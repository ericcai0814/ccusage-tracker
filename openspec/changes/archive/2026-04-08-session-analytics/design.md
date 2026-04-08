## Context

ccusage-tracker 是基於 Hono + Bun SQLite 的團隊 AI 用量追蹤 server，目前包含：
- `POST /api/ingest` — 接收每日 token/cost 資料，寫入 `usage_records` table
- `GET /api/report` — 查詢每日用量報告
- Dashboard（Hono JSX）— 即時用量 dashboard
- Auth — timing-safe team key 驗證（`team-auth` middleware）
- Member 自動建立 — 首次 ingest 時自動建立成員

現有 `extract-session-metrics.py`（已驗證）可從 Claude Code JSONL transcript 萃取 session 行為指標，輸出 JSON 物件包含 turns、tool 使用、commit、errors 等欄位。本變更將 server 端擴展為能接收、儲存、聚合這些指標。

## Goals / Non-Goals

**Goals:**

- 提供 `POST /api/ingest/session` endpoint 接收 session 行為資料
- 新增 `session_metrics` table 持久化儲存 session 指標
- 提供 `GET /api/report/weekly` 產生跨成員聚合週報 HTML
- 延用現有 auth 機制與 member 管理邏輯

**Non-Goals:**

- 不修改現有 `/api/ingest`、`/api/report`、dashboard 的行為
- 不處理 client-side metrics 萃取（由 plugin 負責）
- 不做即時推播或 WebSocket，週報為靜態 HTML
- 不加入外部依賴（chart library 等），圖表用 inline SVG 或 CSS bar

## Decisions

### Session Metrics Table Schema

採用扁平化 schema + JSON 欄位混合設計：

```sql
CREATE TABLE IF NOT EXISTS session_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL REFERENCES members(id),
  session_id TEXT NOT NULL,
  session_name TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  user_messages INTEGER NOT NULL DEFAULT 0,
  assistant_messages INTEGER NOT NULL DEFAULT 0,
  user_avg_chars INTEGER NOT NULL DEFAULT 0,
  tool_calls TEXT NOT NULL DEFAULT '{}',
  tool_call_total INTEGER NOT NULL DEFAULT 0,
  tool_errors INTEGER NOT NULL DEFAULT 0,
  skills_invoked TEXT NOT NULL DEFAULT '[]',
  hook_blocks INTEGER NOT NULL DEFAULT 0,
  files_read INTEGER NOT NULL DEFAULT 0,
  files_written INTEGER NOT NULL DEFAULT 0,
  files_edited INTEGER NOT NULL DEFAULT 0,
  has_commit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, session_id)
);
```

**理由：** 數值欄位直接存為 INTEGER 以便聚合查詢（SUM/AVG）；`tool_calls`（物件）和 `skills_invoked`（陣列）存為 JSON TEXT，透過 SQLite `json_each()` 聚合。UNIQUE(member_id, session_id) 確保冪等性。

**替代方案：** 正規化 tool_calls 為獨立 table — 拒絕，因為 tool 種類不固定、查詢主要是聚合而非個別 lookup，JSON 足以應對。

### Ingest Endpoint 設計

複用現有 `team-auth` middleware，與 `/api/ingest` 相同的驗證流程。Payload 格式與 `extract-session-metrics.py` 輸出一致，server 端負責：
1. 驗證必要欄位（session_id、member_name、started_at、ended_at）
2. 透過 `findOrCreateMember` 解析 member_id
3. UPSERT 寫入 `session_metrics`（以 member_id + session_id 為 key）

**理由：** UPSERT 而非 INSERT 確保重試安全。欄位驗證在 server 端做，不信任 client。

### Weekly Report 渲染

延用 Hono JSX pattern（同 dashboard.tsx），以 `GET /api/report/weekly?week=2026-W15` 回傳完整 HTML 頁面。

報告區塊：
1. **總覽** — sessions 數、總時數、commit 率、平均 turns
2. **成員比較** — 表格：每人 turns、edits、commits、tool errors
3. **效率分佈** — 各 session 的 edits/turn 分佈（CSS bar chart）
4. **工具熱力圖** — tool × member 使用次數矩陣（HTML table + background-color）
5. **異常 Session** — 高 turns + 低產出 + 有 error 的 session 清單
6. **Skill 使用率** — 各 skill 的跨成員使用頻率
7. **成本趨勢** — 結合 usage_records 的每日 cost 折線（inline SVG polyline）

Auth 使用 `dashboard-auth` middleware（與現有 dashboard 一致）。

**理由：** Server-side rendered HTML 不需前端 framework、不增加依賴、可直接用瀏覽器開啟或轉 PDF。Hono JSX 已在 dashboard 驗證可行。

**替代方案：** 前端 SPA + API — 拒絕，過度工程。

### 聚合查詢策略

週報聚合使用純 SQLite 查詢：
- 數值指標用 `SUM()` / `AVG()` / `COUNT()`
- Tool 使用聚合用 `json_each(tool_calls)` 展開後 GROUP BY
- 週範圍以 `started_at BETWEEN ? AND ?` 篩選
- 跨 table 結合 `usage_records` 取 cost 資料時 JOIN on member_id + date range

**理由：** SQLite JSON 函式在 Bun runtime 原生支援，資料量（每週 <1000 sessions）不需外部 OLAP。

## Risks / Trade-offs

- **[資料量成長]** → session_metrics 比 usage_records 紀錄數多（每個 session 一筆 vs 每人每天一筆）。短期可接受，長期需加入 retention policy 或歸檔策略。緩解：加 INDEX on (started_at) 確保範圍查詢效能。
- **[JSON 欄位查詢效能]** → `json_each()` 在大量資料時較慢。緩解：週報查詢限定一週範圍（<1000 筆），效能足夠。
- **[Schema 演進]** → metrics 欄位隨 extract script 版本可能增減。緩解：新欄位用 ALTER TABLE ADD COLUMN + DEFAULT，向後相容。
- **[週報 HTML 大小]** → 成員多或 session 多時頁面可能龐大。緩解：設定合理的 pagination 或 top-N 限制。
