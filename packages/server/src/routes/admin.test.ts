import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import type { Database } from "bun:sqlite";

const ADMIN_KEY = "test-admin-key";

describe("Admin API", () => {
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

  describe("POST /api/admin/members", () => {
    it("should create a member and return API key", async () => {
      const res = await app.request("/api/admin/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify({ name: "Eric" }),
      });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("Eric");
      expect(body.id).toBeTruthy();
      expect(body.api_key).toMatch(/^sk-tracker-/);
    });

    it("should return 409 for duplicate name", async () => {
      await app.request("/api/admin/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify({ name: "Eric" }),
      });

      const res = await app.request("/api/admin/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify({ name: "Eric" }),
      });

      expect(res.status).toBe(409);
      const body = await res.json();
      expect(body.error).toBe("member already exists");
    });

    it("should return 400 for missing name", async () => {
      const res = await app.request("/api/admin/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
    });

    it("should return 401 without auth", async () => {
      const res = await app.request("/api/admin/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Eric" }),
      });

      expect(res.status).toBe(401);
    });

    it("should return 401 with wrong admin key", async () => {
      const res = await app.request("/api/admin/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-key",
        },
        body: JSON.stringify({ name: "Eric" }),
      });

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/admin/members", () => {
    it("should list members without API keys", async () => {
      await app.request("/api/admin/members", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${ADMIN_KEY}`,
        },
        body: JSON.stringify({ name: "Eric" }),
      });

      const res = await app.request("/api/admin/members", {
        headers: { Authorization: `Bearer ${ADMIN_KEY}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveLength(1);
      expect(body[0].name).toBe("Eric");
      expect(body[0]).not.toHaveProperty("api_key");
      expect(body[0]).not.toHaveProperty("api_key_hash");
    });
  });
});
