# 驗證紀錄

驗證日期：2026-09-21（Asia/Taipei）。本變更未部署、未 push、未改版本號、未 archive。

## 結論

- tasks.md 的 11 項全部完成並勾選。依變更意圖拆 commit：settings 與 admin API、三個新查詢、儀表板頁面、文件與驗證、座標軸刻度修正。
- 完整測試 **CLI 171 pass／0 fail、server 303 pass／1 skip／0 fail**，合計 **474 pass**。server 基線是 228 pass／1 skip，本次淨增 75 項，基線的 228 項一項未刪。
- `pnpm typecheck`、`pnpm build`、`spectra validate dashboard-v2-overview` 全綠；`git diff --check` 無 whitespace error。
- 本機起真的 server（暫存 SQLite，非記憶體、非線上）灌 fixture 後取 `/?period=month` HTML 存檔，移除全部 `<script>` 後 `<svg>`、兩條 `class="trend-line"`、42 個 `<title>` 讀數與圖例都還在。
- **視覺對錯由 Eric 親自確認**，本 session 只保證結構、數字與測試。重現指令見下方「本機啟動與灌 fixture」。

## 環境

macOS 26.6 arm64；Bun 1.3.13、Node 24.15.0、pnpm 9.15.9、Spectra 3.0.0。
測試一律用 `:memory:` SQLite；本機驗證用 `/tmp` 下的暫存 SQLite 與 127.0.0.1:3999，全程沒有碰線上 server 或 `/data`。

## 執行結果

| 檢查 | 結果 |
|---|---|
| `pnpm test` | CLI 171 pass／0 fail；server 303 pass／1 skip／0 fail（基線 228 pass／1 skip） |
| `pnpm typecheck` | CLI 與 server 均 Done |
| `pnpm build` | Bundled 61 modules；`index.js` 0.27 MB |
| `spectra validate dashboard-v2-overview` | `✓ dashboard-v2-overview — valid` |
| `git diff --check` | 無 whitespace error |
| 趨勢圖 SVG 大小 | 10,039 bytes（設計上限 20 KB，期間最多 31 天） |

## 本機啟動與灌 fixture

`seed-demo.ts` 與本檔同目錄，會灌本月每一天、12 位成員、兩個來源的示範資料，並把月預算設成 2000。

```bash
cd /Users/ericcai/project/internal-tools/ccusage-tracker

# 1. 灌 fixture 到暫存 SQLite（不要指到 /data 或線上資料庫）
export DB_PATH=/tmp/ccusage-dashboard-v2/demo.db
mkdir -p "$(dirname "$DB_PATH")" && rm -f "$DB_PATH" "$DB_PATH"-wal "$DB_PATH"-shm
bun run openspec/changes/dashboard-v2-overview/seed-demo.ts

# 2. 起 server（Basic Auth 帳號固定是 admin）
cd packages/server
DB_PATH=$DB_PATH DASHBOARD_PASSWORD=demo ADMIN_API_KEY=demo-admin PORT=3999 bun run src/index.ts

# 3. 另開一個 shell 看頁面
open "http://admin:demo@127.0.0.1:3999/?period=month"

# 或存檔
curl -su admin:demo "http://127.0.0.1:3999/?period=month" > /tmp/ccusage-dashboard-v2/dashboard-month.html
```

改月預算不必重啟：

```bash
curl -X PUT -H "Authorization: Bearer demo-admin" -H "Content-Type: application/json" \
  -d '{"value": 1200}' "http://127.0.0.1:3999/api/admin/settings/monthly_budget_usd"
```

本次存下的 HTML（今天是 2026-09-21 星期一，所以 week 與 today 同範圍、都畫橫條）：

- `/tmp/ccusage-dashboard-v2/dashboard-month.html`（40,870 bytes，折線）
- `/tmp/ccusage-dashboard-v2/dashboard-today.html`（29,303 bytes，兩條橫條）
- `/tmp/ccusage-dashboard-v2/dashboard-week.html`（29,303 bytes）

