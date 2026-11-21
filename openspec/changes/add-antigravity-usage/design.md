## Context

現況：Claude 由 `session-end.mjs` 跑 `ccusage claude daily`，以 session_id `daily` 上報；Codex 由 `codex-sync.mjs` 跑 `ccusage codex daily`，以 `codex-daily` 上報。兩條路各有自己的鎖、buffer、錯誤檔與 5 分鐘節流。Server 沒有來源欄位，靠 `queries.ts` 一段寫死的 SQL CASE 與 `resolveSource` 從 session_id 反推來源；儀表板的顏色、名稱、供應商對照表和兩份來源順序清單也各自寫死，未知的 session_id 一律歸到「其他」。

ccusage 端（提案期間查證）：

- 20.0.20 的原始碼樹沒有任何 antigravity 路徑，20.0.21 起才有 `docs/guide/antigravity`；npm 最新版是 20.0.51（2026-11-14 發布）。
- `ccusage antigravity daily --json` 的每日列由 ccusage-core 共用的序列化器輸出，欄位有 `date`、`inputTokens`、`outputTokens`、`cacheCreationTokens`、`cacheReadTokens`、`totalTokens`、`totalCost`、`modelsUsed`、`modelBreakdowns`。`totalTokens` 等於四項相加再加 `extra_total_tokens`；antigravity adapter 把 reasoning（thinking）token 放進 `extra_total_tokens`，可見 output 不含 reasoning。依據是 v20.0.51 的 loader 測試與報表快照：該日 100＋30＋5＋20＝155，`totalTokens` 為 165。
- 沒有定價的 model 成本算 0，名稱列在 `totals.unpricedModels`。
- 資料來源是六個根目錄底下的 `conversations/*.db`：`~/.gemini/antigravity`、`-cli`、`-ide`、`-backup`、`-acp` 與 `~/.config/antigravity`；也可用 `ANTIGRAVITY_DATA_DIR` 覆寫。
- Claude 與 Codex 在 20.0.51 輸出的欄位，與兩支現有驗證器讀取的欄位一致（本機實跑比對）。

Antigravity hooks（依 antigravity.google/docs/hooks.md，提案時抓下全文核對）：

- App、CLI、IDE 共用全域檔 `~/.gemini/config/hooks.json`。檔案頂層的 key 是 hook 名稱，值是「事件名 → handler 陣列」。
- Stop 屬於簡單事件，handler 物件直接放在陣列裡，沒有 matcher。hook 定義層可帶 `enabled: false` 停用。
- 事件只有 SessionStart、PreToolUse、PostToolUse、PreInvocation、PostInvocation、Stop 六種，沒有 SessionEnd，文件也沒提到信任步驟。
- payload 以 camelCase JSON 從 stdin 傳入，內容含 `conversationId`、`transcriptPath`、`lastUserInput`（使用者最後一句 prompt）等，但沒有事件名欄位。
- Stop 的 stdout 欄位 `decision` 標為必填：值為 `"continue"` 時會阻止停止，其他任何值都允許停止。handler 預設 timeout 30 秒。
- 論壇有兩則回報：Windows 版 IDE 1.107.0 的 Stop hook 從未觸發；改了 hooks.json 要重開才生效。兩則都不是官方文件內容。

本機觀察：

- 沒有任何 AGY 對話資料，也沒有 `agy` 指令。但 `~/.gemini/antigravity/bin/webm_encoder` 存在，這是 Antigravity 的瀏覽器錄影編碼器，binary 字串含 `agy_encoder_chrome_profile`。
- 在 20.0.51 上計時：`antigravity daily` 0.02 至 0.07 秒，`claude daily` 0.31 秒，`daily --by-agent` 0.35 秒。

並行工作：有三個 UI POC session 正在改 `packages/server/src/routes/dashboard.tsx`。

## Goals / Non-Goals

**Goals:**

- AGY 用量自動上報，保證與 Codex 相同：只認已驗證的格式、狀態獨立、只傳 token／成本／model 名稱、永遠不擋住工具本身。
- AGY 的 Stop hook、Claude／Codex worker 搭便車、手動 sync 三種觸發，共用同一個節流。
- 接下一個工具時，每一層各加一筆表格即可；只有該工具有自己的 hook 機制時才需要另寫安裝器。
- 舊版 CLI 與舊版 server 都照常運作；沒有 AGY 的機器行為不變。

