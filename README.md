# ccusage-tracker

[![npm version](https://img.shields.io/npm/v/ccusage-tracker?color=cb3837&label=npm&logo=npm)](https://www.npmjs.com/package/ccusage-tracker)
[![npm downloads](https://img.shields.io/npm/dw/ccusage-tracker?color=cb3837&label=downloads&logo=npm)](https://www.npmjs.com/package/ccusage-tracker)
[![license](https://img.shields.io/github/license/ericcai0814/ccusage-tracker?color=blue)](./LICENSE)
[![node](https://img.shields.io/node/v/ccusage-tracker?logo=node.js&logoColor=white)](https://nodejs.org)
[![built with Bun](https://img.shields.io/badge/built%20with-Bun-fbf0df?logo=bun&logoColor=000)](https://bun.sh)
[![framework Hono](https://img.shields.io/badge/framework-Hono-E36002?logo=hono&logoColor=white)](https://hono.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![SQLite](https://img.shields.io/badge/SQLite-WAL-003B57?logo=sqlite&logoColor=white)](https://sqlite.org)
[![deploy Zeabur](https://img.shields.io/badge/deploy-Zeabur-6300FF)](https://zeabur.com)
[![Claude Code hook](https://img.shields.io/badge/Claude%20Code-Stop%20%2B%20SessionEnd%20hook-D97757)](https://www.anthropic.com/claude-code)
[![CHANGELOG](https://img.shields.io/badge/CHANGELOG-v0.3.4-informational)](./CHANGELOG.md)

> 團隊 Claude Code／Codex token 用量追蹤工具，基於 [ccusage](https://github.com/ryoppippi/ccusage) 建立多人彙整層。
> 沿用訂閱／OAuth 的本機用量紀錄，不需要模型 API key，不上傳對話內容。

`#claude-code` · `#ccusage` · `#token-usage` · `#self-hosted` · `#hono` · `#bun` · `#sqlite` · `#typescript` · `#zeabur`

## 它解決什麼問題

彙整團隊成員的 Claude Code 與 Codex 用量。兩邊都由每輪對話結束（Stop）與 session 結束（SessionEnd）的 hooks 自動上報，跑一次 `setup` 或 `update` 就接好；Codex 多一個平台強制的步驟：在 Codex 內執行一次 `/hooks` 信任。Codex 不需要安裝或啟動 Claude Code。

## 架構

```
成員的電腦                              中央 Server
┌─────────────────────────┐            ┌──────────────────────┐
│ Claude Code 每輪對話結束 │            │ Hono + Bun           │
│ --> Stop hook 觸發       │            │ --> SQLite 儲存       │
│     (5min throttle)     │            │ --> 更新 last_seen_at │
│ --> ccusage 取得 token   │   POST     │ --> Dashboard 顯示    │
│ --> 抽 session metrics   │ ────────>  │ --> Report API        │
│ --> fetch 上報           │            │                      │
│ --> 失敗時暫存到本機     │            │ (SessionEnd 兜底)    │
└─────────────────────────┘            └──────────────────────┘
```

### 技術棧

| 元件 | 技術 |
|------|------|
| Server | [Hono](https://hono.dev/) + [Bun](https://bun.sh/) |
| 資料庫 | bun:sqlite（SQLite WAL mode） |
| Dashboard | Hono JSX Server-Side Rendering |
| Hook | Node.js script（ccusage + fetch，跨平台 macOS/Linux/Windows） |
| 部署 | Zeabur（Docker container + persistent volume） |

### 資料流

1. Claude Code 每輪對話結束 --> 觸發 `Stop` hook（v0.3.2+ 主要路徑）
2. 檢查 `~/.config/ccusage-tracker/last-flush.txt`：距上次 < 5 分鐘就直接 `exit 0`（throttle）
3. 過 throttle 後立即寫 last-flush 戳記（避免 race / 失敗時連續打 server）
4. Hook 讀 stdin 取得 transcript 路徑與 session id，然後把上報 **detach 給背景 worker**，自己立刻 `exit 0`（實測約 0.04 秒）
5. Worker 自成 process group，脫離 hook timeout。以原子檔案鎖（PID + 時效）避免 SessionEnd 與 Stop 重複執行，過期鎖回收另有互斥保護
6. Worker 對 legacy（major <=19）保留 `ccusage daily --json --since YYYYMMDD`；major 20 明確使用 `ccusage claude daily`，加上當日 `--until` 與 `--timezone`。指令成功且輸出通過 Claude schema 驗證才上報（120 秒 timeout）；取數失敗時寫 `last-error.txt`
7. Worker 抽 session 行為指標（turns、tool_calls 等）+ POST 到 server 的 `/api/ingest` 與 `/api/ingest/session`（upsert，重複上報安全）
8. 上報成功寫 `last-upload.txt` 時戳；失敗時 payload 暫存到 `buffer.jsonl`，下次自動重送
9. 最後才處理 `buffer.jsonl` 的重送（上限 15 秒，並依剩餘時間動態縮減）。當日快照排在前面，才不會被積壓的舊資料吃掉時間預算
10. Worker 有 180 秒硬性上限，逾時直接結束並寫 `last-error.txt`
11. session 結束時，`SessionEnd` hook 跑一次「兜底」（無 throttle）— 若主程序退出 race 導致 Stop 最近沒跑成，這裡補上
12. Server 驗證 TEAM_KEY，自動建立/識別成員，寫入 SQLite，更新 `last_seen_at`
13. Dashboard / API 讀取 SQLite 產出報表，超過 24 小時未回報的成員顯示警告

> 為什麼要 detach：`ccusage` 每次執行都全量掃描歷史用量檔，耗時隨累積資料單調成長。只要上報還綁在 hook 的時間預算裡，timeout 就是一條會被追上的線，不是安全邊界。

### 隱私與成本

- 用量上報只傳成員／日期／來源、token 計數、模型名稱和成本估算；Claude 另保留既有 session 行為統計，不傳原始 prompt、回覆或工具結果
- Codex hook 事件（stdin JSON）與舊 notify payload 都可能含對話內容；tracker 只讀 `hook_event_name` 判斷事件種類，丟棄其餘內容，不寫入 buffer、argv 或日誌
- 金額是 collector 估算的 API 等值成本，不是 ChatGPT／Claude 訂閱帳單；不會呼叫模型 API
- Hook 失敗不影響 Claude Code 正常運作（永遠 exit 0）

## 成員安裝

首次使用先準備 [Node.js](https://nodejs.org)（tracker CLI >=18；collector 有自己的版本需求，見下方 Codex 章節）。

> 平台支援範圍：tracker CLI／腳本支援 macOS、Linux 與 Windows 路徑，但實機驗證只在 macOS 跑過（Node 24 與 Node 18.20.8，含帶空白的路徑）；Windows／Linux 尚未實機驗證。collector 的 `ccusage@20.0.20` 原生執行驗證平台為 macOS arm64。

```bash
npx ccusage-tracker@latest setup
```

會依序詢問：
- **Your name**：成員名字（會顯示在 dashboard）
- **Server URL**：團隊自架的 tracker 網址（例如 `https://cctracker.erictree.me`）
- **Team Key**：向管理員索取的 tracker 存取憑證，與模型 API key 無關

> 既有 `curl -fsSL <server>/setup.sh | bash` 與 PowerShell `irm <server>/setup.ps1 | iex` 仍是 Claude 安裝入口；它們不下載 Codex 腳本、不接 Codex hooks，也不是非互動更新。採用 Codex 請使用本版 CLI 的 setup／update。

### Setup 做了什麼

安裝腳本會依序執行以下操作：

| 步驟 | 動作 | 路徑/說明 |
|------|------|----------|
| 1 | 詢問名字、server URL、Team Key | 同時偵測本機有哪些工具（Claude Code／Codex），每個偵測到的工具各印一行結果 |
| 2 | 寫入設定檔 | `~/.config/ccusage-tracker/config.json` |
| 3a | 下載上報 scripts | `~/.config/ccusage-tracker/session-end.mjs`、`session-start.mjs`、支援時的 `codex-sync.mjs` |
| 3b | 注入 Claude 的 SessionStart + SessionEnd + Stop hook | 修改 `~/.claude/settings.json`（先備份；命令字串會自動 migrate 0.1.1 舊格式） |
| 3c | 注入 Codex 的 Stop + SessionEnd hook | append 到 `$CODEX_HOME/hooks.json`（先備份；不修改 `config.toml`）。之後要在 Codex 內跑一次 `/hooks` 信任 |
| 4 | 確認 collector | 只在偵測到工具時執行；缺 `ccusage` 時自動執行 `npm install -g ccusage@20.0.20` 並印出該指令。這是一次全域 npm 安裝，會從 registry 下載該套件並執行它的安裝期（lifecycle）腳本；不希望自動安裝的話，先設 `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1`，CLI 就只印指令 |
| 5 | 驗證 server 連線 | `GET /api/health` |

兩個工具都沒偵測到時，`setup` 仍會寫入設定並以 exit 0 結束，提示裝好工具後再跑 `update`；`update` 在同樣情況回傳非零。兩者在這種情況都不執行步驟 4 的收集器安裝。

`settings.json` 或 `hooks.json` 是 symlink（dotfiles 使用者常見）時，內容寫穿到 symlink 指到的真實檔案，symlink 本身保留，`.backup` 也放在真實檔案旁。斷鏈的 symlink 或指向目錄等非一般檔案一律拒絕並回滾整筆交易，訊息會指出 symlink 的目標。

> macOS/Linux 的 `setup.sh` 另會自動安裝 `jq`（brew/apt/apk）用於合併 `settings.json`；Windows 的 `setup.ps1` 改用 PowerShell 原生 JSON，不需 jq。兩者裝出的上報 hook 都是 `node session-end.mjs`。

### 安裝後的檔案

```
~/.config/ccusage-tracker/
  config.json          # server URL、team key、成員名字
  session-end.mjs      # 共用上報腳本（Stop 與 SessionEnd 都跑這個，靠 --mode 區分）
  session-start.mjs    # SessionStart hook script（記錄 model）
  codex-sync.mjs       # Codex 上報腳本（--hook 由 Codex hooks 觸發，無參數為手動同步）
  sessions/            # 各 session 的 model 暫存（SessionEnd 讀後清除）
  last-flush.txt       # Stop hook 上次上報時間戳（5min throttle 用）
  buffer.jsonl         # POST 失敗時的本機暫存（自動建立/清除）
  codex-buffer.jsonl   # Codex 獨立待送快照
  codex-last-error.txt # Codex 最近錯誤（無原始內容）
  codex-last-upload.txt # Codex 確認送達時間
  codex-last-flush.txt # Codex hook 上次觸發時間戳（5min throttle 用）

~/.claude/
  settings.json        # 被加入了 SessionStart + SessionEnd + Stop hooks
  settings.json.backup # 原始 settings.json 備份（只有 settings 真有變動時才產生）

$CODEX_HOME/           # 預設 ~/.codex
  hooks.json           # 被 append 了 tracker 的 Stop 與 SessionEnd hook
  hooks.json.backup    # 原始 hooks.json 備份（只有真有變動時才產生）
  config.toml          # tracker 只讀不寫；信任狀態由 Codex 自己記在這裡
```

### 更新 Hook 腳本

已有設定時使用零提示更新，不必重填名字、網址與 Team Key：

```bash
npx ccusage-tracker@latest update
```

`@latest` 執行 npm 最新**已發佈 CLI**，不會單憑這個標籤刷新 server 下發的 hooks。`update` 才會從設定中的原 server 下載腳本；新 hook 功能也需要 server 先部署對應版本。

`update` 與 `setup` 跑同一套流程：偵測工具、更新腳本、接上兩邊的 hooks、確認 collector。更新保留 `config.json` 原始位元組、兩個來源的 buffer、sessions 與第三方 hooks；`settings.json` 與 `hooks.json` 屬於同一筆交易，任一步失敗兩邊都回到原狀。既有的第三方 Codex hook 群組位元組不變、順序不動，tracker 只 append 到陣列尾端或就地替換自己那一份 —— Codex 的信任 key 以群組索引組成，重排會讓使用者其他 hook 全部變成「已修改」。`$CODEX_HOME/config.toml` 一律不修改。缺少／無效設定會要求先 setup 並回傳非零；下載或安裝失敗也會回傳非零。舊 server 的 Codex 路由回覆 404／410 時，保留 Claude 路徑、不寫 `hooks.json`（hook 指向不存在的腳本比沒有 hook 更糟），並明確提示不支援 Codex，其他下載錯誤不當成相容降級。

若習慣全域安裝，CLI 套件更新與 hook 更新是兩個步驟：

```bash
npm install -g ccusage-tracker@latest
tracker update
```

沒有通用的 `npx update` 指令；請使用上面的完整套件指令。

## Codex 用量同步

沿用已登入 ChatGPT 訂閱／OAuth 的 Codex CLI。本工具讀取既有本機 usage 紀錄，不需要 OpenAI API key，也不會登入或改寫 Codex 認證。

```bash
# 首次使用：填寫 tracker 連線設定；已有設定者改跑 update
npx ccusage-tracker@latest setup

# 接著在 Codex 內執行一次，信任 tracker 的 hooks
/hooks

npx ccusage-tracker@latest status
npx ccusage-tracker@latest report --period today --json
```

`setup`／`update` 會偵測 Codex、把 tracker 的 Stop 與 SessionEnd hook 接上，並在缺 collector 時自動安裝已驗證的 `ccusage@20.0.20`（一次全域 npm 安裝，會執行該套件的安裝期腳本；設 `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1` 可跳過，改為自行安裝）。既有使用者只需 `npx ccusage-tracker@latest update`，再依輸出在 Codex 內信任一次。

### 在 Codex 內信任一次（必要步驟）

Codex 會**靜默略過**尚未信任的新 hook —— 裝好了卻沒在跑，是這個功能最容易發生的失效。安裝或更新後，在 Codex 內執行 `/hooks` 並信任 ccusage-tracker 的項目，Codex 會把信任紀錄寫進自己的 `config.toml`。

`npx ccusage-tracker@latest status` 的 `Codex hooks:` 一行會顯示目前狀態：

| 輸出 | 意思 |
|---|---|
| `installed, trust recorded` | hooks 已安裝且找得到對應的信任紀錄 |
| `installed, awaiting trust (open /hooks in Codex)` | 兩條 hook 都還沒信任，Codex 現在不會執行它們 |
| `installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)` | 只信任了其中一條；逐 hook 指名還缺哪一條 |
| `installed, disabled in Codex` | 使用者在 Codex 內把它停用了 |
| `installed, Stop disabled in Codex, SessionEnd trusted` | 只停用了其中一條 |
| `not installed` | 還沒接上，跑 `update` |

tracker 只讀 `config.toml` 判斷有沒有信任紀錄，不驗證雜湊值（演算法是 Codex 內部實作），所以措辭是 trust recorded 而不是 trusted，也永遠不會替使用者寫入 `hooks.state`。

Codex hook 的 command 在每次 update 之間逐位元相同，腳本內容更新不需要重新信任；只有 hook 設定本身改變（例如從舊格式升級）才需要再信任一次。兩條 hook 的信任是分開記的，只信任其中一條時 `setup`／`update` 與 `status` 都會指名還缺哪一條。

> 請勿手動修改 tracker hook 的 command。辨識規則只認 `node "<path>/codex-sync.mjs" --hook` 這種標準形狀，以及舊版安裝器寫出的歷史形狀（直譯器須與副檔名相符，路徑須為單一 token，會就地升級成唯一一條）。路徑若未加引號又含空白（很舊的安裝器在含空白的家目錄下會寫出這種），不會被升級而是多 append 一條 —— 那種形狀與「把 tracker 路徑當參數傳給別的腳本」無法區分，寧可重複也不誤刪第三方 hook。加了自訂參數、包成複合命令，或引號外出現 `&&`、`;`、管線、重新導向等 shell 語法（無論中間有沒有空白），或命令中出現 shell 會重新解讀的字元（任何位置的 `$`、反引號 —— 雙引號內照樣展開；成對的 `%NAME%` 與任何位置的 `!` 這兩種 cmd.exe 展開，單獨的 `%` 不算；未加引號 token 裡的 brace／glob 與反斜線 —— shell 會展開或吃掉它們而執行到別的檔案，引號內則不受影響），都會被視為第三方 hook 而保留不動，tracker 另外 append 一份（與本機此刻會寫出的命令位元組相等者例外，一律辨識，重跑才會是 noop），變成重複觸發（由 5 分鐘節流與獨立鎖吸收，但狀態會變難讀）。

### 手動補送與除錯

`sync codex` 保留為手動補送與除錯入口，正常運作不依賴它：

```bash
npx ccusage-tracker@latest sync codex
```

它會等待結果並回傳真實的成功／失敗 exit code，且不受 5 分鐘節流限制 —— 想立刻確認最後用量時用它。

### 舊的 notify 設定（deprecated）

先前版本要求手動在 `$CODEX_HOME/config.toml` 加入 `notify = [... "--notify"]`。hooks 已接管自動上報，該路徑僅為相容保留。若你設定過，請自行從 `config.toml` 移除 tracker 那一項以免重複觸發；`setup`／`update` 偵測到時會提示，但**不會替你編輯 TOML**。即使沒移除也不會算錯：同日快照冪等、鎖互斥，而且兩條觸發路徑共用同一個 5 分鐘節流，只是多跑一次。

### 計數與相容範圍

| 來源／版本 | 實際執行與輸出 | tracker 行為 |
|---|---|---|
| Claude `ccusage 18.0.9`／`18.0.10` | `ccusage daily --json`；`daily`／`totals`、`totalCost`、`modelsUsed` | 保留 `daily` 身分；此 collector 自身要求 Node >=20.19.4 |
| Claude `ccusage 20.0.20` | 明確 `ccusage claude daily --json` | 不使用新版包含所有 agent 的預設 daily |
| Codex `ccusage 20.0.20` | 明確 `ccusage codex daily --json`；`daily`／`totals`、`costUSD`、`models` 物件 | 使用 `codex-daily`；input 已排除 cache read，直接映射 |

上表列的是 npm 發佈包與隔離 fixture 的驗證證據，不是精確 patch 白名單；20.0.20 原生執行驗證平台是 macOS arm64。執行期對 legacy（major <=19）嘗試原本的 Claude-only 指令，對 major 20 明確選擇 `claude daily`／`codex daily`，且每次驗證 JSON schema、日期與數值。`20.0.21` 僅以合成相容／不相容輸出測試，未實跑該發佈包，不保證未測版本相容。tracker CLI／腳本仍支援 Node 18；需安裝適合自己平台的 collector。`@ccusage/codex 19.0.0` 是另一個 bin 為 `ccusage-codex`、要求 Node >=22 的套件，本版未採用它；不能把它的 cachedInputTokens 格式套用到 20.0.20。未知 major（例如 99）、不支援的來源指令、JSON 或計數格式會留下錯誤並停止上報；不回退到 unified default daily。

Codex 原始 input 1000、cached input 400、output 200、reasoning 50，經 20.0.20 轉成 input 600 + cache read 400 + output 200 = **1200 tokens**。reasoning 已含在 output，cache creation 為零。同一成員／日期的 Claude `daily` 與 Codex `codex-daily` 各只有一筆；重送更新快照，報表相加一次。

同步當地時區的**當日**用量，不回補從未上報的歷史日期。collector 依 `CODEX_HOME` 讀取本機 logs；沒有可讀 usage 就顯示 no data，不送假零。請保留 Codex 原始 compact JSONL；實測此原生發佈包會略過部分重新排版、含空白的 JSONL。跨日仍需在有用量的當天觸發同步。server 的 Today 篩選沿用 UTC，與本機日期不同時可改看 month 或指定日期的 daily API。

Codex 使用獨立鎖與 `codex-buffer.jsonl`；同日舊快照先被新快照取代，再重送。buffer 保留到送達，不影響 Claude 的 buffer／5 分鐘 Stop throttle。Codex 的 hook 與相容 notify 觸發共用自己的 5 分鐘節流（`codex-last-flush.txt`），同來源同步中會略過重疊執行；手動 `sync codex` 不受節流限制，需要確認最後用量時用它。`sync codex` 回傳非零表示 collector、設定或送出失敗；用 `status` 查看 `codex-last-error.txt`、待送筆數與成功時間。Codex 不提供 session 行為分析。

若過期鎖回收中途被終止，可能留下 `codex-worker.lock.reclaim` 或 `worker.lock.reclaim`。只有在 recovery 錯誤持續、且已停止對應 workers 後，才移除該來源的 `.reclaim` 標記並重試。

## 卸載

卸載前請自行移除 `$CODEX_HOME/hooks.json` 內的 tracker 群組，以及（若設定過）`config.toml` 的 tracker `notify`；卸載腳本不修改 Codex 的 hooks.json 或 TOML。注意 Codex 的信任 key 以群組索引組成，移除中間的群組會讓其後的 hook 需要重新信任。

一行指令：

```bash
curl -fsSL https://cctracker.erictree.me/uninstall.sh | bash
```

卸載會：
1. 從 `~/.claude/settings.json` 移除 SessionStart + SessionEnd + Stop 三條 ccusage-tracker hook（不動其他 hook）
2. 刪除 `~/.config/ccusage-tracker/` 目錄（config + hook script + buffer + last-flush）

不影響 jq 和 ccusage，它們是獨立工具。

## 查看用量

### Dashboard

打開瀏覽器訪問：

```
https://cctracker.erictree.me
```

支援 Today / Week / Month 切換。Dashboard 包含：
- 摘要卡片：總成本、總 token、活躍成員數
- 每日走勢圖
- 成員用量表格（含 Last Report 欄位與 stale 警告）

### API

```bash
# 摘要報表（含 last_seen_at）
curl -H "Authorization: Bearer <TEAM_KEY>" \
  "https://cctracker.erictree.me/api/report/summary?period=month"

# 每日明細
curl -H "Authorization: Bearer <TEAM_KEY>" \
  "https://cctracker.erictree.me/api/report/daily?from=2026-03-01&to=2026-03-31"
```

### CLI

安裝（`setup`）後，可直接用 CLI 在終端機查看團隊用量，免開瀏覽器。bin 不在全域 PATH，請以 `npx ccusage-tracker@latest` 呼叫：

```bash
# 查看用量報表（預設 period 為 month）
npx ccusage-tracker@latest report

# 指定期間：today / week / month
npx ccusage-tracker@latest report --period today
npx ccusage-tracker@latest report --period week
npx ccusage-tracker@latest report --period month

# 以 JSON 輸出（方便接其他工具）
npx ccusage-tracker@latest report --period today --json

# 檢查本機設定、hook、server 連線、暫存筆數
npx ccusage-tracker@latest status
```

| 指令 | 參數 | 說明 |
|------|------|------|
| `report` | `--period <today\|week\|month>` | 查看團隊用量摘要表，預設 `month`；無效值自動 fallback 為 `month` |
| `report` | `--json` | 輸出原始 JSON（含每位成員的 input/output/cache token 與成本） |
| `status` | （無） | 顯示 config 路徑、成員名字、server 可達性與版本、`buffer.jsonl` 待送筆數、`ccusage` 是否安裝 |
| `setup` | （無） | 互動式設定 server 連線並注入 hook（見上方「成員安裝」） |
| `update` | （無） | 保留既有設定、零提示更新 server 下發腳本與 tracker hooks |
| `sync` | `codex` | 手動補送／除錯：立即同步 Codex 當日快照，回傳真實成功／失敗（正常運作不需要它） |

## 管理員

### 環境變數

| 變數 | 必填 | 說明 |
|------|------|------|
| `TEAM_KEY` | 是 | 共用認證金鑰，setup script 會自動嵌入 |
| `DB_PATH` | 是 | SQLite 路徑（設為 `/data/ccusage-tracker.db` 以使用 persistent volume） |
| `DASHBOARD_PASSWORD` | 否 | Dashboard Basic Auth 密碼（不設則公開） |
| `ADMIN_API_KEY` | 否 | 管理員 API（用於手動建立成員） |

### 本地開發

```bash
pnpm install
TEAM_KEY=dev-key pnpm --filter @ccusage-tracker/server dev

# 跑測試
pnpm -r test
```

## 專案結構

```
ccusage-tracker/
  packages/
    server/                  # Hono server
      src/
        app.ts               # 路由定義
        db.ts                # SQLite schema + migration
        queries.ts           # typed query helpers
        scripts.ts           # setup.sh/.ps1 + session-end.sh/.mjs 產生器
        middleware/
          team-auth.ts       # TEAM_KEY 認證
          admin-auth.ts      # ADMIN_API_KEY 認證
          dashboard-auth.ts  # Dashboard Basic Auth
        routes/
          ingest.ts          # POST /api/ingest
          report.ts          # GET /api/report/*
          admin.ts           # POST/GET /api/admin/members
          dashboard.tsx      # GET / (Hono JSX SSR)
    cli/                     # CLI 工具（setup/update/sync codex/report/status）
  Dockerfile                 # Bun + Alpine
  zeabur.json                # Zeabur 部署設定
  openspec/                  # Spectra SDD 規格文件
  CHANGELOG.md               # 版本紀錄
```

## FAQ

**Q: Hook 失敗會影響 Claude Code 嗎？**
不會。Hook script 永遠 `exit 0`，所有錯誤靜默處理。

**Q: Server 斷線會丟失資料嗎？**
POST 失敗時會暫存已取得的快照，下次觸發時重送。Claude 的 `buffer.jsonl` 保留 7 天；Codex 的 `codex-buffer.jsonl` 保留到送達。同日舊快照會被更新的累計值取代。collector 本身取數失敗時沒有快照可暫存，請用 `status` 檢查。

**Q: Dashboard 上成員顯示紅色警告是什麼意思？**
表示該成員超過 24 小時未回報。可能是 hook 壞掉、設定錯誤、或未安裝。請該成員執行 `npx ccusage-tracker@latest status` 檢查。

**Q: 重複上報會導致數據重複嗎？**
不會。Server 用 `(member_id, date, session_id)` 做唯一鍵，重複上報會覆蓋而非新增。

**Q: 成員需要手動建立嗎？**
不需要。第一次上報時 server 會自動建立成員。

**Q: 不想被追蹤怎麼辦？**
按照上方「卸載」步驟移除即可，30 秒內完成。

**Q: 如何更新 hook 到最新版？**
對應 CLI 發佈、server 部署後執行 `npx ccusage-tracker@latest update`；`@latest` 本身不會更新 hooks。缺少設定時先執行 setup。
