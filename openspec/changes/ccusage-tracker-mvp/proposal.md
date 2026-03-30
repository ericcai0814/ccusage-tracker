## Why

多人共用同一組 Claude Code 訂閱帳號時，無法知道每位成員各自消耗了多少 token。
ccusage 已能解析本機 session 數據產出報表，但僅限單機使用，缺乏跨機器的團隊彙整能力。
本專案在 ccusage 之上建立多人用量收集與查看層，讓團隊管理者掌握每人的使用狀況。

## What Changes

- 新增中央 Server，接收各成員機器上報的 token 用量數據，儲存於 SQLite
- 新增 SessionEnd Hook，在每次 Claude Code session 結束時自動呼叫 `ccusage --json` 並 POST 到 Server
- 新增 CLI 工具，提供 `setup`（一次性設定 hook）、`report`（查詢用量）、`status`（檢查設定）指令
- 新增 Web Dashboard，以表格形式呈現各成員的 token 用量彙總

## Non-Goals (optional)

- 即時推送 / WebSocket 通知
- 圖表視覺化（Chart.js 等）— MVP 僅提供表格
- 多組織 / 多團隊支援
- Email 定期報告
- Rate limiting / 預算警告
- 對話內容的收集或分析 — 僅傳 token 數字

## Capabilities

### New Capabilities

- `usage-ingest`: 接收並儲存成員上報的 token 用量數據，含 API key 驗證與冪等寫入
- `usage-report`: 提供按日期、成員查詢 token 用量彙總的 API endpoint
- `member-management`: 管理團隊成員（建立、列出），產生各成員的 API key
- `session-hook`: SessionEnd hook script，整合 ccusage --json 自動上報用量到 Server
- `cli-tool`: CLI 工具提供 setup（配置 hook）、report（查詢用量）、status（檢查設定）指令
- `dashboard`: Web 表格頁面，呈現各成員 token 用量彙總，支援按日/週/月切換

### Modified Capabilities

（無，全新專案）

## Impact

- 新增 monorepo 結構：`packages/server/`、`packages/cli/`
- 依賴：Hono（HTTP framework）、bun:sqlite（內建）、ccusage（CLI 依賴）
- 部署：Zeabur container + persistent volume
- 各成員機器：需安裝 CLI 並執行一次 `setup`，會修改 `~/.claude/settings.json` 加入 SessionEnd hook
