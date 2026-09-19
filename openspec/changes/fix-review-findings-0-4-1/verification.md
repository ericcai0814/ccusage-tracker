# 驗證紀錄

驗證日期：2026-09-19（Asia/Taipei）。本變更未發布 npm、未部署 server、未 push、未改版本號。

## 結論

- Codex 補審的 2 med、4 low 與 subagent 審查對應的 low 全部修完，加上逐 hook 信任訊息與中文 README 平台限制。0.4.0 已驗證的正常路徑沒有退步：既有 113 個 CLI 測試全部保留且通過。
- 完整測試 **CLI 142 pass／0 fail、server 228 pass／1 skip／0 fail**，合計 **370 pass**；基線為 CLI 113、server 228 pass／1 skip，新增 29 項 CLI 測試。
- `pnpm typecheck`、`pnpm --filter ccusage-tracker build`、`pnpm build` 全綠；`spectra validate fix-review-findings-0-4-1` 通過；`git diff --check` 無 whitespace error。
- Node-built CLI smoke：暫存 HOME、兩份設定檔皆為 symlink、hooks.json 含引用 tracker 腳本路徑的第三方 `sha256sum` Stop 群組 —— setup 後該群組位元組不變留在索引 0、tracker 在索引 1、輸出含兩行 `Wrote through symlink`、symlink 保留；兩次 update 後 `hooks.json` 與 `settings.json` 的 sha256 皆不變；混合信任的 setup／update 與 status 訊息逐字符合規格；`config.toml` 位元組不變。
- 未讀寫真實的 `~/.claude`、`~/.codex`、`~/.config/ccusage-tracker`、`~/dotfiles`；全程未執行真實 `npm install -g`。
- 跨檔 rollback 案例在現行 `installFiles` 上直接通過，不是空斷言：以 mutation（把 rollback 迴圈的 `if (!entry.installed) continue` 反轉成永不還原）確認該測試會轉紅（輸出變成 `restore failed for …`）。

## 環境與隔離

- macOS 26.6 arm64；Node 24.15.0、Bun 1.3.13、pnpm 9.15.9、Spectra 3.0.0。
- 單元測試不碰 `homedir()`（bun 在 process 啟動時就快取 `$HOME`）：交易層測 export 出來的 `installFiles`，路徑完全由測試給定的暫存目錄決定，暫存目錄一律先 `realpathSync` 正規化。
- 端到端測試與 smoke 用子程序注入 `HOME`／`CODEX_HOME`，`PATH` 只放 fixture 的 `bin`（含指向真實 node 的 symlink 與假的 `ccusage`）。
- 測試與 smoke 一律設 `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1`。
- FIFO 案例用 `mkfifo` 建在暫存目錄、沒有 writer；CLI 入口那一版用 `spawn` 的 `timeout: 2000` + `SIGKILL` 當硬上限，斷言 `code === 1`（自行結束）而非 `null`（被殺），測試本身不會跟著阻塞。
- smoke 全程在 `mktemp -d` 的暫存 HOME 內；事後確認真實 `~/.claude/settings.json` 仍是指向 `~/dotfiles/claude/settings.json` 的 symlink。`~/dotfiles/claude/settings.json.backup` 的 mtime 為 09-19 14:39，屬 0.4.0 當日實機驗證的產物，與本次無關。

## 執行結果

| 檢查 | 結果 |
|---|---|
| `pnpm test` | CLI 142 pass／0 fail（基線 113）；server 228 pass／1 skip／0 fail（基線相同） |
| `pnpm typecheck` | CLI 與 server 均 Done |
| `pnpm --filter ccusage-tracker build` | Node target 通過；43.77 KB |
| `pnpm build` | Server Bun target 通過；233.48 KB |
| `spectra validate fix-review-findings-0-4-1` | `✓ fix-review-findings-0-4-1 — valid` |
| `spectra analyze fix-review-findings-0-4-1 --json` | 無 Critical／Warning；2 項「scenario 缺 examples」Suggestion（沿自提案時） |
| `git diff --check` | 無 whitespace error |

## design.md 驗收準則對照