**Non-Goals:**

- 不用 `ccusage daily --json --by-agent` 自動上報本機偵測到的每個工具。這個指令在本機確實列出了 tracker 沒在收的 `hermes`（gpt-6.1-sol，2026-11-20 為 2.93 美元），一次只要 0.35 秒。不採用的理由有三：
  - 現有 codex-usage 規格明文禁止退回統一 daily，並要求逐來源 fail-closed 驗證。
  - 「totalTokens 差額就是 reasoning」只對 antigravity adapter 查證過。
  - 自動上傳每個偵測到的工具（例如掛在成員名下的 Hermes gateway bot）是使用政策的決定，不在這次的需求裡。列為之後的候選 change。
- 不把 `codex-sync.mjs` 併進 `agent-sync.mjs`。
- 不處理 workspace 層 `.agents/hooks.json`、plugin hooks，以及 Antigravity CLI 的 `settings.json`（官方文件說明那裡的 hooks 不會載入）。
- 不提供 uninstall 指令；不改 ingest API、DB schema 與週報。
- 不做 Windows／Linux 實機驗證。文件沒寫 Windows 上 `~` 怎麼解析，實作一律用 `os.homedir()`。
- 儀表板不顯示「未定價 model」警示。

## Decisions

### 通用上報腳本 agent-sync.mjs 與來源表

新增單檔腳本 `packages/server/src/hook-scripts/agent-sync.mjs`，由 server 以 text import 提供，下載到 `~/.config/ccusage-tracker/agent-sync.mjs`。腳本必須單檔、不 import 其他 tracker 檔，因為成員本機只放下載下來的那一個檔，沒有 module graph。

腳本內有 `SOURCES` 物件，以來源 id 為 key，這次只有 `antigravity`。每筆欄位：

- `label`：`Antigravity`
- `subcommand`：`antigravity`
- `sessionId`：`antigravity-daily`
- `statePrefix`：`antigravity`
- `minCollector`：`20.0.21`
- `dataRoots`：上列六個根目錄
- `dataDirEnv`：`ANTIGRAVITY_DATA_DIR`
- `hookStdout`：`{"decision":"stop"}`

鎖、buffer、POST、節流與 stdin 讀取的程式從 `codex-sync.mjs` 複製過來，檔名改為 `<statePrefix>-*`。選擇複製而不抽共用模組：Codex 腳本已在成員機器上跑，抽共用模組就得多下載一個檔、多一層 import，讓已驗證的 Codex 路徑跟著承擔風險。為了防止兩份漂移，agent-sync 的測試沿用 codex-usage.test.ts 的同一組鎖、buffer、節流案例。

替代方案：

- 每個工具一支 `antigravity-sync.mjs`。排除，因為下一個工具又要再複製一份約 260 行。
- 這次就把 Codex 搬進來。排除，風險落在已運作的路徑上，列為 Non-Goal。

### AGY 用量換算：reasoning 併入 output

`output_tokens` 等於 `outputTokens` 加上 `totalTokens` 減四項合計的差額；`input_tokens`、`cache_read_tokens`、`cache_creation_tokens` 原樣上報。`cache_creation_tokens` 可以不為 0（與 Codex 不同）。差額為負時，整列判為不合格、不上報。`total_cost_usd` 取 `totalCost`，負零送 0；`models` 取 `modelsUsed` 清洗後去重。

model 名稱只清洗、不因名稱拒收。ccusage v20.0.51 的 `normalize_antigravity_model` 遇到不認得、且不以 gemini-／claude-／gpt- 開頭的顯示名時，會原樣回傳，空白與括號都還在。若比照 Codex 用 model 名稱 regex 拒收整列，AGY 每推一個新 model，該成員當天的上報就會整個斷掉。清洗規則：

1. 把每段不屬於 `[A-Za-z0-9_.:/-]` 的連續字元換成一個 `-`。
2. 去掉頭尾的 `-`，截到 200 字。
3. 清洗後是空字串的名稱直接丟掉。

