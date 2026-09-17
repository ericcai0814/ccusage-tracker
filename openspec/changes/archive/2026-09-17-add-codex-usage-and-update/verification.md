# 驗證紀錄

驗證日期：2026-09-17（Asia/Taipei）。本功能未發布、未部署。

## 最終獨立驗證

- 啟用真實公開 collector 18.0.9 與 20.0.20 後重跑完整測試：CLI 46 pass、server 215 pass，合計 **261 pass／0 fail／0 skip**；原基準 196，新增 65 項通過測試。
- 型別檢查、CLI/server build、8 份 Spectra 規格與 `git diff --check` 通過；active changes 為空。
- 真實 Node 18.20.8 built CLI 對 loopback Hono／記憶體 SQLite 連線：兩次 update、兩次 sync codex；公開 20.0.20 collector 讀取隔離合成 Codex JSONL，最終 1200 tokens、成本估計 0.0028 USD、單一 codex-daily 記錄。config 原始位元組、Claude buffer、第三方 hooks 均保留。
- 公開 18.0.9 collector 讀取隔離合成 Claude JSONL，修正前被版本 gate 阻擋，修正後上報 190 tokens、單一 daily 記錄。此項直接重現並驗證 P1 修復。
- 舊 shell hooks 隔離 smoke：2 pass／0 fail。授權變更範圍檢查通過，憑證格式掃描無命中；git HEAD 仍為原值，未 commit／push／publish／deploy。
- 修正後全新唯讀 Codex 複核結論 **APPROVED**，原 P1 已解決；Claude 跨模型 review 受額度限制，未冒稱完成。
- 以上用量均為明確的合成測試資料，不是正式使用量；未操作正式 tracker。Windows/Linux 尚未實機驗證。以下各階段紀錄保留原先沙箱限制，不取代本節的最終 parent-host 實跑證據。

## 環境與隔離

- macOS arm64；Node 24.15.0、Bun 1.3.13、pnpm 11.0.8、Spectra 3.0.0。
- 所有實際 reporter／CLI 執行均使用暫存 HOME、CODEX_HOME；測試路徑包含空白。完整檢查另隔離 CLAUDE_CONFIG_DIR、XDG_CONFIG_HOME、XDG_CACHE_HOME。
- 受環境限制，shell DNS 無法取得 npm，loopback socket bind 回覆 EPERM。因此使用已快取的公開 npm 發佈包、Node fetch mock，以及真正的 Hono app.request／記憶體 SQLite；未宣稱已通過外部 HTTP 或部署驗證。
- Corepack 在空白 HOME 會嘗試查詢 registry；改用現有 `/opt/homebrew/bin/pnpm` 11.0.8 執行相同 pnpm 指令，未安裝或更動套件管理器。
- 未讀取 auth.json、.env、真實 tracker config 或認證；未使用模型 API key，未修改實際 hooks／Codex TOML。測試只有合成 tracker team key。

## 已發佈 collector 證據

| 發佈包 | SHA-256 |
|---|---|
| ccusage-18.0.10.tgz | `60c27c2b62e64b4bf41dea11b247d42d9ecfeeb541a606094650e66639dd462c` |
| ccusage-20.0.20.tgz | `df1991b91f4e592a56dbd19557e513484b7486318fb6e0b98d4569c708ebaed3` |
| ccusage-darwin-arm64-20.0.20.tgz | `ad27629a45e0a3e45eb167080db0aad7545080134da6849b6ea774b3ed6899e1` |

18.0.10 的發佈 source／isolated fixture 使用 Claude `daily`、`totalCost`、`modelsUsed`；collector engine 要求 Node >=20.19.4。

20.0.20 的原生 bin 以 `--offline`、當日日期與明確 timezone 執行非空 compact fixture：

- `ccusage codex daily --json --since YYYYMMDD --until YYYYMMDD --timezone Asia/Taipei --offline --speed standard`：輸出 `{daily, totals}`；原始 input1000／cached400／output200／reasoning50 產生 `inputTokens:600, cacheReadTokens:400, cacheCreationTokens:0, outputTokens:200, reasoningOutputTokens:50, totalTokens:1200, costUSD:0.0028`，`models` 為以 gpt-5 為 key 的物件。網站最新 `{type,data,summary}` 並非此發佈包輸出。
- `ccusage claude daily --json --since YYYYMMDD --until YYYYMMDD --timezone Asia/Taipei --offline`：`inputTokens:100, outputTokens:20, cacheCreationTokens:30, cacheReadTokens:40, totalTokens:190, totalCost:0.001, modelsUsed:["claude-sonnet-4-20250514"]`。
- 原生包對部分重新排版、含空白的 JSONL 回傳空 daily；compact 原始格式可讀。此限制已記入兩份 README。
- `@ccusage/codex 19.0.0` 只驗證 registry metadata（bin ccusage-codex、Node >=22），未取得其完整執行包，未採用或宣稱支援。

