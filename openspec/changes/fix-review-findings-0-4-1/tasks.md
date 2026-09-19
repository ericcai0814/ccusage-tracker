## 1. 辨識規則與檔案型態（Codex med）

- [x] [P] 1.1 依 design「tracker hook 只辨識標準命令形狀」與規格「Tracker hook recognition」先在 packages/cli/src/hooks.test.ts 與 packages/cli/src/codex-hooks.test.ts 寫失敗測試：`sha256sum "<home>/.config/ccusage-tracker/codex-sync.mjs"` 與含 `&&` 的複合命令不被辨識且原樣保留、tracker 群組 append 在尾端；帶引號、不帶引號、`--mode=stop`、帶引號 node 路徑四種標準形狀仍被辨識。驗證：該組先紅。
- [x] 1.2 實作 packages/cli/src/hooks.ts 的 isCcusageTrackerHook 與 packages/cli/src/codex-hooks.ts 的辨識為完整形狀比對（可選 node、tracker 腳本絕對路徑、只允許 `--hook`／`--notify`／`--mode=<value>`）。驗證：1.1 全綠，既有 hooks.test.ts 與 codex-hooks.test.ts 全綠。
- [x] [P] 1.3 依 design「讀取設定檔前先驗檔案型態」與規格「Symlinked configuration files」先寫失敗測試：hooks.json 為指向 FIFO 的 symlink（無 writer）時 setup／update 在 2 秒內 exit 1、訊息為非一般檔案訊息含目標、不寫任何檔；指向目錄或 socket 時不報 JSON 錯誤；斷鏈時 readlink 失敗退回不帶目標的訊息；第二個檔案驗證失敗時第一個檔案沒有 `.tmp`／`.rollback`／`.backup`。驗證：先紅。
- [x] 1.4 實作 packages/cli/src/hooks.ts 的 assertRegularFileTarget，讓 settings.json 與 hooks.json 的讀取、installFiles 的 stage 都先過型態檢查再 readFileSync；目標解析移到 staging 迴圈前且每檔一次；依 design「寫穿 symlink 時印出真實路徑並提前解析」在 installFiles 回傳 writtenThrough 並於 setup／update 印 `Wrote through symlink: <link> -> <real>`。驗證：1.3 全綠，setup.test.ts／update.test.ts 新增輸出含該行的斷言並全綠。

## 2. 信任狀態與訊息

- [x] [P] 2.1 依 design「信任 key 依實際群組與 hook 索引」與「信任訊息逐 hook 說明」、規格「Status command」與「Codex hook installation」先寫失敗測試：混合群組（第三方在 hooks[0]、tracker 在 hooks[1]、群組索引 2）查 `:stop:2:1`；formatCodexTrustLine 對「皆 recorded」「皆 awaiting」「Stop recorded／SessionEnd awaiting」「Stop disabled／SessionEnd recorded」四種組合輸出規格文字；setup／update 的 Codex 結果行與 status 的 `Codex hooks:` 行使用同一函式。驗證：codex-hooks.test.ts、status.test.ts、setup.test.ts、update.test.ts 對應案例先紅。
- [x] 2.2 實作 packages/cli/src/codex-hooks.ts 的 codexIndexes（group 與 hook 索引）、readCodexTrustState 依實際索引查詢、新增 formatCodexTrustLine；packages/cli/src/hooks.ts 的 wireTools 與 packages/cli/src/commands/status.ts 改用它。驗證：2.1 全綠。

## 3. notify 提示與 TOML 掃描

- [x] [P] 3.1 依 design「notify 移除提示只在 hooks 真的接上時印」與規格「Codex hook installation」的兩個 notify scenario 先寫失敗測試：server 404、Codex 偵測到、config.toml 含 tracker notify → 輸出含相容訊息、不含移除提示；hooks 已接上且含 tracker notify → 仍印提示。驗證：setup.test.ts／update.test.ts 先紅。
- [x] [P] 3.2 依 design「TOML 掃描追蹤陣列與字串狀態」與規格 scenario「Top-level scan handles arrays, strings and comments」先在 packages/cli/src/codex-hooks.test.ts 寫四個 fixture：`[[servers]]`、`[tui] # comment`、跨行陣列含獨立 `[3, 4]` 行、字串值含 `[`；每個 fixture 各有「notify 在頂層 → true」「notify 在 table 內 → false」兩案。驗證：先紅（至少 `[[servers]]` 與 `[3, 4]` 兩案在現行實作會錯）。
- [x] 3.3 實作 packages/cli/src/hooks.ts 的提示條件改為 codexWired，與 packages/cli/src/codex-hooks.ts 的 hasTrackerNotify 狀態機（字串狀態、陣列深度、只在深度 0 辨識 table 標頭 `^\[\[?[^\]]*\]\]?\s*(#.*)?$`）。驗證：3.1 與 3.2 全綠。

## 4. 跨檔 rollback

