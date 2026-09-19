# 驗證紀錄

驗證日期：2026-09-19（Asia/Taipei）。本變更未發布 npm、未部署 server、未 push、未改版本號。

## 結論

- Codex 補審的 2 med、4 low 與 subagent 審查對應的 low 全部修完，加上逐 hook 信任訊息與中文 README 平台限制。複審 round 2 的 2 med、3 low 與自審發現的 1 個新洞也已修完；審查閘 round 3 指出該修正的護欄仍不足，已把路徑重組整個移除；複審 round 4 再以實際執行的反例指出 shell 重新解讀字元的繞過；round 5 指出嚴格化破壞了特殊字元家目錄的安裝冪等性，辨識因此拆成「精確比對 canonical」與「形狀比對」兩層。全部已修完（見末三節）。0.4.0 已驗證的正常路徑沒有退步：既有 113 個 CLI 測試全部保留且通過。
- 完整測試 **CLI 170 pass／0 fail、server 228 pass／1 skip／0 fail**，合計 **398 pass**；基線為 CLI 113、server 228 pass／1 skip，新增 57 項 CLI 測試（round 1 新增 29、複審 round 2 再 14、審查閘 round 3 再 1 並改寫 2、複審 round 4 再 3 並改寫 1、round 5 再 10）。
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
| `pnpm test` | CLI 170 pass／0 fail（基線 113）；server 228 pass／1 skip／0 fail（基線相同） |
| `pnpm typecheck` | CLI 與 server 均 Done |
| `pnpm --filter ccusage-tracker build` | Node target 通過；46.78 KB |
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

## Codex 複審 round 2 的補修

複審結論 NEEDS-FIX（2 med、3 low）。全部修完並補測；另在自審時發現修正本身引入的一個新洞，一併修掉。

| 複審 finding | 修法 | 證據 |
|---|---|---|
| [med] `--mode=stop&&false` 等無空白複合命令仍被誤收 | 引號外偵測 shell 語法（`& \| ; < > ` $ ( ) '` 與換行）一律第三方；未閉合引號也算 | `packages/cli/src/codex-hooks.ts:71` `containsShellSyntax`；測試 `hooks.test.ts:543`（9 種形狀）、`codex-hooks.test.ts:178` |
| [med] 辨識收緊造成舊 Claude hook 無法升級，新舊兩條並存 | 受限的遷移規則：可選直譯器（node／bash／sh／powershell／pwsh，副檔名須相符；PowerShell 另剝 `-NoProfile` 等開關至 `-File`），其餘整段重組為腳本路徑 | `packages/cli/src/codex-hooks.ts:88` `INTERPRETERS`、`:152` `isTrackerHookCommand`；測試 `hooks.test.ts:573`（升級後只剩一條）、`:582`（副檔名不符仍第三方） |
| [low] TOML `"""` 內的 `\"""` 提前結束字串 | scanLine 對 `"` 與 `"""` 都先判反斜線跳脫再判結束符；literal 字串維持不跳脫 | `packages/cli/src/codex-hooks.ts:325`；fixture `codex-hooks.test.ts:365`（三引號跳脫）、`:367`（literal 不吃跳脫），各有正反案例 |
| [low] 部分更新把未變動 hook 的 recorded 一併降成 awaiting | 依 `codexStopChanged`／`codexSessionEndChanged` 分別作廢 | `packages/cli/src/hooks.ts:333` `stale`；測試 `setup.test.ts:236`（只補裝 SessionEnd）、`:250`（Stop 有變動不冒稱已信任） |
| [low] formatter 少了「皆 recorded」的安裝端分支與逐字斷言 | 補 `Codex: hooks already up to date (trust recorded)` 分支，四組逐字斷言補齊，「皆 disabled」另立一案 | `packages/cli/src/codex-hooks.ts:288` 附近的 `CODEX_RECORDED_MESSAGE`；測試 `codex-hooks.test.ts:301`、`:313` |
| 自審發現：重組未加引號路徑會誤收「tracker 路徑當參數」 | 當時以 `isSinglePath` 擋，**護欄不足，已於 round 3 改為完全不重組**（見下一節） | 見「審查閘 round 3」 |

### 遷移規則的史料依據

舊版命令形狀取自 git，不憑印象（`git show <commit>:packages/server/src/scripts.ts`）：

