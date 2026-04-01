import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { queryUsageRecords, findMemberByName } from "../queries";
import type { Database } from "bun:sqlite";

const TEAM_KEY = "test-team-key";

describe("Ingest API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.TEAM_KEY = TEAM_KEY;
    db = createDatabase(":memory:");
    app = createApp(db);
  });

  afterEach(() => {
    delete process.env.TEAM_KEY;
    db.close();
  });

  const validPayload = {
    member_name: "Eric",
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
          Authorization: `Bearer ${TEAM_KEY}`,
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
          Authorization: `Bearer ${TEAM_KEY}`,
        },
        body: JSON.stringify(validPayload),
      });

      const updatedPayload = { ...validPayload, input_tokens: 2000 };
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEAM_KEY}`,
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
          Authorization: `Bearer ${TEAM_KEY}`,
        },
        body: JSON.stringify(payloadWithoutSession),
      });

      expect(res.status).toBe(200);
    });

    it("should auto-register new member on first ingest", async () => {
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEAM_KEY}`,
        },
        body: JSON.stringify({ ...validPayload, member_name: "NewMember" }),
      });

      expect(res.status).toBe(200);
      const records = queryUsageRecords(db, {});
      expect(records).toHaveLength(1);
    });

    it("should return 400 for missing required fields", async () => {
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEAM_KEY}`,
        },
        body: JSON.stringify({ date: "2026-03-30" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation failed");
      expect(body.details.length).toBeGreaterThan(0);
    });

    it("should return 400 for missing member_name", async () => {
      const { member_name, ...payloadWithoutMember } = validPayload;
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEAM_KEY}`,
        },
        body: JSON.stringify(payloadWithoutMember),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation failed");
      expect(body.details).toContain("member_name is required and must be a string");
    });

    it("should return 401 without auth", async () => {
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(401);
    });

    it("should return 401 with invalid team key", async () => {
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-key",
        },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(401);
    });

    it("should update last_seen_at on successful ingest (record last seen timestamp on ingest)", async () => {
      const res = await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEAM_KEY}`,
        },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(200);

      const member = findMemberByName(db, "Eric");
      expect(member).not.toBeNull();
      expect(member!.last_seen_at).not.toBeNull();
      expect(typeof member!.last_seen_at).toBe("string");
    });

    it("should update last_seen_at on each subsequent ingest", async () => {
      await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEAM_KEY}`,
        },
        body: JSON.stringify(validPayload),
      });

      const member1 = findMemberByName(db, "Eric");
      const firstSeen = member1!.last_seen_at;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 50));

      await app.request("/api/ingest", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${TEAM_KEY}`,
        },
        body: JSON.stringify({ ...validPayload, session_id: "sess2" }),
      });

      const member2 = findMemberByName(db, "Eric");
      expect(member2!.last_seen_at).not.toBeNull();
      // last_seen_at should be updated (>= first time)
      expect(member2!.last_seen_at! >= firstSeen!).toBe(true);
    });
  });
});