## 輸出跳脫

模型名稱是第一次從 ingest 進到 HTML 的字串，另外實測過一次：以成員名 `<script>alert(1)</script>`、
模型名 `"><img src=x onerror=alert(2)>` 灌進記憶體 DB 後取 `/?period=month`，兩段原文都不在輸出中，
分別渲染成 `&lt;script&gt;alert(1)&lt;/script&gt;` 與 `<td>&quot;&gt;&lt;img src=x onerror=alert(2)&gt;</td>`。
Hono JSX 的文字與屬性都會跳脫；頁面唯一的 `dangerouslySetInnerHTML` 是十字線 script，內容是原始碼常數
（`packages/server/src/routes/dashboard.tsx:1140` 的 `TREND_SCRIPT`），不含任何資料庫字串。

## design.md 驗收準則對照

| 驗收準則 | 證據 |
|---|---|
| 三個新查詢對兩成員兩來源三天 fixture 回精確數值 | `packages/server/src/queries.test.ts:820`（fixture）、`:852` `aggregateUsageByDateAndSource` 逐列 `toEqual`、`:892` `sumClaudeTurns` 邊界前後各一筆、`:933` `aggregateModelPresence` |
| models 欄為非法 JSON 的列略過不拋錯 | `packages/server/src/queries.test.ts:945`（`not-json` 與 `"claude-opus-5"` 兩種壞形狀）；實作 `packages/server/src/queries.ts:769` |
| settings 與 admin API 的 401／400／200 與持久化 | `packages/server/src/settings.test.ts`（12 項）、`packages/server/src/routes/admin-settings.test.ts`（10 項） |
| HTML 含五個區塊文字與 `<svg>`；有預算與無預算兩案；空資料庫；`period=today` 不含折線 | `packages/server/src/routes/dashboard.test.ts:178`（overview 14 項）、`:422`（budget 6 項） |
| 移除 `<script>` 後圖表仍完整 | `packages/server/src/routes/dashboard.test.ts:266`；另在 live HTML 上覆驗（見上方結論） |
| `bun test` 全綠、`pnpm typecheck`、`pnpm build` 通過 | 見「執行結果」 |
| 視覺由 Eric 親自確認 | 本 session 不宣稱視覺正確；重現指令見上 |

## 規格場景對照

| 場景 | 證據 |
|---|---|
| Month view with both sources → 一個 `<svg>`、兩條 `<path>`、圖例 Claude Code／Codex | `dashboard.test.ts:250` |
| Single-day period → 無折線 `<path>`、有兩條橫條 | `dashboard.test.ts:276` |
| Ranking order 30／20／10 且條寬與花費成比例 | `dashboard.test.ts:310`、`:322`（寬度 100／66.7／33.3） |
| 第十名之後折疊成一列 | `dashboard.test.ts:330`（15 人 → 10 列 +「其他 5 人」） |
| Provider percentages 75%／25% | `dashboard.test.ts:355` |
| Model presence days 3 members 2 | `dashboard.test.ts:369` |
| Malformed models column → 略過該列仍回 200 | `dashboard.test.ts:379` |
| Budget set and on track → 含 `預算`／`已用`／`月底推估`，無 warning／critical | `dashboard.test.ts:455` |
| Projection over budget → critical 標籤與符號 | `dashboard.test.ts:471`；0 到 10% 的 warning 另有 `:482` |
| No budget → HTML 不含 `預算`（預算 0 與非 month 期間同樣不含） | `dashboard.test.ts:493`、`:500`、`:508` |
| Summary cards → 四張 KPI | `dashboard.test.ts:231` |
| Member table 保留 | `dashboard.test.ts:392` |
| Empty database → 200 且每區塊有空狀態 | `dashboard.test.ts:403` |
| Settings storage：缺 key 回 null、upsert 只留一列 | `settings.test.ts:18`、`:29` |
| Monthly budget admin API：401／400／200／0 | `admin-settings.test.ts:36`、`:69`、`:80`、`:103` |

