# Changelog

## [Unreleased]

本節功能尚未發布到 npm 或部署到 server；版本號維持不變。

### Added

- Codex 自動上報：`setup`／`update` 把 tracker 的 Stop 與 SessionEnd hook 以冪等方式 append 到 `$CODEX_HOME/hooks.json`，不再需要手改設定。安裝後在 Codex 內執行一次 `/hooks` 信任即可 —— Codex 會靜默略過未信任的 hook。不修改 `$CODEX_HOME/config.toml`，也不重排既有 hook 群組（信任 key 以群組索引組成）。
- `setup`／`update` 偵測本機有哪些工具（Claude Code、Codex），對每個偵測到的工具各自接線並印一行結果；兩者皆未偵測到時 `setup` 仍寫入設定並 exit 0，`update` 回傳非零。
- `setup`／`update` 統一處理 collector：缺 `ccusage` 時自動安裝已驗證的 `ccusage@20.0.20` 並印出所執行的指令；主版本不符只警告不替換；`CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1` 可跳過。安裝失敗不改變 exit code。
- `status` 新增 `Codex hooks:` 一行，從 Codex 的 `config.toml` 唯讀判讀 trust recorded／awaiting trust／disabled／not installed；未偵測到 Codex 時整段縮為單行 `Codex: not detected`。
- `tracker sync codex`：保留為手動補送與除錯入口（不受節流限制），可在未安裝或啟動 Claude Code 時同步 Codex 當日用量；正常運作不依賴它。
- Codex 腳本下載路由、獨立 buffer／鎖／成功與錯誤狀態；失敗可重試，非法格式與未知 collector major 會明確停止上報，不送假零。
- `tracker update`：零提示沿用設定，完整下載與驗證後才更新腳本，備份變更檔案並保留 config 原始位元組、buffer、sessions 與第三方 hooks。舊 server 缺少 Codex 路由時保留 Claude 功能並提示相容限制。

### Changed

- Codex 使用實測的 `ccusage@20.0.20 codex daily`：`{daily, totals}`、`costUSD`、`models` 物件；input 已排除 cache read，reasoning 已含於 output，不重複計數。沿用訂閱／OAuth 的本機紀錄，不需要模型 API key，不上傳對話內容。
- Claude 保留 legacy（major <=19）的 `daily --json --since` 路徑，major 20 使用明確來源的 `claude daily`，避免新版預設聚合把 Codex 重複算入。Claude `daily`／Codex `codex-daily` 分別 upsert，報表加總兩者。
- Tracker 維持 Node >=18；collector 有各自的環境要求。20.0.20 原生包實測平台為 macOS arm64。未採用要求 Node >=22 的獨立 `@ccusage/codex@19.0.0`。
- `codex-sync.mjs` 新增 `--hook` 進入點：讀 stdin 事件 JSON，只取 `hook_event_name`，Stop 與 SessionEnd 才啟動背景 worker；讀取、解析或驗證失敗一律 exit 0 且不寫錯誤檔，永不阻擋 Codex。stdin 內容不寫檔、不進 argv、不進任何訊息。
- Codex 的觸發式上報套用與 Claude 一致的 5 分鐘節流（`codex-last-flush.txt`），hook 與相容 `notify` 共用同一個窗口；手動 `sync codex` 不受限制。
- config.toml 的手動 `notify` 路徑標為 deprecated，僅為相容保留；偵測到 tracker 的 notify 時提示自行移除以免重複觸發，但不編輯 TOML。
- `settings.json` 與 `hooks.json` 屬於同一筆 staged 交易與 rollback：任一步失敗兩邊都回到原狀。舊 server 對 Codex 腳本回 404／410 時不寫 `hooks.json`。
- Codex hook 的 timeout 採 45 秒，與 Claude 端一致；hook 群組不含 `matcher` 鍵（Codex 的 Stop 不支援 matcher）。command 字串在 update 之間逐位元相同，腳本更新不需要重新信任。

### Fixed

