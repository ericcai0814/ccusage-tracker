## Context

ccusage-tracker 目前的 SessionEnd hook 由三處 bash script 構成：

- Server 端的 `packages/server/src/scripts.ts` 用 template string 生成 `setup.sh`、`uninstall.sh`、`session-start.sh`、`session-end.sh`
- 透過 server route 暴露為 `/setup.sh`、`/scripts/session-end.sh` 等 endpoint
- 成員機器上以 `bash /Users/.../session-end.sh` 字面字串寫入 `~/.claude/settings.json`

此架構在 macOS 與 Linux 上運作良好，但在 Windows 上：

- `curl | bash` 無法在 cmd.exe / PowerShell 執行
- 即使透過 Git Bash 安裝，`jq` 仍需手動安裝
- Hook command 字面綁定 `bash`，需要 Claude Code Windows process 能找到 `bash.exe`
- Hook 失敗時靜默 exit 0，非技術成員無從察覺

額外的長期痛點：

- `scripts.ts` 是 460 行的 template string，無 type check、無 IDE 支援、改起來像踩雷
- Hook 邏輯更新需要每位成員手動 `curl -o` 覆寫本機檔案（README 第 90 行的指令）
- Server 對 hook 程式碼有寫權限，安全模型偏弱

**Stakeholders：** 既有 mac/Linux 成員（須無痛遷移）、Windows 非技術成員（首次安裝可用）、server 維護者（減少 attack surface）。

## Goals / Non-Goals

**Goals:**

- Windows 成員可在 PowerShell 一行指令完成安裝，無須裝 Git Bash 或 jq
- 移除 `bash` 與 `jq` 兩項 runtime 依賴
- Hook 邏輯有版本號、可透過 `npm update -g` 統一更新、可 pin 版本
- 既有 mac/Linux 成員重跑 setup 即自動完成遷移，舊 `settings.json` 自動覆寫並備份
- 安裝、卸載、更新流程在 macOS、Linux、Windows 三平台一致
- 移除 server 對 hook 程式碼的寫權限，配送通道改用 npm registry

**Non-Goals:**

- 不打包成單一執行檔（.exe / native binary） — 採用 npm 配送
- 不重寫或內建 `ccusage` — 維持為外部 npm 依賴
- 不變動 server `/api/ingest` 與 `/api/ingest/session` 的 wire format
- 不支援 Windows cmd.exe 原生互動式 setup（要求 PowerShell 或 Windows Terminal）
- 不支援沒有 Node 18+ 的環境
- 不變動 `buffer.jsonl` 既有 schema（新版 hook 必須能讀舊 buffer）

## Decisions

### 採用 CLI 子命令而非獨立 Node script

選擇 `tracker hook session-end` 作為 hook command，而非 `node ~/.config/ccusage-tracker/session-end.mjs`。

**理由：**

- CLI 子命令可透過 `npm update -g @ccusage-tracker/cli` 一次更新；獨立 script 需 server 維護 `/scripts/*` endpoint + 成員手動 `curl -o`，與現狀痛點未解
- Hook command 在 `settings.json` 是命名引用（`tracker hook session-end`），與檔案路徑解耦，遷移與重灌更乾淨
- 版本透過 `tracker --version` 可見、有 npm changelog、可被使用者審核
- 程式碼住在 `packages/cli/src/commands/hook/*.ts`，享有 TS type check、IDE 與單元測試

**Alternatives considered：**

- 獨立 Node script（方式 A）：否決，更新體驗未改善
- 維持 bash + 要求 Windows 成員裝 Git Bash + jq：否決，非技術成員無能力執行
- `bun build --compile` 出單一執行檔（方式 C）：推遲，需要三平台 CI binary 發布，當前 npm 配送已滿足

### 用 `child_process.execFile({ shell: true })` 呼叫 ccusage

Node 的 `execFile` 預設不解析 Windows 的 `.cmd` / `.bat`，但 ccusage 在 Windows 上是 `ccusage.cmd`。

**理由：**

- `shell: true` 讓 cmd.exe 處理副檔名 resolve，是跨平台最小阻力路徑
- 替代方案是手動偵測平台後指定完整檔名，更脆弱且與 npm bin 行為偏離
- 安全考量：所有 args 為受控字串（無外部輸入），不構成 command injection 風險

### Hook 失敗模式：靜默 + buffer，永遠 exit 0

維持目前 bash 版本的契約：永遠 exit 0，失敗的 payload 寫入 `buffer.jsonl`。

**理由：**