## 既有測試的三處改寫

`DailyChart`（長條走勢圖）依 design 的 Implementation Contract 由 `TrendChart` 取代，元件保留清單只有 `Layout` 與 `MemberTable`。三個直接斷言舊元件內部樣貌的測試因此改寫為對應的新行為，沒有刪除任何測試：

| 原本 | 改為 | 原因 |
|---|---|---|
| `should show daily-chart when data exists`（斷言 `class="daily-chart"`、`Daily Usage Trend`） | `should show the trend section when data exists`（斷言 `class="panel trend"`、`每日成本趨勢`） | 區塊改名與改版 |
| `should not show daily-chart element when no data` | `should not draw any chart mark when no data`（斷言無 `trend-line` 也無 `trend-bar`） | 無資料時改為顯示空狀態而非整段消失 |
| `should show peak marker when multiple days exist`（斷言 `← peak`） | `should draw a trend line when multiple days exist`（斷言 `class="trend-line"`） | 折線圖沒有 peak 標記；同樣是「多天才成立」的斷言 |

## Codex 審查閘 round 1 的修正

閘門回 NEEDS-FIX，三個 P2 加上閘門摘要另外點名的「排行」。四個我都先自己重現才動手（`bun run` 直接打 `app.request`，輸出見下），修完再以同一支腳本覆驗：

| 問題 | 修正前 | 修正後 |
|---|---|---|
| `monthly_budget_usd` 沒有上下限與最小單位 | `1e308`／`5e-324`／`0.001`／`1000000001` 全部回 200 | 全部回 400，訊息帶出可接受範圍；`1` 與 `999999999.99` 仍回 200 |
| 極小預算讓百分比變 `Infinity` | `已用 Infinity% ／ 預算 $0` | `已用 — ／ 預算 $0`；推估非有限時連狀態標籤一起不印 |
| 峰值 `1e308` 讓刻度座標變 `NaN` | SVG 內出現 `NaN` 與 `∞` | 峰值先夾到 `MAX_PLOTTABLE_USD`（1e12），座標與刻度全為有限數字 |
| 成員總和溢位讓排行與供應商條寬變 `NaN` | `width: NaN%`、`NaN% · Claude Code` | `width: 100.0%`、`100% · Claude Code` |

實作是一組共用守門函式而不是四個各別補丁：`plotValue`（夾到可繪製上限）、`safePct`（百分比守門並夾在 0 到 100）、
以及 `formatNumber`／`formatCost`／`formatUsdRounded` 在非有限值時回傳 `—`
（`packages/server/src/routes/dashboard.tsx:22`）。驗證規則要求「修完再審一次」，這一輪我自己的修正又被抓出三個洞，都已修掉：

1. `plotValue` 最初把 `+Infinity` 當成 `0`（`!Number.isFinite(n)` 一併吃掉了無限大），排行條寬因此變成 0% 而不是 100%。改成先擋 `NaN`、再讓 `Math.min` 把無限大壓到上限。
2. 座標軸刻度一開始跟資料點共用同一個夾值函式，`max` 超過 1e12 時三條格線疊在同一個 y。改成刻度走 `yTick`（不夾）、資料點走 `yData`（夾）。
3. 既有成員表的 share-bar 走同一條溢位路徑，也會印出 `width: NaN%`。一併改用 `safePct`。

另外把十字線 script 裡的 `Infinity` 字面量改成 `-1` 哨兵，這樣「整頁不得出現 NaN／Infinity」可以直接對整份 HTML 斷言，不必先剝掉 `<script>`。

測試：`admin-settings.test.ts` 六個範圍案例（四拒兩收）、`dashboard.test.ts` 的 `Dashboard numeric edge cases` 五個案例（極小預算、非有限推估、極大峰值的 SVG 屬性、溢位後的條寬、KPI 破折號）。

## Codex 審查閘 round 2 的修正

