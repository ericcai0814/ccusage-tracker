## 1. 專案初始化：Monorepo 結構（packages/server + packages/cli）

- [x] 1.1 初始化 monorepo 結構（pnpm workspace），建立 packages/server 與 packages/cli 目錄
- [x] 1.2 設定 packages/server 的 package.json，加入 Hono + Bun + bun:sqlite 作為 Server 技術棧的依賴
- [x] 1.3 設定 packages/cli 的 package.json，加入 CLI entry point
- [x] 1.4 設定 TypeScript 共用設定（tsconfig.json）

## 2. Server：資料庫層

- [x] 2.1 實作 SQLite schema（members 表 + usage_records 表），含 store API key securely 的 SHA-256 hash 欄位
- [x] 2.2 實作資料庫初始化與自動 migration 邏輯
- [x] 2.3 實作 typed query helpers（insert、query、aggregate）

## 3. Server：Member Management + API Key 認證（per-member）

- [x] 3.1 實作 create member endpoint（POST /api/admin/members），含 duplicate member name 檢查
- [x] 3.2 實作 list members endpoint（GET /api/admin/members），API key 不得出現在回應中
- [x] 3.3 實作 admin API key 認證 middleware

## 4. Server：Usage Ingest

- [x] 4.1 實作 authenticate ingest requests middleware（Bearer token + constant-time comparison）
- [x] 4.2 實作 validate ingest payload 邏輯（必填欄位、型別檢查）
- [x] 4.3 實作 ingest token usage data endpoint（POST /api/ingest），含 duplicate session ingest 冪等處理

## 5. Server：Usage Report

- [x] 5.1 實作 query daily usage report endpoint（GET /api/report/daily），含 date range 與 member 篩選
- [x] 5.2 實作 query summary report endpoint（GET /api/report/summary），支援 period=today/week/month
- [x] 5.3 實作 health check endpoint（GET /api/health）
- [x] 5.4 實作 authenticate report requests middleware

## 6. Server：Dashboard：Hono JSX Server-Side Render

- [x] 6.1 實作 dashboard page（GET /），使用 Hono JSX server-side rendering
- [x] 6.2 實作 dashboard data display：summary cards（總成本、總 token、活躍成員數）+ member table
- [x] 6.3 實作 period switching（today/week/month 切換）
- [x] 6.4 實作 dashboard authentication (optional) — DASHBOARD_PASSWORD 環境變數 basic auth

## 7. SessionEnd Hook 上報機制：ccusage --json 作為資料來源（不自己解析 JSONL）

- [x] 7.1 實作 report usage on session end：session-end.sh hook script，read hook payload 取得 session_id，呼叫 ccusage --json 取得資料並 POST 到 server
- [x] 7.2 實作 non-blocking execution（背景 curl + exit 0）
- [x] 7.3 實作 privacy protection：確保只傳 token 數字，不傳對話內容
- [x] 7.4 實作容錯：config file missing、ccusage not installed、malformed payload 時靜默退出

## 8. CLI：Setup Command

- [x] 8.1 實作 setup command interactive 互動式問答（name、server URL、API key）
- [x] 8.2 實作 write config file 到 ~/.config/ccusage-tracker/config.json
- [x] 8.3 實作 install SessionEnd hook：patch ~/.claude/settings.json（deep merge 保留既有 hooks）
- [x] 8.4 實作 backup settings before patch（settings.json.backup）
- [x] 8.5 實作 verify server connectivity（GET /api/health）
- [x] 8.6 實作 check ccusage installation 並在未安裝時顯示提示

## 9. CLI：Report & Status Commands

- [x] 9.1 實作 report command：query server + 格式化 terminal table 輸出
- [x] 9.2 實作 report command period filter（--period today/week/month）
- [x] 9.3 實作 report command JSON output（--json flag）
- [x] 9.4 實作 status command：顯示 config、server、hook、member 狀態

## 10. 部署：Zeabur Container 部署 + Persistent Volume

- [x] 10.1 建立 Dockerfile（Bun + Alpine）
- [x] 10.2 建立 zeabur.json（container 配置 + persistent volume）
- [ ] 10.3 端到端驗證：setup → hook trigger → ingest → report → dashboard 完整流程