- `setup`／`update` 遇到 symlink 的 `~/.claude/settings.json` 或 `$CODEX_HOME/hooks.json` 不再整筆拒寫：解析到真實檔案後寫穿，symlink 本身保留，`.backup` 放在真實檔案旁。斷鏈或指向目錄等非一般檔案仍拒絕整筆交易，訊息指出 symlink 的目標。dotfiles 使用者因此可以直接安裝與更新。
- 收集器步驟只在至少偵測到一個工具時執行：兩個工具都沒偵測到時不再執行一次當下無用的全域 `npm install -g`，也不探測 `ccusage`。
- 自動安裝收集器後重新探測到的版本會再驗一次主版本：PATH 上另一個 `ccusage` 先命中時回報 `unsupported_major` 並印出安裝指令，不再宣稱安裝完成、等到 `sync codex` 才失敗。
- Codex 結果行區分「已停用」與「未信任」：`config.toml` 的 tracker `hooks.state` 含 `enabled = false` 時印 `Codex: hooks installed but disabled in Codex`，不再要求使用者去跑 `/hooks`（與 `status` 一致）。
- server 對 Codex 腳本回 404／410 的相容訊息只在偵測到 Codex 時印，純 Claude 使用者不再同時看到「不支援 Codex」與「Codex: not detected」。
- `config.toml` 的 `notify` 掃描只在整行是 table 標頭（`[name]`）時中斷：`notify` 之前有跨行頂層陣列時不再漏印移除提示。
- 觸發式上報的節流不再把未來的時間戳當成「剛跑過」：時鐘往前跳後校回或 `~/.config` 跨機同步留下未來時間時，Codex hook 與 Claude Stop hook 都照常啟動 worker 並覆寫時間戳。
- 移除 reporter 精確 patch 白名單，依 legacy／major-20 指令系列及嚴格 schema 驗證判定可上報資料；保留未知 major 拒絕與來源隔離。真實 18.0.9 回歸及合成 20.0.21 相容／非法輸出測試涵蓋 Claude 與 Codex，不宣稱未測發佈包相容。
- 同日舊 buffer 不再覆寫新快照；兩個來源的 buffer 與同步互不覆蓋。
- Worker 使用原子鎖與互斥的過期鎖回收，避免並行同步刪掉另一個 worker 的鎖。
- `status` 隱藏 Team Key 內容，並顯示 Codex collector、待送筆數、錯誤與成功時間。

### Upgrade

對應 CLI 發布、server 部署後，既有成員執行：

```bash
npx ccusage-tracker@latest update
```

`@latest` 只選擇最新已發布 CLI，不會自行刷新 server 下發腳本；`update` 才會下載。首次安裝仍用 `npx ccusage-tracker@latest setup`。全域 CLI 更新是另一個步驟：`npm install -g ccusage-tracker@latest`，再跑 `tracker update`。

採用 Codex 的成員跑完 `update` 後，**在 Codex 內執行一次 `/hooks` 信任 ccusage-tracker 的項目**，再用 `status` 確認 `Codex hooks:` 顯示 trust recorded；collector 由 `setup`／`update` 自動安裝，不需要先手動裝。曾依舊版文件手動設定 `notify` 者，請自行從 `config.toml` 移除 tracker 那一項以免重複觸發（不移除也不會算錯，只是多跑）。同步只處理本機當日，不回補未上報歷史；成本為估算，非訂閱帳單。

回滾：以 `.backup` 還原 `hooks.json`，或刪除其中 tracker 的群組；舊 CLI 的 `sync codex` 與 `notify` 路徑仍可用。Windows／Linux 尚未實機驗證。

## [0.3.7] - 2026-08-19

治本收尾。0.3.5 / 0.3.6 都在調整 timeout 與觀測性，但沒有動到結構：只要上報還在 hook 的時間預算裡，`ccusage` 的耗時成長遲早會再次追上。

