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
  });
});
