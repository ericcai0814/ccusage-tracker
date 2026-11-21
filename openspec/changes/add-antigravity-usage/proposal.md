## Why

維護者要求 tracker 開始收 Google Antigravity（AGY）的用量。目前 tracker 只收 Claude Code 與 Codex，成員在 AGY 上花的 token 與成本不會出現在儀表板，也不會算進月預算推估。ccusage 20.0.21 起內建 `antigravity daily`，直接讀 AGY 的本機對話資料庫，所以 tracker 端只缺收集、上報與顯示。另外，server 把來源清單寫死在好幾處，每接一個新工具都要逐處改。這次一併改成來源表，之後接下一個工具，每一層各加一筆即可。

## What Changes

- 新增通用上報腳本 `agent-sync.mjs`（server 提供，setup／update 下載到 `~/.config/ccusage-tracker/`）。腳本內以來源表描述每個工具，這次只有 Antigravity：執行 `ccusage antigravity daily` 取本機當日快照，以 `session_id` `antigravity-daily` 上報，只傳 token、成本估計、model 名稱與成員識別。
- AGY 的 token 換算：fresh input、cache read、cache creation 原樣上報；output 為可見 output 加上 reasoning。ccusage 把 reasoning 放在 totalTokens 減四項合計的差額裡，加回去才不會漏算，也與 Codex「reasoning 只算一次」的規則一致。
- 三種觸發，共用 AGY 自己的 5 分鐘節流、鎖、buffer 與狀態檔，失敗不影響 Claude 與 Codex：
  - AGY 的 Stop hook：setup／update 在 Antigravity 全域 hooks 檔 `~/.gemini/config/hooks.json` 寫入名為 `ccusage-tracker` 的 hook，只接 Stop。Antigravity 沒有 SessionEnd 事件，也沒有信任步驟，但改完 hooks.json 要重開 Antigravity 才會載入。
  - 搭便車：Claude 與 Codex 的背景 worker 結束時，若本機偵測得到 AGY，就觸發一次 AGY 上報，補上 AGY hook 沒觸發的情況。
  - 手動：`tracker sync antigravity`（別名 `tracker sync agy`）。
- CLI：工具偵測加入 Antigravity，status 加 Antigravity 區塊，說明文字加 `sync antigravity`。collector 的安裝版本從 20.0.20 改為 20.0.51。目前的依據有兩項：Claude 與 Codex 在 20.0.51 輸出的 JSON 欄位，與現有驗證器讀取的欄位一致（提案時在本機實跑比對）；Antigravity 的輸出格式取自 ccusage v20.0.51 tag 的測試快照。兩支既有腳本在 20.0.51 上實跑的驗證列為實作任務。版本一律用語意版本比較：已安裝 20.0.21 以下的 20.x 時，若偵測到 AGY，只提示升級，不替換使用者的安裝。status 的 Codex collector 判斷改為只看主版本 20；現在的精確比對會把 20.0.51 誤報為不支援。
- Server：新增來源表模組，`UsageSource`、SQL 的來源 CASE、`resolveSource`，以及儀表板的顏色、名稱、供應商與來源順序，全部由它產生。新增 Antigravity：顯示名 Antigravity、供應商 Google、資料色暫定 `#f0b800`（已用色盲模擬算過與現有三色的區辨度，最後要由人眼確認）。新增 `/scripts/agent-sync.mjs` 路由。ingest API 與 DB schema 不變。
- 儀表板：趨勢圖與供應商拆分從固定的兩條線、兩段，改為每個有資料的來源各一條、各一段。
- `codex-sync.mjs`：只在 worker 結束時多觸發一次 AGY；狀態檔名、`codex-daily`、collector 驗證規則都不變。

## Capabilities

### New Capabilities

- `antigravity-usage`: AGY 當日快照的收集、驗證與 token 換算、獨立的鎖／buffer／重送、Stop hook 進入點、節流，以及 Claude／Codex worker 的搭便車觸發。

### Modified Capabilities

- `cli-tool`: setup／update 的工具偵測與 Antigravity hook 安裝、collector 版本與 Antigravity 讀取器檢查、status 的 Antigravity 區塊與 Codex collector 判斷、`sync antigravity` 指令與說明文字、symlink 規則納入 Antigravity hooks 檔。
- `dashboard`: 趨勢圖與供應商拆分改為逐來源呈現，並加入 Antigravity／Google。

## Impact

- Affected specs: antigravity-usage（新增）、cli-tool、dashboard
- Affected code:
  - New: packages/server/src/sources.ts, packages/server/src/sources.test.ts, packages/server/src/hook-scripts/agent-sync.mjs, packages/server/src/hook-scripts/agent-sync.d.mts, packages/server/src/antigravity-usage.test.ts, packages/cli/src/agent-sources.ts, packages/cli/src/antigravity-hooks.ts, packages/cli/src/antigravity-hooks.test.ts, packages/cli/src/commands/sync.test.ts
  - Modified: packages/server/src/queries.ts, packages/server/src/routes/dashboard.tsx, packages/server/src/scripts.ts, packages/server/src/app.ts, packages/server/src/hook-scripts/session-end.mjs, packages/server/src/hook-scripts/codex-sync.mjs, packages/server/src/routes/dashboard.test.ts, packages/server/src/routes/source-aggregation.test.ts, packages/server/src/claude-usage.test.ts, packages/server/src/codex-usage.test.ts, packages/cli/src/scripts.ts, packages/cli/src/hooks.ts, packages/cli/src/collector.ts, packages/cli/src/commands/setup.ts, packages/cli/src/commands/update.ts, packages/cli/src/commands/status.ts, packages/cli/src/commands/sync.ts, packages/cli/src/index.ts, packages/cli/src/hooks.test.ts, packages/cli/src/collector.test.ts, packages/cli/src/commands/setup.test.ts, packages/cli/src/commands/update.test.ts, packages/cli/src/commands/status.test.ts, README.md, packages/cli/README.md, CHANGELOG.md
  - Removed: (none)
- 依賴：成員本機需 ccusage 20.0.21 以上（20.0.20 沒有 antigravity 指令），新安裝一律裝 20.0.51；不新增 npm runtime 依賴。
- 外部前提：Antigravity hooks 官方文件（antigravity.google/docs/hooks）：App、CLI、IDE 共用全域檔 `~/.gemini/config/hooks.json`，payload 由 stdin 傳入且含使用者最後一句 prompt（本 change 讀完即丟，不解析）。Google 論壇有 Windows IDE 1.107.0 上 Stop 不觸發的回報，搭便車觸發就是為這種情況留的備援。
- 與並行工作的重疊：另有 UI POC session 在改 packages/server/src/routes/dashboard.tsx，本 change 對該檔只改來源相關的對照表與清單。
