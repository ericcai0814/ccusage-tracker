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
| Hook | Node CLI 子命令（`tracker hook session-end` / `session-start`） |
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

**先決條件**：Node 18+ 與 `ccusage`（透過 `npm install -g ccusage@latest`）。

一行指令，約 30 秒完成：

```bash
npx @ericcai/ccusage-tracker-cli@latest setup
```

或先安裝 CLI 再執行：

```bash
npm install -g @ericcai/ccusage-tracker-cli
tracker setup
```

安裝時會互動式詢問**名字**、**Server URL**、**Team Key**（向管理員索取）。也可全旗標模式跳過互動：

```bash
tracker setup --name Alice --server-url https://tracker.example.com --team-key sk-tracker-xxx
```

### Windows 支援

Windows 用戶在 PowerShell 或 Windows Terminal 跑同樣指令即可，**不需要 Git Bash、不需要 jq**。CLI 完全是 plain Node ESM，跨平台一致。

### Setup 做了什麼

| 步驟 | 動作 | 路徑/說明 |
|------|------|----------|
| 1 | 寫入設定檔 | `~/.config/ccusage-tracker/config.json` |
| 2 | 注入 SessionStart + SessionEnd hooks | 修改 `~/.claude/settings.json`（先備份） |
| 3 | 偵測舊版 bash hook | 若有則自動覆寫為新 CLI 指令，備份到 `.backup-pre-cli-migration` |
| 4 | 驗證 server 連線 | `GET /api/health` |
| 5 | 檢查 `ccusage` | 若未安裝給出安裝指示 |

Hook command 寫入 `settings.json` 的值是 `tracker hook session-end`（或 `tracker hook session-start`）— 字面 CLI 子命令，不含任何絕對路徑或 shell 字串。

### 安裝後的檔案

```
~/.config/ccusage-tracker/
  config.json          # server URL、team key、成員名字
  sessions/<id>        # SessionStart 記下的 model（SessionEnd 讀完即刪）
  buffer.jsonl         # POST 失敗時的本機暫存（自動建立/清除）

~/.claude/
  settings.json        # 被加入兩筆 hook 條目（SessionStart + SessionEnd）
  settings.json.backup # 原始 settings.json 備份（或 .backup-pre-cli-migration 若是從 bash 遷移）
```

### 更新

CLI 與 hook 邏輯走同一個 npm 套件，一行指令更新：

```bash
npm update -g @ericcai/ccusage-tracker-cli
```

不需要重跑 setup，hook command 已是版本無關的 `tracker hook session-end` 引用。

## 卸載

```bash
tracker uninstall                       # 移除 hook 條目 + 刪除 ~/.config/ccusage-tracker/
npm uninstall -g @ericcai/ccusage-tracker-cli   # 移除 CLI 本體
```

`tracker uninstall` 預設會確認再刪 config 目錄，加 `--yes` 跳過確認。

不影響 `ccusage`，它是獨立工具。

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
跑 `npm update -g @ericcai/ccusage-tracker-cli`。CLI 內含 hook 子命令，更新 CLI 就等於更新 hook。

**Q: Windows 可以用嗎？**
可以。CLI 是 plain Node ESM，PowerShell 或 Windows Terminal 直接跑 `npx @ericcai/ccusage-tracker-cli@latest setup`，不需要 Git Bash 或 jq。

**Q: 從舊的 bash 版本升級？**
跑一次 `npx @ericcai/ccusage-tracker-cli@latest setup`，setup 會自動偵測 `~/.claude/settings.json` 內的 `bash <path>/session-end.sh` 字樣並覆寫為新的 `tracker hook session-end`，備份原檔到 `settings.json.backup-pre-cli-migration`。
