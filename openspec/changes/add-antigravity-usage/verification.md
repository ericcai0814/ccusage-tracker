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
