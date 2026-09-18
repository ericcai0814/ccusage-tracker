## Why

目前只有 Claude hooks 能觸發用量上報，Codex 訂閱使用者無法独立同步；既有安裝也缺少保留設定的非互動更新入口。

## What Changes

- 新增獨立 Codex 每日快照、手動同步及手動 opt-in notify，沿用訂閱／OAuth 的本機使用紀錄。
- 新增零提示 update，完整下載與驗證後安裝，保留設定原始位元組、buffer、sessions 與第三方 hooks。
- 驗證已發佈 collector 的版本與格式，保護 Claude 身分與離線重送順序。
- 補齊實際 Node 執行、mock HTTP、API 聚合測試及未發佈功能採用文件。

## Capabilities

### New Capabilities

- `codex-usage`: Codex 來源隔離、canonical token 轉換、每日冪等同步、notify 與失敗可見性。

### Modified Capabilities

- `cli-tool`: setup 供應 Codex 腳本，非互動 update、sync 與來源狀態。
- `session-hook`: 保留 Claude daily 快照與背景行為，明確辨識來源格式並避免舊快照覆寫。

## Impact

- Affected specs: codex-usage, cli-tool, session-hook。
- Affected code:
  - New: packages/cli/src/commands/update.ts, packages/cli/src/commands/sync.ts, packages/server/src/hook-scripts/codex-sync.mjs, packages/server/src/codex-usage.test.ts, packages/server/src/routes/source-aggregation.test.ts
  - Modified: packages/cli/src/index.ts, packages/cli/src/config.ts, packages/cli/src/hooks.ts, packages/cli/src/commands/setup.ts, packages/cli/src/commands/status.ts, packages/server/src/hook-scripts/session-end.mjs, packages/server/src/scripts.ts, packages/server/src/app.ts, README.md, packages/cli/README.md, CHANGELOG.md
- 不新增資料庫 schema、外部依賴或模型 API；Node 18 tracker 與 Claude 路徑保持相容，Codex collector 的較高執行環境需求另行說明。
