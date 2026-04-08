## Why

團隊目前透過 ccusage-tracker 追蹤 token 消耗與成本（「花了多少」），但無法回答「AI 用得好不好」。缺乏對 session 層級行為指標（turns、edits、commits、tool 使用、錯誤率）的可見性，導致無法識別低效互動模式、無法跨成員比較使用品質。需要建立 session 行為分析能力，每週產出聚合報告，讓團隊能據此改善 AI 使用方式。

## What Changes

- 新增 `session_metrics` 資料表，儲存每個 session 的行為指標（turns、edits、commits、tool 使用分布、錯誤數等）
- 新增 `POST /api/ingest/session` endpoint，接收並驗證 session 行為資料
- 新增 `GET /api/report/weekly` endpoint，聚合 session 指標並產生 HTML 週報
- 週報涵蓋：總覽、成員比較、效率分佈、工具熱力圖、異常 session、Skill 使用率、成本趨勢

## Non-Goals

- **Repo 更名**：`ccusage-tracker` → `claude-team-analytics` 的更名獨立處理，不包含在此變更
- **Plugin 開發**：用於萃取 session metrics 的 Claude Code plugin 屬於獨立 repo，不在此變更範圍
- **即時 Dashboard 整合**：現有 dashboard 暫不修改，週報作為獨立頁面提供
- **PDF 輸出**：週報以 HTML 為主，PDF 轉換按需使用 vault-to-pdf skill

## Capabilities

### New Capabilities

- `session-ingest`: 接收並儲存 session 行為指標。包含新的 `session_metrics` 資料表定義、`POST /api/ingest/session` endpoint 的驗證與寫入邏輯、以及 member 自動建立整合
- `weekly-report`: 聚合 session 指標並產生 HTML 週報。包含 `GET /api/report/weekly` endpoint、跨成員聚合查詢、HTML 頁面渲染（總覽、成員比較、效率分佈、工具熱力圖、異常偵測、成本趨勢圖表）

### Modified Capabilities

（無）

## Impact

- 新增程式碼：
  - `packages/server/src/db.ts` — 新增 `session_metrics` 資料表 schema 與 migration
  - `packages/server/src/routes/session-ingest.ts` — 新 endpoint route
  - `packages/server/src/routes/weekly-report.tsx` — 週報 HTML 頁面（Hono JSX）
  - `packages/server/src/queries.ts` — 新增 session metrics 相關查詢函式
  - `packages/server/src/app.ts` — 註冊新 routes
- 既有程式碼影響最小：僅 `db.ts`（新增 table）與 `app.ts`（註冊 route）需修改
- API 變更：新增兩個 endpoint，既有 API 不受影響
- 依賴：無新外部依賴，延用現有 Hono + Bun SQLite 技術棧
