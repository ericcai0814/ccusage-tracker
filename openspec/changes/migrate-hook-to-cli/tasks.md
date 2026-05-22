<!--
Each task delivers an observable behavior and states how completion is verified.
File paths are locator context, not the task itself.
-->

## 1. CLI 套件基礎設施改造

- [x] 1.1 把 `@ccusage-tracker/cli` build target 從 `bun build --target bun` 改為 `tsc` 輸出 plain Node ESM（含 `#!/usr/bin/env node` shebang），實作「CLI distributed as plain Node ESM via npm」與「CLI 發行模式：plain Node ESM，不再 bun-target」決策 → verify: `pnpm --filter @ccusage-tracker/cli build` 在沒裝 Bun 的 Docker 容器內成功；`node dist/index.js --help` 輸出 help text
- [x] 1.2 在 `packages/cli/package.json` 加上 `"bin": { "tracker": "./dist/index.js" }`、`"engines": { "node": ">=18" }`、`"publishConfig": { "access": "public" }`，並讓 npm pack 產出含 `dist/` 與可執行 shebang 的 tarball → verify: `npm pack --dry-run` 列出 dist/ 檔案；以 `npm install -g ./ccusage-tracker-cli-*.tgz` 安裝後，`which tracker` 與 `tracker --version` 在 macOS 與 Ubuntu 皆成功

## 2. Hook 子命令骨架

- [x] 2.1 [P] 在 `packages/cli/src/index.ts` 註冊 `tracker hook session-end` 與 `tracker hook session-start` 子命令路由（呼應「採用 CLI 子命令而非獨立 Node script」決策），實作「Hook session-end subcommand」與「Hook session-start subcommand」requirement → verify: 新增測試 `commands/hook/router.test.ts`，斷言 `tracker hook --help` 輸出列出兩個子命令，且未知子命令會 exit 1 並印 usage
- [x] 2.2 [P] 實作 `tracker hook session-start`：讀 stdin JSON、取 `session_id` 與 `model`、寫入 `~/.config/ccusage-tracker/sessions/<session_id>`、永遠 exit 0，達成「Session start hook records model」requirement → verify: 新增 `commands/hook/session-start.test.ts`，覆蓋三個 scenarios（成功寫入、missing model、missing session_id），均以實際 fs 寫入到 tmpdir 並驗證檔案內容

## 3. SessionEnd hook 核心邏輯

- [x] 3.1 [P] 在 `packages/cli/src/lib/ccusage.ts` 新增 `runCcusageDaily(date: string): Promise<Totals | null>`，內部用 `child_process.execFile('ccusage', [...], { shell: true })` 處理 Windows `.cmd` 場景，落實「用 `child_process.execFile({ shell: true })` 呼叫 ccusage」決策 → verify: 新增 `lib/ccusage.test.ts`，mock `child_process` 驗證 `shell: true` 一定被傳；ccusage 不存在時回傳 `null` 而非 throw
- [x] 3.2 [P] 在 `packages/cli/src/lib/transcript-metrics.ts` 新增 `extractSessionMetrics(transcriptPath: string)`，產出與舊 bash hook `_post_session_metrics` byte-equal 的欄位集合，落實「Read hook payload」與「Privacy protection」requirement → verify: 新增 `lib/transcript-metrics.test.ts`，以一個固定 transcript.jsonl fixture 跑 bash 版與 Node 版兩次並比對 JSON deep-equal；額外斷言輸出 JSON 不含任何 `text`、`content`、`input.command` 等對話內容欄位
- [x] 3.3 [P] 在 `packages/cli/src/lib/buffer.ts` 新增 `replayBuffer()` 與 `appendToBuffer(payload)`，處理 15 秒重送總時限與 7 天過期淘汰，達成「Buffer retry on next session end」requirement → verify: 新增 `lib/buffer.test.ts`，用 fake timers 涵蓋四個邊界（`_buffered_at` 在範圍內、剛過 7 天、無 `_buffered_at`、總時限超過 15 秒）的行為
- [x] 3.4 組裝 `packages/cli/src/commands/hook/session-end.ts`：依序讀 stdin → 呼叫 `replayBuffer` → 呼叫 `runCcusageDaily` → POST `/api/ingest`（失敗則 `appendToBuffer`）→ 背景 POST `/api/ingest/session` with metrics，永遠 exit 0，達成「Report usage on session end」「Non-blocking execution」requirement 與「Hook 失敗模式：靜默 + buffer，永遠 exit 0」決策 → verify: 新增 `commands/hook/session-end.test.ts`，覆蓋 server 200/500/逾時三條路徑，斷言 process 在收到 stdin 後 1 秒內 exit 0；用 `CCUSAGE_TRACKER_DEBUG` 環境變數驗證 stack trace 行為

