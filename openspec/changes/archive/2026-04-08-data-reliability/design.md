## Context

ccusage-tracker 的 SessionEnd hook 透過背景 `curl` 將用量 POST 到 server。目前若 POST 失敗（server 斷線、網路異常），payload 直接丟棄。此外，若 hook 本身未觸發（設定錯誤、格式問題），管理者無從察覺——dashboard 上只會顯示「沒有資料」，無法區分「沒用」和「資料丟失」。

現有架構：
- Hook 腳本：bash，由 `generateSessionEndScript()` 在 `scripts.ts` 動態生成
- Server：Hono + bun:sqlite，`POST /api/ingest` 接收資料後 UPSERT 到 `usage_records`
- Dashboard：SSR JSX，查詢 `aggregateUsage()` 顯示成員用量表

## Goals / Non-Goals

**Goals:**

- POST 失敗時 payload 不丟失，下次 hook 觸發時自動重送
- Dashboard 能識別出「應該有資料但沒有」的成員
- 不增加成員的安裝/設定步驟

**Non-Goals:**

- 不做完整的 offline queue / message broker
- 不做主動推播通知（Slack、Email）
- 不做 hook 健康度的 server-side 主動探測（pull 模式）
- 不修改已部署的 hook 腳本自動升級機制（成員需重新執行 setup 取得新腳本）

## Decisions

### 暫存格式選擇 JSONL 而非 SQLite

暫存檔使用 `~/.config/ccusage-tracker/buffer.jsonl`，每行一筆 JSON payload 加上 `_buffered_at` 時間戳。

理由：hook 是 bash 腳本，JSONL 只需 `echo >>` 寫入和 `while read` 讀取，不需額外二進制依賴。SQLite 需要 CLI 工具，增加安裝門檻。

替代方案：SQLite 本機 DB — 提供更好的查詢能力，但 bash 腳本中操作困難，且暫存資料量極小（最多 7 天 × 1 筆/天 = 7 筆），不需要資料庫。

### 重送策略：先送暫存再送當次

Hook 觸發時的執行順序：
1. 進入重送階段前先 `set +e`（停用 errexit），避免個別 curl 失敗導致整個 hook 中斷
2. 讀取 buffer.jsonl，逐行嘗試 POST（前景 curl，`--max-time 5`，檢查 HTTP status）
3. 迴圈中記錄成功/失敗行號，迴圈結束後一次性寫入 temp file 並 `mv` 覆蓋原檔（避免逐行重寫的 O(N²) I/O）
4. 清除超過 7 天的暫存紀錄（依 `_buffered_at` 判斷），`_buffered_at` 缺失或無法解析的條目視為過期移除
5. 恢復 `set -e`，收集當次用量、POST
6. 當次 POST 若失敗，寫入 buffer.jsonl（寫入失敗則靜默跳過）
7. 最後的步驟 5-6 維持背景執行（`&`），不阻塞 Claude Code

整個重送迴圈設定總時限 15 秒（`timeout 15`），超時則放棄本輪重送，暫存保留至下次。

替代方案：全部背景執行 — 無法判斷成功/失敗，無法決定是否移除暫存行。

### 心跳利用現有 ingest 請求，不新增 endpoint

Server 在 `insertUsageRecord` 中，將 UPSERT usage_records 和 `UPDATE members SET last_seen_at = datetime('now') WHERE id = ?` 包在同一個 transaction 內執行，確保原子性。不需要額外的 heartbeat API。

理由：每次 ingest 就代表 hook 活著。額外的 heartbeat endpoint 增加複雜度但不提供額外資訊。

替代方案：獨立 `POST /api/heartbeat` — 能偵測「hook 能跑但 ccusage 取不到資料」的情況，但這種情況極罕見且不值得增加 API 表面。

### Dashboard 警告閾值固定 24 小時

`last_seen_at` 與當前時間差超過 24 小時即標記警告。不做可設定的閾值。

理由：團隊成員每個工作日至少會用一次 Claude Code。24 小時是最自然的閾值——超過代表「昨天有用但今天沒資料」或「hook 壞了」。週末可能出現誤報，但這比漏報好。

### DB migration 使用 ALTER TABLE 加欄位

`members` 表新增 `last_seen_at TEXT` 欄位。使用 `ALTER TABLE members ADD COLUMN last_seen_at TEXT` 搭配 `CREATE TABLE IF NOT EXISTS` 後檢查欄位是否存在的方式執行 migration。

理由：SQLite 支援 `ALTER TABLE ADD COLUMN`，且只新增一個 nullable 欄位，不需要 migration framework。現有成員的 `last_seen_at` 初始為 NULL，dashboard 上顯示為「從未回報」。

## Risks / Trade-offs

- [Risk] 重送暫存期間 server 又斷線 → 暫存保留，下次再試。最多累積 7 天（7 筆），不會無限增長。
- [Risk] buffer.jsonl 寫入競爭（多個 Claude Code session 同時結束）→ `echo >>` 在 POSIX 上對小於 PIPE_BUF 的寫入是 atomic 的，單筆 JSON payload 遠小於此限制。讀-改-寫的 race condition（兩個 session 同時重寫 buffer）可能導致已送出的條目被復活，但 server 端 UPSERT 冪等性確保重複送出無害。
- [Risk] buffer.jsonl 寫入失敗（磁碟滿、權限不足）→ hook 靜默跳過，exit 0。資料丟失但不影響 Claude Code。
- [Risk] 新 hook 腳本需成員重新 setup → 在 CLI `tracker status` 中顯示 hook 版本，提示需要更新。暫不做自動升級。
- [Trade-off] 24 小時閾值在週末會產生誤報 → 可接受，誤報成本低（管理者忽略即可），漏報成本高。
