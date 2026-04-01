## Context

團隊 5-10 人共用一組 Claude Code 訂閱帳號，各自在自己的機器上使用 Claude Code CLI。
目前無法得知每位成員各自消耗了多少 token。

ccusage（https://github.com/ryoppippi/ccusage）是一個成熟的開源 CLI 工具（12k+ stars），
能解析本機 Claude Code 的 JSONL session 檔案，產出包含 token 計數與成本估算的結構化報表。
但 ccusage 僅限單機使用，無跨機器彙整能力。

本專案在 ccusage 之上建立一層多人彙整架構，不重新實作 JSONL 解析或定價計算。

## Goals / Non-Goals

**Goals:**

- 每位成員只需執行一次 `setup`，之後用量自動上報
- 提供中央化的 token 用量查詢（CLI + Web Dashboard）
- 僅傳 token 數字，不傳對話內容
- Hook 失敗不影響 Claude Code 正常運作

**Non-Goals:**

- 即時推送 / WebSocket 通知
- 圖表視覺化（MVP 僅表格）
- 多組織 / 多團隊支援
- Email 定期報告
- Rate limiting / 預算警告
- 取代 ccusage — 本專案依賴 ccusage，不重複其功能

## Decisions

### Monorepo 結構（packages/server + packages/cli）

採用 pnpm workspace monorepo，server 與 cli 共用型別定義。

**替代方案：** 兩個獨立 repo → 型別同步維護成本高，且 MVP 規模不需要。

### Hono + Bun + bun:sqlite 作為 Server 技術棧

- Hono：輕量 HTTP framework，API 少、學習曲線低
- Bun：原生內建 SQLite（`bun:sqlite`），零額外依賴
- SQLite：5-10 人規模，單檔資料庫足夠，部署簡單

**替代方案：**
- Express + better-sqlite3 → 多一個 native dependency，Dockerfile 更複雜
- PostgreSQL → 過度設計，需要額外的 DB service

### Zeabur Container 部署 + Persistent Volume

Zeabur 支援 container 部署與 persistent volume，SQLite db 檔案掛載在 volume 上。

**替代方案：**
- fly.io → 同樣可行，但用戶偏好 Zeabur（已有使用經驗）
- Vercel → Serverless，無持久化檔案系統，需換 DB 方案

### ccusage --json 作為資料來源（不自己解析 JSONL）

SessionEnd hook 呼叫 `ccusage session --json` 取得當次 session 的 token 數據，
直接 POST 到 server。不自己實作 JSONL parser。

**替代方案：** 自己解析 `~/.claude/projects/**/*.jsonl` → 重複 ccusage 已完成的工作，
且需追蹤 Claude Code JSONL 格式變更。

### SessionEnd Hook 上報機制

每次 Claude Code session 結束時觸發 hook：
1. 從 stdin 讀取 hook payload（含 `session_id`、`transcript_path`）
2. 呼叫 `ccusage session --json --since today` 取得 session 級別數據
3. 背景執行 `curl POST` 上報到 server
4. 永遠 `exit 0`，不阻塞 Claude Code

**冪等設計：** Server 端以 `(member_id, date, session_id)` 為 unique key，
`INSERT OR REPLACE` 確保重複上報不造成數據膨脹。

### API Key 認證（per-member）

每位成員在 `setup` 時取得一把 API key。Server 透過 `Authorization: Bearer <key>` 識別成員身份。

Admin 透過 `ADMIN_API_KEY` 環境變數建立成員並產生 key。

**替代方案：**
- 無認證 → 任何人都能上報假資料
- OAuth → 過度設計

### Dashboard：Hono JSX Server-Side Render

使用 Hono 內建的 JSX SSR，不引入前端框架。一個 HTML 頁面搞定。

**替代方案：** React SPA → 需要 build pipeline、增加部署複雜度，MVP 不需要

## Risks / Trade-offs

**ccusage CLI 必須預裝在每位成員的機器上**
→ `setup` 指令檢查 ccusage 是否存在，若無則提示安裝指令 `npx ccusage@latest`

**ccusage --json 輸出格式可能變更**
→ Hook script 對每個欄位使用 `// 0` fallback，parse 失敗送 0 而非不送

**SessionEnd hook stdin 格式未完整公開**
→ `session_id` 讀取失敗時送空字串，unique constraint 降格為 `(member_id, date)`

**`settings.json` patch 可能破壞既有 hooks**
→ CLI setup 使用 JSON parse → deep merge → 寫回，操作前自動備份原檔

**Server 掛掉時 hook POST 失敗**
→ MVP 接受遺失，未來可加 local buffer 檔案。背景 curl 失敗不影響 Claude Code

**SQLite 單檔案在 container 重啟時可能遺失**
→ Zeabur persistent volume 掛載確保持久化。建議定期 backup
