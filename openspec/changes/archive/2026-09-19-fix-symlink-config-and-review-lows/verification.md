# 驗證紀錄

驗證日期：2026-09-19（Asia/Taipei）。本變更未發布 npm、未部署 server、未 push。

## 結論

- 安裝交易對 symlink 設定檔寫穿到真實檔案：symlink 保留、`.backup` 落在真實檔案旁；斷鏈與指向目錄仍整筆拒絕，訊息帶出 symlink 目標。dotfiles 使用者（含 Eric 本機）的 setup／update 不再被擋。上一個 change 記為「已知限制（med）」的 symlink 形狀，本次解除。
- F1 到 F7 全部修完。F8（對真實 Codex CLI 的端到端驗證）依提案不在本次範圍，仍待部署後人工執行。
- 完整測試 **CLI 113 pass／0 fail、server 228 pass／1 skip／0 fail**，合計 **341 pass**；基線為 CLI 101、server 226 pass／1 skip，原有測試全部保留（一項調整前提，見下），新增 14 項。
- typecheck、CLI build、server build 全綠；`spectra validate fix-symlink-config-and-review-lows` 通過；`git diff --check` 無 whitespace error。
- Node built CLI 對 loopback server 的 smoke：暫存 HOME 內 `settings.json` 與 `hooks.json` 皆為 symlink 指向 `$HOME/dotfiles` 的真實檔案，setup 成功、兩個 symlink 保留、真實檔案含 tracker hook、backup 在真實檔案旁；update 兩次後兩個真實檔案 sha256 皆不變。
- 未讀寫真實的 `~/.claude`、`~/.codex`、`~/.config/ccusage-tracker`、`~/dotfiles`；全程未執行真實 `npm install -g`。
- **Codex stop-review 閘實際執行但未能產出審查**：閘門回 `status: 1`、`rawOutput: ""`、`touchedFiles: []`。同一時間的最小探測 `codex exec "Reply with exactly: PING_OK"` 回 `ERROR: You've hit your usage limit ... try again at 5:00 PM`，確認是該帳號額度用盡，與本次 diff 無關。因此本變更**沒有經過獨立的 Codex 審查**，不冒稱已審 —— 與前一個 change 屬同一類限制。

## 環境與隔離

- macOS 26.6 arm64；Node 24.15.0、Bun 1.3.13、pnpm 9.15.9、Spectra 3.0.0。
- 單元測試不碰 `homedir()`：`installFiles` 改為 export，路徑完全由測試給定的暫存目錄決定。暫存目錄一律先 `realpathSync` 正規化 —— macOS 的 `/var` 本身是指向 `/private/var` 的 symlink，不正規化會讓「訊息含 symlink 目標」的斷言假性失敗。
- 端到端測試與 smoke 用子程序注入 `HOME`／`CODEX_HOME`，`PATH` 只放 fixture 的 `bin`；smoke 另以 `env -i` 清空環境。
- 測試與 smoke 一律設 `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1`，收集器的安裝行為只以注入的 fake 驗證。
- smoke 後確認真實 `~/.claude/settings.json` 仍是指向 `~/dotfiles/claude/settings.json` 的 symlink，`~/dotfiles/claude/` 無 `.backup`／`.tmp`／`.rollback` 殘留、內容不含 smoke fixture 痕跡。

## 執行結果

| 檢查 | 結果 |
|---|---|
| `pnpm test` | CLI 113 pass／0 fail（基線 101）；server 228 pass／1 skip／0 fail（基線 226／1 skip） |
| `pnpm typecheck` | CLI 與 server 均 Done |
| `pnpm --filter ccusage-tracker build` | Node target 通過；38.72 KB |
| `pnpm build` | Server Bun target 通過；233.48 KB |
| `spectra validate fix-symlink-config-and-review-lows` | `✓ fix-symlink-config-and-review-lows — valid` |
| `spectra analyze fix-symlink-config-and-review-lows --json` | 無 Critical／Warning；2 項「scenario 缺 examples」Suggestion |
| `git diff --check` | 無 whitespace error |

