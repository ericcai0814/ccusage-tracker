## 1. DB Migration — last_seen_at 欄位

- [x] 1.1 在 `db.ts` 的 schema 初始化後新增 migration：執行 `ALTER TABLE members ADD COLUMN last_seen_at TEXT`（搭配欄位存在檢查，避免重複執行報錯）。對應設計決策「DB migration 使用 ALTER TABLE 加欄位」
- [x] 1.2 更新 `queries.ts` 的 `Member` interface，新增 `last_seen_at: string | null` 欄位
- [x] 1.3 更新 `queries.ts` 的 `UsageSummary` interface，新增 `last_seen_at: string | null` 欄位

## 2. Server 端 — Record last seen timestamp on ingest（心跳利用現有 ingest 請求，不新增 endpoint）

- [x] 2.1 在 `queries.ts` 的 `insertUsageRecord` 函式中，將 UPSERT usage_records 和 `UPDATE members SET last_seen_at = datetime('now') WHERE id = ?` 包在同一個 `db.transaction()` 內執行，確保原子性。對應設計決策「心跳利用現有 ingest 請求，不新增 endpoint」
- [x] 2.2 更新 `aggregateUsage` 查詢，JOIN members 時一併 SELECT `m.last_seen_at`，讓 dashboard 和 report 能取得該欄位

## 3. Report API

- [x] [P] 3.1 Include last_seen_at in report API responses：更新 `routes/report.ts` 的 `/api/report/summary` handler，確保回傳的 members 陣列中每個物件包含 `last_seen_at` 欄位
- [x] [P] 3.2 為 `/api/report/summary` 新增測試案例：驗證回傳 payload 中包含 `last_seen_at`（有值和 null 兩種情況）

## 4. 修改 Dashboard data display — Display last report time 與 Warn on stale members（Dashboard 警告閾值固定 24 小時）

- [x] 4.1 更新 dashboard data display：在 `routes/dashboard.tsx` 新增相對時間格式化函式（將 ISO 時間戳轉為「3 小時前」「2 天前」等人類可讀格式），不依賴外部套件
- [x] 4.2 成員表格新增「Last Report」欄位以 display last report time on dashboard，顯示 `last_seen_at` 的相對時間。`last_seen_at` 為 null 時顯示「Never」
- [x] 4.3 實作 warn on stale members：當 `last_seen_at` 為 null 或超過 24 小時前，該欄位以警告色（與 dashboard 現有紅色主題一致）標示
- [x] 4.4 更新 dashboard 測試：驗證成員表格包含 Last Report 欄位、stale 警告顯示邏輯

## 5. Hook 腳本 — Buffer failed POST payloads locally 與 Retry buffered payloads on next hook invocation（暫存格式選擇 JSONL 而非 SQLite）

- [x] 5.1 修改 `scripts.ts` 的 `generateSessionEndScript()`：buffer failed POST payloads locally — 在 curl POST 當次資料後，檢查 HTTP status code（改用 `curl -w '%{http_code}'` 取得），非 2xx 時將 payload 加上 `_buffered_at` 時間戳 append 到 `~/.config/ccusage-tracker/buffer.jsonl`
- [x] 5.2 新增 retry buffered payloads on next hook invocation 邏輯：進入重送前先 `set +e`，讀取 `buffer.jsonl`，逐行 POST（前景 curl，`--max-time 5`），記錄成功/失敗行號，迴圈結束後一次性寫入 temp file 並 `mv` 覆蓋原檔（避免逐行重寫）。整個重送迴圈以 `timeout 15` 包裹，結束後恢復 `set -e`。對應設計決策「重送策略：先送暫存再送當次」
- [x] 5.3 在重送邏輯後、資料收集前，新增 expire old buffered entries：移除 `buffer.jsonl` 中 `_buffered_at` 超過 7 天或 `_buffered_at` 缺失/無法解析的條目
- [x] 5.4 更新 hook 的 non-blocking execution 行為：重送階段前景執行（有 15 秒上限），當次 POST 維持背景執行（`&`）。確保 retry phase does not block indefinitely

## 6. 腳本生成與部署

- [x] [P] 6.1 確認 `GET /scripts/session-end.sh` endpoint 產生的腳本包含新的 buffer + retry 邏輯
- [x] [P] 6.2 更新 `tracker status` CLI 指令：顯示本機 buffer.jsonl 的暫存筆數（0 筆或檔案不存在時顯示「無暫存」）

## 7. 整合測試

- [x] 7.1 新增 `ingest.test.ts` 測試案例：驗證 ingest 成功後 member 的 `last_seen_at` 被更新（record last seen timestamp on ingest）
- [x] 7.2 新增 `queries.test.ts` 測試案例：驗證 `aggregateUsage` 回傳結果包含 `last_seen_at`
- [x] 7.3 端對端驗證：手動執行更新後的 session-end.sh 腳本，確認 buffer 寫入、重送、過期清理行為正確
