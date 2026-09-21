## Context

儀表板是 Hono JSX 的 server-side rendering 頁面（packages/server/src/routes/dashboard.tsx），已套 S29 樣式 tokens（`--bg-primary #050505`、`--bg-card #0a0a0a`、`--brand-primary #dc2626`、Teko／Michroma／Share Tech Mono），以 `?period=today|week|month` 切換期間，HTTP Basic 認證（`DASHBOARD_PASSWORD`）。資料表 usage_records 以 member／date／session_id 存每日快照，`session_id` 為 `daily`（Claude）或 `codex-daily`（Codex），`models` 欄是模型名稱陣列；session_metrics 有 Claude 每個 session 的 turns。queries.ts 已有 aggregateUsage（每人合計）、aggregateUsageByDate（每日合計）。admin API 以 `ADMIN_API_KEY` Bearer 認證。

Eric 已用假資料原型確認四個區塊的配置（三大 KPI、每日趨勢、排行與供應商、預算）。決定：兩期都做，本 change 是第一期；預算視角降為參考，不做儀表；視覺沿用 S29。

## Goals / Non-Goals

**Goals:**

- 管理者打開儀表板即回答「用了多少、花在哪裡、誰用最多、是否接近月預算」。
- 只用既有資料，合併部署即生效，成員不需更新。
- 保持 SSR、無前端框架、S29 一致。

**Non-Goals:**

- 每模型成本、訂閱額度剩餘（需 hook 多送欄位，下一個 change）。
- 改 period 定義或新增期間選項。
- 改 weekly report。
- 圖表函式庫；client-side 資料抓取。

## Decisions

### 總覽頁的五個區塊與資料來源

由上而下：KPI 列、趨勢＋預算摘要、排行與供應商、模型表、既有成員表保留在最下方。資料來源：花費與 token 來自 usage_records 期間加總；活躍成員為期間內有紀錄的 member 數；Claude 對話回合為 session_metrics 期間內 `turns` 加總，卡片副標明寫「只含 Claude Code」；來源以 `session_id` 判定，`daily` 為 Claude（供應商 Anthropic），`codex-daily` 為 Codex（供應商 OpenAI），其他值歸入「其他」但目前不會出現。替代方案「新增 source 欄位」需 migration 與 hook 改動，排除。

### 趨勢圖以 inline SVG 伺服端繪製

新增 aggregateUsageByDateAndSource(db, {from, to}) 回傳每日每來源的 cost 與 tokens。趨勢圖為每日成本折線，Claude 與 Codex 各一條，圖例永遠顯示，線尾直接標名；顏色採已驗證的資料色 Claude `#3987e5`、Codex `#d95926`（在 `#0a0a0a` 面上 CVD ΔE 26.8、對比皆 ≥3:1），S29 的紅色只做 chrome 不做資料色。每個資料點附 `<title>` 供 hover 讀數；可加一段少量原生 script 做十字線，但無 script 時圖表仍完整可讀。`today` 期間只有一個點時改畫單日兩來源的橫條。單一 y 軸，不做雙軸。

### 成員排行與供應商切分

成員排行用 aggregateUsage 依 cost 排序，橫條為單色序列（第一名 `#6da7ec`、二三名 `#3987e5`、其餘 `#256abf`，已驗證 ordinal 通過），右側顯示金額與 token，最多 10 人，其餘折疊為「其他 N 人」。供應商切分為一條兩段堆疊比例條（段間 2px 間隙）加兩格金額與百分比，標題註明「來源即供應商」。

### 模型表只列出現天數與使用人數

新增 aggregateModelPresence(db, {from, to})：解析 usage_records.models 陣列，依模型名稱統計出現天數（distinct date）與使用人數（distinct member），並帶來源。表格依出現天數排序。不放成本欄，不放「第二期」佔位。

### 月預算存在 settings 表並由 admin API 管理

新增 `settings` 表（key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL），db.ts 以 CREATE TABLE IF NOT EXISTS 建立。新增 packages/server/src/settings.ts 提供 getSetting／setSetting／getMonthlyBudgetUsd。admin API：`GET /api/admin/settings` 回全部設定；`PUT /api/admin/settings/monthly_budget_usd` body `{ "value": number }`，接受 0 表示清除，負數或非數字回 400。沿用 adminAuth。替代方案「環境變數」改數字要重新部署，Eric 已否決。

### 預算只做參考不做儀表