| commit | 實際寫出的命令 |
|---|---|
| `db7435a` | `HOOK_CMD="bash $HOOK_SCRIPT"`，`HOOK_SCRIPT="$CONFIG_DIR/session-end.sh"` |
| `f04098e` | `HOOK_CMD="node $HOOK_SCRIPT"`（未加引號），`.mjs` |
| `d758e52` | `node $HOOK_SCRIPT --mode=session-end`／`--mode=stop`（未加引號） |
| `95869d9`→今 | `node "<path>" --mode=…`（加引號） |

`$CONFIG_DIR` 為 `$HOME/.config/ccusage-tracker`，家目錄含空白時這些變數不帶引號展開 —— 這正是收緊後升級不了的形狀。PowerShell 側自 `f04098e` 起一律寫 `node "<正斜線路徑>"`，**本 repo 從未產生過 `powershell … -File …ps1` 的 hook 命令**；該形狀由同一條「直譯器＋副檔名相符」規則涵蓋（規格本就列有 `.ps1`），但不宣稱它有史料依據。

### round 2 後的執行結果

| 檢查 | 結果 |
|---|---|
| `pnpm test` | CLI **156 pass／0 fail**（round 1 為 142，基線 113）；server 228 pass／1 skip／0 fail |
| `pnpm typecheck` | CLI 與 server 均 Done |
| `pnpm --filter ccusage-tracker build` | Node target 通過；45.69 KB |
| `pnpm build` | Server Bun target 通過；233.48 KB |
| `spectra validate fix-review-findings-0-4-1` | `✓ valid`；tasks 19/19 |

### round 2 後的 smoke 增補

同一份 smoke 另外預先在 `settings.json` 放入舊版 hook 與「tracker 路徑當參數」的第三方 hook，並在最後模擬「只補裝 SessionEnd」：

```
=== Claude 端：舊 hook 升級、第三方保留 ===
SessionEnd 命令: [ "node /usr/local/lib/lint.js ~/.config/ccusage-tracker/session-end.mjs",
                  "node \"~/.config/ccusage-tracker/session-end.mjs\" --mode=session-end" ]
canonical tracker 條數: 1        => 只剩一條 OK
第三方 lint hook 保留:            OK
舊的 bash .sh hook 已被取代:      OK

=== 只補裝 SessionEnd（Stop 未變動且已信任）===
Codex: hooks installed (Stop trusted, SessionEnd awaiting trust). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook.
Codex hooks: installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)
```

第一段同時驗證了兩個 med 修正與自審發現的新洞；第二段是 [low] 部分更新信任狀態的端到端證據（拿掉 SessionEnd 群組後再跑 update，Stop 未變動故其信任仍有效）。

### 審查閘 round 3：路徑重組被移除

閘門結論「本輪新增的路徑重組仍會誤刪第三方 hook」成立，已實測重現。

round 2 為了讓未加引號、含空白的舊路徑能升級，把「直譯器與 tracker 參數以外的整段」重組成路徑，並用 `isSinglePath`（重組後不得再出現第二個絕對路徑起點）當護欄。護欄不夠：後續 token 若是**相對**路徑就穿過去了。實測三個命令中有兩個被誤刪：

```
"/usr/bin/env node <tracker>/session-end.mjs"                  -> 保留(第三方)
"/opt/tools/run.sh sub/ccusage-tracker/session-end.sh"         -> !!! 被刪掉 !!!
"node /opt/lint.js config/ccusage-tracker/session-end.mjs"     -> !!! 被刪掉 !!!
```

根因是這件事在字串層面無解：`<絕對路徑> <更多文字>` 既可能是「含空白的單一路徑」，也可能是「路徑＋另一個相對路徑參數」，兩種解讀都能以 tracker 腳本名結尾。唯一可靠的判別是查檔案系統是否存在，那會讓辨識變成不純函式且相依環境。

修法：**不猜**。腳本路徑必須恰好是一個 token（裸的或雙引號），完全不重組空白（`packages/cli/src/codex-hooks.ts` 的 `isTrackerHookCommand`），`isSinglePath` 一併移除。

取捨與代價：家目錄含空白、且由未加引號的舊安裝器（`f04098e`／`d758e52` 期間）裝的 hook 不會被升級，而是多 append 一條 canonical，變成兩條並存。這是 design.md 風險段已接受的「重複觸發由節流與鎖吸收」；相對於刪掉第三方 hook 的資料損失，選前者。規格新增 scenario「Unquoted path containing spaces is not recognized」明文寫下這個取捨，兩份 README 也已寫明。

