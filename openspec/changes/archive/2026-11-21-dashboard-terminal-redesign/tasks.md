## 1. 視覺改版（POC C）

- [x] 1.1 新增 packages/server/scripts/seed-demo.ts：固定亂數種子產生示範資料，供不同版本在同一份資料上截圖比較。
- [x] 1.2 新增 packages/server/src/routes/ui-theme.ts 共用 token 與元件樣式，packages/server/src/routes/dashboard.tsx 與 packages/server/src/routes/weekly-report.tsx 套用；趨勢圖改單調平滑曲線、主線漸層面積、原生 script 十字線；期間切換改 D／W／M 鍵帽並可用鍵盤切換。
- [x] 1.3 POC C 審查修正（dashboard.tsx、ui-theme.ts、weekly-report.tsx）。

## 2. KPI 比上一期與成員回報狀態（TDD）

- [x] 2.1 依規格「KPI comparison with the previous period」在 packages/server/src/utils/date-range.test.ts 寫 getPreviousDateRange 測試，在 packages/server/src/routes/dashboard-kpi-status.test.ts 寫 formatChange 與 month／week／today 路由測試；實作 packages/server/src/utils/date-range.ts 的 getPreviousDateRange 與 dashboard.tsx 的 formatChange／KpiRow。驗證：測試全綠。
- [x] 2.2 依規格「Member report status」在 dashboard-kpi-status.test.ts 寫狀態點測試（過期、未過期、null、其他列與合計列不加點），實作 ReportDot。驗證：測試全綠。
- [x] 2.3 seed-demo.ts 示範資料延長到 70 天，讓比上一期有資料可比。
- [x] 2.4 修正每月 1 日 UTC+8 上期區間反轉與超上限變化量防護，補 date-range.test.ts 與 dashboard-kpi-status.test.ts 斷言。

## 3. 審查修正

- [x] 3.1 dashboard.tsx 拆出 packages/server/src/routes/dashboard-charts.tsx 與 packages/server/src/routes/dashboard-format.ts，函式本體不改。驗證：dashboard.tsx ≤ 800 行；seed 資料下 month／week／today 三頁 HTML 搬移前後無差異。
- [x] 3.2 smoothPath 改為 map／slice／join，新增 packages/server/src/routes/dashboard-charts.test.ts 鎖住輸出。驗證：輸出逐字相同。
- [x] 3.3 依規格「Period keyboard shortcuts」補規格 Scenario，dashboard-kpi-status.test.ts 斷言鍵帽是指向 ?period= 的 `<a>` 且帶 aria-keyshortcuts。
- [x] 3.4 回報過期門檻抽成 STALE_AFTER_HOURS／STALE_AFTER_MS，狀態點文字由同一常數推出；dashboard-kpi-status.test.ts 補 today「vs 昨天」路由測試。
- [x] 3.5 完整驗證：packages/server 下 `bun test` 全綠、`bun x tsc --noEmit` 無錯；seed 資料重拍截圖，視覺由 Eric 確認。
