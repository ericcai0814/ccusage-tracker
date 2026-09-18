## Context

PR #13 把 Codex 接線合併進 master，但：(1) installFiles 沿用「目標不是一般檔案就拒寫」的防護，Eric 本機 `~/.claude/settings.json` 與 `~/.codex/hooks.json` 都是 symlink 指到 dotfiles，setup／update 回非零且整筆不落地；npm 0.1.7 沒有這道防護。(2) 獨立審查（Codex 閘因額度用盡未跑）給了 8 個 low，完整內容在 change 目錄外的審查報告，重點已抄進本文的 Decisions。

## Goals / Non-Goals

**Goals:**

- dotfiles 使用者可以直接 setup／update，symlink 保留、內容落到真實檔案。
- 修掉 F1 到 F7，行為與規格一致。
- 不放寬對目錄、socket、斷鏈的防護。

**Non-Goals:**

- F8 對真實 Codex CLI 的端到端驗證（需要真實 Codex session 與額度，部署後人工做）。
- 不改 hooks.json 的序列化格式（維持 2 空格 JSON）。
- 不改 server、DB、Claude 端上報邏輯（只動 Claude 的節流比較式）。

## Decisions

### 設定檔為 symlink 時寫穿到真實檔案

installFiles 的 stage 對每個目標先 lstat：是 symlink 就以 realpathSync 解析；解析失敗（斷鏈）或解析後不是一般檔案就拋錯，訊息含原路徑與 symlink 目標。解析成功時，暫存檔、`.backup`、rename 全部以真實路徑進行，symlink 不動。原本的「內容相同就略過」比較照舊透過 symlink 讀取。替代方案「unlink symlink 後寫一般檔案」會破壞 dotfiles 管理，排除；替代方案「只放寬 hooks.json」不一致，排除。適用於 settings.json、hooks.json、`~/.config/ccusage-tracker/*.mjs`。

### 收集器安裝後重新驗證主版本，且只在偵測到工具時安裝

ensureCollector 在自動安裝成功後對重新探測的版本再跑一次主版本判斷，不是 20 就回 unsupported_major 並印同一道指令（F2）。setup 與 update 只在 claudeDetected 或 codexDetected 為真時呼叫 ensureCollector；無工具時不做全域 npm 安裝（F6）。

### 節流時間戳只接受過去的值

codex-sync.mjs 的 throttled 與 session-end.mjs 的 Stop 節流改為 `age = now - last; age >= 0 && age < THROTTLE_MS` 才視為節流中；未來時間戳視為未節流並被新時間戳覆寫（F3）。

### Codex 結果行區分停用與未信任

wireTools 讀 readCodexTrustState 後，含 disabled 時印 `Codex: hooks installed but disabled in Codex`，不再印「請去信任」；與 status 的判斷一致（F1）。

### notify 掃描只在 table 標頭中斷

hasTrackerNotify 的中斷條件改為整行符合 table 標頭 `^\[[^\]]*\]$`；跨行頂層陣列中以 `[` 開頭的行不中斷掃描（F4）。仍為唯讀、只影響提示。

### 相容警告只在偵測到 Codex 時印

server 對 codex-sync.mjs 回 404／410 時，只有 codexDetected 為真才印相容訊息；未偵測到 Codex 只印 `Codex: not detected`（F5）。

### README 說明自動安裝會執行 npm 安裝期腳本

packages/cli/README.md 與 README.md 的 collector 段落加一句：setup／update 在缺收集器時會執行一次 `npm install -g ccusage@20.0.20`，會下載並執行該套件的安裝期腳本；不希望自動安裝者先設 `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1`（F7）。

## Implementation Contract

**行為**

- symlink 的 settings.json 或 hooks.json：setup／update 成功，symlink 仍是 symlink，真實檔案含 tracker hook，備份在真實檔案旁 `<real>.backup`。
- 斷鏈或指向目錄的 symlink：exit 1，訊息形如 `Refusing to replace non-regular file: <path> (symlink target: <target>)`，該交易沒有任何檔案落地。
- 無工具偵測：不執行 npm 安裝；setup exit 0、update exit 1 的既有行為不變。
- 安裝後探測到非 20 主版本：結果為 unsupported_major，訊息含 `20.0.20`。
- config.toml 該 hook 區段 `enabled = false`：Codex 結果行為 `Codex: hooks installed but disabled in Codex`。
- 404 且未偵測 Codex：輸出不含相容訊息，只含 `Codex: not detected`。
- notify 前有跨行頂層陣列：仍能印出移除提示。
- `codex-last-flush.txt` 或 Claude 的 `last-flush.txt` 為未來時間：下一次觸發照常啟動 worker 並覆寫時間戳。

**驗收準則**

- packages/cli/src/hooks.test.ts：symlink → 一般檔案（寫穿、symlink 保留、backup 位置）；symlink → 目錄（拒絕）；斷鏈（拒絕）；三者都斷言交易內其他檔案未落地或完整落地。
- packages/cli/src/commands/setup.test.ts 與 update.test.ts：settings.json 與 hooks.json 皆為 symlink 的暫存 HOME 下 setup／update 成功且 symlink 保留。
- packages/cli/src/collector.test.ts：安裝後重探測回 18.0.9 → unsupported_major；setup／update 在無工具時 installCollector 未被呼叫。
- packages/cli/src/codex-hooks.test.ts：跨行陣列後的 notify 仍被偵測；hooks.state `enabled = false` 對應結果行。
- packages/cli/src/commands/setup.test.ts：404 且 detectCodex 為 false 時輸出不含相容訊息。
- packages/server/src/codex-usage.test.ts 與 claude-usage.test.ts：未來時間戳不節流。
- pnpm test、pnpm typecheck、兩個 build 全綠；verification.md 記錄各命令輸出。

**範圍邊界**

- In scope：上述檔案與三份規格、兩份 README、CHANGELOG。
- Out of scope：F8、hooks.json 排版保留、server、DB、npm 發布。

## Risks / Trade-offs

- [寫穿 symlink 讓 tracker 可能寫到 HOME 以外的檔案] → 只在解析後是一般檔案時寫；訊息與 backup 都指向真實路徑，使用者看得到寫去哪。
- [Windows 的 junction／symlink 行為] → realpathSync 支援；未實機驗證，列入既有 Windows 限制。
- [Claude 節流改動觸碰上報路徑] → 只改比較式，既有 claude-usage 測試全部保留。

## Migration Plan

隨下一次 CLI 發布；無資料或設定遷移。回滾：還原 `.backup`。

## Open Questions

- 無。
