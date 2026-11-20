## 1. Server 來源表與儀表板

- [x] [P] 1.1 依 design「Server 來源表與儀表板」與規格「Server source table」先寫失敗測試 packages/server/src/sources.test.ts：以 bun:sqlite 記憶體資料庫跑 `buildSourceCaseSql`，`daily`、`codex-daily`、`antigravity-daily`、`manual`、NULL 依序得到 claude、codex、antigravity、other、other，`resolveSource` 結果相同；傳入多一筆 `gemini-daily` 的表時，兩者都歸到該筆；表內 sessionId 不符 `^[a-z0-9-]+$` 時建表即拋錯。再實作 packages/server/src/sources.ts，讓 packages/server/src/queries.ts 的 `UsageSource`、SQL CASE 與 `resolveSource` 改由它產生；ingest 路由與 schema 不動。驗證：`bun test packages/server/src/sources.test.ts packages/server/src/queries.test.ts packages/server/src/routes/source-aggregation.test.ts packages/server/src/routes/ingest.test.ts` 全綠，其中 ingest 案例同一成員同一天送兩次 `antigravity-daily` 後只剩一筆。
- [x] 1.2 依規格「Overview trend chart」與「Rankings and provider split」先在 packages/server/src/routes/dashboard.test.ts 寫失敗測試：月檢視有三種來源時，SVG 有三條 `<path>`、圖例依序為 Claude Code、Codex、Antigravity，且 Antigravity 用 `#f0b800`；只有 `antigravity-daily` 時圖例不含 `其他`；`period=today` 兩種來源時畫兩條橫條、沒有 `<path>`；供應商拆分 50／30／20 美元顯示 Anthropic 50%、OpenAI 30%、Google 20%，整數百分比合計 100；`gemini-3-pro` 只出現在 AGY 時來源欄為 Antigravity；`claude-opus-5-5` 同時出現在兩個來源時分成兩列。再讓 packages/server/src/routes/dashboard.tsx 的顏色、名稱、供應商對照表與兩份來源順序清單改由來源表推導，不改版面。驗證：`bun test packages/server/src/routes/dashboard.test.ts` 全綠。

## 2. agent-sync.mjs 收集、上報與觸發

- [x] 2.1 依 design「通用上報腳本 agent-sync.mjs 與來源表」「AGY 用量換算：reasoning 併入 output」「Collector 版本：語意版本比較與 20.0.51」與規格「Canonical Antigravity snapshots」「Isolated Antigravity state」，在 packages/server/src/antigravity-usage.test.ts 以隔離 HOME、合成 ccusage（記錄 argv、可設定版本與輸出）與本機 loopback ingest 先寫失敗測試。案例如下：
  - 規格的 token 換算表：100／30／5／20／165 上報 output 40；200／50／0／0／250 上報 output 50；totalTokens 150 時拒收。
  - model 名稱清洗：`["Kimi K3 (Preview)", "gemini-3-pro", "gemini-3-pro", "()"]` 上報為 `["Kimi-K3-Preview", "gemini-3-pro"]`；`modelsUsed` 不是字串陣列時拒收。
  - collector 呼叫順序為 `--version` 後接 `antigravity daily --json --since --until --timezone`，從不以 `daily` 開頭。
  - 版本表：20.0.20、21.0.0、18.0.9 拒收且訊息含 `ccusage@20.0.51`；20.0.21、20.0.51、20.1.0 接受。
  - 各種不合格輸出都 exit 1，錯誤檔不含 collector 輸出。
  - 空 daily 印 `No Antigravity usage for today.` 並 exit 0。
  - `totals.unpricedModels` 出現時印出 model 名稱的提示。
  - request body 只含規定欄位。
  - 離線時先存 100、下一次存 200，最後送出的是 200。
  - AGY 失敗時 `buffer.jsonl` 與 `codex-buffer.jsonl` 位元組不變。
  - 兩個 worker 並行時只有一個拿到 `antigravity-worker.lock`。
  - 驗證：該檔先全紅。