### Changed
- **上報改為背景 worker**（#5）：hook 程序只讀 stdin 然後把上報 detach 出去，自己立刻 `exit 0`。worker 自成 process group，脫離 Claude Code 的 hook timeout。

  | 指標 | 0.3.6 | 0.3.7 |
  |---|---|---|
  | session 結束等待 | ccusage 耗時（實測 4~11s，隨資料成長） | **0.04s**（不隨資料成長） |
  | `ccusage` 上限 | 25s | 120s |
  | 整體上限 | 40s（受 hook timeout 45s 箝制） | 180s（worker，不受箝制） |

  `ccusage` 每次執行都全量掃描歷史用量檔（開發機實測 782MB / 399 檔）。8s 上限被追上時造成漏報 9 天；放寬到 25s 只是把同一條線往後推。detach 之後 timeout 不再是會被追上的線。

- **`tracker status` 的 `Last upload:` 改名為 `Upload error:`**：新增「上次成功上報」後兩行都叫 Last upload 會被誤讀 —— 那正是 `Buffer: none` 當初的問題。

### Added
- **worker 檔案鎖**：SessionEnd 與 Stop 可能前後腳觸發，兩個 worker 會各自全量掃一次 `ccusage`（使用者感覺得到的 CPU），且 `flushBuffer` 結尾的整檔回寫會互相覆蓋。以 PID + 時效雙條件判斷：只看時效會在 worker 被 kill 後空等，只看 PID 會因 PID 被系統回收而誤判。上報是 upsert，搶不到鎖直接放棄不排隊。
- **`last-upload.txt` 成功時戳**：非同步帶來一個新的無聲路徑 —— worker 可能根本沒被啟動（spawn 被擋、機器立刻關機），那條路徑不會寫任何錯誤，於是「沒有失敗痕跡」不再等於「有送出去」。`tracker status` 顯示距今多久，超過 24 小時明講可能停擺。

### Upgrade
server 端部署後，成員重跑即可取得新腳本：

```bash
npx ccusage-tracker@latest setup
```

## [0.3.6] - 2026-08-18

承 0.3.5，收掉當時記錄下來、但沒有一併處理的三個已知問題。

### Fixed
- **buffer 積壓時上報仍可能被 `__deadline` 從中切斷**（#6）：最壞路徑是 `readStdin 1s + flushBuffer 15s + 當日快照 35s = 51s`，超過 `__deadline` 的 40s。時間一到 `process.exit(0)`，正在 await 的 `/api/ingest` 被切斷，而 `clearError()` 早在 `ccusage` 成功時就跑過，`last-error.txt` 不會留下痕跡 —— 與 0.3.5 修掉的是同一種靜默失效，只是觸發條件較窄（需要「buffer 非空」與「ccusage 慢」同時成立）。三項調整：
  - 當日快照移到 `flushBuffer` 之前。重送舊資料是次要目的，不該先吃掉 15s
  - `flushBuffer` 改依剩餘時間動態編預算，並逐筆收斂單次 timeout，確保它不會自己跨過 deadline（被中途切斷的話，連 buffer 的清理與回寫都不會執行）
  - `__deadline` 觸發時寫 `last-error.txt`。此路徑同樣沒有 payload 可退進 buffer

  未採用「`flushBuffer` 與當日快照併發」的方案：`flushBuffer` 結尾會整檔回寫 `buffer.jsonl`，而當日快照上報失敗時會 append 到同一個檔，併發會讓回寫吃掉剛存進去的快照。改為 36s 後 `__deadline` 已不該被觸發，它現在是「有東西卡住超出預期」的訊號。
- **`session-end.mjs` 每次執行噴 DEP0190 警告**（#7）：Node 22+ 對「`shell: true` 且傳非空 args 陣列」發出棄用警告。hook 掛在 SessionEnd / Stop，等於每次結束 session 都印在使用者眼前。指令與參數合成單一字串即可；`shell: true` 保留 —— Windows 上 npm 全域安裝的是 `ccusage.cmd`，不透過 shell 找不到。
- **`tracker status` 對 deadline 逾時給錯建議**：`last-error.txt` 現在有兩種來源，下一步完全不同（`ccusage` 取不到數 → 量它多久；deadline 到了 → `ccusage` 有跑完，卡的是送出那段）。一律給同一句建議會讓診斷資訊自己把人帶偏。

