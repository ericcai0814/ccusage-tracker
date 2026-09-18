## Context

前一個 change（add-codex-usage-and-update）完成了 Codex 的當日快照、獨立 buffer／鎖、手動 sync codex 與零提示 update，但把「自動觸發」留給使用者手動填 Codex 的 notify。理由是 notify 是單一槽位，安裝工具不敢覆蓋既有整合。實際情況：Codex CLI 0.154.0 已有正式 hooks 機制（官方文件標示預設啟用），使用者層級的 hooks.json 可放多條 hook，事件含 Stop 與 SessionEnd，與 Claude 的 settings.json hooks 同構。本機驗證顯示 notify 已被其他程式佔用，而 hooks.json 已有第三方 hook 共存。

Codex hooks 有一個 Claude 沒有的機制：信任。新的或改過的 hook 會被略過，直到使用者在 Codex 內以 /hooks 信任一次；信任紀錄存在 config.toml 的 hooks.state 表，key 為「hooks 檔路徑:事件小寫底線:群組索引:hook 索引」，值為 Codex 內部演算法計算的 trusted_hash。OpenAI 尚無給安裝工具的信任 API（issue 21615 仍 open）。

現有 CLI 是零 runtime 依賴的 bun bundle，settings.json 的 upsert／備份／rollback 已在 hooks.ts；收集器 ccusage 只被探測不被安裝。

## Goals / Non-Goals

**Goals:**

- setup 與 update 對 Claude 與 Codex 提供同一套體驗：一條指令完成偵測、腳本、hook、收集器；Codex 只多一個平台強制的「信任一次」。
- sync codex 降為選用的手動補送／除錯入口，正常運作不依賴它。
- 設定衝突才提示，不靜默覆蓋、不靜默略過。
- 不新增 runtime 依賴；config.toml 只讀不寫。

**Non-Goals:**

- 不重現 Codex 的 trusted_hash 演算法、不自動寫入 hooks.state（等於替使用者按同意，且演算法為內部實作）。
- 不編輯 Codex config.toml（含移除使用者手動加的 notify）。
- 不提供 uninstall 指令；不處理 project 層級的 .codex/hooks.json。
- 不改 server ingest／report、DB schema、dashboard。
- 不做 Windows／Linux 實機驗證（沿用前一 change 的限制，於文件標示）。

## Decisions

### Codex 接線走 hooks.json 而非 notify

**Supersedes**: add-codex-usage-and-update / 手動同步與通知

寫入 `$CODEX_HOME/hooks.json`（預設 `~/.codex/hooks.json`）的 Stop 與 SessionEnd 兩個事件，各一個群組、一條 command hook。理由：多條 hook 可共存，不與既有 notify 或第三方 hook 衝突；檔案是 JSON，沿用 hooks.ts 的 staged install、備份與 rollback；事件模型與 Claude 一致，兩邊 status 可對齊。替代方案 notify：單一槽位，本機已被 Codex Computer Use 佔用，且需要 TOML 寫入器；排除。替代方案「只用 SessionEnd」：Codex session 可能長時間不結束，Stop 才能提供接近即時的上報；排除。

Hook 群組物件不含 matcher 鍵（Codex 文件：Stop 不支援 matcher）。command 字串固定為 `node "<絕對路徑>/codex-sync.mjs" --hook`，timeout 與 Claude 相同（45 秒）。字串在 update 間逐位元相同，因為 Codex 的信任雜湊算的是 hook 設定身分而非腳本檔內容，腳本更新不需重新信任。

冪等規則：事件陣列中已有 tracker hook（command 含 ccusage-tracker 目錄下的 codex-sync.mjs）時，原索引就地替換，內容相同則不寫檔；沒有時 append 到陣列尾端。永不移除、重排或改寫非 tracker 的群組，因為信任 key 以索引組成，重排會讓使用者既有 hook 全部變成「已修改」。

### 工具偵測與逐工具接線

Claude 視為存在：`~/.claude` 目錄存在，或 `claude` 在 PATH。Codex 視為存在：`$CODEX_HOME`（未設定則 `~/.codex`）目錄存在，或 `codex` 在 PATH。setup 與 update 對每個存在的工具執行各自的接線，並在結尾逐工具列出結果；不存在的工具印「not detected」。兩者皆不存在：setup 仍寫入 config 並以 exit 0 結束，提示安裝工具後執行 update；update 以 exit 1 結束並印出相同提示。Claude 的接線行為不變。

server 回 404／410（無 codex-sync.mjs）時：印既有相容訊息，不寫 hooks.json（避免 hook 指向不存在的腳本），Claude 接線照常。

### Hook 信任狀態的可見性

setup／update 完成後，Codex 那一行固定附上「Open Codex and run /hooks once to trust the ccusage-tracker hooks.」除非已偵測到信任紀錄。status 以唯讀、逐行方式讀 `$CODEX_HOME/config.toml`：找 `[hooks.state."<hooks.json 絕對路徑>:stop:<群組索引>:0"]` 與 `:session_end:` 的區段，區段內有 `trusted_hash` 視為「trust recorded」，有 `enabled = false` 視為「disabled」，皆無視為「awaiting trust」。不驗證雜湊值是否等於現行 hook（演算法為 Codex 內部），因此輸出措辭是 trust recorded 而非 trusted。不引入 TOML parser；解析只認區段標頭與其後直到下一個 `[` 之前的 `key = value` 行。