notify 的單一 JSON argv 與 `agent-turn-complete` 依 [OpenAI 官方文件](https://developers.openai.com/codex/config-advanced/#notifications)；測試確認原始消息未轉交背景 worker、持久化或上報。

## 執行結果

| 檢查 | 結果 |
|---|---|
| `pnpm test` | CLI 46 pass／0 fail；server 200 pass／0 fail（baseline 為 32／164，原測試保留） |
| `pnpm typecheck` | CLI 與 server 均通過 |
| `pnpm --filter ccusage-tracker build` | Node target 通過；25.57 KB |
| `pnpm build` | Server Bun target 通過；228.78 KB |
| `bash packages/server/scripts/session-end.test.sh` | 隔離 HOME、CODEX_HOME、TMPDIR、PATH；2 pass／0 fail |
| 真實上游完整路徑 | server cwd 下以 `CCTRACKER_TEST_COLLECTOR=<20.0.20 native bin> bun test src/routes/source-aggregation.test.ts`：3 pass／0 fail、29 assertions |
| Standards review（原實作） | 兩種鎖競爭均已重現及修正；獨立覆核 7 pass／0 fail、26 assertions，無剩餘阻擋 |
| Spec review（原實作） | 需求、privacy、失敗保護與來源聚合覆核通過；最終新增鎖修正另由 Standards reviewer 驗證 |
| `spectra validate add-codex-usage-and-update` | 通過 |
| `spectra analyze add-codex-usage-and-update --json` | Coverage／Consistency／Gaps／Localization clean；18 個補充 scenario examples 的建議，無 Critical／Warning |
| `spectra instructions apply --change add-codex-usage-and-update --json` | `all_done`，6/6 tasks 完成 |
| `spectra archive add-codex-usage-and-update --yes` | 成功封存至 `2026-09-17-add-codex-usage-and-update`；3 capabilities，5 added／5 modified requirements |
| `spectra validate --specs` | 8 份主規格全部通過 |
| `spectra list` | `No active changes.` |
| `git diff --check`／變更範圍 | 無 whitespace error；僅授權的 CLI/server source、測試、README、CHANGELOG、主規格與本次 archive |

完整路徑測試建置 CLI 並以 Node 執行兩次 update、兩次 sync，保留 config bytes，讀取實際下發腳本，驗證 reporter payload，再呼叫真正 ingest/report API。collector override 僅在測試 wrapper 加 `--offline`；production 腳本不改價格資料策略。

## 回歸與失敗證據

- CLI update 尚未實作時，新增 public-seam 測試觀察到 8 fail／2 pass；實作後涵蓋 14 項新行為，含完整下載、回復、第三方 hooks、無 settings、無效 config／settings 與可選路由。
- 新 Codex script route 首次測試回覆 404；實作後檢查內容等於實際腳本。
- Claude20 刪除明確 claude 子命令的 mutation 使 argv 斷言失敗，恢復後通過。
- 並行 Claude worker 曾產生兩次上報；原子取鎖後只產生一次。
- 兩輪鎖 ownership 競爭都以隔離 Node/mock HTTP 重現。最終所有取鎖者共用 guard；新增兩個「已有 guard、尚無 main lock」測試在修正前會上報，修正後不建立主鎖、不送出且保留 guard。其餘 stale-owner 與 replay 測試持續通過。

## 驗證範圍

Tracker 的 Node >=18 engine 未改動，production 不使用 Bun global；原實作僅實跑 Node24，後續修正已使用快取 Node18.20.8 驗證，見下方補充。Windows/Linux collector 安裝與 runtime 尚未實測。未發布 npm、未部署 server、未 commit／push。

封存 CLI 回報 `.git/spectra-app/spectra.db` 的 `change_sort_order` 清理遇到唯讀資料庫。規格合併、archive、驗證與 active list 均成功；保留此管理資料清理警告，未更動 git metadata 或繞過檔案權限。


## 精確 patch gate 回歸修正（2026-09-17）

唯讀 Codex 覆核指出單一 P1：18.0.10／20.0.20 精確白名單阻擋既有可用的 18.0.9 與相容 patch。此次直接修正兩支 reporter 的選擇邏輯：legacy major <=19 保留 `daily --json --since`；major 20 明確使用 `claude daily`／`codex daily` 與當日、時區參數。既有 schema、日期、數值驗證不放寬，未知 major 99 仍拒絕，沒有 unified daily fallback。buffer、鎖、CLI、OAuth、認證與其他產品程式碼未改。

新增測試在修正前 34 pass／14 fail，修正後 48 pass／0 fail、187 assertions。未刪除或放寬原測試。

- **真實相鄰版本**：唯讀快取 `/Users/ericcai/.npm/_npx/ca5af5c71a84ce7c/node_modules/.bin/ccusage`，package metadata 與 `--version` 均確認 18.0.9。以 `CCTRACKER_TEST_LEGACY_COLLECTOR` 啟用測試，Node24 執行已發佈 collector、隔離 Claude JSONL 與 mock HTTP，單次上報 input100／output20／cache creation30／cache read40、cost0.001、identity daily。collector 本身要求 Node >=20.19.4，與 tracker 的 Node18 要求分開。
- **合成相容 patch**：20.0.21 僅代表已知 schema 的合成 fixture，未取得或實跑該發佈包。Claude 與 Codex 都驗證成功上報與明確來源 argv；非法 JSON、混合／錯誤來源、非法數值仍拒絕，Codex 指令失敗不 fallback。不能據此保證所有未測版本相容。
- **來源取得限制**：npm registry DNS 請求失敗（ENOTFOUND／curl exit 6），改用上述已存在的公開 npm 快取；mgrep 服務回報 403 credits depleted，使用任務指定檔案的直接讀取，未讀真實設定或認證。

| 本次檢查 | 結果 |
|---|---|
| `pnpm test`（啟用真實 18.0.9 測試） | CLI 與 server 通過；server 215 pass／0 fail、639 assertions |
| `pnpm typecheck` | CLI 與 server 通過 |
| `pnpm --filter ccusage-tracker build` | 通過，Node target 25.57 KB |
| `pnpm build` | 通過，server Bun target 229.27 KB |
| `spectra validate --specs` | 8 份規格全部通過 |
| Node 18.20.8 reporter runtime | 47 pass／0 fail、182 assertions；只略過需 Node >=20.19.4 的真實 legacy collector 測試，該測試已在 Node24 通過 |
| Node 18.20.8 + 真實 ccusage 20.0.20 | `CCTRACKER_TEST_COLLECTOR` 執行 source-aggregation：3 pass／0 fail、29 assertions；兩次 update、兩次 sync，mock transport 接真正 Hono app.request／記憶體 SQLite |
| `git diff --check` | 通過 |

隔離 HOME 下第一次 pnpm 遞迴命令命中 Corepack 並嘗試連 registry；將既有 `/opt/homebrew/bin` 放在 PATH 前端後，所有必要命令通過，未安裝或修改套件管理器。Node18 第一次測試失敗源自暫存 extensionless collector／copied CLI 缺少 ESM package metadata；在隔離 TMPDIR 加入 `{"type":"module"}`（與 CLI package 一致）後通過，未修改產品 module 設定或不屬此次範圍的測試。

任務檔另提供獨立 parent-host 證據：未修改的 `/tmp/cctracker-http-smoke.py` 已以真實 loopback Hono、Node18 built CLI、已發佈 20.0.20 與離線 compact Codex JSONL 通過，tokens1200、cost0.0028、record_count1，config bytes／Claude buffer／第三方 hooks 保留。本次在 sandbox 重跑無法啟動 listener（listen EADDRINUSE），不將該重跑列為通過。該上游版本拒絕 Python 六位小數 timestamp fixture，使用標準 Codex／JS 三位毫秒 ISO timestamp 後，parent-host smoke 通過；只記錄測試資料限制，未新增產品 workaround。

原實作的 Standards／Spec review 紀錄保留為歷史證據。獨立 Claude 覆核受 session quota 429 阻擋，沒有相反模型 family 的通過結論；此次未啟動子代理。未 commit、push、publish、deploy，未使用模型 API key 或修改真實使用者設定／credential／git metadata。

本次修改檔案（其餘既有工作保留）：

- `packages/server/src/hook-scripts/session-end.mjs`
- `packages/server/src/hook-scripts/codex-sync.mjs`
- `packages/server/src/claude-usage.test.ts`
- `packages/server/src/codex-usage.test.ts`
- `README.md`
- `packages/cli/README.md`
- `CHANGELOG.md`
- `openspec/specs/session-hook/spec.md`
- `openspec/specs/codex-usage/spec.md`
- `openspec/changes/archive/2026-09-17-add-codex-usage-and-update/design.md`
- `openspec/changes/archive/2026-09-17-add-codex-usage-and-update/specs/session-hook/spec.md`
- `openspec/changes/archive/2026-09-17-add-codex-usage-and-update/specs/codex-usage/spec.md`
- `openspec/changes/archive/2026-09-17-add-codex-usage-and-update/verification.md`
