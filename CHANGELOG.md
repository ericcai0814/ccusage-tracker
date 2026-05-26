# Changelog

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
