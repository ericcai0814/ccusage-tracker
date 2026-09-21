import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createDatabase } from "./db";
import { getSetting, setSetting, getMonthlyBudgetUsd } from "./settings";
import type { Database } from "bun:sqlite";

describe("Settings", () => {
  let db: Database;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("getSetting", () => {
    it("should return null for a missing key", () => {
      expect(getSetting(db, "monthly_budget_usd")).toBeNull();
    });

    it("should return the stored value", () => {
      setSetting(db, "monthly_budget_usd", "1000");
      expect(getSetting(db, "monthly_budget_usd")).toBe("1000");
    });
  });

  describe("setSetting", () => {
    it("should keep a single row and the latest value when written twice", () => {
      setSetting(db, "monthly_budget_usd", "1000");
      setSetting(db, "monthly_budget_usd", "2000");

      const rows = db.query("SELECT key, value FROM settings WHERE key = ?").all("monthly_budget_usd");
      expect(rows).toHaveLength(1);
      expect(getSetting(db, "monthly_budget_usd")).toBe("2000");
    });

    it("should refresh updated_at on overwrite", () => {
      setSetting(db, "monthly_budget_usd", "1000");
      db.run("UPDATE settings SET updated_at = '2000-01-01 00:00:00' WHERE key = ?", ["monthly_budget_usd"]);

      setSetting(db, "monthly_budget_usd", "2000");

      const row = db.query("SELECT updated_at FROM settings WHERE key = ?").get("monthly_budget_usd") as {
        updated_at: string;
      };
      expect(row.updated_at).not.toBe("2000-01-01 00:00:00");
    });

    it("should store unrelated keys side by side", () => {
      setSetting(db, "monthly_budget_usd", "2000");
      setSetting(db, "other_key", "hello");

      expect(getSetting(db, "monthly_budget_usd")).toBe("2000");
      expect(getSetting(db, "other_key")).toBe("hello");
    });
  });

  describe("getMonthlyBudgetUsd", () => {
    it("should return null when unset", () => {
      expect(getMonthlyBudgetUsd(db)).toBeNull();
    });

    it("should return the stored number", () => {
      setSetting(db, "monthly_budget_usd", "2000");
      expect(getMonthlyBudgetUsd(db)).toBe(2000);
    });

    it("should return 0 when the budget is cleared to 0", () => {
      setSetting(db, "monthly_budget_usd", "0");
      expect(getMonthlyBudgetUsd(db)).toBe(0);
    });

    it("should return null when the stored value is not a number", () => {
      setSetting(db, "monthly_budget_usd", "abc");
      expect(getMonthlyBudgetUsd(db)).toBeNull();
    });

    // 讀取端與 API 共用驗證，所以驗證只要誤拒，既存的合法預算就會整個消失
    [1.01, 12.34, 999.99, 12345.67, 1234567.89, 300000000.03, 599999999.95, 987654321.01, 999999999.99].forEach(
      (value) => {
        it(`should read back a stored budget of ${value}`, () => {
          setSetting(db, "monthly_budget_usd", String(value));
          expect(getMonthlyBudgetUsd(db)).toBe(value);
        });
      }
    );

    // 有人繞過 admin API 直接改表時，讀取端要套同一組範圍規則
    ["5e-324", "1e300", "0.001", "1000000001", "-1", "Infinity", "999999999.995"].forEach((stored) => {
      it(`should return null for an out-of-range stored value of ${stored}`, () => {
        setSetting(db, "monthly_budget_usd", stored);
        expect(getMonthlyBudgetUsd(db)).toBeNull();
      });
    });
  });
});