例如 `Kimi K3 (Preview)` 會變成 `Kimi-K3-Preview`。依據見 Context 的 v20.0.51 快照與 loader 測試。這樣與 Codex「output 含 reasoning、只算一次」一致，儀表板的 output 欄跨來源才可比。

替代方案：

- 丟掉差額。會少算 reasoning，也與 Codex 規則不一致，排除。
- 新增 reasoning 欄位。要改 schema，屬 Non-Goal。

成本沿用 ccusage 預設的線上定價（與 Codex 相同，不加 `--offline`）。手動 sync 若看到 `totals.unpricedModels`，印一行列出被排除在成本估計之外的 model；hook 與搭便車路徑不另外記錄。

### Collector 版本：語意版本比較與 20.0.51

三個地方用同一條版本規則：reporter 收集前、CLI 的 collector 步驟、status 的 Antigravity collector 行。`ccusage --version` 的輸出可能帶 `ccusage ` 前綴，去掉後以語意版本比較，範圍為 20.0.21（含）至 21.0.0（不含）。比較整個版本號，不只看 patch，所以 20.1.0 照樣接受。

reporter 遇到 20.0.21 以下的 20.x、其他主版本或無法解析的版本時，失敗訊息都指名 `ccusage@20.0.51`，而且不執行 antigravity 指令。

CLI 端：

- `COLLECTOR_VERSION` 改為 20.0.51，安裝指令、status 的 `ccusage: not found` 提示與相容訊息同步更新。
- `ensureCollector` 新增「是否偵測到 AGY」的輸入。已裝 20.0.21 以下的 20.x 時，只有偵測到 AGY 才警告，且不替換使用者的安裝。
- status 的 Codex collector 行改為只看主版本 20。現行精確比對 20.0.20 的寫法會把 20.0.51 誤報為不支援；這是既有 bug，因為改了安裝版本才會浮現，所以一併修。

版本解析與比較寫成 CLI 的 `parseCollectorVersion`／`compareCollectorVersion`，collector 與 status 共用。腳本端是單檔，自帶同一套邏輯。

### Antigravity hook 安裝：以 hook 名稱為 key

寫入 `~/.gemini/config/hooks.json` 頂層 key `ccusage-tracker`，值為：

    {"Stop":[{"type":"command","command":"node \"<home>/.config/ccusage-tracker/agent-sync.mjs\" --hook antigravity"}]}

既有 tracker 項目若帶 `enabled` 欄位，原樣保留。使用者在 Antigravity 介面停用的 hook，update 不會擅自打開。

command 字串與 Codex 用同一個帶引號路徑的產生方式。辨識 tracker 項目只看 key 名稱，不看 command 形狀，所以不需要 Codex 那套命令辨識規則；其他頂層 key 的值與順序都不動。檔案或上層目錄不存在就建立。

不寫 `timeout`：文件只在巢狀 `hooks` 陣列的欄位表列出它，扁平 handler 能不能用不確定；而本腳本在 3 秒內就會結束，預設的 30 秒夠用。

stdout 固定印 `{"decision":"stop"}`。依據是文件寫 `decision` 必填，且「`continue` 以外的值都允許停止」。空 stdout 時 Antigravity 怎麼處理，文件沒寫，所以避開空輸出。這行輸出還沒在實機驗證過，列為驗收任務；萬一被拒，只需改 `SOURCES` 裡的 `hookStdout` 常數。

這個檔與 Claude、Codex 的設定檔放進同一筆 staged 交易，共用 `.backup`、rollback 與 symlink 規則。寫入成功的結果行會提醒重開 Antigravity（依論壇回報，改 hooks.json 要重開才生效）。status 讀同一個檔，回報 installed、disabled 或 not installed。

替代方案：寫入 workspace 層 `.agents/hooks.json`。排除，因為那要逐專案安裝，而且會進到使用者的 repo。

### 觸發與節流：hook、搭便車、手動

`agent-sync.mjs` 的 argv 契約：

| 呼叫方式 | 行為 |
| -------- | ---- |
| `<source>` | 手動 sync，不受節流限制 |
| `--hook <source>` | Antigravity Stop hook 的進入點 |
| `--trigger` | 給 Claude 與 Codex worker 呼叫 |
| `--worker <source>` | 內部使用，實際執行收集與上報 |

