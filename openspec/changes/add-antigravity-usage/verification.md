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
