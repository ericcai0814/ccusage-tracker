## 1. symlink 寫穿（TDD）

- [x] 1.1 依 design「設定檔為 symlink 時寫穿到真實檔案」與規格「Symlinked configuration files」先在 packages/cli/src/hooks.test.ts 寫失敗測試：settings.json 為 symlink → 一般檔案時 installHook 成功、symlink 仍是 symlink、真實檔案含 tracker hook、backup 在真實檔案旁；symlink → 目錄與斷鏈各拒絕、訊息含 link 目標、交易內其他檔案不落地。驗證：bun test packages/cli 該組先紅。
- [x] 1.2 實作 packages/cli/src/hooks.ts 的 installFiles：stage 對 symlink 以 realpathSync 解析，成功且為一般檔案時以真實路徑進行暫存、backup、rename；失敗或非一般檔案拋含原路徑與目標的錯誤。驗證：1.1 全綠，既有 hooks.test.ts 全綠。
- [x] [P] 1.3 在 packages/cli/src/commands/setup.test.ts 與 update.test.ts 各加一案：暫存 HOME 內 settings.json 與 hooks.json 皆為 symlink 指到另一目錄的真實檔案，setup／update 成功且兩個 symlink 保留、真實檔案含 tracker hook。驗證：兩檔測試全綠。

## 2. 收集器（F2、F6）

- [x] [P] 2.1 依 design「收集器安裝後重新驗證主版本，且只在偵測到工具時安裝」與規格「Collector dependency」先寫失敗測試：packages/cli/src/collector.test.ts 安裝後重探測回 18.0.9 → unsupported_major 且警告含 20.0.20；setup.test.ts 與 update.test.ts 在 detectClaude 與 detectCodex 皆 false 時 installCollector 與探測都未被呼叫。驗證：先紅。
- [x] 2.2 實作 packages/cli/src/collector.ts 對 reprobed 重跑主版本判斷；packages/cli/src/commands/setup.ts 與 update.ts 只在偵測到工具時呼叫 ensureCollector。驗證：2.1 全綠。

## 3. Codex 結果行與 notify 掃描（F1、F4、F5）

- [x] [P] 3.1 依 design「Codex 結果行區分停用與未信任」「notify 掃描只在 table 標頭中斷」「相容警告只在偵測到 Codex 時印」與規格「Codex hook installation」先寫失敗測試：codex-hooks.test.ts 的 notify 前有跨行頂層陣列仍回 true；setup.test.ts 或 update.test.ts 的 hooks.state `enabled = false` 印 `Codex: hooks installed but disabled in Codex` 且不含 /hooks 提示；404 且 detectCodex 為 false 時輸出不含相容訊息只含 `Codex: not detected`。驗證：先紅。
- [x] 3.2 實作 packages/cli/src/hooks.ts 的 wireTools 分支（disabled 訊息、codexDetected 才印相容訊息）與 packages/cli/src/codex-hooks.ts 的 hasTrackerNotify 中斷條件。驗證：3.1 全綠。

## 4. 節流時間戳（F3）

- [x] [P] 4.1 依 design「節流時間戳只接受過去的值」與規格「Hook-triggered throttle」「Stop throttle ignores future timestamps」先寫失敗測試：packages/server/src/codex-usage.test.ts 的 codex-last-flush.txt 為未來 1 小時時 `--hook` Stop 仍啟動 worker 並覆寫時間戳；packages/server/src/claude-usage.test.ts 的 last-flush.txt 為未來時 `--mode=stop` 仍啟動 worker。驗證：先紅。
- [x] 4.2 修改 packages/server/src/hook-scripts/codex-sync.mjs 的 throttled 與 packages/server/src/hook-scripts/session-end.mjs 的 Stop 節流比較式為 `age >= 0 && age < THROTTLE_MS`。驗證：4.1 全綠，既有兩檔測試全綠。

## 5. 文件與驗證

- [x] [P] 5.1 依 design「README 說明自動安裝會執行 npm 安裝期腳本」更新 packages/cli/README.md 與 README.md 的 collector 段落，CHANGELOG 加 Fixed 條目（symlink 寫穿、F1 到 F6）。驗證：內容審閱，兩份 README 含 `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL` 與安裝期腳本說明。
- [x] 5.2 完整驗證：pnpm test、pnpm typecheck、pnpm --filter ccusage-tracker build、pnpm build 全綠；Node-built CLI 對 loopback server 的 smoke 在暫存 HOME 內以 symlink 設定檔跑 setup 與兩次 update，symlink 保留、真實檔案 sha256 在第二次 update 後不變；輸出寫入 openspec/changes/fix-symlink-config-and-review-lows/verification.md；spectra validate 通過。