hook 模式：

- 讀 stdin 到 EOF，或到 2 秒、64 KB 為止，讀完即丟、不解析。只讀是為了讓 Antigravity 寫 payload 時不會因為沒人接收而出錯。
- 印出 `hookStdout`，通過節流就 detach worker，exit 0。
- payload 沒有事件名可以檢查；這條命令只註冊在 Stop 底下，所以不必過濾事件。

搭便車：

- Claude worker 在 `runWorker` 持有鎖、跑完 `flushBuffer` 之後觸發；Codex worker 在 worker 模式的 sync 結束後觸發，不論成敗。
- 觸發的做法：`agent-sync.mjs` 存在時，以 detached、stdio ignore 的方式啟動 `--trigger`，不帶任何自身的 payload 或參數。
- 放在 worker 結尾，而不是 hook 主程序：Claude／Codex 的 hook 延遲不變，兩個 collector 也不會同時跑。

`--trigger` 依序走過 `SOURCES`，每個來源各自判斷「偵測得到」且「通過節流」才啟動 worker。偵測條件是 `ANTIGRAVITY_DATA_DIR` 非空，或任一根目錄下有 `conversations` 目錄。只看根目錄不夠，本機殘留的 `~/.gemini/antigravity/bin` 就會被誤判為有在用。

CLI 的工具偵測另外接受 `agy`、`antigravity` 在 PATH 上，讓還沒開過對話的新使用者也能先接好 hook。

節流檔 `antigravity-last-flush.txt` 由 hook 與搭便車共用，規則與 Codex 相同：5 分鐘內不重跑；時間戳落在未來時不算節流中；先寫時間戳再 spawn。手動 sync 不讀也不寫節流檔。

### Server 來源表與儀表板

新增 `packages/server/src/sources.ts`，內容是一個有序陣列，依序為 claude／`daily`、codex／`codex-daily`、antigravity／`antigravity-daily`；每筆含 id、sessionId、label、provider、color，另有 OTHER 項目。

- 型別：`UsageSource` 由陣列推導，再加 `other`。
- 函式：`buildSourceCaseSql(table)` 與 `resolveSource(sessionId, table)` 都接受表格參數，預設用正式表；測試可以傳入含 `gemini-daily` 的表。
- 安全性：SQL 只由表內常數組成，模組載入時檢查每個 sessionId 都符合 `^[a-z0-9-]+$`。
- 儀表板：顏色、名稱、供應商與兩份順序清單改由表格推導。`aggregateModelPresence` 已經以「model＋來源」為 key，同一個 model 從兩個來源來會分成兩列，不必改。

Antigravity 的資料色 `#f0b800`。依據：

- 以 Machado 2009 的 protan／deutan／tritan 模擬（severity 1.0）計算 CIELAB ΔE76，與現有三色最差的一對是 31.1；現有色盤內最差的一對（claude 對 other）是 33.7。
- 在 `#0a0a0a` 上的對比是 10.9:1。

依「UI 視覺驗證不由 AI 判斷」的規則，這個顏色要由人看過才算定案。

新增 `/scripts/agent-sync.mjs` 路由，`scripts.ts` 匯出腳本文字。dashboard.tsx 只改上述對照表與清單，不碰版面，降低與 UI POC session 的衝突。

### CLI 來源表與 Antigravity 指令

新增 `packages/cli/src/agent-sources.ts`，AGY 一筆，欄位：

- `id`：`antigravity`；`aliases`：`["agy"]`；`label`：`Antigravity`
- `statePrefix`：`antigravity`；`scriptName`：`agent-sync.mjs`
- `dataRoots`：六個根目錄；`pathCommands`：`["agy","antigravity"]`
- `minCollector`：`20.0.21`

工具偵測、`sync` 指令的目標解析與 status 的區塊都從這張表讀。Antigravity 專屬的 hooks.json 處理放在 `packages/cli/src/antigravity-hooks.ts`。

CLI 各處的改動：

