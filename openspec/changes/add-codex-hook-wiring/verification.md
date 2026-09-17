# 驗證紀錄

驗證日期：2026-09-17（Asia/Taipei）。本功能未發布、未部署。

## 結論

- `setup`／`update` 對 Claude 與 Codex 提供同一套流程：偵測、腳本、hook、collector；Codex 只多一個平台強制的「在 Codex 內跑一次 `/hooks` 信任」。`sync codex` 降為手動補送／除錯入口。
- 完整測試 **CLI 101 pass／0 fail、server 226 pass／1 skip／0 fail**，合計 **327 pass**；基線為 CLI 46、server 215（214 pass + 1 skip），原有測試全部保留，新增 66 項。
- typecheck、CLI build、server build 全綠；`spectra validate add-codex-hook-wiring` 通過；`git diff --check` 無 whitespace error。
- Node built CLI 對 loopback Node HTTP server 的 smoke：暫存 HOME／CODEX_HOME（路徑含空白），setup 後 `settings.json` 與 `hooks.json` 都含 tracker hook，update 兩次後三個檔案 sha256 不變、`config.toml` 位元組不變。
- **已知限制（med）**：`$CODEX_HOME/hooks.json` 若是 symlink（例如以 dotfiles 管理），既有的 `installFiles` 非一般檔案防護會拒絕寫入，整筆交易不執行並回傳非零。失敗可見且不破壞任何檔案，但該機器需先把 symlink 換成一般檔案。詳見下方「symlink 形狀」。
- **Codex stop-review 閘未能執行**：該帳號的 Codex 額度已用盡（`ERROR: You've hit your usage limit ... try again at Sep 19th, 2026 5:00 PM`），連 `codex exec "Reply with exactly: PING_OK"` 都回同一個錯。因此本次變更**沒有經過獨立的 Codex 審查**，不冒稱已審。與前一個 change 的「跨模型 review 受額度限制」屬同一類限制。
- 未發布 npm、未部署 server、未 push。Windows／Linux 未實機驗證，沿用前一個 change 的限制。

## 環境與隔離

- macOS 26.6 arm64；Node 24.15.0、Bun 1.3.13、pnpm 9.15.9、Spectra 3.0.0。
- 所有實際 CLI／reporter 執行都使用暫存 HOME 與 CODEX_HOME，smoke 的路徑刻意含空白。整合測試的 `PATH` 只放 fixture 的 `bin`：本機 `~/.local/bin` 實際存在真的 `claude` 與 `codex`，沿用開發者 PATH 會讓偵測測到假的綠燈。
- 測試與 smoke 一律設 `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1`，`installCollector` 另以注入的 fake 驗證，全程未執行真實 `npm install -g`。
- 未讀寫真實的 `~/.claude`、`~/.codex`、`~/.config/ccusage-tracker`。確認 `~/.codex/hooks.json` 的 mtime 仍為原值（symlink，指向 dotfiles）。
- Team key 全為合成字串；未使用模型 API key，未上傳任何對話內容。

## 執行結果

| 檢查 | 結果 |
|---|---|
| `pnpm test` | CLI 101 pass／0 fail（基線 46）；server 226 pass／1 skip／0 fail（基線 214／1 skip） |
| `pnpm typecheck` | CLI 與 server 均 Done |
| `pnpm --filter ccusage-tracker build` | Node target 通過；37.71 KB |
| `pnpm build` | Server Bun target 通過；232.67 KB |
| `spectra validate add-codex-hook-wiring` | `✓ add-codex-hook-wiring — valid` |
| `spectra analyze add-codex-hook-wiring --json` | 無 Critical／Warning；6 項「scenario 缺 examples」Suggestion |
| `git diff --check` | 無 whitespace error |

## 規格驗收對照

| design.md 驗收準則 | 證據 |
|---|---|
| `codex-hooks.test.ts`：空檔 append 無 matcher 群組、三個第三方在前 tracker 落索引 3、重跑 anyChanged false、索引 1 就地替換、非物件拋錯、三種 TOML 片段 | `packages/cli/src/codex-hooks.test.ts`（21 tests） |
| `collector.test.ts`：探測失敗→安裝並印指令、20.0.20→ok、18.0.9→unsupported_major、env→skipped、安裝失敗→install_failed | `packages/cli/src/collector.test.ts`（8 tests） |
| `setup.test.ts`：逐工具接線、404、notify 提示、兩工具皆未偵測 exit 0、collector 三種結果、輸出順序 | `packages/cli/src/commands/setup.test.ts`（16 tests） |
| `update.test.ts`：hooks.json 第三方保留／tracker append、兩次 update 位元組不變、404 不寫 hooks.json、兩工具皆未偵測 exit 非零、hooks.json 非法不寫任何檔、notify 提示、trust recorded 分支、說明文字 | `packages/cli/src/commands/update.test.ts`（21 tests） |
| `status.test.ts`：trusted_hash→trust recorded、缺→awaiting、enabled=false→disabled、未安裝→not installed | `packages/cli/src/commands/status.test.ts`（10 tests） |
| `codex-usage.test.ts`：`--hook` Stop／SessionEnd spawn worker、其他事件不 spawn、非 JSON／空／>64KB exit 0 不寫錯誤檔、payload 不外流、5 分鐘 throttle、手動 sync 不受限 | `packages/server/src/codex-usage.test.ts`（新增 12 cases） |

