import type { Database } from "bun:sqlite";

export const MONTHLY_BUDGET_KEY = "monthly_budget_usd";

export function getSetting(db: Database, key: string): string | null {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSetting(db: Database, key: string, value: string): void {
  db.run(
    `INSERT INTO settings (key, value, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET
       value = excluded.value,
       updated_at = excluded.updated_at`,
    [key, value]
  );
}

export function listSettings(db: Database): Record<string, string> {
  const rows = db.query("SELECT key, value FROM settings ORDER BY key").all() as { key: string; value: string }[];
  return rows.reduce<Record<string, string>>((acc, row) => ({ ...acc, [row.key]: row.value }), {});
}

// 設定值是 TEXT，寫入端可能是舊版或手改的資料庫 —— 解析不出數字就當作沒設定，
// 儀表板寧可不顯示預算，也不要拿 NaN 去算百分比。
export function getMonthlyBudgetUsd(db: Database): number | null {
  const raw = getSetting(db, MONTHLY_BUDGET_KEY);
  if (raw === null) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || raw.trim() === "") return null;
  return parsed;
}
