# add-antigravity-usage 驗證紀錄

所有指令都在 worktree `t3/add-agy-usage-detection` 上執行（基底 `f6ff76e`）。測試一律用隔離 HOME 與 loopback；沒有寫入真實設定檔，也沒有對正式 server 發請求。

## 1.1 Server 來源表

先寫 `packages/server/src/sources.test.ts`，`sources.ts` 不存在時執行結果為 `0 pass / 1 fail / 1 error`（模組找不到）。

```
$ cd packages/server && bun test src/sources.test.ts src/queries.test.ts src/routes/source-aggregation.test.ts src/routes/ingest.test.ts
 75 pass
 0 fail
 215 expect() calls
Ran 75 tests across 4 files.
```

三來源各送兩次只留三筆的 ingest 案例放在 `source-aggregation.test.ts`（`ingest.test.ts` 不在本 change 的檔案範圍內）。

## 1.2 儀表板逐來源呈現

新增 6 個案例後、改 dashboard.tsx 前：`51 pass / 6 fail`，失敗的正是這 6 個。

```
$ cd packages/server && bun test src/routes/dashboard.test.ts
 57 pass
 0 fail
 168 expect() calls
Ran 57 tests across 1 file.
```

## 2.1 agent-sync.mjs 測試（先紅）

`packages/server/src/antigravity-usage.test.ts`：合成 ccusage（記錄 argv、可設版本與輸出）、隔離 HOME，ingest 是以 `Bun.serve` 掛在 `127.0.0.1` 隨機埠上的真實 `createApp`（記憶體 DB）。

腳本不存在時：`1 pass / 35 fail`。唯一通過的是「未知來源與未知旗標 exit 1」，因為 node 找不到腳本本來就 exit 1。

## 2.2 手動與 worker 模式、路由

```
$ node --check packages/server/src/hook-scripts/agent-sync.mjs   # exit 0
$ cd packages/server && bun test src/antigravity-usage.test.ts
 36 pass
 0 fail
$ bun test src/routes/source-aggregation.test.ts src/antigravity-usage.test.ts src/scripts.test.ts
 76 pass
 0 fail
```

路由案例 `serves the agent reporter script byte-for-byte`（source-aggregation.test.ts）在接上 `/scripts/agent-sync.mjs` 之前為 fail，之後為 pass。

## 2.3 hook、trigger 與節流

新增 16 個案例後、實作前：`38 pass / 16 fail`（手動 sync 不寫節流檔的兩案本來就通過）。

```
$ cd packages/server && bun test src/antigravity-usage.test.ts   # 連跑兩次
 54 pass
 0 fail
$ bunx tsc --noEmit   # exit 0
$ bun test            # server 全套
 400 pass
 0 fail
```

「worker 無法啟動」以 `--import` 注入的 probe 讓 `child_process.spawn` 拋錯，並斷言確實沒有 worker 啟動。

## 3.1 Claude worker 搭便車

測試在隔離 HOME 放一支假的 `agent-sync.mjs`（記錄 argv、印 stdout／stderr、睡 2 秒、exit 1），確認 worker 以 detached、stdio ignore 啟動它、只帶 `--trigger`、不等它。

新增 5 個案例後、改腳本前：`21 pass / 3 fail`（腳本不存在與拿不到鎖的兩案本來就通過）。

```
$ cd packages/server && bun test src/claude-usage.test.ts
 24 pass
 0 fail
```

## 3.2 Codex worker 搭便車

新增 6 個案例後、改腳本前：`44 pass / 4 fail`。既有案例一字未改。

```
$ cd packages/server && bun test src/codex-usage.test.ts src/routes/source-aggregation.test.ts
 53 pass
 0 fail
$ bunx tsc --noEmit   # exit 0
$ bun test            # server 全套
 411 pass
 0 fail
```

## 4.1 Collector 版本

先改測試（含隨 `COLLECTOR_VERSION` 改為 20.0.51 而更新的安裝指令字串），`parseCollectorVersion`／`compareCollectorVersion` 不存在時整檔載入失敗：`0 pass / 1 fail`。

```
$ cd packages/cli && bun test src/collector.test.ts
 17 pass
 0 fail
```

## 4.2 CLI 來源表與 hooks.json 處理

模組不存在時：`0 pass / 1 fail`（Cannot find module './agent-sources'）。

```
$ cd packages/cli && bun test src/antigravity-hooks.test.ts
 27 pass
 0 fail
```

## 4.3 安裝交易與 wireTools

installHook／wireTools 會走 `os.homedir()`，而 bun 在程序啟動時就快取它，所以 hooks.test.ts 的新案例一律在 bun 子程序以隔離 HOME 執行，本程序不呼叫 installHook。實作前：10 個新案例失敗。

```
$ cd packages/cli && bun test src/hooks.test.ts
 47 pass
 0 fail
```

