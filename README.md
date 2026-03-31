# ccusage-tracker

團隊 Claude Code token 用量追蹤工具，基於 [ccusage](https://github.com/ryoppippi/ccusage) 建立多人彙整層。

## 它解決什麼問題

多人共用一組 Claude Code 訂閱帳號時，無法得知每位成員各自消耗了多少 token。本工具在每次 Claude Code session 結束時，自動上報 token 用量到中央 server，讓管理者掌握每人的使用狀況。

## 架構

```
成員的電腦                              中央 Server
┌─────────────────────────┐            ┌──────────────────────┐
│ Claude Code session 結束 │            │ Hono + Bun           │
│ --> SessionEnd hook 觸發 │   POST     │ --> SQLite 儲存       │
│ --> ccusage 取得 token   │ ────────>  │ --> Dashboard 顯示    │
│ --> 背景 curl 上報       │            │ --> Report API        │
└─────────────────────────┘            └──────────────────────┘
```

### 技術棧

| 元件 | 技術 |
|------|------|
| Server | [Hono](https://hono.dev/) + [Bun](https://bun.sh/) |
| 資料庫 | bun:sqlite（SQLite WAL mode） |
| Dashboard | Hono JSX Server-Side Rendering |
| Hook | Bash script（jq + ccusage + curl） |
| 部署 | Zeabur（Docker container + persistent volume） |

### 資料流

1. Claude Code session 結束 --> 觸發 `SessionEnd` hook
2. Hook 呼叫 `ccusage session --json --since today` 取得 token 數據
3. Hook 用背景 `curl` POST 到 server 的 `/api/ingest`
4. Server 驗證 TEAM_KEY，自動建立/識別成員，寫入 SQLite
5. Dashboard / API 讀取 SQLite 產出報表

### 隱私

- 只傳 token 計數和成本估算，不傳對話內容
- Hook 失敗不影響 Claude Code 正常運作（永遠 exit 0）

## 成員安裝

一行指令，約 30 秒完成：

```bash
curl -fsSL https://ccusage-tracker.zeabur.app/setup.sh | bash
```

### Setup 做了什麼

安裝腳本會依序執行以下操作：

| 步驟 | 動作 | 路徑/說明 |
|------|------|----------|
| 1 | 檢查/安裝 `jq` | 用 brew（macOS）或 apt（Linux）安裝 |
| 2 | 檢查/安裝 `ccusage` | `npm install -g ccusage@latest` |
| 3 | 寫入設定檔 | `~/.config/ccusage-tracker/config.json` |
| 4a | 下載 hook script | `~/.config/ccusage-tracker/session-end.sh` |
| 4b | 注入 SessionEnd hook | 修改 `~/.claude/settings.json`（先備份） |
| 5 | 驗證 server 連線 | `GET /api/health` |

### 安裝後的檔案

```
~/.config/ccusage-tracker/
  config.json          # server URL、team key、成員名字
  session-end.sh       # SessionEnd hook script

~/.claude/
  settings.json        # 被加入了一筆 SessionEnd hook
  settings.json.backup # 原始 settings.json 備份
```

### config.json 內容

```json
{
  "server_url": "https://ccusage-tracker.zeabur.app",
  "team_key": "（共用 team key，自動嵌入）",
  "member_name": "（你輸入的名字）"
}
```

### settings.json 被加入的內容

```json
{
  "hooks": {
    "SessionEnd": [
      {
        "type": "command",
        "command": "bash ~/.config/ccusage-tracker/session-end.sh"
      }
    ]
  }
}
```

如果你原本就有其他 hooks，setup 會保留它們（deep merge），不會覆蓋。

## 卸載

如果不想再使用，手動移除以下內容即可：

### 1. 移除 hook

編輯 `~/.claude/settings.json`，刪除 `hooks.SessionEnd` 陣列中 command 包含 `ccusage-tracker` 的那筆：

```bash
# 或直接用 jq 移除
jq '.hooks.SessionEnd |= map(select(.command | contains("ccusage-tracker") | not))' \
  ~/.claude/settings.json > /tmp/settings.json && \
  mv /tmp/settings.json ~/.claude/settings.json
```

### 2. 移除設定檔和 hook script

```bash
rm -rf ~/.config/ccusage-tracker
```

### 3.（選用）還原 settings.json 備份

```bash
cp ~/.claude/settings.json.backup ~/.claude/settings.json
```

卸載不影響 ccusage 和 jq，它們是獨立工具，可自行決定是否保留。

## 查看用量

### Dashboard

打開瀏覽器訪問：

```
https://ccusage-tracker.zeabur.app
```

支援 Today / Week / Month 切換。

### API

```bash
# 摘要報表
curl -H "Authorization: Bearer <TEAM_KEY>" \
  "https://ccusage-tracker.zeabur.app/api/report/summary?period=month"

# 每日明細
curl -H "Authorization: Bearer <TEAM_KEY>" \
  "https://ccusage-tracker.zeabur.app/api/report/daily?from=2026-03-01&to=2026-03-31"
```

## 管理員

### 環境變數

| 變數 | 必填 | 說明 |
|------|------|------|
| `TEAM_KEY` | 是 | 共用認證金鑰，setup script 會自動嵌入 |
| `DB_PATH` | 否 | SQLite 路徑（預設 `/data/ccusage-tracker.db`） |
| `DASHBOARD_PASSWORD` | 否 | Dashboard Basic Auth 密碼（不設則公開） |
| `ADMIN_API_KEY` | 否 | 管理員 API（用於手動建立成員） |

### 本地開發

```bash
pnpm install
TEAM_KEY=dev-key pnpm --filter @ccusage-tracker/server dev

# 跑測試
pnpm -r test
```

## 專案結構

```
ccusage-tracker/
  packages/
    server/                  # Hono server
      src/
        app.ts               # 路由定義
        db.ts                # SQLite schema
        queries.ts           # typed query helpers
        scripts.ts           # setup.sh / session-end.sh 產生器
        middleware/
          team-auth.ts       # TEAM_KEY 認證
          admin-auth.ts      # ADMIN_API_KEY 認證
          dashboard-auth.ts  # Dashboard Basic Auth
        routes/
          ingest.ts          # POST /api/ingest
          report.ts          # GET /api/report/*
          admin.ts           # POST/GET /api/admin/members
          dashboard.tsx      # GET / (Hono JSX SSR)
      scripts/
        session-end.sh       # 舊版 hook（已改為 server 動態提供）
    cli/                     # CLI 工具（已簡化為 curl setup）
  Dockerfile                 # Bun + Alpine
  zeabur.json                # Zeabur 部署設定
  openspec/                  # Spectra SDD 規格文件
```

## FAQ

**Q: Hook 失敗會影響 Claude Code 嗎？**
不會。Hook script 永遠 `exit 0`，所有錯誤靜默處理。

**Q: 重複上報會導致數據重複嗎？**
不會。Server 用 `(member_id, date, session_id)` 做唯一鍵，重複上報會覆蓋而非新增。

**Q: 成員需要手動建立嗎？**
不需要。第一次上報時 server 會自動建立成員。

**Q: 不想被追蹤怎麼辦？**
按照上方「卸載」步驟移除即可，30 秒內完成。