- [x] 2.2 實作 packages/server/src/hook-scripts/agent-sync.mjs 的手動模式（`<source>`）與 worker 模式（`--worker <source>`），寫入 `antigravity-*` 狀態檔；在 packages/server/src/hook-scripts/agent-sync.d.mts 寫下 argv 契約；packages/server/src/scripts.ts 匯出腳本文字，packages/server/src/app.ts 新增 `/scripts/agent-sync.mjs` 路由。驗證：2.1 全綠；`node --check` 通過該檔；路由測試 GET `/scripts/agent-sync.mjs` 回 200，內容與原始檔逐字相同。
- [x] 2.3 依規格「Antigravity Stop hook never blocks Antigravity」與「Antigravity trigger throttle」，以及 design「觸發與節流：hook、搭便車、手動」，在 antigravity-usage.test.ts 先寫失敗測試，再實作 `--hook antigravity` 與 `--trigger`。
  - hook 模式：含 `secret prompt` 的 payload 只啟動一次 worker，stdout 恰為 `{"decision":"stop"}`，worker argv 只有 `--worker antigravity`；`secret prompt` 與 transcript 路徑不出現在任何檔案、argv、stdout、stderr；超過 64 KB 或 stdin 不關時 3 秒內 exit 0；worker 無法啟動時 stdout 不含 `continue`。
  - 節流：hook 啟動後 2 分鐘內的 `--trigger` 不再啟動 worker；時間戳在未來時照跑並覆寫；手動 sync 不讀也不寫節流檔。
  - `--trigger` 只在 `<root>/conversations` 存在或 `ANTIGRAVITY_DATA_DIR` 非空時啟動；只有 `~/.gemini/antigravity/bin` 時不建立任何 `antigravity-*` 檔；`--trigger` 不輸出、exit 0。
  - 驗證：antigravity-usage.test.ts 全綠。

## 3. Claude 與 Codex worker 的搭便車觸發

- [x] [P] 3.1 依規格「Trigger from Claude and Codex workers」，在 packages/server/src/claude-usage.test.ts 先寫失敗測試，再改 packages/server/src/hook-scripts/session-end.mjs：worker 持有鎖、跑完 `flushBuffer` 後，若 `agent-sync.mjs` 存在，以 detached、stdio ignore 啟動一次 `agent-sync.mjs --trigger`，不帶 model、transcript 或 payload；腳本不存在時不啟動任何程序；拿不到鎖的 worker 不觸發；Claude 的 `last-error.txt`、`buffer.jsonl`、`last-upload.txt` 與觸發前相同。同時把該腳本錯誤訊息中的已驗證版本清單加上 20.0.51，對齊 design「Collector 版本：語意版本比較與 20.0.51」。驗證：`bun test packages/server/src/claude-usage.test.ts` 全綠。
- [x] [P] 3.2 依規格「Trigger from Claude and Codex workers」，在 packages/server/src/codex-usage.test.ts 先寫失敗測試，再改 packages/server/src/hook-scripts/codex-sync.mjs：只在 `--worker` 模式的 sync 結束後（不論成敗）觸發一次 `agent-sync.mjs --trigger`；Codex 自身上報失敗時，`codex-last-error.txt` 仍為 Codex 的訊息，`codex-buffer.jsonl` 保留待送快照；腳本不存在時與改動前行為相同。狀態檔名、`codex-daily` 與 collector 驗證都不改；只把兩則安裝提示中的 `ccusage@20.0.20` 改成 `ccusage@20.0.51`，相關測試的預期字串同步更新。驗證：`bun test packages/server/src/codex-usage.test.ts packages/server/src/routes/source-aggregation.test.ts` 全綠，既有案例不需修改。

## 4. CLI：偵測、安裝、collector、status 與 sync

