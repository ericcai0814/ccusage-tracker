## 1. Codex hooks 模組（TDD）

- [ ] [P] 1.1 依 design「Codex 接線走 hooks.json 而非 notify」與規格「Codex hook installation」先寫失敗測試 packages/cli/src/codex-hooks.test.ts：applyCodexHooks 對空檔或無 hooks 鍵 → append 無 matcher 鍵的 Stop 與 SessionEnd 群組；三個第三方 Stop 群組在前 → 索引 0 至 2 位元組不變、tracker 在索引 3；重跑 → anyChanged 為 false；索引 1 的舊 tracker command → 原索引就地替換；非物件 JSON → 拋錯。驗證：bun test packages/cli 該檔全紅。
- [ ] 1.2 實作 packages/cli/src/codex-hooks.ts 的 getCodexHome（尊重 CODEX_HOME）、getCodexHooksPath、getCodexHookCommand（node 加引號絕對路徑加 --hook）、applyCodexHooks；擴充 packages/cli/src/hooks.ts 的 tracker hook 辨識 regex 同時辨識 codex-sync.mjs，並讓 installHook 把 hooks.json 納入與 settings.json 同一筆 staged 交易與 rollback。驗證：1.1 全綠，既有 packages/cli/src/hooks.test.ts 仍全綠。
- [ ] [P] 1.3 依 design「Hook 信任狀態的可見性」先寫再實作 readCodexTrustState(configTomlText, hooksPath, groupIndexes)：區段含 trusted_hash → recorded、含 enabled = false → disabled、缺區段或空字串 → awaiting，只認區段標頭與其後到下一個 [ 之前的 key = value 行。驗證：codex-hooks.test.ts 三種 TOML 片段案例全綠。

## 2. 收集器與工具偵測

- [ ] [P] 2.1 依規格「Collector dependency」與 design「收集器依賴的統一處理」先寫失敗測試 packages/cli/src/collector.test.ts：探測失敗 → 呼叫 installCollector 且訊息含 npm install -g ccusage@20.0.20；20.0.20 → ok 不安裝；18.0.9 → unsupported_major、警告含 20.0.20、不安裝；CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1 → skipped 且印指令；安裝失敗 → install_failed 但不改 exit code。驗證：該檔先紅。
- [ ] 2.2 實作 packages/cli/src/collector.ts 的 ensureCollector(deps)，回傳 { status, version }，安裝以 shell 執行、stdio 繼承、180 秒 timeout，安裝後重新探測。驗證：2.1 全綠。
- [ ] [P] 2.3 依規格「Tool detection」與 design「工具偵測與逐工具接線」實作 detectClaude（~/.claude 目錄或 claude 在 PATH）與 detectCodex（CODEX_HOME 或 ~/.codex 目錄或 codex 在 PATH），放在 packages/cli/src/codex-hooks.ts 與 packages/cli/src/hooks.ts 各自的工具側；測試以暫存 HOME 與空 PATH 覆蓋有目錄、無目錄、只有 PATH 三種情況。驗證：對應測試全綠。

## 3. setup、update、status 與說明文字

- [ ] 3.1 依規格「Setup command」與 design「既有 notify 的衝突提示」擴充 packages/cli/src/commands/setup.test.ts：兩工具皆偵測 → hooks.json 含 tracker Stop 與 SessionEnd、config.toml 位元組不變、輸出含 /hooks；Codex 未偵測 → 不建立 hooks.json 且輸出 Codex: not detected；server 對 codex-sync.mjs 回 404 → 不建立 hooks.json 且輸出相容訊息；config.toml 含 tracker notify → 輸出移除提示；兩工具皆未偵測 → exit 0 並提示 update。再改 packages/cli/src/commands/setup.ts：SetupDeps 新增 detectClaude、detectCodex、installCollector、readCodexConfig，輸出逐工具結果行與 collector 結果。驗證：setup.test.ts 全綠。
- [ ] 3.2 依規格「Noninteractive update」擴充 packages/cli/src/commands/update.test.ts：settings.json 與 hooks.json 皆含第三方 hook 時 update 兩次三個檔案位元組不變且 tracker 每事件只出現一次；404 → 不寫 hooks.json；兩工具皆未偵測 → exit 1；完成訊息不再要求執行 sync codex。再讓 packages/cli/src/commands/update.ts 與 setup 共用同一段偵測、Codex hook 安裝與 collector 流程。驗證：update.test.ts 全綠。
- [ ] [P] 3.3 依規格「Status command」擴充 packages/cli/src/commands/status.test.ts：trusted_hash 存在 → Codex hooks: installed, trust recorded；缺 → installed, awaiting trust (open /hooks in Codex)；enabled = false → installed, disabled in Codex；未偵測 → 單行 Codex: not detected。再改 packages/cli/src/commands/status.ts 以 readCodexTrustState 輸出該行。驗證：status.test.ts 全綠。
- [ ] [P] 3.4 依規格「Codex command and adoption」把 packages/cli/src/index.ts 的說明文字中 sync codex 改為 Report Codex usage now (manual fallback / debugging)，並移除 setup 與 update 中「Run tracker sync codex to report usage」的完成訊息。驗證：build 後執行 node packages/cli/dist/index.js 不帶參數，輸出含新描述且不含舊句。

## 4. codex-sync.mjs 的 hook 模式

- [ ] 4.1 依規格「Hook entry point never blocks Codex」與 design「hook 進入點與 throttle」先寫失敗測試於 packages/server/src/codex-usage.test.ts：--hook 搭配 stdin {"hook_event_name":"Stop"} → spawn worker 一次且父程序 exit 0；UserPromptSubmit → 不 spawn；非 JSON、空輸入、超過 64 KB → exit 0、不 spawn、不寫 codex-last-error.txt；payload 含 transcript_path 與訊息文字 → 不出現在 worker argv、buffer、error 檔與 stdout。驗證：該組測試先紅。
- [ ] 4.2 在 packages/server/src/hook-scripts/codex-sync.mjs 實作 --hook 模式（stdin 讀到 EOF、2 秒與 64 KB 上限、只取 hook_event_name），依規格「Isolated retry and notification」保留 --notify 相容路徑，同步更新 packages/server/src/hook-scripts/codex-sync.d.mts 的 argv 契約註解。驗證：4.1 全綠，既有 codex-usage.test.ts 與 source-aggregation.test.ts 仍全綠。
- [ ] 4.3 依規格「Hook-triggered throttle」先寫再實作：hook 與 notify 觸發在 spawn 前檢查 ~/.config/ccusage-tracker/codex-last-flush.txt，5 分鐘內第二次觸發不 spawn，通過時先寫時間戳再 spawn；手動 sync codex 不受 throttle。驗證：codex-usage.test.ts 的 throttle 案例全綠。

## 5. 文件與完整驗證

- [ ] [P] 5.1 更新 README.md、packages/cli/README.md 與 CHANGELOG.md：Codex 段落改為「setup 或 update 後在 Codex 內執行 /hooks 信任一次」，notify 手動路徑標為 deprecated，sync codex 改為手動補送與除錯用途，說明 collector 自動安裝與 CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL，Upgrade 段落不再要求 sync codex。驗證：內容審閱，且 grep 三份文件不再出現 manual opt-in 與「必須執行 sync codex」的敘述。
- [ ] 5.2 完整驗證：pnpm test、pnpm typecheck、pnpm --filter ccusage-tracker build、pnpm build 全綠；以 Node 執行 built CLI 對 loopback server 做 smoke，暫存 HOME 與 CODEX_HOME，setup 後 settings.json 與 hooks.json 皆含 tracker hook，update 兩次後 config.json、settings.json、hooks.json 的 sha256 不變，config.toml 位元組不變；spectra validate add-codex-hook-wiring 通過。驗證：各命令輸出附於 change 目錄的 verification.md。