### 收集器依賴的統一處理

setup 與 update 都執行同一個 ensureCollector 步驟：探測 `ccusage --version`。未安裝：先印出將執行的指令 `npm install -g ccusage@20.0.20`，以 shell 執行（stdio 繼承、180 秒 timeout），完成後重新探測；失敗只警告並附上同一指令，setup／update 的 exit code 不因此改變，由 status 顯示缺失。已安裝但主版本不是 20：只警告「Claude 上報可用，Codex 需要 20.0.20」並附指令，不替換。已安裝且主版本為 20：不動作。環境變數 `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1` 跳過自動安裝（供 CI、測試與自行管理全域套件的使用者）。替代方案「腳本改用 npx ccusage@20.0.20」：每次 hook 都有 npx 解析成本且離線不可用；排除。

### hook 進入點與 throttle

codex-sync.mjs 新增 `--hook` 模式：讀取 stdin 至 EOF（上限 2 秒與 64 KB），解析 JSON 只取 `hook_event_name`；為 Stop 或 SessionEnd 時 detach 背景 worker，其他事件直接結束；任何錯誤（非 JSON、逾時、缺欄位）都以 exit 0 結束且不啟動 worker，永不阻擋 Codex。stdin 內容不寫檔、不進 argv、不進錯誤訊息。既有 `--notify` 模式保留以相容已手動設定的使用者，但文件標為 deprecated。

throttle：hook 與 notify 觸發在啟動 worker 前檢查 `codex-last-flush.txt`，距上次啟動不足 5 分鐘則不啟動；通過時先寫入時間戳再 spawn。手動 `sync codex` 不受 throttle。與 Claude 的 Stop throttle 語意一致。

### 既有 notify 的衝突提示

setup／update 唯讀掃描 config.toml 頂層 `notify = [...]`：若陣列元素含 ccusage-tracker 目錄下的 codex-sync.mjs，印出「hooks 已接管 Codex 上報，請自行從 config.toml 移除 tracker 的 notify 以免重複觸發」；notify 存在但不是 tracker 的，不提示（hooks 與 notify 可共存）。不編輯 TOML。

## Implementation Contract

**行為（使用者可觀察）**

- 首次：`npx ccusage-tracker@latest setup` 輸入 name／server／team key 後，依序印出 Config saved、Claude 結果行、Codex 結果行、collector 結果行、Server 可達性、Setup complete。
- 後續：`npx ccusage-tracker@latest update` 無提示，印出同樣的逐工具結果行；重跑第二次所有結果行為 already up to date，hooks.json、settings.json、config.json 位元組不變。
- Codex 結果行三種：`Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.`／`Codex: hooks already up to date (trust recorded)`／`Codex: not detected`。
- `tracker status` 新增 `Codex hooks:` 一行，值為 `installed, trust recorded`、`installed, awaiting trust (open /hooks in Codex)`、`installed, disabled in Codex`、`not installed`；Codex 未偵測到時整段 Codex 區塊改為單行 `Codex: not detected`。
- `tracker` 說明文字中 `sync codex` 的描述改為 `Report Codex usage now (manual fallback / debugging)`。

**介面與資料形狀**

- 新模組 packages/cli/src/codex-hooks.ts 匯出純函式 applyCodexHooks(hooksFile) 回傳 { updated, stopChanged, sessionEndChanged, anyChanged }，以及 getCodexHome()、getCodexHooksPath()、getCodexHookCommand()、readCodexTrustState(configTomlText, hooksPath, groupIndexes) 回傳每個事件的 'recorded' | 'awaiting' | 'disabled'。
- hooks.json 寫入形狀：`{"hooks":{"Stop":[...既有群組, {"hooks":[{"type":"command","command":"node \"<abs>/codex-sync.mjs\" --hook","timeout":45}]}],"SessionEnd":[同上]}}`；其他頂層鍵與其他事件原樣保留。
- 新模組 packages/cli/src/collector.ts 匯出 ensureCollector(deps) 回傳 { status: 'ok' | 'installed' | 'install_failed' | 'unsupported_major' | 'skipped', version?: string }。
- hooks.ts 的 tracker hook 辨識 regex 擴充為同時辨識 codex-sync.mjs；installHook 接受 hooks.json 作為額外 staged 檔案，與 settings.json 同一交易、同一 rollback。
- SetupDeps 新增 detectClaude、detectCodex、installCollector、readCodexConfig 四個可注入依賴；update 沿用同一組預設實作。
- codex-sync.mjs 的 argv 契約：無參數＝手動 sync；`--hook`＝讀 stdin 事件；`--notify <json>`＝相容舊路徑；`--worker`＝內部。

**失敗模式**

