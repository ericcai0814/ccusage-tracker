## 1. 平行實作與失敗測試

- [x] [P] 1.1 CLI owner 完成 Noninteractive update 與 Codex command and adoption、Setup command：完整下載後更新、手動同步與通知的 CLI 入口、設定／第三方 hook／buffer 保存與失敗非零；以 packages/cli/src 的暫存 HOME 與 Node CLI 測試驗證。
- [x] [P] 1.2 Collector owner 完成 Canonical Codex snapshots、Isolated retry and notification 與 Source-safe Claude daily snapshots、Report usage on session end、Non-blocking execution、Read hook payload 與 Privacy protection：來源隔離與格式驗證、canonical cached/reasoning 計數、獨立 buffer/lock/status、未知資料拒絕、舊快照不覆寫；以已發佈套件證據與實際 Node 腳本 mock HTTP 測試驗證。
- [x] [P] 1.3 Root owner 新增 Codex 腳本 HTTP 路由與真實 ingest/report 來源聚合回歸測試，驗證相同成員／日期的 daily 和 codex-daily 重送後僅兩筆且成本／token 相加正確。

## 2. 文件與完整驗證

- [x] 2.1 完成 README root/npm 與 CHANGELOG 的 setup/update/sync/notify/status、Node 條件、真實 collector 格式、估計成本、未發佈與 server 部署依賴說明；依實際已驗證命令人工核對。
- [x] 2.2 完成程式碼與隱私／失敗處理審查，執行 pnpm test、pnpm typecheck、CLI build、pnpm build、隔離 shell smoke 與 Node-built CLI update/Codex mock smoke；修正失敗直到全綠。
- [x] 2.3 同步規格與封存此 change，確認 apply all_done、spectra validate --specs 與 spectra list；檢查僅允許檔案有變更且無提交／部署。