- Claude Code SessionEnd hook 不應 block process 退出
- 既有 mac/Linux 成員的心智模型是「hook 是看不見的」，加 log 反而嚇人
- 可診斷性透過新指令 `tracker status` 提供（讀 buffer 大小、最近 POST 結果）

### 舊 hook 遷移判準：command 字串前綴比對

Setup 跑到時，掃描 `settings.json` 內 `hooks.SessionEnd[].hooks[].command`，若 command 開頭為 `bash ` 且字串內含 `ccusage-tracker`，視為舊版。

**處理流程：**

1. 備份至 `settings.json.backup-pre-cli-migration`
2. 將舊 hook 條目的 `command` 改寫為 `tracker hook session-end`
3. 不刪除舊的 `~/.config/ccusage-tracker/session-end.sh` 檔（保留兩個 release cycle）
4. 提示使用者已遷移

**理由：** 字串前綴比對足以區分，且不需要解析 bash 內容；保留舊 .sh 提供 rollback 餘地。

### CLI 發行模式：plain Node ESM，不再 bun-target

`packages/cli` 從 `bun build --target bun` 改為 `tsc` 輸出 plain ESM，`package.json` 加 `"bin"`、`"publishConfig"`、`"engines.node": ">=18"`，shebang `#!/usr/bin/env node`。

**理由：**

- Bun-targeted output 在沒裝 Bun 的環境失敗，Windows PM 不會有 Bun
- Node 18+ 已支援 ESM、`fetch`、`AbortSignal.timeout`、`node:test`，足以涵蓋舊 bun-specific API
- 啟用 `npx @ccusage-tracker/cli@latest setup` 作為主要安裝路徑

### Setup 改為 `tracker setup --server-url <url>` 可選參數版

互動式為預設，但加入 `--server-url`、`--team-key`、`--name` 旗標允許非互動式安裝（例如未來 CI 部署）。

**理由：** 既有 setup 已是互動式，加 flag 是純向後相容的擴充；對 PM 仍然走互動式，對自動化場景開後門。

## Implementation Contract

**Observable behavior**

1. **安裝（任何平台）**：跑 `npx @ccusage-tracker/cli@latest setup` 後：
   - `~/.config/ccusage-tracker/config.json` 包含 `server_url`、`team_key`、`member_name`
   - `~/.claude/settings.json` 內 `hooks.SessionEnd` 與 `hooks.SessionStart` 各含一筆 `command: "tracker hook session-end"` / `command: "tracker hook session-start"`，既有其他 hook 不動
   - 若 `settings.json` 存在：建立 `settings.json.backup`（首次安裝）或 `settings.json.backup-pre-cli-migration`（從舊 bash 遷移）
   - 輸出 server 連線測試結果與 ccusage 是否安裝
2. **Session 結束**：Claude Code 觸發 `tracker hook session-end` 後：
   - Exit code 永遠 0
   - POST 成功時，server 收到與舊 bash hook byte-equal 的 JSON 到 `/api/ingest` 與 `/api/ingest/session`
   - POST 失敗時，payload 加 `_buffered_at` 後 append 到 `~/.config/ccusage-tracker/buffer.jsonl`
   - Buffer 內未過期（< 7 天）的條目於下次觸發時重送
3. **Session 開始**：`tracker hook session-start` 將 model 寫入 `~/.config/ccusage-tracker/sessions/<session_id>`，exit 0
4. **卸載**：`tracker uninstall`：
   - 從 `settings.json` 移除 ccusage-tracker 加入的 hook 條目（不動其他 hook）
   - 刪除 `~/.config/ccusage-tracker/` 目錄
   - `tracker` CLI 本身保留，須額外 `npm uninstall -g` 移除

**Interface / data shape**

- CLI commands：`tracker setup`、`tracker hook session-end`、`tracker hook session-start`、`tracker uninstall`、`tracker report`（既有）、`tracker status`（既有）
- Hook stdin payload：遵循 Claude Code SessionEnd/SessionStart 規範（含 `session_id`、`transcript_path`、`model`）
- `/api/ingest` body：`{ date, session_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_cost_usd, models, member_name }`（與現行一致）
- `/api/ingest/session` body：保留現行 bash hook `_post_session_metrics` 產出的所有欄位（`session_id`、`session_name`、`project`、`branch`、`turns`、`user_messages`、`assistant_messages`、`tool_calls`、`tool_call_total`、`tool_errors`、`started_at`、`ended_at`、`duration_minutes`、`has_commit`、`files_read`、`files_written`、`files_edited`、`skills_invoked`、`hook_blocks`、`member_name`、`model`、`context_estimate_pct`）
- `buffer.jsonl`：每行一個 JSON，schema 與既有 bash 版相同 + `_buffered_at` ISO8601 字串
- `settings.json` patch：deep merge，hooks.SessionEnd/SessionStart 為 array append