### Changed
- **兩支 hook 腳本抽成獨立 `.mjs` 檔**（#8）：先前以 `String.raw` 樣板存在 `scripts.ts` 裡，Bun 轉譯時把非 ASCII 一律轉成 `\uXXXX`，而 raw 樣板不會還原，這串字元原樣進到發出去的檔案。字串字面量裡的 node 解析時會解碼（所以 `last-error.txt` 的中文一直是對的），註解裡的就是死的亂碼 —— 偏偏 `~/.config/ccusage-tracker/session-end.mjs` 正是排查時第一個被打開的檔案。改以 text import 讀獨立檔案，912 個逸出歸零。

  範圍只有這兩支：`setup.sh` / `setup.ps1` / `uninstall.sh` / `session-end.sh` 用的是一般樣板，逸出在執行期就解碼回真字元，產出零逸出。

### Added
- `node --check` 語法檢查測試：腳本抽成獨立檔案後才做得到。這 357 行過去藏在樣板字串裡，語法錯誤只能等使用者裝上去才炸
- DEP0190 迴歸測試：掃描產生出來的腳本，確保 `shell: true` 不會再與 args 陣列同時出現
- `\uXXXX` 迴歸測試：確保腳本不會被搬回樣板字串

### Upgrade
server 端部署後，成員重跑即可取得新腳本：

```bash
npx ccusage-tracker@latest setup
```

## [0.3.5] - 2026-08-18

### Fixed
- **ccusage 逾時導致用量靜默漏報**：`session-end.mjs` 給 `ccusage` 的 8 秒上限太短。`ccusage` 每次執行都全量掃描歷史用量檔，耗時隨累積資料單調成長；資料量夠大的成員機器上實測需約 11 秒，會被穩定 SIGKILL。此路徑取不到 payload、連 `buffer.jsonl` 都寫不進，故障完全無聲 —— 用量停在某一天且無任何錯誤訊息（實際案例漏報 9 天才被發現）。三層上限一併放寬：

  | 位置 | 原值 | 新值 |
  |---|---|---|
  | `session-end.mjs` `spawnSync(ccusage)` | 8s | 25s |
  | `session-end.mjs` `__deadline` | 20s | 40s |
  | `settings.json` SessionEnd / Stop hook timeout | 25 | 45 |

  三層必須維持 `ccusage < __deadline < hook timeout` 的包含關係：`spawnSync` 是同步阻塞，外層 `__deadline` 的 `setTimeout` 排不進 event loop、救不了它；而 `__deadline` 一到就 `process.exit(0)`，若小於 `ccusage + 上報` 總和，放寬最內層等於白做。

### Added
- **`last-error.txt` 失效痕跡**：`ccusage` 取數失敗（逾時 / 非零結束 / 輸出無法解析）時寫入時間戳與原因，取數成功時清除。這是整條上報鏈上唯一「連 buffer 都寫不了」的環節，先前完全無跡可循
- **`tracker status` 顯示上報健康度**：新增 `Last upload`（有無失效痕跡）與 `Last hook run`（上次 hook 執行時間）。先前 status 五項全綠卻不代表用量有送出去，`Buffer: none` 更會被誤讀成好消息

### Fixed（續）
- **`ccusage: not found` 誤報**：`status.ts` 與 `setup.ts` 用 `Bun.spawnSync` 偵測 ccusage，但 bin 以 node 執行（shebang `#!/usr/bin/env node`、build `--target node`），`Bun` global 不存在會拋 `ReferenceError` 並被 `try/catch` 吞掉 —— 所有 npx 使用者一律被告知「ccusage 沒裝」，`setup` 也會誤警告。改用 `node:child_process` 的 `spawnSync`。此誤報會把診斷帶往錯誤方向，正好抵銷上面新增的診斷資訊
- 新增 `runtime.test.ts` 守住「發布的原始碼不得使用 Bun 全域 API」：測試在 bun 下跑、`Bun` global 存在，這類誤用在測試中完全看不出來，只有使用者裝了才會炸