- hooks.json 非 JSON 物件或 hooks 不是物件：拋錯、不寫任何檔、setup／update exit 1，訊息要求修復檔案（與 settings.json 相同措辭風格）。
- config.toml 不存在或不可讀：信任狀態一律回 awaiting，不報錯。
- npm 全域安裝失敗：警告含指令，繼續後續步驟。
- hook 模式下 stdin 任何異常：靜默 exit 0，不寫 error 檔（避免每輪對話製造噪音）；worker 內部失敗照舊寫 codex-last-error.txt。

**驗收準則**

- packages/cli/src/codex-hooks.test.ts：空檔／無 hooks 鍵 → append 兩個群組且無 matcher 鍵；三個第三方群組在前 → 順序與內容位元組不變、tracker 在尾端；重跑 → anyChanged 為 false；tracker command 不同 → 原索引就地替換；非物件 JSON → 拋錯。readCodexTrustState 對含 trusted_hash、含 enabled = false、缺區段三種 TOML 片段回傳對應狀態。
- packages/cli/src/collector.test.ts：探測失敗 → 呼叫 installCollector 且訊息含 `npm install -g ccusage@20.0.20`；版本 20.0.20 → ok 且不安裝；18.0.9 → unsupported_major、警告含 20.0.20、不安裝；環境變數設定 → skipped。
- packages/cli/src/commands/setup.test.ts 與 update.test.ts：暫存 HOME＋CODEX_HOME 含 `.codex/` 目錄 → hooks.json 有 tracker Stop 與 SessionEnd、config.toml 位元組不變、輸出含 `/hooks`；無 `.codex/` 且 detectCodex 回 false → 不建立 hooks.json、輸出含 `Codex: not detected`；server 對 codex-sync.mjs 回 404 → 不建立 hooks.json、輸出含既有相容訊息；config.toml 含 tracker notify → 輸出含移除提示；兩工具皆未偵測 → setup exit 0、update exit 1。
- packages/cli/src/commands/status.test.ts：hooks.state 含對應 key 的 trusted_hash → `trust recorded`；缺 → `awaiting trust`。
- packages/server/src/codex-usage.test.ts：`--hook` 搭配 stdin `{"hook_event_name":"Stop"}` → spawn worker 一次；`UserPromptSubmit` → 不 spawn；非 JSON → exit 0 不 spawn；5 分鐘內第二次 → 不 spawn；手動 sync 在 throttle 期間仍執行；stdin 內容不出現在任何寫入檔與 worker argv。
- Node-built CLI 對 loopback server 的 smoke：暫存 HOME／CODEX_HOME，setup 後 hooks.json 與 settings.json 皆含 tracker hook，update 兩次後三個檔案 sha256 不變；在 pnpm test、pnpm typecheck、兩個 build 全綠後執行。

**範圍邊界**

- In scope：CLI 的 setup／update／status／help、codex-hooks 與 collector 模組、codex-sync.mjs 的 hook 模式與 throttle、兩份 README、CHANGELOG、cli-tool 與 codex-usage 規格。
- Out of scope：uninstall、project 層級 hooks、Claude 端腳本、server API、trusted_hash 自動寫入、TOML 編輯、Windows／Linux 實機驗證、npm 發布與 server 部署。

## Risks / Trade-offs

- [使用者忘記在 Codex 內信任，hook 靜默不跑] → setup／update 結尾與 status 都明示 awaiting trust；README 的 Codex 段第一步就是 /hooks。
- [Codex 改變 hooks.state 的 key 格式或 hooks.json 語意] → 信任偵測是 best-effort 且措辭保守；hook 安裝本身只依賴文件公開的 hooks.json 形狀；測試用固定 fixture，升級 Codex 時由 status 的實機檢查發現。
- [信任 key 以索引組成] → 只 append、就地替換、永不重排；未來 uninstall 必須說明移除會影響其後 hook 的信任。
- [npm 全域安裝需要權限或網路] → 失敗不阻斷，印指令；提供環境變數跳過。
- [Stop 每輪觸發，收集器全量掃描] → 5 分鐘 throttle，與 Claude 一致；鎖避免重疊。
- [仍有使用者留著手動 notify] → 提示移除；即使不移除，同日快照冪等且鎖互斥，只是多跑。
- [Windows 路徑與 node 不在 Codex PATH] → command 使用引號絕對路徑；文件保留「Node 不在 PATH 時改用絕對 node 路徑」的說明；未實機驗證列為已知限制。

## Migration Plan

1. CLI 發布新版、server 部署含 hook 模式的 codex-sync.mjs（順序：server 先，CLI 後；舊 CLI 對新 server 仍相容）。
2. 既有成員執行 `npx ccusage-tracker@latest update`，依輸出在 Codex 內 /hooks 信任一次；曾手動設定 notify 者依提示移除。
3. 回滾：以 `.backup` 還原 hooks.json，或刪除其中 tracker 群組；舊 CLI 的 sync codex 與 notify 路徑仍可用。

## Open Questions

- 無阻斷項。Codex hook 的 timeout 採 45 秒與 Claude 對齊；若實測 Codex 對 Stop hook 有更嚴格上限，在實作時以文件值為準並記錄於 CHANGELOG。
