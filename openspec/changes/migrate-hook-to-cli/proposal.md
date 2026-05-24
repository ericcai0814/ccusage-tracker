## Why

Windows 成員無法走目前的 `curl -fsSL .../setup.sh | bash` 安裝流程（Windows 無原生 bash），且即使透過 Git Bash 安裝後，hook script 對 `bash` + `jq` 的依賴會在 runtime 持續造成靜默失敗。團隊內已有非技術角色（PM）需要近乎零步驟的安裝體驗，現行架構無法支撐。

此外，目前 hook 邏輯以 server-generated bash script 形式配送（`scripts.ts:218` 產出 `/scripts/session-end.sh`），每次更新需要每位成員手動 `curl -o` 覆寫，沒有版本可見性、無法 pin 版本、server 一旦被攻陷可即時推送任意程式碼到所有成員機器，信任模型偏弱。

## What Changes

- **BREAKING**：Hook 執行載體從「下載到 `~/.config/ccusage-tracker/session-end.sh` 的 bash script」改為「`@ericcai/ccusage-tracker-cli` 的子命令 `tracker hook session-end` / `tracker hook session-start`」
- **BREAKING**：成員安裝指令從 `curl -fsSL .../setup.sh | bash` 改為 `npx @ericcai/ccusage-tracker-cli@latest setup`；卸載指令對應改為 `tracker uninstall` 或 `npm uninstall -g @ericcai/ccusage-tracker-cli`
- 新增 `tracker hook session-end` 與 `tracker hook session-start` 子命令，吸收原 bash script 的所有邏輯（讀 stdin payload、讀 config、呼叫 ccusage、buffer 重送與 7 天過期清理、transcript metrics 萃取、背景 POST）
- 新增 `tracker uninstall` 子命令，取代 server 端的 `uninstall.sh`
- `tracker setup` 加入舊版偵測：若 `~/.claude/settings.json` 內已存在 `bash <path>/session-end.sh` 字樣的 hook，自動覆寫為新指令並備份
- `packages/cli` build target 從 Bun-only 改為 plain Node（ESM）發行至 npm，使 `npx` 在 Windows 原生可用
- 移除對 `jq` 的依賴（改用 Node 內建 `JSON.parse`/`JSON.stringify`），消除 Windows 上的手動安裝步驟
- 跨平台路徑與 subprocess 處理：使用 `node:path`、`node:os.homedir()`、`execFile({ shell: true })` 以正確 resolve Windows 上的 `ccusage.cmd`
- 刪除 server 端 `/setup.sh`、`/uninstall.sh`、`/scripts/session-end.sh`、`/scripts/session-start.sh` 等 endpoints 以及 `packages/server/src/scripts.ts` 的 script generator
- 刪除 `packages/server/scripts/session-end.sh` 與 `session-end.test.sh`
- README 重寫安裝、更新、卸載段落，新增 Windows 支援說明

## Capabilities

### New Capabilities

（無 — 所有變更皆為現有 capability 的修改）

### Modified Capabilities

- `session-hook`：執行載體從 bash script 變為 Node CLI 子命令；移除 `bash` 與 `jq` 依賴；非阻塞執行從「背景 curl」改為「Node `fetch` + `unref()` 不阻塞 process exit」
- `cli-tool`：新增 `hook session-end`、`hook session-start`、`uninstall` 子命令；`setup` 命令的 hook 安裝行為改為寫入 `tracker hook session-end`；setup 須支援 Windows 路徑與 settings.json 位置；setup 須能偵測並遷移舊版 bash hook

## Impact

- **Affected specs**：`session-hook`（delta）、`cli-tool`（delta）
- **Affected code**：
  - 新增：`packages/cli/src/commands/hook/session-end.ts`、`packages/cli/src/commands/hook/session-start.ts`、`packages/cli/src/commands/uninstall.ts`、`packages/cli/src/lib/transcript-metrics.ts`、`packages/cli/src/lib/buffer.ts`、`packages/cli/src/lib/ccusage.ts`
  - 修改：`packages/cli/src/index.ts`（註冊新子命令）、`packages/cli/src/hooks.ts`（`getHookCommand` 改用 `tracker hook session-end`，新增舊版偵測）、`packages/cli/src/commands/setup.ts`（跨平台路徑、舊版遷移、移除 `chmod` 對 Windows 無意義的步驟、改抓 Node bin 路徑）、`packages/cli/package.json`（build target Node ESM、加 `bin` 與 `publishConfig`）、`packages/cli/tsconfig.json`（target ES2022、module Node16）
  - 刪除：`packages/server/scripts/session-end.sh`、`packages/server/scripts/session-end.test.sh`、`packages/server/src/scripts.ts`（整檔）
  - 修改：`packages/server/src/app.ts`（移除 `/setup.sh`、`/uninstall.sh`、`/scripts/*` 路由與對應測試）、`packages/server/src/index.ts`（如有 scripts 引用）
  - 修改：`README.md`（安裝、更新、卸載、Windows 支援、檔案位置）
- **Affected dependencies**：
  - 移除 runtime 依賴：`jq`、`bash`
  - 新增 npm 配送：`@ericcai/ccusage-tracker-cli` 需發行至 npm（公開或私有 registry）
  - 保留：`ccusage`、Node 18+
- **Affected users**：所有現有成員（mac/Linux）需重新跑 setup 完成遷移；Windows 成員首次可安裝