### Upgrade
受影響成員請重跑（會同時更新 `session-end.mjs` 與 settings.json 的 hook timeout）：

```bash
npx ccusage-tracker@latest setup
```

日常自檢：`tracker status`；若 `ccusage` 耗時接近 25 秒需再次放寬上限。

## [0.3.4] - 2026-06-03

### Fixed
- **CLI 0.1.4**：修正 macOS/Linux/Windows 使用者目錄含空格時，Claude Code hook command 的 script path 會被 shell 拆成多個參數，導致 `node` 找不到腳本。`SessionStart` / `SessionEnd` / `Stop` 現在都輸出 `node "<path>" ...`。
- **Hook migration**：重跑 `npx ccusage-tracker@latest setup` 會把既有未加引號的 ccusage-tracker hook command 升級成 canonical quoted command。

### Upgrade
受影響成員請重跑：

```bash
npx ccusage-tracker@latest setup
```

## [0.3.3] - 2026-05-28

### Changed
- **CLI 0.1.3**：純文件版本，npm 頁面的 README 同步 0.3.2 行為。不含 functional 變更，不需重新跑 setup（0.1.2 用戶停留在原版即可）

## [0.3.2] - 2026-05-28

### Added
- **Stop hook + throttle**：每輪對話結束時跑 ccusage-tracker 的上報路徑（`Stop` hook），主程序仍活著、不會被 cancel；新增 `~/.config/ccusage-tracker/last-flush.txt` 做 5 分鐘 throttle 避免狂打 server。SessionEnd 保留為備援
- **`session-end.mjs` 加 `--mode` 參數**：`--mode=stop`（Stop hook，throttled、不刪 model file）與 `--mode=session-end`（SessionEnd，無 throttle、清 model file）
- **`spawnSync(ccusage)` 加 timeout**：8s 上限 + SIGKILL，避免 sync 阻塞 event loop 時內部 `__deadline` 無效
- **CLI 0.1.2 注入三條 hook**：原本只注入 SessionStart + SessionEnd，現在加 Stop hook 並把 SessionEnd 命令升級為帶 `--mode=session-end`
- **CLI 0.1.2 hook migration**：偵測到舊命令（無 `--mode`）時原地替換為新命令；舊使用者重跑 `npx ccusage-tracker@latest setup` 就會升級
- **`setup.sh` / `setup.ps1` 同步**：curl/irm 安裝路徑也注入 Stop hook 並做 migration

### Fixed
- **`Hook cancelled` 偶發**：SessionEnd 把網路 IO 放在退出路徑導致主程序退出時 race。Stop hook 接手後不再發生資料漏報

### Upgrade
成員請重跑安裝指令（會自動升級 hook 命令並新增 Stop hook，舊命令會被原地替換）：

```bash
npx ccusage-tracker@latest setup
```

## [0.3.1] - 2026-05-28

### Fixed
- **CLI 0.1.1**：修正 `ccusage-tracker setup` 在 piped stdin（CI/automation）下會卡在第二題的 silent fail。改用 readline 的 `Symbol.asyncIterator` 取代每題 `rl.question`/`rl.close()`，避免一次性灌入時 `line` event 比 `await` 註冊還快、被吞掉的 race。互動模式行為不變。

## [0.3.0] - 2026-05-28

