## Why

合併 PR #13 後，兩件事讓 setup／update 在部分機器上不能用或行為不一致：設定檔是 symlink（dotfiles 使用者）時安裝防護整筆拒寫；獨立審查找到 8 個 low finding，其中 6 個是程式行為、1 個是文件、1 個是部署後人工驗證。趁還沒發布 npm 一次修完。

## What Changes

- 安裝交易寫穿 symlink：目標是 symlink 且解析後是一般檔案，就把暫存檔、備份與 rename 都套在真實檔案上，symlink 本身保留；目錄、socket、斷鏈仍拒絕並在訊息中指出 symlink 目標。適用於 settings.json、hooks.json 與 tracker 腳本。
- 收集器步驟只在至少偵測到一個工具時執行；自動安裝後重新探測必須再驗一次主版本，不符回 unsupported_major。
- 節流時間戳落在未來時不視為節流中（Codex hook 與 Claude Stop 同一修法）。
- Codex 結果行區分「已停用」與「未信任」；server 缺 Codex 腳本的相容警告只在偵測到 Codex 時印；config.toml 頂層 notify 掃描只在 table 標頭中斷，不被跨行陣列提早結束。
- README 收集器段落補一句：此步驟會執行一次全域 npm 安裝與套件的安裝期腳本，可用環境變數跳過。
- 不處理：F8「對真實 Codex CLI 的端到端驗證」留在部署後人工執行。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `cli-tool`: 新增 symlink 設定檔寫穿需求；Codex hook installation 補停用訊息、相容警告條件與 notify 掃描邊界；Collector dependency 補偵測前提與安裝後重驗。
- `codex-usage`: Hook-triggered throttle 對未來時間戳的處理。
- `session-hook`: 新增 Claude Stop 節流對未來時間戳的處理。

## Impact

- Affected specs: cli-tool, codex-usage, session-hook
- Affected code:
  - New: （無）
  - Modified: packages/cli/src/hooks.ts, packages/cli/src/hooks.test.ts, packages/cli/src/codex-hooks.ts, packages/cli/src/codex-hooks.test.ts, packages/cli/src/collector.ts, packages/cli/src/collector.test.ts, packages/cli/src/commands/setup.ts, packages/cli/src/commands/setup.test.ts, packages/cli/src/commands/update.ts, packages/cli/src/commands/update.test.ts, packages/server/src/hook-scripts/codex-sync.mjs, packages/server/src/hook-scripts/session-end.mjs, packages/server/src/codex-usage.test.ts, packages/server/src/claude-usage.test.ts, packages/cli/README.md, README.md, CHANGELOG.md
  - Removed: （無）
- 不新增依賴、不改 server API 與 DB。