KPI 花費卡在期間為 `month` 時，若有預算：副標顯示「已用 X% ／ 預算 $B」，下方一條細的同色系 meter（軌道為同色較深階），再一行「日均 $d，月底推估 $p」。推估超過預算 10% 以上顯示 critical 狀態、超過 0 到 10% 顯示 warning，皆以文字標籤加符號呈現，不只靠顏色；未設定預算時整段不顯示。非 `month` 期間不顯示預算。

### 版面與樣式沿用 S29

沿用現有 STYLES tokens、字體與 CRT 掃描線效果；新增區塊的卡片用既有 `.card` 樣式；區塊標題用既有紅色 glow 標題樣式；數字用 tabular-nums；手機寬度時 KPI 兩欄、其餘單欄。表格外層 `overflow-x: auto`。

## Implementation Contract

**行為**

- `GET /?period=month` 回 200 HTML，依序含：KPI 列四張卡（文字含「總花費」「總 token」「活躍成員」「Claude 對話回合」）、趨勢區塊（`<svg>` 內含兩條 `<path>` 與圖例文字 Claude Code、Codex）、成員排行（每人一列，含金額）、供應商切分（含 Anthropic、OpenAI 與百分比）、模型表（欄位：模型、來源、出現天數、使用人數）、既有成員表。
- 有預算時花費卡含「已用」「預算」「月底推估」三個字樣與對應數字；預算為 0 或未設定時不含「預算」字樣。
- `PUT /api/admin/settings/monthly_budget_usd`：未帶 Bearer 回 401；`{value: 2000}` 回 200 並持久化；`{value: -1}`、`{value: "x"}` 回 400；`{value: 0}` 回 200 且之後 GET 顯示 0。
- `GET /api/admin/settings` 回 `{ "monthly_budget_usd": number | null, ... }`。
- 沒有任何資料時每個區塊顯示既有的空狀態文案，不拋錯。

**介面**

- queries.ts 新增：`aggregateUsageByDateAndSource(db, {from, to}): Array<{date, source: "claude"|"codex"|"other", total_cost_usd, total_tokens}>`、`sumClaudeTurns(db, {from, to}): number`、`aggregateModelPresence(db, {from, to}): Array<{model, source, days, members}>`。
- settings.ts：`getSetting(db, key): string | null`、`setSetting(db, key, value): void`、`getMonthlyBudgetUsd(db): number | null`。
- dashboard.tsx 新增元件 KpiRow、TrendChart、MemberRanking、ProviderSplit、ModelTable、BudgetNote，保留 Layout 與 MemberTable。

**驗收準則**

- packages/server/src/queries.test.ts：三個新查詢對固定 fixture（兩位成員、兩來源、三天）回傳精確數值；models 欄為非法 JSON 時該列略過不拋錯。
- packages/server/src/settings.test.ts 與 routes/admin-settings.test.ts：上述 API 行為含 401／400／200 與持久化。
- packages/server/src/routes/dashboard.test.ts：以 app.request 驗證 HTML 含上述區塊文字與 `<svg>`；有預算與無預算兩案；空資料庫一案；`period=today` 一案不含折線 `<path>`。
- `bun test`（server）全綠；`pnpm typecheck`、`pnpm build` 通過。
- 視覺由 Eric 在部署後或本機 `bun run dev` 親自確認；工作 session 不自行宣稱視覺正確，只在 verification.md 附上本機啟動指令與截圖路徑（若能截）。

**範圍邊界**

- In scope：packages/server 的 dashboard、queries、settings、admin、db、app、測試；README 的儀表板與 admin API 段落；CHANGELOG。
- Out of scope：hook 腳本、CLI、ingest、weekly report、period 定義、每模型成本、額度視角。

## Risks / Trade-offs

- [models 欄歷史資料格式不一（舊版可能存字串）] → 解析失敗的列略過並計數，不影響其他區塊。
- [SSR 折線在資料點多時 HTML 變大] → 期間最多 31 天、兩條線，SVG 小於 20 KB；不做更長期間。
- [S29 紅色與狀態色（critical 紅）混淆] → 狀態一律帶符號與文字，critical 用 `#d03b3b` 且只出現在預算註記。
- [視覺判斷] → 依 Eric 規則由他確認，實作方只保證結構與數字正確。

## Migration Plan

隨 server 部署生效；`settings` 表自動建立。回滾：部署前一版，表可留著。

## Open Questions

- 無。
