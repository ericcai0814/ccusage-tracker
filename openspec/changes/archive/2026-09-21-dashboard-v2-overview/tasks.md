## 1. 設定儲存與 admin API（TDD）

- [x] [P] 1.1 依規格「Settings storage」與 design「月預算存在 settings 表並由 admin API 管理」先寫失敗測試 packages/server/src/settings.test.ts：缺 key 回 null、連寫兩次只留一列且值為最新、updated_at 更新；packages/server/src/db.test.ts 補 settings 表存在。驗證：先紅。
- [x] 1.2 實作 packages/server/src/db.ts 的 settings 表與 packages/server/src/settings.ts 的 getSetting／setSetting／getMonthlyBudgetUsd。驗證：1.1 全綠。
- [x] [P] 1.3 依規格「Monthly budget admin API」先寫失敗測試 packages/server/src/routes/admin-settings.test.ts：無 Bearer 401；PUT 2000 後 GET 回 2000；PUT -1 與 "abc" 回 400 且值不變；PUT 0 後 GET 回 0。驗證：先紅。
- [x] 1.4 在 packages/server/src/routes/admin.ts 實作 GET /settings 與 PUT /settings/monthly_budget_usd，沿用 adminAuth。驗證：1.3 全綠。

## 2. 新查詢（TDD）

- [x] [P] 2.1 依 design「總覽頁的五個區塊與資料來源」「趨勢圖以 inline SVG 伺服端繪製」「模型表只列出現天數與使用人數」先在 packages/server/src/queries.test.ts 寫失敗測試：aggregateUsageByDateAndSource 對兩成員兩來源三天 fixture 回精確每日每來源 cost 與 tokens；sumClaudeTurns 只加總期間內 session_metrics.turns；aggregateModelPresence 回每模型的來源、出現天數、使用人數，且 models 欄為非法 JSON 的列被略過。驗證：先紅。
- [x] 2.2 在 packages/server/src/queries.ts 實作三個查詢，來源判定依 session_id（daily → claude、codex-daily → codex、其他 → other）。驗證：2.1 全綠，既有 queries.test.ts 全綠。

## 3. 儀表板頁面

- [x] 3.1 依規格「Dashboard data display」「Overview trend chart」「Rankings and provider split」「Budget reference」先在 packages/server/src/routes/dashboard.test.ts 寫失敗測試：month 期間含四張 KPI 文字、`<svg>` 內兩條 `<path>` 與圖例 Claude Code／Codex、成員排行順序 30／20／10、供應商 75%／25%、模型表 days 3 members 2、既有成員表；有預算時含「預算」「已用」「月底推估」，推估超過 10% 含 critical 標籤；無預算不含「預算」；today 期間不含折線 `<path>`；空資料庫回 200 且各區塊空狀態。驗證：先紅。
- [x] 3.2 依 design「版面與樣式沿用 S29」「成員排行與供應商切分」「預算只做參考不做儀表」在 packages/server/src/routes/dashboard.tsx 實作 KpiRow、TrendChart（inline SVG，資料色 Claude #3987e5、Codex #d95926，每點 `<title>`，單一 y 軸，today 改兩條橫條）、MemberRanking（單色序列 #6da7ec／#3987e5／#256abf，最多 10 列加其他）、ProviderSplit（兩段堆疊條 2px 間隙）、ModelTable、BudgetNote（同色系 meter、critical／warning 帶符號與文字），保留 Layout 與 MemberTable；手機寬度 KPI 兩欄其餘單欄，表格外層 overflow-x auto。驗證：3.1 全綠，既有 dashboard.test.ts 全綠。
- [x] 3.3 可選的原生 script 十字線：若加入，必須在 script 不執行時圖表仍完整（`<title>` 讀數仍在），且 dashboard.test.ts 不依賴 script。驗證：以 app.request 取得 HTML 後移除 `<script>` 再斷言圖表元素仍存在。

## 4. 文件與驗證

- [x] [P] 4.1 更新 README.md 的儀表板段落（五個區塊、預算參考的顯示條件）與 admin API 段落（兩個 settings 端點與 curl 範例），CHANGELOG 加 Unreleased 條目。驗證：內容審閱，README 含 `monthly_budget_usd`。
- [x] 4.2 完整驗證：`bun test`（server）、`pnpm typecheck`、`pnpm build` 全綠；以本機 `DASHBOARD_PASSWORD` 與記憶體或暫存 SQLite 啟動 server，灌入 fixture 後以 curl 取得 `/?period=month` HTML 並存檔；把啟動指令、fixture 灌入指令與 HTML 路徑寫進 openspec/changes/dashboard-v2-overview/verification.md，明寫「視覺由 Eric 確認」；`spectra validate` 通過。