| 驗收準則 | 證據 |
|---|---|
| 第三方命令含腳本路徑不被辨識為 tracker（`sha256sum` 與含 `&&` 兩案） | `packages/cli/src/hooks.test.ts:495`（4 種形狀：`sha256sum`、`&&`、管線、`bash -c`）；`packages/cli/src/codex-hooks.test.ts:161`（群組位元組不變、tracker append 尾端） |
| 標準命令的帶引號／不帶引號／`--mode=stop` 三種形狀仍被辨識 | `packages/cli/src/hooks.test.ts:508`（另含帶引號 node 絕對路徑、Windows `C:/` 路徑）；`packages/cli/src/codex-hooks.test.ts:178`（另含 `--notify`） |
| FIFO symlink 在讀取前被拒且測試在 2 秒內完成 | `packages/cli/src/hooks.test.ts:443`（交易層）；`packages/cli/src/commands/update.test.ts:365`（CLI 入口，FIFO／目錄／socket 三案，`spawn` timeout 2000 + 斷言 `Date.now() - started < 2000`） |
| 斷鏈時 readlink 失敗退回不帶目標訊息 | `packages/cli/src/commands/update.test.ts:400`（preload 讓 `fs.readlinkSync` 對該 link 拋錯，斷言訊息不含 `symlink target:`） |
| 寫穿成功回傳 writtenThrough | `packages/cli/src/hooks.test.ts:366` 斷言 `installed.writtenThrough` 等於 `[{ link, real }]` |
| 解析失敗時目錄內無 `.tmp` | `packages/cli/src/hooks.test.ts:403`（更強：腳本目錄根本沒被建出來）、`:420`（既有內容與既有 `.backup` 位元組不變） |
| 混合群組的索引與信任查詢 | `packages/cli/src/codex-hooks.test.ts:234`（`findCodexTrackerIndexes` 回 `{group:2,hook:1}`；隔壁 `:stop:2:0` 的 `trusted_hash` 不算數） |
| TOML 四案（`[[x]]`、行尾註解、`[3, 4]` 續行、字串內 `[`） | `packages/cli/src/codex-hooks.test.ts:320` 的 fixture 表，每案各有「notify 在頂層 → true」「notify 在 table 內 → false」兩個斷言，共 8 個測試 |
| formatCodexTrustLine 四種組合 | `packages/cli/src/codex-hooks.test.ts:264`（status 四種）、`:273`（setup／update 四種）、`:284`（disabled 兩種輸出都不出現 `/hooks`） |
| 404＋Codex 偵測到＋tracker notify → 無移除提示 | `packages/cli/src/commands/setup.test.ts:242`；`packages/cli/src/commands/update.test.ts:587`（CLI 入口，TOML 位元組不變、不寫 hooks.json） |
| 混合信任 → 逐 hook 訊息 | `packages/cli/src/commands/setup.test.ts:216`；`packages/cli/src/commands/update.test.ts:619`（update 與 status 兩行都斷言） |
| 跨檔 rollback 案例 | `packages/cli/src/commands/update.test.ts:271` |
| 輸出含 `Wrote through symlink` | `packages/cli/src/commands/update.test.ts:346`（首次含兩行）、`:357`（第二次不含）；`packages/cli/src/commands/setup.test.ts:370` |
| status 逐 hook 訊息與混合群組索引 | `packages/cli/src/commands/status.test.ts:84`、`:91`、`:99` |
| 中文 README 補平台限制 | `README.md:78`（`grep -n "尚未實機驗證" README.md` 命中） |

## Implementation Contract 行為對照

| 契約行為 | 證據 |
|---|---|
| 含 `sha256sum "<script>"` 的第三方 Stop 群組：位元組不變留原索引，tracker append 尾端 | smoke：第三方群組 sha256 安裝前後相同，Stop 群組數 2、索引 1 為 tracker |
| hooks.json 為指向 FIFO 的 symlink：2 秒內 exit 1、非一般檔案訊息含目標、不寫檔 | `update.test.ts:365`；`code === 1` 而非 SIGKILL 的 `null` |
| 混合群組：status 查 `:stop:<g>:1` | `status.test.ts:99` |
| server 404＋Codex 偵測到＋tracker notify：含相容訊息、不含移除提示 | `update.test.ts:587`、`setup.test.ts:242` |
| config.toml 三種形狀下 notify 在頂層皆印提示、在 table 內皆不印 | `codex-hooks.test.ts:320` fixture 表 |
| symlink 寫穿成功輸出 `Wrote through symlink: <link> -> <real>` | smoke setup 輸出兩行；`update.test.ts:346` |
| Stop 已信任、SessionEnd 未信任的兩句訊息 | smoke 實跑：`Codex: hooks installed (Stop trusted, SessionEnd awaiting trust). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook.` 與 `Codex hooks: installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)` |