## 4.4 setup／update

改 setup.ts 前，CLI 全套 `197 pass / 21 fail`（setup 還沒把 `detectAntigravity` 交給 wireTools）。setup.test.ts 隨 `InstallTargets` 多出 `antigravity` 欄位與安裝版本 20.0.51，更新了既有斷言（targets 形狀、`ccusage@20.0.51`、結果行順序加入 Antigravity）。

```
$ cd packages/cli && bun test src/commands/setup.test.ts src/commands/update.test.ts
 62 pass
 0 fail
$ bunx tsc --noEmit   # exit 0
$ bun test            # CLI 全套
 228 pass
 0 fail
```

## 4.5 status、sync 與說明文字

新增案例後、實作前：status.test.ts 因匯入不到 `antigravityStatusLines`／`codexCollectorLine` 整檔失敗，sync.test.ts 的案例全紅。status 指令與 sync 指令的案例在 bun 子程序以隔離 HOME、只含 fixture 的 PATH 執行。

```
$ cd packages/cli && bun test src/commands/status.test.ts src/commands/sync.test.ts
 32 pass
 0 fail
$ bun run build && node dist/index.js | grep "sync antigravity"
  sync antigravity  Report Antigravity usage now (manual fallback / debugging)
$ bun test   # CLI 全套
 247 pass
 0 fail
```

update.test.ts 中「status 的 Codex collector 安裝指令」斷言隨安裝版本改為 `ccusage@20.0.51`。

## 5.1 文件

```
$ for f in README.md packages/cli/README.md CHANGELOG.md; do echo "$f: sync antigravity=$(grep -c 'sync antigravity' $f) 20.0.51=$(grep -c '20.0.51' $f)"; done
README.md: sync antigravity=2 20.0.51=6
packages/cli/README.md: sync antigravity=2 20.0.51=3
CHANGELOG.md: sync antigravity=1 20.0.51=2
$ grep -n -i "只支援\|only supports\|Claude Code or Codex\|Claude Code and Codex\|neither Claude Code nor Codex" README.md packages/cli/README.md CHANGELOG.md
（無輸出）
```

CHANGELOG 舊版段落中「兩個工具都沒偵測到」屬於當時的紀錄，保留不改。README 的「計數與相容範圍」表新增 20.0.51 與 Antigravity 兩列；20.0.51 實跑結果見下方 5.2。

## 5.2 完整驗證

### 全套指令

四項 exit code 皆為 0。尾段：

```
$ pnpm test
packages/cli test: Ran 247 tests across 10 files. [8.90s]
packages/cli test: Done
packages/server test:  411 pass
packages/server test:  1 skip
packages/server test:  0 fail
packages/server test:  1226 expect() calls
packages/server test: Ran 412 tests across 18 files. [40.88s]
packages/server test: Done
$ pnpm typecheck
packages/server typecheck$ tsc --noEmit
packages/cli typecheck$ tsc --noEmit
packages/cli typecheck: Done
packages/server typecheck: Done
$ pnpm build
Bundled 63 modules in 7ms

  index.js  0.29 MB  (entry point)

$ pnpm --filter ccusage-tracker build
Bundled 13 modules in 3ms

  index.js  57.50 KB  (entry point)

```

server 412 個案例中 1 個是既有的 opt-in 案例（`CCTRACKER_TEST_LEGACY_COLLECTOR` 未設定時 skip）。

### 以 built CLI 對 loopback server 的 smoke 測試

- server：真實 `createApp`，DB 為 scratch 檔案，以 `Bun.serve({ hostname: "127.0.0.1", port: 0 })` 只綁 loopback。
- 隔離 HOME，只建 `~/.gemini/antigravity-cli/conversations`；PATH 只有合成 ccusage（版本 20.0.51、只回 Antigravity 一列）與 `/usr/bin:/bin`。
- 每個 CLI 指令都包在 `sandbox-exec` 內執行，profile 拒絕寫入 `~/.claude`、`~/.codex`、`~/.gemini`、`~/.config/ccusage-tracker`、`~/dotfiles/claude`。守衛先以無害靶自測：在 sandbox 內寫 `~/.codex/__sandbox_probe` 得到 `Operation not permitted`，檔案不存在。