> 注意：server 測試必須用 `pnpm test:server`（cwd = `packages/server`）。從 repo root 直接跑 `bun test packages/server` 會因相對路徑而有 10 個假失敗，不是回歸。

## 規格驗收對照

| design.md 驗收準則 | 證據 |
|---|---|
| `hooks.test.ts`：symlink → 一般檔案（寫穿、symlink 保留、backup 位置）；symlink → 目錄（拒絕）；斷鏈（拒絕）；三者都斷言交易內其他檔案未落地或完整落地 | `packages/cli/src/hooks.test.ts:346`、`:375`、`:398`（describe「installFiles 對 symlink 設定檔寫穿真實檔案」）|
| `setup.test.ts`／`update.test.ts`：settings.json 與 hooks.json 皆為 symlink 的暫存 HOME 下 setup／update 成功且 symlink 保留 | `packages/cli/src/commands/update.test.ts:264`（Node CLI 子程序，真的 `HOME`）、`packages/cli/src/commands/setup.test.ts:299`（見下方「偏離」）|
| `collector.test.ts`：安裝後重探測回 18.0.9 → unsupported_major | `packages/cli/src/collector.test.ts:78` |
| setup／update 在無工具時 installCollector 未被呼叫 | `packages/cli/src/commands/setup.test.ts:261`（`probes === 0`、`installedCollector === []`）、`packages/cli/src/commands/update.test.ts:432`（fixture `ccusage` 會記錄自己被呼叫，log 檔不存在）|
| `codex-hooks.test.ts`：跨行陣列後的 notify 仍被偵測 | `packages/cli/src/codex-hooks.test.ts:205`；另加反向案例 `:212`（table 內的 notify 仍不算數，確認收緊條件沒有反向放寬）|
| `hooks.state` `enabled = false` 對應結果行 | `packages/cli/src/commands/setup.test.ts:198` |
| `setup.test.ts`：404 且 detectCodex 為 false 時輸出不含相容訊息 | `packages/cli/src/commands/setup.test.ts:190` |
| `codex-usage.test.ts` 與 `claude-usage.test.ts`：未來時間戳不節流 | `packages/server/src/codex-usage.test.ts:364`、`packages/server/src/claude-usage.test.ts:201` |
| pnpm test、typecheck、兩個 build 全綠 | 見「執行結果」 |

### 既有測試的一項前提調整

`update.test.ts` 的 `only treats Codex 404/410 as compatibility and preserves its prior script` 原本在**沒有** `$CODEX_HOME` 的 fixture 下斷言會印出 Codex 相容訊息。F5 之後這正是規格要求「不印」的情況，因此為該測試補上 `mkdirSync(join(home, "codex"))`，讓它回到原本的題目（哪些狀態碼算相容降級）。斷言強度未降低；相反的情況（404 且未偵測到 Codex）由 `setup.test.ts:190` 新測試涵蓋。

### 反證測試不是空的

symlink 這組斷言若寫錯方向會天生假通過（例如只斷言「不拋錯」）。因此另做一次 mutation 驗證：`git stash push packages/cli/src/hooks.ts` 把 `installFiles` 還原成修改前的版本後，`update.test.ts` 的 symlink 端到端案例轉紅（`1 fail`），還原後恢復綠燈。節流那兩個案例在實作前已先跑過紅燈（Codex 與 Claude 各 `1 fail`），實作後轉綠。

### 偏離：setup 的 symlink 案不在子程序內

`setup.test.ts` 無法用子程序跑：bun 在 process 啟動時就快取 `os.homedir()`，該檔全部是 in-process 注入測試。因此 setup 的 symlink 案改為把注入的 `installHook` 換成**真實的** `applyTrackerHooks` + `applyCodexHooks` + `installFiles`，只把 `homedir()` 推導的兩個路徑換成暫存目錄下的 symlink。它驗的是「setup 流程在 symlink 設定檔下走得完、symlink 保留、真實檔案含 tracker hook」；完整的子程序端到端（真的 `HOME`）在 `update.test.ts:264` 與下方 smoke。

