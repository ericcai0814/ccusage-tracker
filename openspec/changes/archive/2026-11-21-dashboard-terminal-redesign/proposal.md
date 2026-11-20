## Why

v2 總覽頁上線後，數字只有「這一期」，看不出比上一期多還是少；成員表只有相對時間，掃一眼看不出誰的 hook 已經停止回報。外觀也與週報各自為政。這次以 POC C（終端機深墨樣式）統一儀表板與週報的視覺 token，並補上 KPI 比上一期與成員回報狀態，讓管理者一眼看出趨勢方向與資料是否可信。

## What Changes

- 視覺改版（POC C）：新增共用 `ui-theme.ts`（語意色 token、Card／Table／Badge／Button 結構、Geist／Geist Mono 字體），儀表板與週報都套用；每日成本趨勢改為單調平滑曲線，主線加漸層面積，原生 script 十字線讀數（script 不執行時每點 `<title>` 仍可讀）。
- 期間切換改成 D／W／M 鍵帽：每個鍵帽是指向 `?period=` 的 `<a>` 並帶 `aria-keyshortcuts`；頁面上按 D／W／M（無修飾鍵、焦點不在輸入元件）切到對應期間。
- KPI 比上一期：四張 KPI 卡各顯示與上一期的變化（today 比昨天、week 比上週同期、month 比上月同期），金額／token／回合顯示整數百分比，活躍成員顯示人數差；上一期為 0 或非有限值時顯示「無資料」，不印 NaN／Infinity；方向只用正負號，不用紅綠。
- 成員回報狀態點：成員排行與成員明細每列前加狀態點，24 小時內有回報為實心綠點、超過或從未回報為空心灰點，附 `aria-label`／`title` 文字替代；「其他」折疊列與合計列不加點。
- 新增 `getPreviousDateRange`，與 `getDateRange` 同一套算法往前推一期；修正每月 1 日在 UTC+8 上期區間反轉，以及變化量超過可顯示上限時的防護。
- 示範資料腳本 `scripts/seed-demo.ts`：固定亂數種子產生 6 人 × 70 天資料，供 UI 截圖比較。
- 審查後整理：`dashboard.tsx` 拆出 `dashboard-charts.tsx`（趨勢圖）與 `dashboard-format.ts`（數字防護與來源標籤），`smoothPath` 改為不可變寫法，回報過期門檻抽成常數。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `dashboard`: Dashboard page 新增期間鍵盤快捷鍵 Scenario；Dashboard data display 新增 KPI 比上一期與成員回報狀態兩個 Scenario。

## Impact

- Affected specs: dashboard
- Affected code:
  - New: packages/server/src/routes/ui-theme.ts, packages/server/src/routes/dashboard-charts.tsx, packages/server/src/routes/dashboard-charts.test.ts, packages/server/src/routes/dashboard-format.ts, packages/server/src/routes/dashboard-kpi-status.test.ts, packages/server/src/utils/date-range.test.ts, packages/server/scripts/seed-demo.ts
  - Modified: packages/server/src/routes/dashboard.tsx, packages/server/src/routes/weekly-report.tsx, packages/server/src/utils/date-range.ts, openspec/specs/dashboard/spec.md
  - Removed: （無）
- 只改 server 的頁面與日期工具；不改資料庫結構、hook、CLI、ingest，不新增依賴。
