## Why

0.4.0 已上線並在真實機器驗證通過，但 Codex 補審（2 med、4 low）與 subagent 審查（4 low）留下 10 個邊角問題，加上 status 對「兩條 hook 只信任一條」的訊息不夠明確、中文 README 缺平台限制說明。趁 0.4.1 一次修完，避免這些問題在成員環境裡零星出現。

## What Changes

- tracker hook 的辨識收緊為標準命令形狀：只有「`node` 加 tracker 腳本絕對路徑加 tracker 參數」才算 tracker hook；只是命令字串裡含有腳本路徑的第三方 hook 一律保留、另行 append。
- 讀取 `~/.claude/settings.json` 與 `$CODEX_HOME/hooks.json` 之前先驗檔案型態：symlink 解析後不是一般檔案（FIFO、socket、目錄、斷鏈）就以非一般檔案訊息拒絕，不再先 `readFileSync`，避免卡在 FIFO 或誤報 JSON 錯誤。
- 信任狀態查詢改用 tracker hook 的實際群組索引與 hook 索引，不再寫死 `:0`。
- notify 移除提示只在 Codex hooks 真的接上（本次或先前已安裝）時印；server 缺 Codex 腳本時不提示。
- `config.toml` 頂層掃描改為追蹤陣列深度與字串狀態，只在頂層辨識 table 標頭；`[[array]]`、帶行尾註解的標頭、無尾逗號的 `[3, 4]` 續行都正確處理。
- 寫穿 symlink 成功時印一行 `Wrote through symlink: <link> -> <real>`；斷鏈分支的 readlink 失敗退回不帶目標的訊息；目標解析移到 staging 迴圈之前且每檔只解析一次。
- 補跨檔 rollback 測試：settings.json 已寫入、hooks.json 最後 rename 失敗時，兩份設定、既有備份、symlink 與暫存檔全部復原。
- setup／update 的 Codex 結果行與 status 的 `Codex hooks:` 行逐 hook 說明信任狀態，例如 `Stop trusted, SessionEnd awaiting trust`。
- 中文 README 補「Windows／Linux 尚未實機驗證」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `cli-tool`: 新增 tracker hook 辨識規則需求；Symlinked configuration files 補讀取前型態檢查、成功訊息與斷鏈處理；Codex hook installation 修 notify 提示條件與 TOML 掃描邊界、逐 hook 信任訊息；Status command 逐 hook 信任訊息與實際索引。

## Impact

- Affected specs: cli-tool
- Affected code:
  - New: （無）
  - Modified: packages/cli/src/hooks.ts, packages/cli/src/hooks.test.ts, packages/cli/src/codex-hooks.ts, packages/cli/src/codex-hooks.test.ts, packages/cli/src/commands/setup.ts, packages/cli/src/commands/setup.test.ts, packages/cli/src/commands/update.ts, packages/cli/src/commands/update.test.ts, packages/cli/src/commands/status.ts, packages/cli/src/commands/status.test.ts, README.md, packages/cli/README.md, CHANGELOG.md
  - Removed: （無）
- 不動 server、Claude 端腳本、codex-sync.mjs；不新增依賴。版本號提升與發布另開 release PR。
