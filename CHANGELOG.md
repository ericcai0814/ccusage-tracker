# Changelog

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
