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

// 預算會被拿去算百分比與月底推估。沒有上下限的話，1e308 之類的合法有限值會讓儀表板
// 算出 Infinity，5e-324 則會被格式化成 $0。0 保留為「清除」。
export const MIN_BUDGET_USD = 1;
export const MAX_BUDGET_USD = 1_000_000_000;

export function isValidBudget(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value === 0) return true;
  if (value < MIN_BUDGET_USD || value > MAX_BUDGET_USD) return false;
  // 只收到分：用浮點容差判斷，才不會誤殺 1.1 + 2.2 這種帶運算尾差的合法金額
  const cents = value * 100;
  return Math.abs(cents - Math.round(cents)) < 1e-6;
}

// 設定值是 TEXT，寫入端可能是舊版或手改的資料庫 —— 解析不出數字、或不在 API 允許的
// 範圍內（有人繞過 API 直接改表），一律當作沒設定，儀表板整段預算不顯示。
export function getMonthlyBudgetUsd(db: Database): number | null {
  const raw = getSetting(db, MONTHLY_BUDGET_KEY);
  if (raw === null || raw.trim() === "") return null;
  const parsed = Number(raw);
  if (!isValidBudget(parsed)) return null;
  return parsed;
}
