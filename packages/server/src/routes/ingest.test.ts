import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { insertMember, hashApiKey, queryUsageRecords } from "../queries";
import type { Database } from "bun:sqlite";

const MEMBER_API_KEY = "sk-tracker-test123";

describe("Ingest API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    db = createDatabase(":memory:");
    app = createApp(db);
    insertMember(db, "m1", "Eric", hashApiKey(MEMBER_API_KEY));
  });

  afterEach(() => {
    db.close();
  });

  const validPayload = {
    date: "2026-03-30",
    session_id: "sess1",
    input_tokens: 1000,
    output_tokens: 500,
    cache_creation_tokens: 100,
    cache_read_tokens: 200,
    total_cost_usd: 0.05,
    models: ["claude-sonnet-4-6"],
  };

  describe("POST /api/ingest", () => {
    it("should accept valid ingest request", async () => {
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MEMBER_API_KEY}`,
        },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });

      const records = queryUsageRecords(db, {});
      expect(records).toHaveLength(1);
      expect(records[0].input_tokens).toBe(1000);
    });

    it("should handle idempotent upsert", async () => {
      await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MEMBER_API_KEY}`,
        },
        body: JSON.stringify(validPayload),
      });

      const updatedPayload = { ...validPayload, input_tokens: 2000 };
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MEMBER_API_KEY}`,
        },
        body: JSON.stringify(updatedPayload),
      });

      expect(res.status).toBe(200);

      const records = queryUsageRecords(db, {});
      expect(records).toHaveLength(1);
      expect(records[0].input_tokens).toBe(2000);
    });

    it("should accept request without session_id", async () => {
      const { session_id, ...payloadWithoutSession } = validPayload;
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MEMBER_API_KEY}`,
        },
        body: JSON.stringify(payloadWithoutSession),
      });

      expect(res.status).toBe(200);
    });

    it("should return 400 for missing required fields", async () => {
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${MEMBER_API_KEY}`,
        },
        body: JSON.stringify({ date: "2026-03-30" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation failed");
      expect(body.details.length).toBeGreaterThan(0);
    });

    it("should return 401 without auth", async () => {
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(401);
    });

    it("should return 401 with invalid API key", async () => {
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer invalid-key",
        },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(401);
    });
  });
});
