## Context

0.4.0（CLI 0.2.0）已發布並在 Eric 本機端到端驗證：symlink 寫穿、Codex Stop hook 觸發、server 收到 codex-daily。Codex 額度恢復後對提案 commit 以來的 43 個檔案補審，結論 NEEDS-FIX：2 med、4 low；加上前一輪 subagent 的 4 low 與兩個文件／訊息缺口。全部是邊角情況，正常路徑不受影響，所以不做 hotfix，集中在 0.4.1。findings 全文在 `$TMPDIR/claude-handoffs/ccusage-tracker-codex-review-2026-09-19.md` 與 `$TMPDIR/claude-handoffs/fix-symlink-config-and-review-lows/review-findings.md`。

## Goals / Non-Goals

**Goals:**

- 第三方 hook 在任何命令字串下都不會被 tracker 誤認、誤改。
- 任何非一般檔案的設定檔目標都在讀取前被拒絕，不卡住、不誤報。
- 信任狀態的查詢與訊息對實際 hooks.json 結構正確且逐 hook 明確。
- 補齊 rollback 與 TOML 掃描的測試缺口；文件補平台限制。

**Non-Goals:**

- 不改 codex-sync.mjs、session-end.mjs、server。
- 不改 hooks.json 序列化格式。
- 不做 Windows／Linux 實機驗證。
- 版本號、發布、部署另開 release PR。

## Decisions

### tracker hook 只辨識標準命令形狀

`isCcusageTrackerHook` 與 codex-hooks 的辨識改為整條命令必須符合：可選的 `node `（或帶引號的 node 絕對路徑）＋ 帶或不帶雙引號的絕對路徑，路徑以 `/ccusage-tracker/codex-sync.mjs`、`/ccusage-tracker/session-end.mjs`、`/ccusage-tracker/session-start.mjs`（Claude 端另接受舊版 `.sh`／`.ps1`）結尾 ＋ 只允許 tracker 自己的參數（`--hook`、`--notify`、`--mode=<value>`）。命令中出現其他 token（例如 `sha256sum`、管線、`&&`）即視為第三方，原樣保留，tracker 群組另行 append。替代方案「維持子字串比對」會讓引用腳本路徑的第三方命令被整組替換，排除。

### 讀取設定檔前先驗檔案型態

新增 `assertRegularFileTarget(path)`：lstat；symlink 就 realpathSync，失敗（斷鏈）或解析後非一般檔案都拋 `Refusing to replace non-regular file: <path> (symlink target: <target>)`；一般檔案不存在視為「尚未建立」回 null。`readCodexHooksFile`、settings.json 讀取、以及 installFiles 的 stage 都先過這一關，之後才 `readFileSync`。FIFO 永遠不會被 open。斷鏈時 readlink 包 try，失敗就退回不帶目標的訊息。

### 信任 key 依實際群組與 hook 索引

applyCodexHooks 回傳每個事件 tracker hook 的 `{ groupIndex, hookIndex }`；readCodexTrustState 用 `<hooks path>:<event>:<groupIndex>:<hookIndex>` 查 hooks.state。混合群組（第三方在 hooks[0]、tracker 在 hooks[1]）查 `:g:1`，不再誤讀第三方的信任或停用紀錄。

### notify 移除提示只在 hooks 真的接上時印

`hasTrackerNotify` 的提示改為只在 `result.codexWired`（本次安裝或先前已存在且未變）為真時印。server 回 404／410 沒裝 hooks 時，即使有 tracker notify 也不叫人移除，因為那可能是使用者唯一的自動上報入口。

### TOML 掃描追蹤陣列與字串狀態

`hasTrackerNotify` 改為逐字元或逐行狀態機：追蹤是否在字串（單／雙引號、三引號）內與陣列深度；只有在深度 0 且不在字串內時，整行符合 `^\[\[?[^\]]*\]\]?\s*(#.*)?$` 才算 table 標頭並停止掃描。`notify` 的值若跨行，累積到深度回到 0 再判斷是否含 tracker 腳本路徑。覆蓋 `[[array]]`、`[tui] # 註解`、續行 `[3, 4]`（無尾逗號）、字串內含 `[` 等案例。

### 跨檔 rollback 測試

在 update.test.ts 新增：兩端設定皆存在（其中至少一個為 symlink），注入失敗點在 hooks.json 的最後一次 rename；斷言 settings.json 內容回到原狀、既有 `.backup` 未被覆蓋、symlink 仍是 symlink、目錄內沒有 `.tmp`／`.rollback` 殘留、exit 非零。若 installFiles 現行實作無法通過，修到通過為止（預期只需調整 rollback 順序或 backup 覆蓋條件）。

### 寫穿 symlink 時印出真實路徑並提前解析

installFiles 先對全部目標解析與驗證（每檔一次），再進入 staging；任何一檔驗證失敗時尚未寫任何暫存檔。當解析後路徑與原路徑不同，安裝結束印 `Wrote through symlink: <link> -> <real>`（每個寫穿的檔案一行），讓使用者看見寫到 HOME 以外的位置。

