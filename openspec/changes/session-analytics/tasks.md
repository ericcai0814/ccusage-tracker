## 1. 資料庫 Schema 與查詢函式

- [x] 1.1 在 `db.ts` 新增 session_metrics table schema（參照 design「Session Metrics Table Schema」決策），包含所有欄位定義、UNIQUE(member_id, session_id) 約束、以及 INDEX on started_at。透過 migration 函式確保既有資料庫升級（同 `migrateLastSeenAt` pattern）。涵蓋 spec「Store session behavior metrics」
- [x] 1.2 在 `queries.ts` 新增 session metrics 寫入函式 `insertSessionMetrics`，實作 INSERT ... ON CONFLICT(member_id, session_id) DO UPDATE（UPSERT）。輸入為已驗證的 payload + member_id，輸出為寫入結果。涵蓋 spec「Store session behavior metrics」的 UPSERT 行為
- [x] 1.3 在 `queries.ts` 新增週報聚合查詢函式（參照 design「聚合查詢策略」決策）：`getWeeklyOverview`（SUM/AVG/COUNT）、`getMemberComparison`（GROUP BY member_id）、`getToolHeatmap`（json_each 展開 tool_calls）、`getAnomalousSessions`（多條件 OR 篩選）、`getSkillUsageSummary`（json_each 展開 skills_invoked）、`getWeeklyCostTrend`（JOIN usage_records）。所有查詢以 started_at BETWEEN ? AND ? 篩選週範圍

## 2. Session Ingest Endpoint

- [x] [P] 2.1 建立 `packages/server/src/routes/session-ingest.ts`，實作 `POST /` route（參照 design「Ingest Endpoint 設計」決策）。使用 `team-auth` middleware 驗證身份。驗證必要欄位（member_name、session_id、started_at、ended_at），驗證數值欄位為非負有限數值，驗證 tool_calls 為物件、skills_invoked 為字串陣列。透過 `findOrCreateMember` 解析 member_id 後呼叫 `insertSessionMetrics`。成功回傳 `{"ok": true}`，驗證失敗回傳 HTTP 400 含欄位錯誤清單。涵蓋 spec「Ingest session metrics via API」與「Validate numeric fields」
- [x] 2.2 在 `app.ts` 註冊 session-ingest route 為 `/api/ingest/session`。import session-ingest module 並呼叫 `app.route("/api/ingest/session", sessionIngest)`

## 3. Weekly Report Endpoint

- [x] [P] 3.1 建立 `packages/server/src/routes/weekly-report.tsx`（參照 design「Weekly Report 渲染」決策），實作 `GET /` route。使用 `dashboard-auth` middleware。解析 `week` query parameter（格式 `YYYY-Www`，預設當前週），驗證格式並計算週一～週日的日期範圍。回傳完整 HTML 頁面含內嵌 CSS。涵蓋 spec「Generate weekly report via API」
- [x] 3.2 在 `app.ts` 註冊 weekly-report route 為 `/api/report/weekly`
- [x] 3.3 實作 overview 區塊：呼叫 `getWeeklyOverview` 查詢，渲染 sessions 數、總時數、commit 率、平均 turns、tool errors。涵蓋 spec「Report overview section」
- [x] 3.4 實作 member comparison table：呼叫 `getMemberComparison` 查詢，渲染 HTML table（member name、sessions、turns、files edited、files written、commits、errors），按 turns 降序排列。涵蓋 spec「Member comparison table」
- [x] 3.5 實作 tool usage heatmap：呼叫 `getToolHeatmap` 查詢，渲染 tool × member 矩陣 HTML table，cell 背景色強度按數值相對最大值比例設定。無資料時顯示空狀態訊息。涵蓋 spec「Tool usage heatmap」
- [x] 3.6 實作 anomalous session detection 區塊：呼叫 `getAnomalousSessions` 查詢，渲染異常 session 清單（member、session name、project、turns、duration、files edited、errors、anomaly reasons）。三種異常條件：turns>=20 且無 edit/write、errors>=5、duration>=60 且無 commit。無異常時顯示正常訊息。涵蓋 spec「Anomalous session detection」
- [x] 3.7 實作 skill usage summary 區塊：呼叫 `getSkillUsageSummary` 查詢，渲染各 skill 的使用 session 數與使用成員列表，按使用次數降序排列。無資料時顯示空狀態訊息。涵蓋 spec「Skill usage summary」
- [x] 3.8 實作 cost trend 區塊：呼叫 `getWeeklyCostTrend` 查詢（JOIN usage_records），渲染 7 天每日成本折線圖（inline SVG polyline 或 CSS bar chart）。無資料日顯示零值，完全無資料時顯示空狀態訊息。涵蓋 spec「Cost trend integration」

## 4. 測試

- [x] [P] 4.1 撰寫 `session-ingest.test.ts`：測試成功 ingest、缺少必要欄位、無效數值、無效 tool_calls 格式、無效 auth、member 自動建立、冪等 re-ingest。對應 spec「Ingest session metrics via API」「Validate numeric fields」「Store session behavior metrics」所有 scenarios
- [x] [P] 4.2 撰寫 `weekly-report.test.ts`：測試當週報告（無 week 參數）、指定週報告、無效 week 格式、無資料空狀態、無效 auth。對應 spec「Generate weekly report via API」所有 scenarios
- [x] [P] 4.3 撰寫 `queries.test.ts` 新增測試：測試 `insertSessionMetrics` UPSERT 行為、各聚合查詢函式的正確性（overview、member comparison、tool heatmap、anomalous sessions、skill usage、cost trend）

## 5. 整合驗證

- [x] 5.1 端對端驗證：啟動 server → curl POST `/api/ingest/session` 寫入測試資料 → curl GET `/api/report/weekly` 確認 HTML 正確渲染所有區塊。確認 DB migration 在既有資料庫上正常執行