round 1 的修正本身被抓出問題 —— **夾值拿去算比例，把比例洗掉了**。這是我的設計錯誤：
`MAX_PLOTTABLE_USD`（1e12）原本是給 SVG 座標用的「可繪製」上限，我卻同時拿它當佔比的輸入，
於是 `3e12` 與 `1e12` 雙雙被夾成 `1e12`，供應商切分顯示 50%／50%（正確是 75%／25%），排行條也全變 100%。

| 問題 | 修正前 | 修正後 |
|---|---|---|
| `usedPct` 守的是乘 100 前的比值 | 花費 `1e308`、預算 `1` → `已用 Infinity%` | `已用 —` |
| 夾值洗掉比例 | `3e12`／`1e12` → 50%／50%，排行雙雙 100% | 75%／25%，排行 100.0%／33.3% |
| 支出溢位時預算條清空 | `safePct(Infinity, 2000)` 回 0 | 回 100，條子滿格 |
| 小數位用字串長度判斷 | `1.1 + 2.2`（`3.3000000000000003`）被拒 | 改用浮點容差，接受；`12.345` 仍拒 |
| 金額沒有顯示上限 | 「月底推估」印出三百多位數 | 絕對值 ≥ 1e15 顯示 `—` |
| 超範圍的預算只擋在 API | 直接寫表的 `5e-324` → `預算 $0` | 讀取端套同一組範圍，當作未設定 |

改法是把兩種夾值分開：

- `finiteCost` 是**可表示**夾值（NaN／負數 → 0，`+Infinity` → `Number.MAX_VALUE`）。真實金額不可能超過
  `Number.MAX_VALUE`，所以它不會扭曲任何一筆真的資料。
- `ratioPct` 先算比值再夾到 `[0,1]`，不先截斷金額。
- `sharePercents` 先把整組值除以最大值再相加：分子分母同時縮放，比例不變，而正規化後的總和最多等於
  項目數，不會溢位。供應商切分、成員表的 share 欄都走這條。
- 趨勢圖的軸改成「級距乘回去會溢位時退成剛好等於峰值」，頂部沒有留白但每個點的相對高度仍然正確；
  因為 `max` 一定 ≥ 每個資料點，座標天然落在畫布內，不需要再截斷數值。
- 預算範圍與驗證函式移到 `packages/server/src/settings.ts:28`，admin API 與 `getMonthlyBudgetUsd`
  共用同一份定義，繞過 API 直接改表也擋得住。

測試補強（round 1 的溢位測試只查「有限且在範圍內」，條寬全 0、格線全疊也會過）：
現在斷言溢位項目的條寬為 100、另一項小於 100、資料點 y 互異、五條格線 y 互異、頁面不含 20 位以上的連續數字。

`MemberTable` 的 `totalCost` prop 在改用 `sharePercents` 後沒有用了，一併移除。

自我覆審（`bun run` 直接打 `app.request`）另外確認沒有退步：正常 45／15 仍是 75%／25% 與 100.0%／33.3%、
單一來源 100%、全零走空狀態、負成本不進佔比、三來源含「其他」加總剛好 100、12 人折疊成 10 列加「其他 2 人」、
數值持平時五條格線仍分開、預算邊界 `1` 與 `1e9` 收、`0.99` 與 `1000000000.01` 拒、金額顯示上限剛好在 1e15 切換。

## 範圍外的發現（未修）

- **low — `getDateRange("month")` 的 from 會早一天**：`packages/server/src/utils/date-range.ts:25` 用本地時間算當月一日，再用 `toISOString()` 取日期，在 UTC+8 會得到上個月最後一天（本機實測 `from` 為 `2026-08-31`）。對總覽頁沒有實質影響（多含的那一天本來就沒有本月資料），但趨勢圖的日期讀數若直接印期間邊界就會露出來，所以趨勢圖的 readout 改成顯示實際有資料的首末日期。handoff 明列「不動 period 定義」，故未修。要修的話是 `date-range.ts` 單獨一個 change。