**Failure modes**

- `ccusage` 不在 PATH → hook silently exit 0
- `config.json` 不存在或缺欄位 → hook silently exit 0
- Server 不可達 → POST 失敗、寫 buffer、exit 0
- `transcript_path` 不存在或解析失敗 → session metrics 略過、daily POST 仍嘗試
- `settings.json` 不存在 → setup 建立 `{}` 後 patch
- `settings.json` 無法 parse → setup 顯示具體錯誤並 exit 1，不破壞檔案
- 偵測到舊 bash hook → 自動覆寫並建立 `settings.json.backup-pre-cli-migration`
- Windows 上 `ccusage` 為 `.cmd` → `shell: true` 處理
- npm registry 連不上 → README 提供 `npm install -g <tarball-url>` 退路

**Acceptance criteria**

- 在 macOS、Ubuntu 22.04、Windows 11 各跑一次 `npx @ccusage-tracker/cli@latest setup`，三平台都完成設定並寫入正確的 `settings.json`
- 既有 macOS 機器（有舊 bash hook）跑 `tracker setup` 後，`settings.json` 的 hook command 從 `bash <path>` 變為 `tracker hook session-end`，且 `settings.json.backup-pre-cli-migration` 存在
- Windows 11 上手動執行 `echo '{"session_id":"x","transcript_path":""}' | tracker hook session-end`，verify POST body 與 macOS 版本欄位相同
- `pnpm --filter @ccusage-tracker/cli test` 通過，含 hook session-end / session-start 單元測試、buffer 重送整合測試、舊 hook 偵測測試
- Server `/setup.sh`、`/uninstall.sh`、`/scripts/*` 路由刪除後，server build 與既有 server 測試通過
- README 安裝段落為單一一行 `npx` 指令

**In scope**

- CLI hook 子命令新增、setup 跨平台、舊 hook 偵測與遷移、server scripts 路由清理、npm 發行設定、README 重寫、跨平台手動驗證

**Out of scope**

- 改變 server API 行為（即使是新增欄位）
- 改變 Dashboard 顯示
- 改變 `buffer.jsonl` 格式（保持向後相容）
- Windows 提供 .exe / standalone binary
- 私有 npm registry 設定（保留為部署期決定）

## Risks / Trade-offs

- **既有成員忘記重跑 setup，舊 bash hook 持續運作但 server route 已被移除** → 兩階段發版：先發 0.3.0-rc.1（server 保留舊路由，CLI 已可用），觀察兩週後再發 0.3.0（移除 server 路由）
- **npm 配送對內部團隊敏感（server URL 不該公開）** → CLI 不嵌入 server URL，setup 互動式詢問；考慮發行至 private registry 或 GitHub Packages
- **Windows 上 `~/.claude/settings.json` 路徑可能因 Claude Code 版本差異而不一致** → 用 `os.homedir() + '/.claude/settings.json'` 為主要路徑；若不存在則檢查 `%APPDATA%\Claude\settings.json` 作為 fallback
- **移除 server `/setup.sh` 後既有 README link 失效** → 0.3.0-rc 階段保留路由但內容改為導引使用 npx
- **放棄 `curl | bash` 的「零依賴感」，要求 Node 18+** → 成員本來就需要 Node 跑 ccusage，未新增依賴
- **`shell: true` 在 Node 文件有 command injection 警告** → 所有 args 為受控字串、無外部輸入；可接受

## Migration Plan

1. **0.3.0-rc.1（內部驗證）**：發行新版 CLI 到 npm；server 同時保留新舊路由，`/setup.sh` 內容改為導引 npx 指令
2. **公告與導引**：團隊 Slack 訊息：「請跑 `npx @ccusage-tracker/cli@latest setup`，舊 hook 會自動換掉」
3. **觀察期（2 週）**：監看 dashboard 「stale > 24h」成員列表，主動聯絡未遷移者
4. **0.3.0（正式版）**：刪除 server `/setup.sh`、`/uninstall.sh`、`/scripts/*` 路由與 `scripts.ts`
5. **0.4.0**：setup 主動清理舊 `~/.config/ccusage-tracker/session-end.sh` 檔

**Rollback：** 若 npm 發行有問題，0.3.0-rc 階段 server 仍服務舊 setup.sh，既有成員不受影響；rollback 路徑為 `git revert` + 重新部署 server。
