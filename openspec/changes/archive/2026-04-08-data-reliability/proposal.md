## Why

目前 SessionEnd hook POST 失敗時（server 斷線、網路異常、hook 設定錯誤），該次用量資料永久丟失且無人知曉。使用者剛遇到 `settings.json` 格式錯誤導致 hook 數天未觸發，dashboard 上完全沒有資料卻無法察覺。資料可靠性是所有上層功能的基礎——數字不對，其他功能都沒有意義。

## What Changes

- **本機暫存 + 重試**：hook POST 失敗時，將 payload 寫入本機暫存檔（`~/.config/ccusage-tracker/buffer.jsonl`）。下次 hook 觸發時，先嘗試送出暫存的 payload，再送當次的。超過 7 天的暫存紀錄自動清除。現有的 UPSERT 冪等性（`session_id: "daily"`）確保重複送出不會產生重複資料。
- **心跳 + 缺漏檢測**：Server 記錄每個成員最後一次成功回報的時間戳。Dashboard 成員表格新增「最後回報」欄位，超過 24 小時未回報的成員標記視覺警告。讓管理者能即時發現 hook 壞掉、設定錯誤、或未安裝的情況。

## Non-Goals

- 不做即時推播通知（Slack/Email 告警）——dashboard 上的視覺標記已足夠 5-10 人團隊
- 不做本機離線佇列系統——簡單的 JSONL 暫存檔足以應對短暫斷線，不需要完整的 message queue
- 不修改 `ccusage` 本身——只在 hook 腳本和 server 層面處理

## Capabilities

### New Capabilities

- `local-buffer`: SessionEnd hook 的本機暫存與重試機制，確保 POST 失敗時資料不丟失
- `gap-detection`: Server 端成員心跳追蹤與 dashboard 缺漏警告顯示

### Modified Capabilities

- `session-hook`: hook 腳本新增 POST 失敗暫存、啟動時重送暫存、暫存過期清理的行為
- `dashboard`: 成員表格新增「最後回報」欄位與超時警告標記

## Impact

- 受影響的 specs：`session-hook`（新增失敗處理行為）、`dashboard`（新增欄位與警告）
- 受影響的程式碼：
  - `packages/server/src/scripts.ts`（session-end.sh 腳本生成邏輯）
  - `packages/server/src/db.ts`（members 表新增 `last_seen_at` 欄位）
  - `packages/server/src/queries.ts`（ingest 時更新 last_seen_at、查詢時回傳該欄位）
  - `packages/server/src/routes/ingest.ts`（ingest 成功時更新心跳時間戳）
  - `packages/server/src/routes/dashboard.tsx`（成員表格新增欄位與警告樣式）