`bash <tracker>/session-end.sh`、`node <tracker>/session-end.mjs --mode=…`（家目錄無空白）與 `powershell … -File "<path>.ps1"`（路徑加引號）都仍是單一 token，遷移不受影響。

### 對抗性掃描（round 3 後）

以 18 條引用 tracker 路徑的第三方命令與 8 種已知 tracker 形狀直接跑 `applyTrackerHooks`：

- 被誤刪的第三方：**無**（含 `sha256sum`、`&&`／`;`／管線、`/usr/bin/env node`、`/opt/tools/run.sh sub/…`、`node /opt/lint.js config/…`、副檔名不符、相對直譯器、`--verbose` 等額外參數、`--script=` 形式）
- 未能升級的 tracker 形狀：**無**（含 `bash …session-end.sh`、裸路徑 `.sh`、帶／不帶引號的 `.mjs`、帶引號 node 絕對路徑、PowerShell `-File`）

### round 3 後的執行結果

| 檢查 | 結果 |
|---|---|
| `pnpm test` | CLI **157 pass／0 fail**；server 228 pass／1 skip／0 fail |
| `pnpm typecheck` | CLI 與 server 均 Done |
| `pnpm --filter ccusage-tracker build` | Node target 通過；45.54 KB |
| `pnpm build` | Server Bun target 通過；233.48 KB |
| `spectra validate fix-review-findings-0-4-1` | `✓ valid` |
| `git diff --check` | 無 whitespace error |

Smoke 的 `settings.json` 另外預先放入三條引用 tracker 路徑的第三方 hook（`node /usr/local/lib/lint.js <tracker>`、`/usr/bin/env node <tracker>`、`/opt/tools/run.sh sub/ccusage-tracker/session-end.sh`）與一條舊的 `bash <tracker>.sh`：

```
canonical tracker 條數: 1        => 只剩一條 OK
第三方 hook 全部保留:            OK (3/3)
舊的 bash .sh hook 已被取代:      OK
```

> smoke 跑的是 `packages/cli/dist/index.js`。改完 code 一定要先 `pnpm --filter ccusage-tracker build` 再跑 smoke —— 本輪第一次跑就是對著舊 build，`/opt/tools/run.sh …` 顯示被誤刪，重建後才是真實結果。

### 審查閘 round 4：shell 會重新解讀的字元

Codex 第三輪複審 NEEDS-FIX（2 med、1 low），以實際執行的 JSON 反例指出仍可繞過。共通形狀是「字串長得像 tracker 路徑，但 shell 實際執行的是別的檔案」—— 辨識認錯就會把第三方 hook 整條刪掉。