- [x] 4.1 依 design「跨檔 rollback 測試」在 packages/cli/src/commands/update.test.ts 新增：settings.json 與 hooks.json 皆存在且 hooks.json 為 symlink，在 hooks.json 最後一次 rename 注入失敗；斷言 exit 非零、settings.json 內容回到原狀、既有 `.backup` 未被覆蓋、symlink 仍是 symlink、目錄內無 `.tmp`／`.rollback`。若 installFiles 現行實作未通過，修正 packages/cli/src/hooks.ts 的 rollback 順序或 backup 覆蓋條件直到通過。驗證：該案例全綠，既有 rollback 測試全綠。

## 5. 文件與驗證

- [x] [P] 5.1 依 design「中文 README 補未實機驗證平台」更新 README.md（架構表或 Codex 章節加「macOS 實測，Windows／Linux 路徑受支援但尚未實機驗證」）；packages/cli/README.md 補「勿手動修改 tracker hook 命令，否則會被視為第三方而另行 append」；CHANGELOG 的 Unreleased 新增 Fixed 條目（辨識收緊、型態檢查、實際索引、notify 提示條件、TOML 掃描、寫穿訊息、rollback 測試、逐 hook 訊息）。驗證：內容審閱，grep README.md 含「尚未實機驗證」。
- [x] 5.2 完整驗證：pnpm test、pnpm typecheck、pnpm --filter ccusage-tracker build 全綠；Node-built CLI smoke 在暫存 HOME 內以 symlink 設定檔與含 `sha256sum` 第三方命令的 hooks.json 跑 setup 與兩次 update，第三方群組位元組不變、tracker 在尾端、輸出含 `Wrote through symlink`、第二次 update 後 sha256 不變；輸出寫入 openspec/changes/fix-review-findings-0-4-1/verification.md；spectra validate 通過。

## 6. Codex 複審 round 2 補修

- [x] 6.1 依規格 scenario「Compound command without whitespace is not recognized」先寫失敗測試：`--mode=stop&&false`、`--hook;`、`--hook|`、`--hook>`、`$( )`、反引號、`bash -c '…'` 皆視為第三方並原樣保留。實作 packages/cli/src/codex-hooks.ts 的引號外 shell 語法偵測。驗證：hooks.test.ts 與 codex-hooks.test.ts 該組先紅後綠。
- [x] 6.2 依規格 scenario「Historical installer commands upgrade to exactly one tracker hook」先寫失敗測試，形狀取自 git 史料（db7435a `bash $HOOK_SCRIPT`、f04098e `node $HOOK_SCRIPT`、d758e52 `node $HOOK_SCRIPT --mode=…`，家目錄含空白時未加引號）與 `powershell … -File …ps1`。實作直譯器前綴規則（node/bash/sh/powershell/pwsh，副檔名須相符）與未加引號路徑的重組。驗證：升級後每個事件只剩一條 tracker hook。
- [x] 6.3 依規格 scenario「Tracker path passed as an argument to another program」、「Unquoted path containing spaces is not recognized」與「Interpreter does not match the script extension」補測並實作：腳本路徑必須是單一 token（裸的或雙引號），不把多個以空白分隔的 token 重組成路徑；直譯器與副檔名不符一律第三方。驗證：`node /opt/lint.js config/ccusage-tracker/session-end.mjs`、`/usr/bin/env node <tracker>`、`/opt/tools/run.sh sub/ccusage-tracker/session-end.sh` 皆原樣保留。
- [x] 6.3b 審查閘 round 3：`isSinglePath` 仍擋不住 `node /opt/lint.js config/ccusage-tracker/session-end.mjs` 與 `/opt/tools/run.sh sub/ccusage-tracker/session-end.sh`（後續 token 不是絕對路徑）。改為完全不重組空白，並移除 `isSinglePath`。驗證：18 條第三方命令的對抗性掃描全部保留、8 種 tracker 形狀全部升級為唯一一條。
- [x] 6.4 依規格 scenario「Escapes inside basic strings」先寫失敗測試（`"""` 內的 `\"""` 不結束字串；`'''` 不吃跳脫），實作 packages/cli/src/codex-hooks.ts 的 scanLine 跳脫處理。驗證：四個 TOML fixture 的正反案例全綠。
- [x] 6.5 依規格 scenario「Trust invalidated only for the hook that changed」先寫失敗測試：Stop 未變動且已信任、只補裝 SessionEnd 時只要求信任 SessionEnd；Stop 有變動時不冒稱已信任。實作 packages/cli/src/hooks.ts 依 codexStopChanged／codexSessionEndChanged 分別作廢信任。驗證：setup.test.ts 兩案先紅後綠。
- [x] 6.6 補 formatCodexTrustLine「皆 recorded」的安裝端分支（`Codex: hooks already up to date (trust recorded)`），並把四組逐字斷言補齊、另立「皆 disabled」案例。驗證：codex-hooks.test.ts 全綠。
- [x] 6.7 重跑 pnpm test、pnpm typecheck、CLI build 與 Node-built CLI smoke，更新 verification.md 與 REPORT.md。

