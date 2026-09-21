## Why

目前儀表板只有三張摘要卡與一張成員表，管理者看不出趨勢、看不出錢花在哪個來源、也沒有任何「接近上限」的提示。Eric 2026-09-19 提出要能回答「用了多少、花在哪裡、是否接近預算」，並以 Twister5 的營運總覽為參考。第一階段只用既有資料就能做到大部分，不需要改 hook，合併即可上線。

## What Changes

- 儀表板改版為總覽頁：KPI 列（總花費、總 token、活躍成員、Claude 對話回合）、每日成本趨勢折線（Claude 與 Codex 兩條線，可切來源）、成員排行（單色橫條）、供應商切分（Anthropic 對 OpenAI 的堆疊比例與兩格金額）、模型表（出現天數與使用人數）。維持 S29 Cyber-Bio Noir 樣式與 server-side rendering，不引入前端框架；圖表以 inline SVG 繪製，hover 讀數用原生 `<title>` 或少量原生 script。
- 新增團隊設定：`settings` 資料表與 admin API，可設定月預算（USD）。設定後 KPI 的花費卡顯示已用百分比、月底推估與超支提示；未設定時不顯示預算相關內容。
- 新增查詢：依日期與來源聚合、Claude 回合數加總、模型出現天數與使用人數。
- 不動 hook、CLI、ingest；每模型成本與訂閱額度視角留給下一個 change（需 client 更新）。

## Capabilities

### New Capabilities

- `team-settings`: 團隊層級設定的儲存與 admin API，第一個設定是月預算。

### Modified Capabilities

- `dashboard`: Dashboard data display 需求改為總覽頁的五個區塊；新增趨勢、排行與供應商、預算參考三個需求。

## Impact

- Affected specs: dashboard, team-settings
- Affected code:
  - New: packages/server/src/routes/admin-settings.test.ts, packages/server/src/settings.ts, packages/server/src/settings.test.ts
  - Modified: packages/server/src/db.ts, packages/server/src/db.test.ts, packages/server/src/queries.ts, packages/server/src/queries.test.ts, packages/server/src/routes/admin.ts, packages/server/src/routes/dashboard.tsx, packages/server/src/routes/dashboard.test.ts, packages/server/src/app.ts, README.md, CHANGELOG.md
  - Removed: （無）
- 只改 server；資料庫新增一張 `settings` 表（idempotent CREATE TABLE），不改既有表。不新增依賴。
