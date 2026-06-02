## 1. CLI hook command quoting

- [x] 1.1 將 `packages/cli/src/hooks.ts` 的 Setup command hook 產生邏輯改為共用 `buildHookCommand()`，並以雙引號包住 SessionStart / SessionEnd / Stop 腳本絕對路徑。
- [x] 1.2 保留 `SessionEnd` 與 `Stop` 共用 `session-end.mjs`，分別以 `--mode=session-end` / `--mode=stop` 區分。

## 2. Migration / regression tests

- [x] 2.1 更新 `packages/cli/src/hooks.test.ts`，斷言三個 canonical hook command 的腳本路徑都有雙引號。
- [x] 2.2 新增含空格路徑 regression test，確認 command 經 shell word-split 後，`node` 的第一個參數仍是完整腳本路徑。
- [x] 2.3 新增 Windows 風格含空格路徑 regression test，確認 command 產生器會輸出 `node "<path>"`。
- [x] 2.4 新增 migration regression test，確認既有無引號 tracker command 會被 `applyTrackerHooks` 替換為有引號 canonical command。

## 3. Verification

- [x] 3.1 執行 CLI hook test。
- [x] 3.2 執行 full repo test suite。
- [x] 3.3 執行 TypeScript typecheck。
- [x] 3.4 執行 Spectra validation。
