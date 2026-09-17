## Context

每日 usage 以 member/date/session_id upsert。Claude 使用 daily，hook 透過 server 下載獨立 mjs。設定為 server_url/team_key/member_name；team_key 是既有 tracker 存取憑證，不是模型 API key。

## Goals / Non-Goals

**Goals:** Codex-only 可使用手動 sync；零提示安全更新；canonical 計數；來源隔離與可見錯誤；完整測試與文件。

**Non-Goals:** 模型 API、讀取 auth.json/.env/真實設定、部署／提交、全域安裝測試、改寫使用者 Codex TOML、dashboard／DB migration／排程／Codex 行為分析。

## Decisions

### 來源隔離與格式驗證

Codex 使用 ccusage 20.0.20 已發佈的 codex daily reader，不自行估 token 或價格。由 npm package source 與隔離實跑驗證版本、daily/totals 與 cached/reasoning 語意，再實作有限格式支援；未知格式明確失敗。Claude 保留 daily；Codex 使用 codex-daily。成本為估計 API 等值，非訂閱帳單。獨立 Codex buffer、lock、error、upload 狀態。避免 unified aggregate 與 Codex 重複相加。替代方案自行解析 rollout 與價格資料因維護與準確性成本排除。

### 完整下載後更新

update 讀取並驗證既有 config，不重寫；先抓取所有必要脚本並驗證，再安裝及 migration。只有 Codex 404/410 屬旧 server 相容降級；其他下載或安裝失敗回傳非零。變更備份、重跑冪等、保留第三方 matcher 額外欄位。替代方案重跑互動 setup 會改寫設定，故排除。

### 手動同步與通知

tracker sync codex 執行安裝的 codex-sync.mjs 並傳回真實成功／失敗。Codex notify 的 JSON argv 僅檢查事件種類，不傳入 worker、不寫出內容。使用文件提供的手動 opt-in TOML 頂層 notify 陣列；不自動覆蓋既有整合。手動同步不需 Claude 執行。

## Implementation Contract

- CLI owner：packages/cli/src/**。提供 update、sync codex，setup 取得第三支可選腳本，status 顯示 Codex 腳本、collector 與錯誤／buffer／成功時間。update 不提示、不改 config bytes、buffer、sessions；缺少／錯誤 config 提示 setup 並非零；mkdir 缺少 settings 目錄、保留第三方 hook 所有欄位，安裝中失敗回復原 scripts/settings。新腳本下載完整後才 mutation。實際 Node CLI 與暫存 HOME 路徑含空白驗證。
- Collector owner：packages/server/src/hook-scripts/**、packages/server/src/codex-usage.test.ts、packages/server/src/claude-usage.test.ts。新增 codex-sync.mjs，ccusage 20.0.20 原生 collector 不提高 tracker Node18（@ccusage/codex 19.0.0 的 Node22 條件只屬上游 metadata，此版本未採用）。取得 local timezone 當天快照，驗證日期、有限非負整數 token、非負成本、已知格式；空 daily 不送假零。採用實跑的 ccusage 20.0.20 explicit codex daily；其 inputTokens 已扣除 cacheReadTokens，直接映射不重扣，output 保留含 reasoning 原值，cache_creation=0；models 僅名稱。獨立鎖／buffer 不碰 Claude；先以新快照淘汰同日舊快照或以等效有序方案避免降版。缺 reader、壞 JSON／schema／數字、offline 都有可見狀態，手動非零；notify 可背景執行但不保留原 payload。Claude 既有背景、5 分鐘 throttle、120 秒 collector timeout、model/session metrics 保留，防 unified 重算並修正 stale replay。
- Root owner：packages/server/src/scripts.ts、packages/server/src/app.ts、packages/server/src/routes/source-aggregation.test.ts、README.md、packages/cli/README.md、CHANGELOG.md、此 change 與 resulting specs。提供腳本路由；真實 ingest/report 同 member/date 重複上報僅兩筆且正確加總。文件清楚區分 setup、npx ccusage-tracker@latest update、npm install -g ccusage-tracker@latest、未發佈與 server 部署依賴、Codex prerequisites/notify/status/成本語意。
- 驗證：每項 runtime 改動先有 public seam 失敗測試，維持既有測試；pnpm test、pnpm typecheck、CLI build、server build、隔離 bash smoke 與 Node-built CLI mock HTTP smoke；Spectra analyze/validate/archive/validate --specs/list。
- 全程只能使用隔離 HOME/CODEX_HOME、loopback/mock HTTP；不讀取使用者設定或 credential，不修改禁止檔案與 git metadata。獨立工作不得覆蓋別人的編輯。

## Risks / Trade-offs

- 上游新版本 JSON 可能漂移 → 明確指令系列／來源選擇及拒絕未知格式，文件記錄真實驗證版本。
- 新版本 collector 可能改變格式 → 已驗證版本是證據，不作精確 patch 白名單。Claude 對 major <=19 保留原本的 daily --json --since；major 20 明確選 claude daily／codex daily，保留日期／時區參數與嚴格 schema 驗證。未知 major（例如 99）拒絕，不回退 unified default daily；tracker engine 仍為 Node18。真實 18.0.9 與合成 20.0.21 回歸測試分別記錄，不保證未測發佈包相容。
- notify 使用者已有設定 → 手動整合，不自動 TOML patch。
- server 尚未發佈 → CLI 與 hooks 各自標示版本／部署前提，404 降級明確告知。
- 鎖持有者釋放與過期鎖回收交錯 → 所有取鎖路徑共用獨占 guard，釋放只處理自己的 PID；回收中斷留下的 .reclaim 需先停止對應 workers 再人工移除，不冒險搶走 guard。

## 上游驗證紀錄

- npm 快取的 ccusage 18.0.9 發佈包已用隔離 Claude JSONL、Node reporter 與 mock HTTP 實跑回歸；保留原始 daily --json --since flags。18.0.9 與 18.0.10 的 collector engine 均要求 Node >=20.19.4。
- npm 快取的 ccusage 18.0.10 發佈包：Claude daily 使用 daily/totals 與 totalCost、modelsUsed；Node engine >=20.19.4 屬 collector 本身。
- npm 快取的 ccusage 20.0.20 及 macOS arm64 原生包已在隔離 HOME/CODEX_HOME 實跑 --offline。明確 codex daily 輸出 daily/totals（不是網站最新描述的 type/data/summary）。compact rollout 的原始 input1000/cache400/output200/reasoning50 產生 inputTokens600/cacheReadTokens400/outputTokens200/reasoningOutputTokens50/totalTokens1200/costUSD0.0028；models 為物件。只映射 canonical 欄位，reasoning 不加總。帶空白的重新序列化 JSONL 在此發佈包觀察到被略過；保留原始 compact rollout。
- 同一原生包的 Claude compact fixture 實跑 claude daily，取得 inputTokens100/outputTokens20/cacheCreationTokens30/cacheReadTokens40/totalTokens190/totalCost0.001/modelsUsed；對應 runtime 測試明確檢查 claude 子命令。
- @ccusage/codex 19.0.0 的 registry metadata 證實 bin ccusage-codex 與 Node>=22，但發佈包無法取得；不宣稱支援未驗證的 adapter。
- OpenAI 官方 notify 文件證實單一 JSON argv，type 為 agent-turn-complete，內容字段立即丟棄；使用者手動填寫頂層 notify 陣列。