### 信任訊息逐 hook 說明

readCodexTrustState 回傳每個事件的狀態後，訊息規則：兩者皆 recorded → `trust recorded`；皆 awaiting → 現行「awaiting trust」訊息；混合 → 列出各自狀態，例如 `Stop trusted, SessionEnd awaiting trust`，並保留 `/hooks` 指引；任一 disabled → 標出哪一條 disabled。setup／update 的 Codex 結果行與 status 的 `Codex hooks:` 行共用同一個格式化函式。

### 中文 README 補未實機驗證平台

README.md 的架構表或 Codex 章節加一句：tracker 與 collector 在 macOS 實測，Windows／Linux 路徑受支援但尚未實機驗證；與英文 README 第 133 行對齊。

## Implementation Contract

**行為**

- hooks.json 中含 `sha256sum "<home>/.config/ccusage-tracker/codex-sync.mjs"` 的第三方 Stop 群組：setup／update 後該群組原樣保留在原索引，tracker 群組 append 在尾端。
- hooks.json 為指向 FIFO 的 symlink（無 writer）：setup／update 在 2 秒內以 exit 1 結束，訊息為非一般檔案訊息並含 symlink 目標；不寫任何檔。
- hooks.json 的 Stop 群組為 `[第三方 hook, tracker hook]` 混合：status 查 `:stop:<g>:1`。
- server 404、Codex 偵測到、config.toml 有 tracker notify：輸出含相容訊息，不含 notify 移除提示。
- config.toml 在 notify 前有 `[[x]]` 表、`[tui] # 註解`、跨行陣列含獨立一行 `[3, 4]`：三種情況下若 notify 是頂層且含 tracker 腳本，皆印提示；notify 若位在 table 內，皆不印。
- symlink 寫穿成功：輸出含 `Wrote through symlink: <link> -> <real>`。
- Stop 已信任、SessionEnd 未信任：setup／update 印 `Codex: hooks installed (Stop trusted, SessionEnd awaiting trust). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook.`；status 印 `Codex hooks: installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)`。

**介面**

- `packages/cli/src/hooks.ts`：新增 `assertRegularFileTarget(path): { realPath: string } | null`（不存在回 null）；`isCcusageTrackerHook(command)` 改為完整形狀比對；installFiles 回傳值加 `writtenThrough: Array<{ link: string; real: string }>`。
- `packages/cli/src/codex-hooks.ts`：`applyCodexHooks` 回傳 `codexIndexes: { stop?: { group: number; hook: number }; sessionEnd?: { group: number; hook: number } }`；`readCodexTrustState(configToml, hooksPath, indexes)`；新增 `formatCodexTrustLine(states, { forStatus })`；`hasTrackerNotify(toml)` 改狀態機。

**驗收準則**

- packages/cli/src/hooks.test.ts：第三方命令含腳本路徑不被辨識為 tracker（至少 `sha256sum` 與含 `&&` 兩案）；標準命令的帶引號／不帶引號／`--mode=stop` 三種形狀仍被辨識；FIFO symlink 在讀取前被拒且測試在 2 秒內完成；斷鏈時 readlink 失敗退回不帶目標訊息；寫穿成功回傳 writtenThrough；解析失敗時目錄內無 `.tmp`。
- packages/cli/src/codex-hooks.test.ts：混合群組的索引與信任查詢；TOML 四案（`[[x]]`、行尾註解、`[3, 4]` 續行、字串內 `[`）；formatCodexTrustLine 四種組合。
- packages/cli/src/commands/setup.test.ts 與 update.test.ts：404＋Codex 偵測到＋tracker notify → 無移除提示；混合信任 → 逐 hook 訊息；跨檔 rollback 案例；輸出含 `Wrote through symlink`。
- packages/cli/src/commands/status.test.ts：逐 hook 訊息與混合群組索引。
- pnpm test、pnpm typecheck、CLI build 全綠；Node-built CLI smoke（暫存 HOME、symlink 設定、含第三方 `sha256sum` 命令的 hooks.json）setup 後第三方群組位元組不變、tracker 在尾端。

**範圍邊界**

- In scope：上述 CLI 檔案與測試、兩份 README、CHANGELOG、cli-tool 規格。
- Out of scope：server、hook 腳本、版本號與發布、Windows／Linux 實機。

## Risks / Trade-offs

- [辨識收緊後，成員手動改過 tracker 命令（例如加了自訂參數）會被視為第三方，導致重複的 tracker hook] → 標準形狀允許 tracker 自己的參數集合；README 說明勿手改 tracker hook；重複觸發由節流與鎖吸收。
- [TOML 狀態機比 regex 複雜] → 只用於唯讀提示，錯誤最壞是少印或多印一句；以四個 fixture 釘住。
- [rollback 測試可能暴露 installFiles 既有缺陷] → 若暴露就在本 change 修，範圍仍在 installFiles。

## Migration Plan

隨 0.4.1 發布；無資料遷移。回滾：安裝 CLI 0.2.0。

## Open Questions

- 無。
