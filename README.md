# ccusage-tracker

團隊 Claude Code token 用量追蹤工具，基於 [ccusage](https://github.com/ryoppippi/ccusage) 建立多人彙整層。

## 它解決什麼問題

多人共用一組 Claude Code 訂閱帳號時，無法得知每位成員各自消耗了多少 token。本工具在每次 Claude Code session 結束時，自動上報 token 用量到中央 server，讓管理者掌握每人的使用狀況。

## 架構

```
成員的電腦                              中央 Server
┌─────────────────────────┐            ┌──────────────────────┐
│ Claude Code session 結束 │            │ Hono + Bun           │
│ --> SessionEnd hook 觸發 │            │ --> SQLite 儲存       │
│ --> 重送暫存的失敗紀錄   │   POST     │ --> 更新 last_seen_at │
│ --> ccusage 取得 token   │ ────────>  │ --> Dashboard 顯示    │
│ --> 背景 curl 上報       │            │ --> Report API        │
│ --> 失敗時暫存到本機     │            │                      │
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
2. Hook 檢查本機暫存（`buffer.jsonl`），逐筆重送失敗的紀錄（15 秒上限）
3. 清除超過 7 天的暫存紀錄
4. Hook 呼叫 `ccusage daily --json --since today` 取得當日 token 數據
5. Hook 用背景 `curl` POST 到 server 的 `/api/ingest`
6. POST 失敗時，payload 暫存到 `buffer.jsonl`，下次自動重送
7. Server 驗證 TEAM_KEY，自動建立/識別成員，寫入 SQLite，更新 `last_seen_at`
8. Dashboard / API 讀取 SQLite 產出報表，超過 24 小時未回報的成員顯示警告

### 隱私

- 只傳 token 計數和成本估算，不傳對話內容
- Hook 失敗不影響 Claude Code 正常運作（永遠 exit 0）

## 成員安裝

一行指令，約 30 秒完成：

```bash
curl -fsSL https://ccusage-tracker.zeabur.app/setup.sh | bash
```

安裝時會要求輸入名字和 **Team Key**（向管理員索取），Team Key 會即時驗證。

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
  session-end.sh       # SessionEnd hook script (v2)
  buffer.jsonl         # POST 失敗時的本機暫存（自動建立/清除）

~/.claude/
  settings.json        # 被加入了一筆 SessionEnd hook
  settings.json.backup # 原始 settings.json 備份
```

### 更新 Hook 腳本

當 server 發布新版本後，成員需要更新本機的 hook 腳本：

```bash
curl -fsSL https://ccusage-tracker.zeabur.app/scripts/session-end.sh -o ~/.config/ccusage-tracker/session-end.sh
```

## 卸載

一行指令：

```bash
curl -fsSL https://ccusage-tracker.zeabur.app/uninstall.sh | bash
```

卸載會：
1. 從 `~/.claude/settings.json` 移除 SessionEnd hook
2. 刪除 `~/.config/ccusage-tracker/` 目錄（config + hook script + buffer）

不影響 jq 和 ccusage，它們是獨立工具。

## 查看用量

### Dashboard

打開瀏覽器訪問：

```
https://ccusage-tracker.zeabur.app
```

支援 Today / Week / Month 切換。Dashboard 包含：
- 摘要卡片：總成本、總 token、活躍成員數
- 每日走勢圖
- 成員用量表格（含 Last Report 欄位與 stale 警告）

### API

```bash
# 摘要報表（含 last_seen_at）
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
| `DB_PATH` | 是 | SQLite 路徑（設為 `/data/ccusage-tracker.db` 以使用 persistent volume） |
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
        db.ts                # SQLite schema + migration
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
    cli/                     # CLI 工具（tracker setup/report/status）
  Dockerfile                 # Bun + Alpine
  zeabur.json                # Zeabur 部署設定
  openspec/                  # Spectra SDD 規格文件
  CHANGELOG.md               # 版本紀錄
```

## FAQ

**Q: Hook 失敗會影響 Claude Code 嗎？**
不會。Hook script 永遠 `exit 0`，所有錯誤靜默處理。

**Q: Server 斷線會丟失資料嗎？**
不會。v0.2.0 起，POST 失敗時 payload 會暫存到本機 `buffer.jsonl`，下次 session 結束時自動重送。暫存保留 7 天。

**Q: Dashboard 上成員顯示紅色警告是什麼意思？**
表示該成員超過 24 小時未回報。可能是 hook 壞掉、設定錯誤、或未安裝。請該成員執行 `tracker status` 檢查。

**Q: 重複上報會導致數據重複嗎？**
不會。Server 用 `(member_id, date, session_id)` 做唯一鍵，重複上報會覆蓋而非新增。

**Q: 成員需要手動建立嗎？**
不需要。第一次上報時 server 會自動建立成員。

**Q: 不想被追蹤怎麼辦？**
按照上方「卸載」步驟移除即可，30 秒內完成。

**Q: 如何更新 hook 到最新版？**
執行：`curl -fsSL https://ccusage-tracker.zeabur.app/scripts/session-end.sh -o ~/.config/ccusage-tracker/session-end.sh`
