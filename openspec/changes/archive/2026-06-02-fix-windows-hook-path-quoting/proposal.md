## Problem

Windows 使用者名稱含空格者（例如 home 路徑為 `C:\Users\Gill Chiang`），透過 CLI 指令 `ccusage-tracker setup` 安裝後，寫入 `~/.claude/settings.json` 的三個 hook（SessionStart / SessionEnd / Stop）command 全部無法執行，導致該機器**完全不上報**用量，且為靜默失敗、使用者無任何錯誤提示。Dashboard 上該成員的 Last Report 會凍結在最後一次正確安裝的時間點，用量被嚴重低估，連帶團隊總量與成本統計失真。

## Root Cause

`packages/cli/src/hooks.ts` 的 `getHookCommand`、`getStopHookCommand`、`getStartHookCommand` 三個函式以 `"node " + path` 直接串接腳本絕對路徑，未對路徑加引號。當 home 路徑含空格時，產出的 command 形如 `node C:\Users\Gill Chiang\.config\ccusage-tracker\session-end.mjs --mode=stop`。Claude Code 執行 hook 時對 command 字串做 shell word-split，`node` 取得的第一個參數變成 `C:\Users\Gill`，node 因找不到該模組而拋 `Cannot find module` 並退出，hook 靜默失敗。

bash 安裝腳本（`packages/server/src/scripts.ts` 內 setup.sh 段落）與 PowerShell 安裝腳本（同檔 setup.ps1 段落）都已刻意用雙引號包住腳本路徑以容納含空格的 home，唯獨 CLI 這條安裝路徑遺漏，三條安裝路徑的引號處理不一致。

## Proposed Solution

將 `hooks.ts` 三個產生 command 的函式改為以雙引號包住腳本絕對路徑，產出 `node "<absolute-path>" --mode=...` 形式的命令，與 setup.sh、setup.ps1 的既有做法對齊。新增單元測試斷言三個函式回傳的字串中腳本路徑確實被雙引號包住（含空格路徑情境），守住回歸並保證三條安裝路徑語意一致。

## Non-Goals (optional)

- 不修改 `.mjs` 上報腳本本身的邏輯（問題不在腳本內容，而在外層 command 字串）。
- 不修改 setup.sh / setup.ps1（兩者已正確加引號）。
- 不新增 hook 執行失敗的主動診斷或告警機制（屬另案，本次僅修引號）。
- 不額外撰寫清理舊設定的工具：受影響使用者重跑修正版 setup 後，既有的無引號 command 會被既有 upsert 邏輯偵測為變更並自動覆蓋為有引號版本。

## Success Criteria

- `getHookCommand`、`getStopHookCommand`、`getStartHookCommand` 回傳的字串中，腳本絕對路徑被一對雙引號包住。
- 在含空格的 home 路徑（如 `C:\Users\Gill Chiang`）情境下，產出的 command 字串經 shell word-split 後，`node` 的第一個參數仍是完整的 `.mjs` 絕對路徑，而非在空格處斷裂。
- 受影響使用者重跑修正版 `setup` 後，`~/.claude/settings.json` 中既有的無引號 tracker command 被替換為有引號版本（`applyTrackerHooks` 回報 changed=true）。
- `packages/cli/src/hooks.test.ts` 既有測試全數通過，且新增的引號斷言測試通過。

## Impact

- Affected code:
  - Modified: packages/cli/src/hooks.ts
  - Modified: packages/cli/src/hooks.test.ts
