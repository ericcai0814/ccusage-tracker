## Why

目前週報使用白底卡片風格，與 Dashboard 的 S29 Cyber-Bio Noir 視覺風格不一致。更重要的是，現有六個區塊中有兩個（Tool Usage Heatmap、Cost Trend）經分析後確認沒有實際行動價值，而 Anomalous Sessions 的異常定義存在根本性問題（high turns / no commit / errors 都不代表 session 有問題）。需要重新設計區塊結構和查詢邏輯，讓週報成為有洞察力的活動分診工具。

## What Changes

- **Overview 重新設計**：從五個 stat card 改為三層結構——活動摘要（sessions / hours / active members）、session 分佈 bar（依 duration 分類為 Quick / Medium / Deep / Marathon）、Highlights（自動觀察型分析，報告極值和差異，不做好壞判斷）
- **Member Comparison → Project Activity**：一人時為扁平 project 表格；多人時展開 Member × Project 矩陣，按 sessions 數降序排列
- **Tool Usage Heatmap 刪除**：tool 分佈是工作副產品，無分析價值
- **Anomalous Sessions → Session Log + Context %**：改為全量 session 明細表，新增 context_estimate_pct 欄位（超過 70% 標記警示），不再做異常判斷
- **Skill Usage 重新設計**：從簡單列表改為常用 skill 排行（按使用次數降序）+ 未使用 skill 偵測（安裝但本週零使用）
- **Cost Trend 刪除**：與 Dashboard token 用量趨勢重複
- **視覺風格統一**：從白底卡片改為 S29 Cyber-Bio Noir（黑底、紅色 neon glow），共用 Dashboard 的 CSS 變數和字型設定

## Non-Goals

- 不做判斷型指標（commit rate、error rate 等不作為 session 品質指標）
- 不重複 Dashboard 已有的 token 用量圖表
- 不在週報中實作即時互動功能（週報是靜態分診工具，看一次就夠）
- 不建立新的 API 端點——所有查詢函數仍在 queries.ts 中，路由仍使用 `/weekly-report`

## Capabilities

### New Capabilities

- `weekly-report`: 週報頁面的完整渲染——涵蓋 Overview（三層結構）、Project Activity、Session Log + Context %、Skill Usage 四個區塊，使用 S29 Cyber-Bio Noir 風格

### Modified Capabilities

- `usage-report`: 移除 getToolHeatmap、getWeeklyCostTrend、getAnomalousSessions 查詢，新增 getProjectActivity、getSessionLog、getSessionDistribution、getHighlights 查詢，修改 getWeeklyOverview 回傳結構，修改 getSkillUsageSummary 加入未使用 skill 偵測

## Impact

- 受影響的程式碼：
  - `packages/server/src/routes/weekly-report.tsx`（全面重寫——區塊元件、CSS、props）
  - `packages/server/src/queries.ts`（刪除 3 個查詢函數、新增 4 個、修改 2 個）
  - `packages/server/src/routes/weekly-report.test.ts`（配合新查詢和元件更新測試）
  - `packages/server/src/queries.test.ts`（配合查詢函數變更更新測試）
