import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { getSetting } from "../settings";
import type { Database } from "bun:sqlite";

const ADMIN_KEY = "test-admin-key";

function authed(body?: unknown): RequestInit {
  return {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_KEY}`,
    },
    body: JSON.stringify(body),
  };
}

describe("Admin Settings API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.ADMIN_API_KEY = ADMIN_KEY;
    db = createDatabase(":memory:");
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
    delete process.env.ADMIN_API_KEY;
  });

  describe("GET /api/admin/settings", () => {
    it("should return 401 without a Bearer key", async () => {
      const res = await app.request("/api/admin/settings");
      expect(res.status).toBe(401);
    });

    it("should return 401 with a wrong Bearer key", async () => {
      const res = await app.request("/api/admin/settings", {
        headers: { Authorization: "Bearer wrong-key" },
      });
      expect(res.status).toBe(401);
    });

    it("should return monthly_budget_usd as null when unset", async () => {
      const res = await app.request("/api/admin/settings", {
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.monthly_budget_usd).toBeNull();
    });
  });

  describe("PUT /api/admin/settings/monthly_budget_usd", () => {
    it("should return 401 without a Bearer key", async () => {
      const res = await app.request("/api/admin/settings/monthly_budget_usd", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value: 2000 }),
      });
      expect(res.status).toBe(401);
      expect(getSetting(db, "monthly_budget_usd")).toBeNull();
    });

    it("should store the budget and return it on a subsequent GET", async () => {
      const put = await app.request("/api/admin/settings/monthly_budget_usd", authed({ value: 2000 }));
      expect(put.status).toBe(200);

      const get = await app.request("/api/admin/settings", {
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      });
      const body = await get.json();
      expect(body.monthly_budget_usd).toBe(2000);
    });

    it("should return 400 with a message for a negative value and keep the stored value", async () => {
      await app.request("/api/admin/settings/monthly_budget_usd", authed({ value: 2000 }));

      const res = await app.request("/api/admin/settings/monthly_budget_usd", authed({ value: -1 }));
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeTruthy();
      expect(getSetting(db, "monthly_budget_usd")).toBe("2000");
    });

    it("should return 400 for a non-numeric value and keep the stored value", async () => {
      await app.request("/api/admin/settings/monthly_budget_usd", authed({ value: 2000 }));

      const res = await app.request("/api/admin/settings/monthly_budget_usd", authed({ value: "abc" }));
      expect(res.status).toBe(400);
      expect(getSetting(db, "monthly_budget_usd")).toBe("2000");
    });

    it("should return 400 when value is missing", async () => {
      const res = await app.request("/api/admin/settings/monthly_budget_usd", authed({}));
      expect(res.status).toBe(400);
    });

    it("should accept 0 and report 0 on GET", async () => {
      await app.request("/api/admin/settings/monthly_budget_usd", authed({ value: 2000 }));

      const res = await app.request("/api/admin/settings/monthly_budget_usd", authed({ value: 0 }));
      expect(res.status).toBe(200);

      const get = await app.request("/api/admin/settings", {
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      });
      const body = await get.json();
      expect(body.monthly_budget_usd).toBe(0);
    });

    it("should reject a malformed JSON body with 400", async () => {
      const res = await app.request("/api/admin/settings/monthly_budget_usd", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });
  });
});