## 4. Setup 跨平台與遷移

- [x] 4.1 改寫 `packages/cli/src/hooks.ts` 的 `getHookCommand()` 回傳 `"tracker hook session-end"`（不再含 `bash` 或絕對路徑），並讓 setup 同時 patch `hooks.SessionStart` 條目，達成「Setup command」requirement 的新行為與 platform-independent scenario → verify: 更新 `hooks.test.ts` 斷言 hook command 字串不含 `bash`、不含絕對路徑；新增 `settings.json` patch 後 SessionStart 與 SessionEnd 各含 ccusage-tracker 條目的測試
- [x] 4.2 為 `tracker setup` 新增 `--name`、`--server-url`、`--team-key` 非互動式旗標，並保留互動式為預設，落實「Setup 改為 `tracker setup --server-url <url>` 可選參數版」決策 → verify: 更新 `commands/setup.test.ts` 加入 flag-mode 案例，斷言當所有 flag 都給時不發出任何 prompt；缺一個 flag 時仍 fall back 到 prompt
- [x] 4.3 在 `tracker setup` 加入舊 bash hook 偵測：command 字串以 `bash ` 開頭且含 `ccusage-tracker` 子串者，自動覆寫為 `tracker hook session-end`/`session-start` 並產出 `settings.json.backup-pre-cli-migration`，落實「舊 hook 遷移判準：command 字串前綴比對」決策 → verify: 新增 setup migration 測試，覆蓋 spec 內 example table 的五個 case（包含正向匹配、不匹配的其他工具、不匹配的 node 指令、已是新版的 no-op）

## 5. Uninstall 命令

- [x] 5.1 新增 `packages/cli/src/commands/uninstall.ts`：移除 `~/.claude/settings.json` 內 `command` 等於 `tracker hook session-*` 的條目（保留其他 hook）、`--yes` 跳過確認後遞迴刪除 `~/.config/ccusage-tracker/`，達成「Uninstall command」requirement → verify: 新增 `commands/uninstall.test.ts`，覆蓋三個 scenarios（移除 hook 條目、刪 config 目錄、settings 不存在），所有測試用 tmpdir，斷言其他無關 hook 未被動到

## 6. Server 端 script 路由清理

- [x] 6.1 刪除 `packages/server/src/scripts.ts`、`packages/server/scripts/session-end.sh`、`session-end.test.sh`，並從 `packages/server/src/app.ts` 移除 `/setup.sh`、`/uninstall.sh`、`/scripts/session-end.sh`、`/scripts/session-start.sh` 路由與對應測試，落實 spec 的「Hook delivered as bash script via server endpoint」REMOVED requirement → verify: `pnpm --filter @ccusage-tracker/server build` 與 `pnpm --filter @ccusage-tracker/server test` 通過；`curl -I http://localhost:PORT/setup.sh` 回 404

## 7. 文件與跨平台驗證

- [x] 7.1 重寫 `README.md` 的安裝、更新、卸載、Windows 支援、檔案位置段落，安裝指令改為單一行 `npx @ccusage-tracker/cli@latest setup`；卸載指令改為 `tracker uninstall && npm uninstall -g @ccusage-tracker/cli` → verify: `grep -n 'curl -fsSL.*setup.sh' README.md` 與 `grep -n 'bash \$HOOK_SCRIPT' README.md` 皆無輸出；README 含 Windows 區段
- [ ] 7.2 三平台手動驗證：macOS、Ubuntu 22.04、Windows 11 各跑一次 `npx @ccusage-tracker/cli@latest setup`，並在每台機器上手動觸發 session-end，確認 server 收到的 `/api/ingest` body 在三平台 byte-equal → verify: 在 PR description 附三平台測試結果（含 server log 截圖或 hash 比對），dashboard 顯示三筆對應 member 條目