## Node built CLI loopback smoke

腳本置於 job 暫存區（非 repo）：`$CLAUDE_JOB_DIR/tmp/smoke-symlink.sh`，完整輸出 `$CLAUDE_JOB_DIR/tmp/smoke-output.txt`。以 `env -i` 清空環境，暫存 `WORK/home` 作 HOME、`$HOME/codex` 作 CODEX_HOME，`$HOME/dotfiles/{claude,codex}/` 放真實設定檔，HOME 內兩個路徑都是 symlink。loopback Node HTTP server 下發 fixture 腳本。

```
loopback server on 127.0.0.1:61089
=== setup ===
Config saved.
Claude Code: hooks installed/updated (SessionStart, SessionEnd, Stop)
Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.
Changed files backed up (.backup).
Collector: ccusage 20.0.20 (Claude and Codex ready)
Server is reachable.
Setup complete!                                              setup exit=0
symlink  …/home/.claude/settings.json -> …/home/dotfiles/claude/settings.json
symlink  …/home/codex/hooks.json     -> …/home/dotfiles/codex/hooks.json
backup 在真實檔案旁: dotfiles/claude: settings.json settings.json.backup
                     dotfiles/codex:  hooks.json   hooks.json.backup
symlink 旁沒有 .backup: .claude: . .. settings.json    codex: . .. hooks.json

=== update #1 ===                                            update1 exit=0
settings sha: 3427508664bf7c3b3c5ca6c47bf67e991c242813fd2b9d7b7589bd022fec27df
hooks sha:    30457eba3cdc587ca8da69d42a4a18dba5813b799ba8cc36892baf1fdeca4c42

=== update #2 ===                                            update2 exit=0
settings sha: 3427508664bf7c3b3c5ca6c47bf67e991c242813fd2b9d7b7589bd022fec27df
hooks sha:    30457eba3cdc587ca8da69d42a4a18dba5813b799ba8cc36892baf1fdeca4c42

=== assertions ===
OK  settings.json 第二次 update 後 sha256 不變
OK  hooks.json 第二次 update 後 sha256 不變
OK  settings.json 仍是 symlink
OK  hooks.json 仍是 symlink
OK  真實 settings.json 含 tracker hook
OK  真實 hooks.json 含 tracker hook
OK  第三方 Codex 群組保留
OK  使用者既有設定保留
OK  backup 在真實檔案旁
OK  symlink 那側沒有 .backup
OK  無 .tmp/.rollback 殘留
```

update #2 仍印信任提示是正確的：該 fixture 的 `config.toml` 不存在，沒有信任紀錄。「未變更且已有紀錄」才顯示 `trust recorded`，該分支由 `update.test.ts` 既有整合測試涵蓋。

## 文件

- `README.md`：collector 步驟補「只在偵測到工具時執行」與「這是一次全域 npm 安裝，會下載並執行該套件的安裝期（lifecycle）腳本，`CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1` 可跳過」；安裝表後補一段 symlink 寫穿說明；Codex 章節同步補安裝期腳本說明。
- `packages/cli/README.md`：collector 段落同上（含安裝後重驗主版本的說明）；hook script 段落補 symlink 寫穿與拒絕條件。
- `CHANGELOG.md`：`[Unreleased] > Fixed` 新增 7 條（symlink 寫穿、F1 到 F6）。

## 範圍外

- **F8**：整份 `hooks.json` 重新序列化為 2 空格後，第三方 hook 的信任是否在真實 Codex CLI 中存活，仍未驗證。需要一台有第三方 Codex hook 的機器、在部署後跑一次 `update` 並在 Codex 內確認。本次維持提案的決定，不處理。
- Windows／Linux 未實機驗證，沿用既有限制；`realpathSync` 對 Windows junction 的行為未實測。
