## Why

Codex 的用量快照與手動 sync 已完成，但 setup／update 不會替 Codex 接上自動上報，使用者必須手動改 Codex 設定或每天自己跑 sync codex。這與 Claude「跑一次 setup 就自動上報」的體驗不一致，也是目前 Codex 成員漏報的主因。

## What Changes

- setup 與 update 偵測本機是否有 Claude 與 Codex，對偵測到的每一個工具接上自動上報；`sync codex` 降為選用的手動補送／除錯指令。
- Codex 自動上報改走 Codex hooks：setup／update 把 tracker 的 Stop 與 SessionEnd hook 以冪等方式 append 到使用者層級的 Codex hooks.json，不再要求手動填寫 notify，也不修改 Codex config.toml。
- 安裝完成訊息與 status 明確告知 Codex hook 的信任狀態：Codex 會略過尚未信任的新 hook，使用者需在 Codex 內執行 /hooks 信任一次；status 從 Codex config.toml 的 hooks.state 讀出 trusted／untrusted／modified 並給出下一步。
- setup 與 update 統一處理收集器依賴：未安裝 ccusage 時自動安裝已驗證的 ccusage@20.0.20 並印出所執行的指令；已安裝但主版本不支援 Codex 時只提示不替換。
- codex-sync.mjs 新增 hook 進入點：讀取並丟棄 stdin 事件內容，只在事件為 Stop 或 SessionEnd 時 detach 背景 worker；worker 加入與 Claude 相同的 5 分鐘 throttle，避免每輪對話都重跑收集器。
- 偵測到使用者先前依文件手動加入的 tracker notify 時，提示移除以免重複觸發；仍不編輯 TOML。
- **BREAKING**（規格層）：移除「setup／update SHALL NOT modify Codex 設定」的情境，改為「SHALL 只 append 到 hooks.json、SHALL NOT 修改 config.toml、SHALL NOT 重排既有 hook」。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `cli-tool`: setup／update 新增工具偵測、Codex hook 安裝、收集器自動安裝與衝突提示；status 新增 Codex hook 信任狀態；sync codex 定位改為選用。
- `codex-usage`: 通知進入點由 notify argv 改為 hooks stdin 事件；新增 Stop／SessionEnd 事件過濾與 5 分鐘 throttle；trust 狀態可見性。

## Impact

- Affected specs: cli-tool, codex-usage
- Affected code:
  - New: packages/cli/src/codex-hooks.ts, packages/cli/src/codex-hooks.test.ts, packages/cli/src/collector.ts, packages/cli/src/collector.test.ts
  - Modified: packages/cli/src/hooks.ts, packages/cli/src/commands/setup.ts, packages/cli/src/commands/update.ts, packages/cli/src/commands/status.ts, packages/cli/src/index.ts, packages/cli/src/commands/setup.test.ts, packages/cli/src/commands/update.test.ts, packages/cli/src/commands/status.test.ts, packages/server/src/hook-scripts/codex-sync.mjs, packages/server/src/hook-scripts/codex-sync.d.mts, packages/server/src/codex-usage.test.ts, packages/cli/README.md, README.md, CHANGELOG.md
  - Removed: （無）
- 不新增 npm runtime 依賴：hooks.json 是 JSON，沿用現有 settings.json 的 upsert／備份／rollback 機制；不引入 TOML 寫入器，config.toml 只讀不寫。
- 外部前提：Codex CLI 需支援 hooks（0.154.0 驗證，官方文件標示預設啟用）；信任步驟無官方自動化 API（openai/codex issue 21615 仍 open），不嘗試重現 trusted_hash。