- `scripts.ts`：`agent-sync.mjs` 比照 Codex，伺服器回 404／410 時視為選配缺席，`TrackerScripts.agentSync` 為選填。
- `hooks.ts`：`installHook` 把 `agent-sync.mjs` 與 AGY hooks 檔納入同一筆交易；`wireTools` 回傳 `antigravityDetected` 並印出 Antigravity 結果行；`NO_TOOL_MESSAGE` 加上 Antigravity。
- `status.ts`：Codex 未偵測時不再提早 return，改為印一行後繼續印 Antigravity 區塊。
- `sync.ts`：接受 `codex`、`antigravity`、`agy` 三個目標。
- `index.ts`：說明文字加一行。

### 接下一個工具的步驟

1. 在釘選的 collector 版本、以真實資料跑 `ccusage <tool> daily --json`，確認欄位，並查清 `totalTokens` 差額在該 adapter 代表什麼。
2. 在 `agent-sync.mjs` 的 `SOURCES` 加一筆，並用合成 collector 寫測試。
3. 在 server 來源表加一筆：session_id `<tool>-daily`，以及 label、provider 和用同一支色盲模擬腳本驗過的顏色。
4. 在 CLI 來源表加一筆：偵測目錄、PATH 指令與別名。
5. 若該工具有 hook 機制，比照 `antigravity-hooks.ts` 另寫安裝器；沒有就靠搭便車觸發。

## Implementation Contract

**行為**

- 偵測得到 AGY 的成員執行 `tracker update` 並重開 Antigravity 後，每次 Stop（5 分鐘最多一次）就上報 AGY 當日快照。Claude 或 Codex 的 worker 跑完時，也會補觸發一次。
- 儀表板出現 Antigravity 線條、Google 供應商區段，模型表的來源欄可顯示 Antigravity。
- 沒有 AGY 的機器：沒有新程序、沒有新的 `antigravity-*` 檔，結果行只多一行 `Antigravity: not detected`。

**介面與資料形狀**

- 上報 body：member_name、date、session_id `antigravity-daily`、input_tokens、output_tokens（含 reasoning）、cache_creation_tokens、cache_read_tokens、total_cost_usd、models，沒有其他欄位。
- 狀態檔：`antigravity-buffer.jsonl`、`antigravity-worker.lock`、`antigravity-last-error.txt`、`antigravity-last-upload.txt`、`antigravity-last-flush.txt`。
- hooks.json：頂層 key `ccusage-tracker`，內容見上方「Antigravity hook 安裝」。
- argv 契約：見上方「觸發與節流」；`--hook` 一律 exit 0，stdout 恆為 `{"decision":"stop"}`；`--trigger` 一律 exit 0、不輸出。

**CLI 輸出字串（逐字）**

| 情況 | 字串 |
| ---- | ---- |
| hook 已寫入 | `Antigravity: hook installed (Stop). Restart Antigravity to load it.` |
| hook 已是最新 | `Antigravity: hook already up to date` |
| hook 被停用 | `Antigravity: hook installed but disabled in Antigravity (Settings > Customizations > Hooks)` |
| server 沒有 agent-sync.mjs | `Antigravity: hook not installed (this server does not provide agent-sync.mjs)` |
| 未偵測到 | `Antigravity: not detected` |
| 手動 sync 成功 | `Antigravity usage synced.` |
| 今天沒有用量 | `No Antigravity usage for today.` |
| sync 目標錯誤 | `Usage: tracker sync codex|antigravity` |
| 腳本未安裝 | `Antigravity script not installed. Run tracker update with a server that provides agent-sync.mjs.` |
| 說明文字 | `sync antigravity  Report Antigravity usage now (manual fallback / debugging)` |

status 各行的字串依 cli-tool 規格「Status command」。

**失敗模式**

- collector 缺席、版本不合、輸出不合格：寫固定、不含 collector 輸出的錯誤訊息到 `antigravity-last-error.txt`，不上報；手動模式 exit 1。
- 上報失敗：快照留在 buffer，下次先送新快照。
- hooks.json 不是 JSON object，或 `ccusage-tracker` 的值不是 object：整筆交易不寫任何檔，exit 非 0，要求使用者修檔。
- server 對 `agent-sync.mjs` 回 404／410：不接 AGY，Claude 與 Codex 照常安裝。
- AGY 的任何失敗都不改 Claude 與 Codex 的任何檔案或 exit code。