```
$ printf 'Smoke Tester\nhttp://127.0.0.1:<port>\nsmoke-team-key\n' | node packages/cli/dist/index.js setup
Claude Code: not detected
Codex: not detected
Antigravity: hook installed (Stop). Restart Antigravity to load it.
Collector: ccusage 20.0.51 (Claude, Codex and Antigravity ready)
setup exit=0
（~/.gemini/config/hooks.json 只含 ccusage-tracker → Stop → node "<home>/.config/ccusage-tracker/agent-sync.mjs" --hook antigravity）

$ node packages/cli/dist/index.js update   # 兩次，都印 Antigravity: hook already up to date，exit 0
sha256（setup 後 = 第一次 update 後 = 第二次 update 後）：
cd4d13978533ca7200d1bdb6e3fa45b6c32696627fa36b22945c859d83813f2e  <home>/.gemini/config/hooks.json
9bc50786f1ec3ac5d2c609f0aea5efe11c10d6650abfd5860979c25d577e3164  <home>/.config/ccusage-tracker/config.json
ce57f40a70925871cc32cf7df5bda36edf08ceb7a31afcf58d08014e9310c923  <home>/.config/ccusage-tracker/agent-sync.mjs

$ node packages/cli/dist/index.js sync agy
Antigravity usage synced.   (exit 0)
$ GET /api/report/daily → 一筆 session_id antigravity-daily，input 100、output 40（30 + reasoning 10）、cache_creation 5、cache_read 20
```

儀表板：sync 寫入的是本機日期 2026-11-21，而 server 的期間以 UTC 計（`getDateRange` 用 `toISOString()`，當時 UTC 仍是 11-20），所以剛 sync 完的月檢視不含這筆。這是 README 已記載的既有行為，不屬本 change。補一筆 2026-11-20 的 `antigravity-daily` 後，月檢視 HTML 含 `Antigravity` 5 次、`#f0b800` 4 次，圖例沒有 `其他`。再以 ingest API 補 11-16 至 11-20 三來源資料，三來源 HTML 檢查結果：SVG 3 條 `<path>`、Antigravity 線為 `stroke="#f0b800"`、圖例順序 Claude Code → Codex → Antigravity、供應商 Anthropic／OpenAI／Google、`claude-opus-5-5` 兩列。

### 以真實 ccusage 20.0.51 跑既有 session-end.mjs 與 codex-sync.mjs

- ccusage 20.0.51 以 `npm install --prefix <scratch>` 安裝；wrapper 對收集指令加 `--offline`，避免下載定價。
- `CLAUDE_CONFIG_DIR=~/.claude`、`CODEX_HOME=~/.codex` 唯讀讀取真實用量；隔離 HOME 的 config 指向 loopback server。
- 兩支腳本只寫 `homedir()/.config/ccusage-tracker`（已隔離），已逐行檢查寫檔呼叫。ccusage 是否寫入則由上述 `sandbox-exec` profile 在機制上拒絕，不靠推論。

```
claude      daily --json: exit 0, top=daily,totals rows=1 rowkeys=cacheCreationTokens,cacheReadTokens,date,inputTokens,modelBreakdowns,modelsUsed,outputTokens,totalCost,totalTokens
codex       daily --json: exit 0, top=daily,totals rows=1 rowkeys=cacheCreationTokens,cacheReadTokens,costUSD,date,inputTokens,models,outputTokens,reasoningOutputTokens,totalTokens
antigravity daily --json: exit 0, top=daily,totals rows=0（本機沒有 Antigravity 對話資料；totals.totalCost 為 -0.0）
session-end.mjs --mode=worker: exit 0 → ingest 200, session_id daily
codex-sync.mjs（手動）: "Codex usage synced." exit 0 → ingest 200, session_id codex-daily
agent-sync.mjs antigravity: "No Antigravity usage for today." exit 0
兩個 last-error 檔都不存在；last-upload.txt、codex-last-upload.txt 都已寫入
```

兩支既有驗證器都接受 20.0.51 的真實輸出。真實 JSON 存在 scratch，未入庫。

### 真實設定檔前後 sha256

與主線程的 baseline 逐一比對，全部相同；`~/.gemini/config/hooks.json` 前後都不存在：

```
1050bb8148d67c7efeaf93644853002223b04f4385d2d88059a6e738b687cd97  ~/dotfiles/claude/settings.json      OK
6c53180f461414576f2b43f6e29b30c7799f484364672d585cc944b6aebb23a4  ~/.codex/hooks.json                 OK
af99efc0236809abce7b509c1f8e8ca76d30a1ebb5a4419a83c5b93d2b5a2682  ~/.codex/config.toml                OK
03cd8bc2ce45de4132d97efff542f7b4246e828f373518fc43d70eb95ba01e65  ~/.config/ccusage-tracker/config.json OK
```

### 未在本 session 完成的項目

- `spectra validate add-antigravity-usage`：依交接指示跳過（Spectra CLI 不支援 worktree），由主線程執行。
- `#f0b800` 的人眼確認：截圖與 HTML 已交給維護者，尚未確認。

## 5.3 Antigravity 實機驗收

未確認。本機沒有 Antigravity 對話資料，也沒有 `agy` 指令；需要一台裝有 Antigravity 且有對話的機器確認：Customizations > Hooks 列出 `ccusage-tracker`、一輪對話後產生 `antigravity-last-flush.txt` 並上報成功、`{"decision":"stop"}` 不被當成錯誤。
