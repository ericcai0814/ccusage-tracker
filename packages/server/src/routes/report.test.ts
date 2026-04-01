import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { insertMember, hashApiKey, insertUsageRecord } from "../queries";
import type { Database } from "bun:sqlite";

const TEAM_KEY = "test-team-key";

describe("Report API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.TEAM_KEY = TEAM_KEY;
    db = createDatabase(":memory:");
    app = createApp(db);
    insertMember(db, "m1", "Eric", hashApiKey("dummy-m1"));
    insertMember(db, "m2", "Alice", hashApiKey("dummy-m2"));

    insertUsageRecord(db, "m1", {
      member_name: "Eric",
      date: "2026-03-28",
      session_id: "s1",
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_tokens: 10,
      cache_read_tokens: 20,
      total_cost_usd: 0.01,
      models: ["claude-sonnet-4-6"],
    });
    insertUsageRecord(db, "m1", {
      member_name: "Eric",
      date: "2026-03-30",
      session_id: "s2",
      input_tokens: 200,
      output_tokens: 100,
      cache_creation_tokens: 20,
      cache_read_tokens: 40,
      total_cost_usd: 0.02,
      models: ["claude-opus-4-6"],
    });
    insertUsageRecord(db, "m2", {
      member_name: "Alice",
      date: "2026-03-30",
      session_id: "s3",
      input_tokens: 300,
      output_tokens: 150,
      cache_creation_tokens: 30,
      cache_read_tokens: 60,
      total_cost_usd: 0.03,
      models: ["claude-sonnet-4-6"],
    });
  });

  afterEach(() => {
    db.close();
    delete process.env.TEAM_KEY;
  });

  describe("GET /api/report/daily", () => {
    it("should return records within date range", async () => {
      const res = await app.request("/api/report/daily?from=2026-03-30&to=2026-03-30", {
        headers: { Authorization: `Bearer ${TEAM_KEY}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.records).toHaveLength(2);
    });

    it("should filter by member name", async () => {
      const res = await app.request("/api/report/daily?member=Eric", {
        headers: { Authorization: `Bearer ${TEAM_KEY}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.records).toHaveLength(2);
      expect(body.records.every((r: { member_id: string }) => r.member_id === "m1")).toBe(true);
    });

    it("should return 404 for unknown member", async () => {
      const res = await app.request("/api/report/daily?member=Unknown", {
        headers: { Authorization: `Bearer ${TEAM_KEY}` },
      });

      expect(res.status).toBe(404);
    });

    it("should return 401 without auth", async () => {
      const res = await app.request("/api/report/daily");
      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/report/summary", () => {
    it("should return summary for period=today", async () => {
      const res = await app.request("/api/report/summary?period=today", {
        headers: { Authorization: `Bearer ${TEAM_KEY}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.period).toBe("today");
      expect(body).toHaveProperty("total_cost_usd");
      expect(body).toHaveProperty("total_tokens");
      expect(body).toHaveProperty("active_members");
      expect(body).toHaveProperty("members");
    });

    it("should return summary for period=month", async () => {
      const res = await app.request("/api/report/summary?period=month", {
        headers: { Authorization: `Bearer ${TEAM_KEY}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.period).toBe("month");
      expect(body.members.length).toBeGreaterThanOrEqual(0);
    });

    it("should default to month when no period specified", async () => {
      const res = await app.request("/api/report/summary", {
        headers: { Authorization: `Bearer ${TEAM_KEY}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.period).toBe("month");
    });

    it("should return 401 without auth", async () => {
      const res = await app.request("/api/report/summary");
      expect(res.status).toBe(401);
    });

    it("should include last_seen_at for members with ingest history", async () => {
      // Insert a record for today so it appears in the default month period
      const today = new Date().toISOString().slice(0, 10);
      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: today,
        session_id: "today-s1",
        input_tokens: 50,
        output_tokens: 25,
        cache_creation_tokens: 5,
        cache_read_tokens: 10,
        total_cost_usd: 0.005,
        models: ["claude-sonnet-4-6"],
      });

      const res = await app.request("/api/report/summary?period=month", {
        headers: { Authorization: `Bearer ${TEAM_KEY}` },
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.members.length).toBeGreaterThan(0);
      for (const member of body.members) {
        expect(member).toHaveProperty("last_seen_at");
        expect(typeof member.last_seen_at).toBe("string");
      }
    });
  });
});