**驗收**

- tasks.md 列出的單元與整合測試全綠；`pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm --filter ccusage-tracker build` 全綠。
- 以 built CLI 對 loopback server、隔離 HOME、合成 ccusage 做 smoke 測試。
- 以本機真實 ccusage 20.0.51 跑既有 `session-end.mjs` 與 `codex-sync.mjs`，確認驗證器接受其輸出；上報對象指向 loopback，不送正式機。
- `spectra validate add-antigravity-usage` 通過。
- Antigravity 實機驗收需要一台裝有 Antigravity 且有對話的機器，本機沒有，結果記為未確認，直到有人驗收。

**範圍**

- 範圍內：上述 server、腳本、CLI、文件。
- 範圍外：見 Non-Goals；另外不改 release 版本號，發版另開 change。

## Risks / Trade-offs

- [Windows IDE 1.107.0 有 Stop hook 從未觸發的回報，官方尚無修正] → Claude／Codex worker 搭便車觸發；status 的「last successful upload」可看出 AGY 是否長期沒送出。
- [`{"decision":"stop"}` 尚未在實機確認會被接受] → 寫法依官方文件；task 5.3 實機驗收；被拒時只改 `hookStdout` 常數。
- [改 hooks.json 要重開 Antigravity 才生效（論壇回報）] → 結果行提醒重開，README 也寫明。
- [只用 AGY、且 hook 不觸發的成員，不會自動上報] → status 會顯示從未成功上報；README 說明 `tracker sync agy` 可手動補送。
- [IDE 使用者 PATH 上沒有指令、也還沒開過對話時，偵測不到 AGY] → README 寫明第一次用過 AGY 後再跑一次 `tracker update`。
- [從 codex-sync 複製來的鎖與 buffer 程式日後漂移] → 兩份用同一組測試案例；把 Codex 併入 agent-sync 列為後續候選。
- [未定價 model 的成本算 0，AGY 成本會被低估] → 手動 sync 會列出這些 model；模型表照樣顯示 model 名稱。
- [以 JSON 重寫 hooks.json 會統一縮排，且 JS 會把整數字串的 hook 名稱移到最前面] → 只有純數字的 hook 名稱會移位；寫入前一定留 `.backup`。
- [server 提供的 `uninstall.sh` 只處理 Claude，會刪掉整個 `~/.config/ccusage-tracker`，留下指向不存在腳本的 AGY hook；Codex hook 目前也有同樣問題] → 每次 Stop 時 node 找不到檔案、stdout 為空，Antigravity 的反應未確認。README 的移除段落寫明要手動刪掉 hooks.json 的 `ccusage-tracker` key；改寫 uninstall 屬 Non-Goal。
- [Windows 上 `~` 怎麼解析，文件沒寫] → 一律用 `os.homedir()`；Windows 實機屬 Non-Goal。
- [dashboard.tsx 有 UI POC session 同時在改] → 只改來源相關的對照表與清單；合併前先 rebase 並重跑 dashboard 測試。

## Migration Plan

1. 先部署 server（來源表、儀表板、`/scripts/agent-sync.mjs`）。舊 CLI 不會下載新腳本，行為不變；舊資料不動。
2. 成員執行 `tracker update`：下載 `agent-sync.mjs`，偵測到 AGY 就寫入 hooks.json，並檢查 collector。之後重開 Antigravity。
3. 回滾：
   - server 退回舊版時，`antigravity-daily` 會被舊的 CASE 歸到「其他」，資料看得到、不會遺失。
   - 成員端刪掉 hooks.json 的 `ccusage-tracker` key（或還原 `.backup`），再刪 `agent-sync.mjs`。檔案不在時，Claude／Codex worker 會自動略過觸發。
4. CHANGELOG 記在 Unreleased，發版另開 change。

## Open Questions

- 不擋實作。只剩兩項本機無法回答的實機確認，已列為 task 5.3：Antigravity 是否接受 `{"decision":"stop"}` 而不報錯；目前 macOS 上的 Antigravity CLI 與 IDE，Stop hook 是否會觸發。