- [ ] [P] 4.1 依規格「Collector dependency」與 design「Collector 版本：語意版本比較與 20.0.51」，先在 packages/cli/src/collector.test.ts 寫失敗測試，再改 packages/cli/src/collector.ts：匯出 `parseCollectorVersion` 與 `compareCollectorVersion`，`COLLECTOR_VERSION` 改為 20.0.51，`ensureCollector` 接受「是否偵測到 AGY」。案例：缺 collector 時執行 `npm install -g ccusage@20.0.51`；18.0.9 不安裝且警告含 20.0.51；20.0.20 加上 AGY 時警告含 `Antigravity` 與安裝指令；20.0.20 沒有 AGY 時不警告；20.1.0 不動作；skip 環境變數只印指令；安裝後探測到 18.0.9 時結果為 unsupported_major。驗證：`bun test packages/cli/src/collector.test.ts` 全綠。
- [ ] [P] 4.2 依規格「Tool detection」與「Antigravity hook installation」，以及 design「CLI 來源表與 Antigravity 指令」「Antigravity hook 安裝：以 hook 名稱為 key」，先在 packages/cli/src/antigravity-hooks.test.ts 寫失敗測試，再實作 packages/cli/src/agent-sources.ts 與 packages/cli/src/antigravity-hooks.ts。
  - 偵測：`<root>/conversations` 存在、或 `agy`／`antigravity` 在 PATH 上，都算偵測到；只有 `~/.gemini/antigravity/bin` 不算。
  - `applyAntigravityHook`：已有 `my-linter-hook`、`safety-gate` 時兩者值與順序不變，`ccusage-tracker` 排在最後；重跑時 changed 為 false；舊 command 或多出的 `PostToolUse` 在原位置換成正規值；`enabled: false` 保留；非 JSON、非 object、或 `ccusage-tracker` 不是 object 時拋出要求修檔的錯誤；不寫 `timeout` 或 `matcher`。
  - `readAntigravityHookState` 與結果行：四種結果行逐字符合規格。
  - 驗證：該測試檔全綠。
- [ ] 4.3 依規格「Setup command」「Symlinked configuration files」「Antigravity hook installation」，先在 packages/cli/src/hooks.test.ts 寫失敗測試，再改 packages/cli/src/scripts.ts 與 packages/cli/src/hooks.ts。
  - `agent-sync.mjs` 回 404／410 時視為缺席：不寫 `~/.gemini/config/hooks.json`，結果行為 `Antigravity: hook not installed (this server does not provide agent-sync.mjs)`，Claude 與 Codex 照常安裝。
  - `installHook` 把 `agent-sync.mjs` 與 AGY hooks 檔納入同一筆交易，寫入前建立 `.backup`；第二個檔驗證失敗時第一個檔不留 `.tmp`、`.rollback`、`.backup`。
  - `~/.gemini/config/hooks.json` 是指向一般檔案的 symlink 時，寫穿 symlink 並印出 `Wrote through symlink:` 行。
  - `wireTools` 印出 Antigravity 結果行，`NO_TOOL_MESSAGE` 列出三種工具。
  - 驗證：`bun test packages/cli/src/hooks.test.ts` 全綠。
- [ ] 4.4 依規格「Setup command」「Noninteractive update」「Tool detection」，在 packages/cli/src/commands/setup.test.ts 與 packages/cli/src/commands/update.test.ts 先寫失敗測試，再改 packages/cli/src/commands/setup.ts 與 packages/cli/src/commands/update.ts，讓兩者共用 AGY 的偵測、安裝與 collector 流程。
  - 只有 `~/.gemini/antigravity-cli/conversations` 的機器：setup 寫入 hook、執行 collector、exit 0。
  - 三個設定檔都有第三方 hook 時連跑 update 兩次：三檔與 config 的 sha256 不變，tracker 項目各只出現一次。
  - server 沒有 agent-sync 時：保留舊的 `agent-sync.mjs`、不寫 AGY hooks 檔。
  - 三種工具都沒偵測到時：setup exit 0、update exit 非 0，且都印出提示。
  - 驗證：兩個測試檔全綠。