## 7. 審查閘 round 4 補修

- [x] 7.1 依規格 scenario「Characters the shell would reinterpret are never recognized」先寫失敗測試（Codex 實測反例原文）：`node /tmp/ccusage-tracker\codex-sync.mjs`、`node C:/%TARGET%/ccusage-tracker/codex-sync.mjs`、`node "/tmp/$(printf keep)/ccusage-tracker/codex-sync.mjs"`、雙引號內反引號、雙引號內 `$HOME`，皆應原樣保留；Windows 磁碟機與 UNC 的反斜線路徑仍應被辨識。驗證：hooks.test.ts 與 codex-hooks.test.ts 該組先紅。
- [x] 7.2 實作 packages/cli/src/codex-hooks.ts：`$`、反引號、`%` 不分引號內外一律拒絕（POSIX 雙引號內仍會展開，`%` 是 cmd.exe 展開）；腳本路徑與直譯器 token 的反斜線只在 Windows 磁碟機 `^[A-Za-z]:\` 或 UNC `^\\` 形狀下才算分隔，其餘一律第三方。驗證：7.1 全綠。
- [x] 7.3 修正 packages/cli/src/commands/setup.test.ts 的 SessionEnd 作廢測試：起始狀態改為兩事件皆 recorded、只設 `codexSessionEndChanged: true`，斷言只有 SessionEnd 降為 awaiting 且輸出不含 already up to date。驗證：以 mutation（拿掉整個作廢邏輯）確認該案例與 Stop 方向的案例都會轉紅。
- [x] 7.4 重跑 pnpm test、typecheck、build 與 smoke；更新 verification.md 與 REPORT.md。

## 8. 審查閘 round 5 補修

- [x] 8.1 依規格 scenario「The command the CLI writes is always recognized」先寫失敗測試：家目錄含 `%`／`$`／反引號時，以同一條 canonical 命令連跑三次 `applyCodexHooks`，Stop 群組數必須維持 1 且第二次起 `anyChanged` 為 false。驗證：先紅（實測 1→2→3 無上限成長）。
- [x] 8.2 實作 packages/cli/src/codex-hooks.ts 的 `isTrackerHookCommand` canonical 位元組相等豁免，並把 canonical 命令一路帶進 `isCodexTrackerHook`／`upsertCodexGroups`／`findCodexTrackerIndexes`／`applyCodexHooks`；packages/cli/src/hooks.ts 的 `isCcusageTrackerHook` 傳入三條 canonical 命令。驗證：8.1 全綠，round 4 的 10 條反例仍全部是第三方。
- [x] 8.3 `%` 的拒絕範圍收斂為成對的 `%NAME%`（cmd.exe 變數展開），單獨的 `%` 視為普通路徑字元。驗證：`node C:/%TARGET%/…` 仍被拒、`node "/Users/a%b/…"` 可辨識。
- [x] 8.4 重跑 pnpm test、typecheck、build 與 smoke；更新 verification.md 與 REPORT.md。
- [x] 8.5 依 Codex round 5 finding (c1) 補測並實作：未加引號的直譯器或路徑 token 含 brace／glob（`{ } * ? [ ]`）一律第三方，引號內不受影響。驗證：`/opt/{real,foreign}/node "…"`、`/opt/*/node "…"`、`node /home/*/…` 皆原樣保留。
- [x] 8.6 依 Codex round 5 finding (c2) 補測並實作：整條命令任何位置出現 `!` 一律第三方（cmd.exe delayed expansion），canonical 含 `!` 時由第一層接住。驗證：`node C:/!TARGET!/…`（引號內外）皆保留；家目錄 `/home/a!b` 重複安裝仍為 noop。
- [x] 8.7 依 Codex round 5 finding (b) 修正反斜線規則：腳本路徑尾綴在 Windows 路徑（磁碟機／UNC）下兩種分隔都算，其餘只認正斜線；未加引號含反斜線的 token 一律第三方。驗證：`/home/a\b/.config/ccusage-tracker/codex-sync.mjs` 被辨識、`/tmp/ccusage-tracker\codex-sync.mjs` 被拒、Windows 與 UNC 路徑仍被辨識。
- [x] 8.8 審查閘 round 6：`%` 收斂成「成對的 `%NAME%`」不成立（cmd 變數名不限於 `[A-Za-z_]\w*`，`%ProgramFiles(x86)%` 為真實變數、`%1` 為批次參數），實測 6 種形狀繞過。改回形狀層一律拒絕任何 `%`；家目錄含 `%` 時的冪等性本來就由第一層保證。驗證：六輪彙總掃描 41 條第三方無一被誤刪、8 種 tracker 形狀全部升級、12 種家目錄全部冪等。