### Added
- **npm 套件發布**：CLI 透過 npm 對外發布為 [`ccusage-tracker`](https://www.npmjs.com/package/ccusage-tracker)，一條跨平台指令安裝：`npx ccusage-tracker setup`（取代原本依平台分歧的 curl/irm 兩種方法）

### Changed
- **部署遷移至自架 dedicated server + custom domain**：從 Zeabur AWS Tokyo 共享叢集（`ccusage-tracker.zeabur.app`）搬到 Linode Seattle dedicated server（`https://cctracker.erictree.me`），未來搬遷不再受 Zeabur generated 子網域保留機制限制
- README 安裝/更新 hook 指南更新為 `npx ccusage-tracker` 流程
- root package 由 `ccusage-tracker` 改名為 `ccusage-tracker-monorepo` 以避免與發布到 npm 的 CLI 套件撞名（純內部變更，無外部影響）

### Fixed
- 修正 Dockerfile 啟動目錄為 `/app/packages/server`，使 Bun 讀到 `packages/server/tsconfig.json` 的 `jsxImportSource: hono/jsx` 設定；原本從 `/app` 啟動會 fallback 到 default React JSX runtime，載入 `dashboard.tsx` 時 crash

### Upgrade
成員請重跑安裝指令（會覆寫舊 config 與 hook script，本機 `buffer.jsonl` 不受影響，下次 session 結束會自動把切換期間累積的回報補回新站）：

```bash
npx ccusage-tracker@latest setup
```

### Known issues
- CLI 0.1.0 的 `setup` 在 piped stdin 無延遲狀態下會 silent fail（readline 緩衝邊緣情況）。互動使用不受影響，CI/automation 場景需等 0.1.1 修正。**已於 0.3.1 修復**。

## [0.2.1] - 2026-05-26

### Added
- **Session analytics**：接收 session 行為指標並產生週報（heatmap、異常閾值偵測）
- **Session metrics**：SessionEnd hook 萃取並上報 session metrics；SessionStart hook 記錄 model，SessionEnd 計算 context 佔比
- **週報重設計**：S29 風格、新區塊結構、移除無效指標，新增 Cost Snapshot 與 Footer
- **Dashboard ↔ 週報雙向導航**
- **Windows 支援**：上報腳本改為跨平台 Node.js（`session-start.mjs`），新增 Windows 安裝入口；`tracker setup` 補裝 SessionStart hook
- monorepo workspaces 配置

### Changed
- 簡化 session-ingest payload 構建，抽取 `touchMemberLastSeen`
- 簡化 session analytics：抽取異常閾值常數、優化 heatmap 迭代

### Fixed
- 修正 setup/uninstall script 的 SessionEnd hook 格式符合 Claude Code schema
- 修正 code review 發現的安全與健壯性問題

## [0.2.0] - 2026-04-02

### Added
- **本機暫存 + 重試**：SessionEnd hook POST 失敗時，payload 自動暫存到 `buffer.jsonl`，下次 session 結束時自動重送
- **心跳 + 缺漏檢測**：Server 記錄每位成員最後回報時間（`last_seen_at`），Dashboard 顯示 "Last Report" 欄位
- **Stale 警告**：成員超過 24 小時未回報，Dashboard 以警告色標示
- Report API（`/api/report/summary`）回傳 `last_seen_at` 欄位
- `tracker status` CLI 顯示本機暫存筆數
- DB 啟動 log 顯示實際使用的 DB 路徑

### Changed
- `insertUsageRecord` 改用 transaction 包裹 UPSERT + `last_seen_at` 更新
- SessionEnd hook 升級為 v2（含 buffer/retry/expire 邏輯）
- 暫存重送設 15 秒上限、7 天過期自動清理

### Fixed
- 修正 `settings.json` SessionEnd hook 格式錯誤（缺少 matcher + hooks 結構）

### Upgrade
成員需更新本機 hook 腳本：
```bash
curl -fsSL https://ccusage-tracker.zeabur.app/scripts/session-end.sh -o ~/.config/ccusage-tracker/session-end.sh
```

## [0.1.0] - 2026-03-31

### Added
- MVP：多人用量追蹤系統
- SessionEnd hook 自動上報每日 token 用量
- Web Dashboard（Cyber-Bio Noir 風格）：成員用量表格、每日走勢圖、成本佔比條
- REST API：ingest、report summary/daily、admin members
- 一鍵安裝/卸載腳本（`setup.sh`、`uninstall.sh`）
- CLI 工具（`tracker setup`、`tracker report`、`tracker status`）
- SQLite 儲存、TEAM_KEY 共享認證、Dashboard 選用 Basic Auth
- Zeabur Docker 部署（Dockerfile + zeabur.json）