## Smoke 摘要

暫存 HOME、`~/.claude/settings.json` 與 `$CODEX_HOME/hooks.json` 皆為指向 `$HOME/dotfiles` 的 symlink、hooks.json 內含第三方 `sha256sum "<home>/.config/ccusage-tracker/codex-sync.mjs"` 的 Stop 群組。以下為實跑輸出（暫存路徑縮寫為 `~`）：

```
=== setup ===
Claude Code: hooks installed/updated (SessionStart, SessionEnd, Stop)
Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.
Wrote through symlink: ~/.claude/settings.json -> <realpath>/dotfiles/settings.json
Wrote through symlink: ~/codex/hooks.json -> <realpath>/dotfiles/hooks.json
Changed files backed up (.backup).
Collector: ccusage 20.0.20 (Claude and Codex ready)
Setup complete!              (exit 0)

Stop 群組數: 2
索引 0 (第三方): {"hooks":[{"type":"command","command":"sha256sum \"~/.config/ccusage-tracker/codex-sync.mjs\"","timeout":9}],"note":"third-party audit"}
索引 1 (尾端):   {"hooks":[{"type":"command","command":"node \"~/.config/ccusage-tracker/codex-sync.mjs\" --hook","timeout":45}]}
SessionEnd:      [{"hooks":[{"type":"command","command":"node \"~/.config/ccusage-tracker/codex-sync.mjs\" --hook","timeout":45}]}]
第三方群組 sha256 安裝前 == 安裝後            => OK
輸出含 Wrote through symlink                  => OK
兩個 symlink 保留                             => OK

=== update x2 ===
hooks.json sha256:    d39736fd… / d39736fd… / d39736fd…   => 不變 OK
settings.json sha256: 2c42966e… / 2c42966e… / 2c42966e…   => 不變 OK
無 .tmp／.rollback 殘留                       => OK

=== 只信任 Stop（hooks.state 寫 <hooks.json>:stop:1:0）===
Codex: hooks installed (Stop trusted, SessionEnd awaiting trust). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook.
Codex hooks: installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)
config.toml 位元組不變                        => OK
```

重點：

- setup exit 0；第三方群組 sha256 安裝前後相同；Stop 索引 1 與 SessionEnd 索引 0 為 canonical tracker 群組（`node "<path>/codex-sync.mjs" --hook`、timeout 45、只有 `hooks` 鍵）。
- 輸出含 `Wrote through symlink` 兩行（settings.json 與 hooks.json 各一）；兩個 symlink 都保留。
- update 兩次後 `hooks.json`／`settings.json` 的 sha256 與 setup 後完全相同；HOME 內無 `.tmp`／`.rollback` 殘留。
- 寫入只信任 Stop 的 `hooks.state` 後，update 與 status 的兩行訊息逐字符合規格；`config.toml` 位元組不變。

## 已知限制與範圍外

- **Windows／Linux 未實機驗證**：路徑受支援（`isAbsolutePathToken` 認 `C:/`、UNC，辨識測試含 Windows 形狀），但只在 macOS 實跑。FIFO／socket 案例以 `it.skipIf(process.platform === "win32")` 跳過。中文與英文 README 都已寫明。
- **`config.toml` 與 status 讀檔未套型態檢查**：本次的 `assertRegularFileTarget` 依規格只涵蓋安裝交易的目標（`settings.json`、`hooks.json`、tracker 腳本）。`defaultWiringDeps.readCodexConfig`（`packages/cli/src/hooks.ts:296`）與 `status.ts:138` 的 `readTextFile` 仍直接 `readFileSync`，若 `config.toml` 是指向無 writer FIFO 的 symlink 會卡住。兩處都只讀不寫、不在本 change 範圍，記錄於此不順手修。
- **辨識收緊的取捨**：手動改過 tracker hook 命令（加自訂參數、包成複合命令）會被視為第三方而多出一份 tracker hook。已在兩份 README 寫明；重複觸發由 5 分鐘節流與獨立鎖吸收。
- 版本號提升、CHANGELOG 的 `[Unreleased]` 定版、npm 發布與 Zeabur 部署都不在本 change，另開 release PR。