| 複審 finding | 修法 | 證據 |
|---|---|---|
| [med] 反斜線與 `%VAR%`：`node /tmp/ccusage-tracker\codex-sync.mjs --hook` 被認成 tracker，但 POSIX 實際執行 `/tmp/ccusage-trackercodex-sync.mjs`；`node C:/%TARGET%/ccusage-tracker/codex-sync.mjs` 也被接受 | 腳本路徑與直譯器 token 的反斜線只在 Windows 磁碟機 `^[A-Za-z]:\` 或 UNC `^\\` 形狀下才算分隔（`hasAmbiguousBackslash`）；`%` 不分引號內外一律拒絕 | `packages/cli/src/codex-hooks.ts` 的 `hasAmbiguousBackslash` 與 `EXPANDS_ANYWHERE`；測試 `hooks.test.ts` 的 describe「shell 會改寫字面意義的字元一律視為第三方」、`codex-hooks.test.ts` 的同名案例（Codex 反例原文） |
| [med] 雙引號內的 shell 展開：`node "/tmp/$(printf keep)/ccusage-tracker/codex-sync.mjs" --hook` 被接受，替換後第三方命令消失 | `$` 與反引號不分引號內外一律拒絕（POSIX 雙引號內照樣展開），canonical 命令永遠不含這些字元 | 同上；`hooks.test.ts` 另含雙引號內反引號與 `$HOME` 兩案 |
| [low] SessionEnd 作廢測試起始狀態已是 awaiting，拿掉作廢邏輯也會過 | 改為兩事件起初皆 recorded、只設 `codexSessionEndChanged: true`，斷言只有 SessionEnd 降為 awaiting 且輸出不含 already up to date | `packages/cli/src/commands/setup.test.ts` 的「兩條原本都已信任、只補裝 SessionEnd」 |

Codex 實測的 7 條反例原文（含 unclosed／newline／caret 三條原本就已擋住）已逐字釘進 `codex-hooks.test.ts`，實跑全部 `stopGroups=2`（第三方保留）。

**mutation 驗證**：把 `packages/cli/src/hooks.ts` 的作廢邏輯整個拿掉（`stale` 直接回傳原狀態），setup.test.ts 的「只補裝 SessionEnd」與「Stop 有變動」兩案同時轉紅；修正前只有後者會紅。

### 對抗性掃描（round 4 後）

直接跑 `applyTrackerHooks`：

- 被誤刪的第三方：**無**（28 條，含 round 1–3 的全部案例，加上反斜線跳脫、正斜線路徑中混入反斜線、`%VAR%`（引號內外）、雙引號內的 `$()`／反引號／`$HOME`、caret、未閉合引號、引號外換行）
- 未能升級的 tracker 形狀：**無**（11 種，含 Windows 磁碟機反斜線路徑、UNC 反斜線路徑、帶空白且加引號的磁碟機路徑）

### round 4 後的執行結果

| 檢查 | 結果 |
|---|---|
| `pnpm test` | CLI **160 pass／0 fail**；server 228 pass／1 skip／0 fail |
| `pnpm typecheck` | CLI 與 server 均 Done |
| `pnpm --filter ccusage-tracker build` | Node target 通過；45.81 KB |
| `pnpm build` | Server Bun target 通過；233.48 KB |
| `spectra validate fix-review-findings-0-4-1` | `✓ valid` |
| `git diff --check` | 無 whitespace error |

Smoke 的 `settings.json` 擴充到五條引用 tracker 路徑的第三方 hook（`node /usr/local/lib/lint.js <tracker>`、`/usr/bin/env node <tracker>`、`/opt/tools/run.sh sub/…`、`node "/tmp/$(printf keep)/ccusage-tracker/session-end.mjs"`、`node /tmp/ccusage-tracker\session-end.mjs`）加一條舊的 `bash <tracker>.sh`：

```
canonical tracker 條數: 1        => 只剩一條 OK
第三方 hook 全部保留:            OK (5/5)
舊的 bash .sh hook 已被取代:      OK
```

### 審查閘 round 5／Codex 第五輪：辨識拆成兩層

閘門與複審指出同一個核心矛盾：**嚴格拒絕特殊字元會讓家目錄含這些字元的機器連自己寫出的 canonical 命令都認不得**，於是每次 update 再 append 一條、hooks 無上限成長；放寬又會被 shell 展開繞過。實測重現（家目錄含 `%`）：

```
run 1: anyChanged=true Stop 群組數=1
run 2: anyChanged=true Stop 群組數=2
run 3: anyChanged=true Stop 群組數=3
```

這比「多一條」嚴重得多 —— 是每跑一次就漏一條。解法是把辨識拆成兩層。

**第一層（精確比對，永遠優先）**：命令字串逐位元等於本機當下的 canonical 命令（Codex 用 `applyCodexHooks` 傳入的 command，Claude 用三條 `get*HookCommand()`）就是 tracker，不看任何字元規則。理由：那是我們自己產生、加了雙引號的字串；第三方寫出一模一樣的字串在定義上就是這條 hook，換成自己是 no-op，不可能誤刪。

**第二層（形狀比對，只用於升級舊形狀）**：維持嚴格規則，並依複審再收緊三點：

| finding | 修法 |
|---|---|
| (c1) `/opt/{real,foreign}/node "<tracker>"` 與 `/opt/*/node …` 被誤收（Bash 實測展開成兩個路徑，真正執行的是後者） | 未加引號的 token 含 brace／glob（`{ } * ? [ ]`）一律第三方；引號內不受影響（shell 不展開） |
| (c2) `node C:/!TARGET!/ccusage-tracker/codex-sync.mjs` 被誤收（cmd.exe delayed expansion） | `!` 不分引號內外一律第三方；canonical 含 `!` 由第一層接住 |
| (b) 合法家目錄 `/home/100%`、`/home/a\b` 產生的 canonical 被誤拒 | `%` 收斂為成對的 `%NAME%`；反斜線只在 Windows 路徑（磁碟機／UNC）算分隔符，其餘路徑的尾綴只以正斜線比對，未加引號含反斜線的 token 仍一律第三方 |

第二層辨識成功後會升級成 canonical，之後就走第一層，所以嚴格不會造成重複。

### 反斜線規則的推導

`/tmp/ccusage-tracker\codex-sync.mjs` 與 `/home/a\b/.config/ccusage-tracker/codex-sync.mjs` 都含反斜線，但只有前者危險：前者在 POSIX 是 `/tmp` 下的**單一檔名**（不是 `ccusage-tracker/` 目錄裡的腳本），後者的反斜線只是家目錄名稱的普通字元、tracker 的部分仍用正斜線。因此規則不是「有沒有反斜線」，而是「尾綴用哪種分隔符比對」：Windows 路徑兩種都算，其餘只認正斜線。未加引號時 POSIX shell 會吃掉反斜線，字面文字不是真正執行的路徑，所以另外一律拒絕。

### 五輪彙總的對抗性掃描

| 檢查 | 結果 |
|---|---|
| Codex round 5 原文反例（8 條，含兩條「應接受」的合法家目錄） | 判斷全對 |
| 前四輪反例（21 條） | 無一被誤收 |
| 家目錄形狀（10 種：`%` `\` `!` `$` 反引號 `{}` `*` 空白 一般 Windows） | 全部冪等（第二次 `anyChanged` 為 false、群組數維持 1） |

### round 5 後的執行結果

| 檢查 | 結果 |
|---|---|
| `pnpm test` | CLI **170 pass／0 fail**；server 228 pass／1 skip／0 fail |
| `pnpm typecheck` | CLI 與 server 均 Done |
| `pnpm --filter ccusage-tracker build` | Node target 通過；46.78 KB |
| `pnpm build` | Server Bun target 通過；233.48 KB |
| `spectra validate fix-review-findings-0-4-1` | `✓ valid` |
| `git diff --check` | 無 whitespace error |

Smoke 另外對三個含特殊字元的暫存家目錄各跑三次 update：

```
[pct%home]   run 1/2/3: Claude SessionEnd hook 數=1  Codex Stop 群組數=1
[bang!home]  run 1/2/3: Claude SessionEnd hook 數=1  Codex Stop 群組數=1
[back\slash] run 1/2/3: Claude SessionEnd hook 數=1  Codex Stop 群組數=1
```

## 已知限制與範圍外

- **Windows／Linux 未實機驗證**：路徑受支援（`isAbsolutePathToken` 認 `C:/`、UNC，辨識測試含 Windows 形狀），但只在 macOS 實跑。FIFO／socket 案例以 `it.skipIf(process.platform === "win32")` 跳過。中文與英文 README 都已寫明。
- **`config.toml` 與 status 讀檔未套型態檢查**：本次的 `assertRegularFileTarget` 依規格只涵蓋安裝交易的目標（`settings.json`、`hooks.json`、tracker 腳本）。`defaultWiringDeps.readCodexConfig`（`packages/cli/src/hooks.ts:296`）與 `status.ts:138` 的 `readTextFile` 仍直接 `readFileSync`，若 `config.toml` 是指向無 writer FIFO 的 symlink 會卡住。兩處都只讀不寫、不在本 change 範圍，記錄於此不順手修。
- **辨識收緊的取捨**：手動改過 tracker hook 命令（加自訂參數、包成複合命令）會被視為第三方而多出一份 tracker hook。舊版安裝器寫出的形狀已在 round 2 補上受限的遷移規則（round 3 再限定腳本路徑須為單一 token），但沒有涵蓋任何自訂改寫。已在兩份 README 寫明；重複觸發由 5 分鐘節流與獨立鎖吸收。
- **未加引號且含空白的路徑不會被升級**：該形狀與「把 tracker 路徑當參數傳給別的腳本」在字串層面無法區分，改為一律視為第三方（round 3）。代價是這類舊 hook 會多出一條 canonical 並存，重複觸發由 5 分鐘節流與獨立鎖吸收。現行安裝器一律加引號，只影響 `f04098e`／`d758e52` 期間安裝且家目錄含空白、之後從未更新過的機器。
- **含展開語法的「舊形狀」命令不會被升級**：家目錄含 `$`、反引號、`%NAME%`、`!` 或未加引號的 brace／glob 時，canonical 命令一律由第一層（位元組相等）接住，安裝冪等性不受影響；受影響的只有「舊形狀 ＋ 這類家目錄」的組合，那條舊 hook 不會就地升級而是多一條並存。
- 版本號提升、CHANGELOG 的 `[Unreleased]` 定版、npm 發布與 Zeabur 部署都不在本 change，另開 release PR。