- [ ] 4.5 依規格「Status command」與「Antigravity command」，先在 packages/cli/src/commands/status.test.ts 與新檔 packages/cli/src/commands/sync.test.ts 寫失敗測試，再改 packages/cli/src/commands/status.ts、packages/cli/src/commands/sync.ts 與 packages/cli/src/index.ts。
  - status：Codex 為 20.0.51 時印 `Codex collector: installed (ccusage 20.0.51)`；Antigravity 區塊依序印六行；hook 停用與 collector 為 20.0.20 時的字串逐字符合規格；Codex 未偵測時先印 `Codex: not detected`，再印 Antigravity 區塊；AGY 未偵測時只印一行 `Antigravity: not detected`。
  - sync：`tracker sync agy` 與 `tracker sync antigravity` 都執行 `agent-sync.mjs antigravity` 並回傳其 exit code；腳本不存在時印規格字串並 exit 1；`tracker sync gemini` 印 `Usage: tracker sync codex|antigravity` 並 exit 1。
  - 說明文字含 `Report Antigravity usage now (manual fallback / debugging)`。
  - 驗證：兩個測試檔全綠；`node packages/cli/dist/index.js` 不帶參數時的輸出含該行。

## 5. 文件、實跑驗證與 Antigravity 實機驗收

- [ ] [P] 5.1 更新 README.md、packages/cli/README.md 與 CHANGELOG.md 的 Unreleased 段，寫明：
  - AGY 的接法：update 後重開 Antigravity；三種觸發方式。
  - `tracker sync antigravity`（別名 `agy`）。
  - collector 改為 20.0.51，且 20.0.21 起才支援 AGY。
  - 已知限制：Windows IDE 的 Stop hook 回報、未定價 model 成本算 0、第一次用 AGY 後要再跑一次 update。
  - 移除段落：手動刪掉 `~/.gemini/config/hooks.json` 的 `ccusage-tracker` key。
  - 依 design「接下一個工具的步驟」寫成開發者段落的五步清單。
  - 驗證：內容審閱；grep 三份文件都含 `sync antigravity` 與 `20.0.51`，且不再有「只支援 Claude 與 Codex」的敘述。
- [ ] 5.2 完整驗證，各命令輸出寫入 change 目錄的 verification.md：
  - `pnpm test`、`pnpm typecheck`、`pnpm build`、`pnpm --filter ccusage-tracker build` 全綠。
  - 以 built CLI 對 loopback server 做 smoke 測試，使用隔離 HOME（含 `~/.gemini/antigravity-cli/conversations`）與合成 ccusage：setup 後 `~/.gemini/config/hooks.json` 含 `ccusage-tracker`；update 兩次後各設定檔 sha256 不變；`tracker sync agy` 後 server 有一筆 `antigravity-daily`，儀表板 HTML 含 `Antigravity`。
  - 以本機真實 ccusage 20.0.51，對 loopback server 跑既有 `session-end.mjs` worker 與 `codex-sync.mjs`，確認兩支驗證器都接受 20.0.51 的真實輸出。
  - `spectra validate add-antigravity-usage` 通過。
  - 把 `#f0b800` 的儀表板截圖交給維護者以人眼確認。
- [ ] 5.3 Antigravity 實機驗收。需要一台裝有 Antigravity 且有對話資料的機器（提案時的開發機沒有）：
  - update 並重開後，Antigravity 的 Customizations > Hooks 列出 `ccusage-tracker`。
  - 一輪對話結束後產生 `antigravity-last-flush.txt` 並上報成功。
  - Antigravity 對 `{"decision":"stop"}` 沒有顯示 hook 錯誤，agent 正常停止。
  - 把 Antigravity 版本、平台與結果記入 verification.md。
  - 若輸出被拒，只改 `SOURCES` 裡的 `hookStdout` 常數並重跑 2.3 的測試；尚未驗收前，verification.md 標「未確認」。