### 反證測試不是空的

「不啟動 worker」這類斷言天生容易假通過：detached worker 要先把 node 開起來，立刻斷言等於必過。因此負向案例一律先 settle 700ms 再斷言，並實際做過一次 mutation 驗證 —— 暫時拿掉 `throttled()` 與事件過濾後，**7 個負向測試同時轉紅**（其他事件、非 JSON、空輸入、缺欄位、超過 64 KB、hook throttle、notify throttle），確認這些斷言真的咬得住。修改已還原。

## Node built CLI loopback smoke

指令（腳本置於 job 暫存區，非 repo）：以暫存 `WORK/home with spaces` 作 HOME、`$HOME/.codex` 作 CODEX_HOME，loopback Node HTTP server 直接下發 repo 內真實的 `session-end.mjs`／`session-start.mjs`／`codex-sync.mjs`。

```
### 1) setup
Config saved.
Claude Code: hooks installed/updated (SessionStart, SessionEnd, Stop)
Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.
Changed files backed up (.backup).
Collector: ccusage 20.0.20 (Claude and Codex ready)
Server is reachable.
Setup complete!                                    setup exit=0

### 2) 兩邊都接上
settings.json tracker hook 數: 3
Stop: groups=2 tracker=1 keys=["hooks"] entry={"type":"command","command":"node \"…/codex-sync.mjs\" --hook","timeout":45}
SessionEnd: groups=1 tracker=1 keys=["hooks"] entry={"type":"command","command":"node \"…/codex-sync.mjs\" --hook","timeout":45}
Stop[0] 第三方群組: {"hooks":[{"type":"command","command":"echo third-party","timeout":3}]}
hooks.json.backup 等於安裝前內容: YES

### 3) update 兩次，比對 sha256
update#1 exit=0   update#2 exit=0
config.json   : 034b4114d7046bc71aef4b30095e7ae5ea72d1309fa833aee52bffdad30ac413  UNCHANGED
settings.json : 618bad33846aad3a0adf121225d71eca9160cde3b4d567f6bd0452769ea6318e  UNCHANGED
hooks.json    : ea35b54bd39a19510d62a22881f9ab2a3d27e7bd2db5b9e824e95ed9df8b4c0c  UNCHANGED
config.toml   : dc20d8bade34889fe82fd3d01b86617a1120894cc9564f0ab7f56d723d9035f8  UNCHANGED

### 4) update#2 輸出
Claude Code: hooks already up to date
Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.
Collector: ccusage 20.0.20 (Claude and Codex ready)
Update complete. Tracker scripts and hooks updated.

### 5) status
Codex script: installed
Codex hooks: installed, awaiting trust (open /hooks in Codex)
Codex collector: installed (ccusage 20.0.20)

### 6) 說明文字
  sync codex  Report Codex usage now (manual fallback / debugging)
```

第 4 節仍顯示信任提示是正確的：該環境的 `config.toml` 沒有信任紀錄。「未變更且已有紀錄」才顯示 `Codex: hooks already up to date (trust recorded)`，該分支由 `update.test.ts` 的整合測試涵蓋。

### symlink 形狀（已知限制）

以同一組 smoke 重現「`hooks.json` 是指向 dotfiles 的 symlink」：

```
Config saved.
Could not install tracker scripts. Refusing to replace non-regular file: …/.codex/hooks.json Run `tracker update` after resolving the problem.
symlink 仍是 symlink: YES
dotfiles 目標未被改寫: YES
Claude settings.json 已建立: NO
```

防護來自既有的 `installFiles`（不透過 symlink 寫入，避免被導去改寫非預期的檔案），行為正確且失敗可見、整筆交易不落地。但 Eric 本機的 `~/.codex/hooks.json` 正是這個形狀，採用前需先處理。本次未更動該防護：那是安全姿態的改變，超出本 change 範圍。

## 文件

- `README.md`、`packages/cli/README.md`、`CHANGELOG.md` 的 Codex 段落改為「setup 或 update 後在 Codex 內執行一次 `/hooks` 信任」，notify 標為 deprecated，`sync codex` 標為手動補送／除錯，並說明 collector 自動安裝與 `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL`。
- `grep -rn "manual opt-in|opt-in|Run \`tracker sync codex\`"` 對三份文件**無命中**。
