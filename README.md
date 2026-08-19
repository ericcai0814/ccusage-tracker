# ccusage-tracker

[![npm version](https://img.shields.io/npm/v/ccusage-tracker?color=cb3837&label=npm&logo=npm)](https://www.npmjs.com/package/ccusage-tracker)
[![npm downloads](https://img.shields.io/npm/dw/ccusage-tracker?color=cb3837&label=downloads&logo=npm)](https://www.npmjs.com/package/ccusage-tracker)
[![license](https://img.shields.io/github/license/ericcai0814/ccusage-tracker?color=blue)](./LICENSE)
[![node](https://img.shields.io/node/v/ccusage-tracker?logo=node.js&logoColor=white)](https://nodejs.org)
[![built with Bun](https://img.shields.io/badge/built%20with-Bun-fbf0df?logo=bun&logoColor=000)](https://bun.sh)
[![framework Hono](https://img.shields.io/badge/framework-Hono-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://sqlite.org)
[![deploy Zeabur](https://img.shields.io/badge/deploy-Zeabur-6300FF)](https://zeabur.com)
[![Claude Code hook](https://img.shields.io/badge/Claude%20Code-Stop%20%2B%20SessionEnd%20hook-D97757)](https://www.anthropic.com/claude-code)
[![CHANGELOG](https://img.shields.io/badge/CHANGELOG-v0.3.4-informational)](./CHANGELOG.md)

> 團隊 Claude Code token 用量追蹤工具，基於 [ccusage](https://github.com/ryoppippi/ccusage) 建立多人彙整層。
> 一行 `npx ccusage-tracker setup` 安裝、跨平台、不傳對話內容、失敗自動暫存重試。

`#claude-code` · `#ccusage` · `#token-usage` · `#self-hosted` · `#hono` · `#bun` · `#sqlite` · `#typescript` · `#zeabur`

## 它解決什麼問題

多人共用一組 Claude Code 訂閱帳號時，無法得知每位成員各自消耗了多少 token。本工具在每次 Claude Code session 結束時，自動上報 token 用量到中央 server，讓管理者掌握每人的使用狀況。

## 架構

```
成員的電腦                              中央 Server
┌─────────────────────────┐            ┌──────────────────────┐
│ Claude Code 每輪對話結束 │            │ Hono + Bun           │
│ --> Stop hook 觸發       │            │ --> SQLite 儲存       │
│     (5min throttle)     │            │ --> 更新 last_seen_at │
│ --> ccusage 取得 token   │   POST     │ --> Dashboard 顯示    │
│ --> 抽 session metrics   │ ────────>  │ --> Report API        │
│ --> fetch 上報           │            │                      │
│ --> 失敗時暫存到本機     │            │ (SessionEnd 兜底)    │
└─────────────────────────┘            └──────────────────────┘
```

### 技術棧

| 元件 | 技術 |
|------|------|
| Server | [Hono](https://hono.dev/) + [Bun](https://bun.sh/) |
| 資料庫 | bun:sqlite（SQLite WAL mode） |
| Dashboard | Hono JSX Server-Side Rendering |
| Hook | Node.js script（ccusage + fetch，跨平台 macOS/Linux/Windows） |
| 部署 | Zeabur（Docker container + persistent volume） |

### 資料流

1. Claude Code 每輪對話結束 --> 觸發 `Stop` hook（v0.3.2+ 主要路徑）
2. 檢查 `~/.config/ccusage-tracker/last-flush.txt`：距上次 < 5 分鐘就直接 `exit 0`（throttle）
3. 過 throttle 後立即寫 last-flush 戳記（避免 race / 失敗時連續打 server）
4. Hook 呼叫 `ccusage daily --json --since today` 取得當日 token 數據（25 秒 timeout）。取數失敗時寫 `last-error.txt`，可用 `tracker status` 查看
5. Hook 抽 session 行為指標（turns、tool_calls 等）+ POST 到 server 的 `/api/ingest` 與 `/api/ingest/session`（upsert，重複上報安全）
6. POST 失敗時，payload 暫存到 `buffer.jsonl`，下次自動重送
7. 最後才處理 `buffer.jsonl` 的重送（上限 15 秒，並依剩餘時間動態縮減）。當日快照排在前面，才不會被積壓的舊資料吃掉時間預算
8. 整支腳本 40 秒硬性上限（`__deadline`），逾時直接結束並寫 `last-error.txt`
9. session 結束時，`SessionEnd` hook 跑一次「兜底」（無 throttle）— 若主程序退出 race 導致 Stop 最近沒跑成，這裡補上
10. Server 驗證 TEAM_KEY，自動建立/識別成員，寫入 SQLite，更新 `last_seen_at`
11. Dashboard / API 讀取 SQLite 產出報表，超過 24 小時未回報的成員顯示警告

### 隱私

- 只傳 token 計數和成本估算，不傳對話內容
- Hook 失敗不影響 Claude Code 正常運作（永遠 exit 0）

## 成員安裝

一行指令、跨平台、約 30 秒完成。先確保已安裝 [Node.js](https://nodejs.org)（>=18）。

```bash
npx ccusage-tracker setup
```

會依序詢問：
- **Your name**：成員名字（會顯示在 dashboard）
- **Server URL**：團隊自架的 tracker 網址（例如 `https://cctracker.erictree.me`）
- **Team Key**：向管理員索取，會即時驗證

> 也提供 shell-only 安裝（不經 npm，由 server 直接下發 setup script）：`curl -fsSL <server>/setup.sh | bash` 或 PowerShell `irm <server>/setup.ps1 | iex`。兩條路最終效果相同。

### Setup 做了什麼

安裝腳本會依序執行以下操作：

| 步驟 | 動作 | 路徑/說明 |
|------|------|----------|
| 1 | 檢查 Node.js / 安裝 `ccusage` | `npm install -g ccusage@latest` |
| 2 | 寫入設定檔 | `~/.config/ccusage-tracker/config.json` |
| 3a | 下載 hook scripts | `~/.config/ccusage-tracker/session-end.mjs`、`session-start.mjs` |
| 3b | 注入 SessionStart + SessionEnd + Stop hook | 修改 `~/.claude/settings.json`（先備份；命令字串會自動 migrate 0.1.1 舊格式） |
| 4 | 驗證 server 連線 | `GET /api/health` |

> macOS/Linux 的 `setup.sh` 另會自動安裝 `jq`（brew/apt/apk）用於合併 `settings.json`；Windows 的 `setup.ps1` 改用 PowerShell 原生 JSON，不需 jq。兩者裝出的上報 hook 都是 `node session-end.mjs`。

### 安裝後的檔案

```
~/.config/ccusage-tracker/
  config.json          # server URL、team key、成員名字
  session-end.mjs      # 共用上報腳本（Stop 與 SessionEnd 都跑這個，靠 --mode 區分）
  session-start.mjs    # SessionStart hook script（記錄 model）
  sessions/            # 各 session 的 model 暫存（SessionEnd 讀後清除）
  last-flush.txt       # Stop hook 上次上報時間戳（5min throttle 用）
  buffer.jsonl         # POST 失敗時的本機暫存（自動建立/清除）

~/.claude/
  settings.json        # 被加入了 SessionStart + SessionEnd + Stop hooks
  settings.json.backup # 原始 settings.json 備份（只有 settings 真有變動時才產生）
```

### 更新 Hook 腳本

當 server 發布新版本後，重跑安裝指令即可，`@latest` 強制 npm 抓最新版：

```bash
npx ccusage-tracker@latest setup
```

config 會被覆寫但已收集的本機暫存（`buffer.jsonl`）會保留，下次 session 結束會自動補回切換期間的回報。

## 卸載

一行指令：

```bash
curl -fsSL https://cctracker.erictree.me/uninstall.sh | bash
```

卸載會：
1. 從 `~/.claude/settings.json` 移除 SessionStart + SessionEnd + Stop 三條 ccusage-tracker hook（不動其他 hook）
2. 刪除 `~/.config/ccusage-tracker/` 目錄（config + hook script + buffer + last-flush）

不影響 jq 和 ccusage，它們是獨立工具。

## 查看用量

### Dashboard

打開瀏覽器訪問：

```
https://cctracker.erictree.me
```

支援 Today / Week / Month 切換。Dashboard 包含：
- 摘要卡片：總成本、總 token、活躍成員數
- 每日走勢圖
- 成員用量表格（含 Last Report 欄位與 stale 警告）

### API

```bash
# 摘要報表（含 last_seen_at）
curl -H "Authorization: Bearer <TEAM_KEY>" \
  "https://cctracker.erictree.me/api/report/summary?period=month"

# 每日明細
curl -H "Authorization: Bearer <TEAM_KEY>" \
  "https://cctracker.erictree.me/api/report/daily?from=2026-03-01&to=2026-03-31"
```

### CLI

安裝（`setup`）後，可直接用 CLI 在終端機查看團隊用量，免開瀏覽器。bin 不在全域 PATH，請以 `npx ccusage-tracker@latest` 呼叫：

```bash
# 查看用量報表（預設 period 為 month）
npx ccusage-tracker@latest report

# 指定期間：today / week / month
npx ccusage-tracker@latest report --period today
npx ccusage-tracker@latest report --period week
npx ccusage-tracker@latest report --period month

# 以 JSON 輸出（方便接其他工具）
npx ccusage-tracker@latest report --period today --json

# 檢查本機設定、hook、server 連線、暫存筆數
npx ccusage-tracker@latest status
```

| 指令 | 參數 | 說明 |
|------|------|------|
| `report` | `--period <today\|week\|month>` | 查看團隊用量摘要表，預設 `month`；無效值自動 fallback 為 `month` |
| `report` | `--json` | 輸出原始 JSON（含每位成員的 input/output/cache token 與成本） |
| `status` | （無） | 顯示 config 路徑、成員名字、server 可達性與版本、`buffer.jsonl` 待送筆數、`ccusage` 是否安裝 |
| `setup` | （無） | 互動式設定 server 連線並注入 hook（見上方「成員安裝」） |

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
        scripts.ts           # setup.sh/.ps1 + session-end.sh/.mjs 產生器
        middleware/
          team-auth.ts       # TEAM_KEY 認證
          admin-auth.ts      # ADMIN_API_KEY 認證
          dashboard-auth.ts  # Dashboard Basic Auth
        routes/
          ingest.ts          # POST /api/ingest
          report.ts          # GET /api/report/*
          admin.ts           # POST/GET /api/admin/members
          dashboard.tsx      # GET / (Hono JSX SSR)
    cli/                     # CLI 工具（npx ccusage-tracker@latest setup/report/status）
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
表示該成員超過 24 小時未回報。可能是 hook 壞掉、設定錯誤、或未安裝。請該成員執行 `npx ccusage-tracker@latest status` 檢查。

**Q: 重複上報會導致數據重複嗎？**
不會。Server 用 `(member_id, date, session_id)` 做唯一鍵，重複上報會覆蓋而非新增。

**Q: 成員需要手動建立嗎？**
不需要。第一次上報時 server 會自動建立成員。

**Q: 不想被追蹤怎麼辦？**
按照上方「卸載」步驟移除即可，30 秒內完成。

**Q: 如何更新 hook 到最新版？**
見上方「更新 Hook 腳本」章節（macOS/Linux 用 `curl`、Windows 用 `irm` 下載最新的 `session-end.mjs`），或直接重跑安裝指令。
