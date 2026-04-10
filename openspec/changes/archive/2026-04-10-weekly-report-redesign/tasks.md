## 1. 清除舊區塊（queries 層）

- [x] [P] 1.1 從 `queries.ts` 移除 `getToolHeatmap`、`ToolHeatmapEntry`（對應 tool usage heatmap 移除）
- [x] [P] 1.2 從 `queries.ts` 移除 `getAnomalousSessions`、`AnomalousSession`、`ANOMALY_THRESHOLDS`（對應 anomalous session detection 移除）
- [x] [P] 1.3 從 `queries.ts` 移除 `getWeeklyCostTrend`、`DailyCostEntry`（對應 cost trend integration 移除）
- [x] [P] 1.4 從 `queries.test.ts` 移除上述三個查詢函數的對應測試

## 2. 新增與修改查詢函數

- [x] 2.1 修改 `getWeeklyOverview` 回傳 `total_sessions`、`total_duration_hours`、`active_members`（移除 `commit_rate`、`avg_turns`、`total_tool_errors`）以符合 report overview section 規格
- [x] [P] 2.2 新增 `getSessionDistribution` 查詢：按 duration 分類為 Quick (<15min)、Medium (15-59min)、Deep (60-179min)、Marathon (>=180min) 四組，回傳各組 session 數
- [x] [P] 2.3 新增 `getHighlights` 查詢：回傳最長 session（duration + project）、最活躍日（weekday + count）、最多使用的 project（name + count）、context_estimate_pct >= 70 的 session 數，對應 highlights generation 規格
- [x] [P] 2.4 新增 `getProjectActivity` 查詢：按 project 分組，含 member_name、session_count、turns、files_edited、files_written、commit_count，支援單人扁平表格和多人矩陣，對應 project activity section 規格
- [x] [P] 2.5 新增 `getSessionLog` 查詢：回傳所有 session 明細含 member_name、session_name、project、duration_minutes、turns、model、context_estimate_pct，按 started_at 降序，對應 session log with context percentage 規格
- [x] 2.6 修改 `getSkillUsageSummary`（skill usage summary）：新增 `getUnusedSkills` 查詢，比對歷史 skills_invoked 與本週已使用的 skills，回傳未使用清單，對應 skill usage with unused detection 規格
- [x] 2.7 為 2.1–2.6 的所有新增與修改查詢函數撰寫測試（`queries.test.ts`）

## 3. 週報元件重寫（S29 風格）

- [x] 3.1 將 `weekly-report.tsx` 的 CSS 從白底卡片改為 S29 Cyber-Bio Noir visual style：使用 dashboard 的 CSS 變數（`--bg-primary`、`--brand-primary`、`--neon-shadow` 等）、字型（Teko/Michroma/Share Tech Mono）、CRT scanline overlay、carbon fiber texture
- [x] 3.2 重寫 `OverviewSection` 元件為三層結構：活動摘要 + session 分佈 bar + highlights，對應 report overview with three-layer structure 規格
- [x] 3.3 新增 `ProjectActivitySection` 元件取代 `MemberTable`，實作單人扁平表格與多人矩陣兩種模式，對應 project activity section 規格
- [x] 3.4 新增 `SessionLogSection` 元件取代 `AnomalySection`，顯示全量 session 明細含 model 和 context % 高亮，對應 session log with context percentage 規格
- [x] 3.5 重寫 `SkillSection` 元件，新增 top skills 排行和 unused skills 偵測子區塊，對應 skill usage with unused detection 規格
- [x] 3.6 移除 `ToolHeatmap`、`CostTrendSection`、`getAnomalyReasons` 元件和函數
- [x] 3.7 更新 `WeeklyReportPage` 的 props 和路由 handler，串接新查詢函數

## 4. 路由測試更新

- [x] 4.1 更新 `weekly-report.test.ts`：移除舊區塊測試（heatmap、anomaly、cost trend），新增 overview 三層結構、project activity、session log、skill usage unused detection 的渲染測試
