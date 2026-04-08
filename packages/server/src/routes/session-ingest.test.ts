import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { findMemberByName } from "../queries";
import type { Database } from "bun:sqlite";

const TEAM_KEY = "test-team-key";

describe("Session Ingest API", () => {
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
    session_id: "sess-abc-123",
    started_at: "2026-04-07T10:00:00Z",
    ended_at: "2026-04-07T11:30:00Z",
    session_name: "debug login",
    project: "ccusage-tracker",
    branch: "main",
    duration_minutes: 90,
    turns: 15,
    user_messages: 15,
    assistant_messages: 14,
    user_avg_chars: 120,
    tool_calls: { Bash: 10, Read: 5, Edit: 3 },
    tool_call_total: 18,
    tool_errors: 1,
    skills_invoked: ["commit", "review-pr"],
    hook_blocks: 0,
    files_read: 12,
    files_written: 2,
    files_edited: 5,
    has_commit: true,
  };

  const authHeaders = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TEAM_KEY}`,
  };

  describe("POST /api/ingest/session", () => {
    it("should accept valid session ingest request", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toEqual({ ok: true });

      const row = db.query("SELECT * FROM session_metrics WHERE session_id = ?").get("sess-abc-123") as any;
      expect(row).not.toBeNull();
      expect(row.turns).toBe(15);
      expect(row.tool_call_total).toBe(18);
      expect(row.has_commit).toBe(1);
      expect(JSON.parse(row.tool_calls)).toEqual({ Bash: 10, Read: 5, Edit: 3 });
      expect(JSON.parse(row.skills_invoked)).toEqual(["commit", "review-pr"]);
    });

    it("should accept minimal payload with only required fields", async () => {
      const minimal = {
        member_name: "Alice",
        session_id: "sess-minimal",
        started_at: "2026-04-07T10:00:00Z",
        ended_at: "2026-04-07T10:30:00Z",
      };

      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(minimal),
      });

      expect(res.status).toBe(200);

      const row = db.query("SELECT * FROM session_metrics WHERE session_id = ?").get("sess-minimal") as any;
      expect(row).not.toBeNull();
      expect(row.turns).toBe(0);
      expect(row.tool_call_total).toBe(0);
      expect(row.has_commit).toBe(0);
    });

    it("should return 400 for missing member_name", async () => {
      const { member_name, ...payload } = validPayload;
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("validation failed");
      expect(body.details).toContain("member_name is required and must be a string");
    });

    it("should return 400 for missing session_id", async () => {
      const { session_id, ...payload } = validPayload;
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toContain("session_id is required and must be a string");
    });

    it("should return 400 for missing started_at and ended_at", async () => {
      const { started_at, ended_at, ...payload } = validPayload;
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toContain("started_at is required and must be a string");
      expect(body.details).toContain("ended_at is required and must be a string");
    });

    it("should return 400 for negative numeric values", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ ...validPayload, turns: -5 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toContain("turns must be a non-negative integer");
    });

    it("should return 400 for non-integer numeric values", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ ...validPayload, files_read: 3.5 }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toContain("files_read must be a non-negative integer");
    });

    it("should return 400 for non-object tool_calls", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ ...validPayload, tool_calls: "not an object" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toContain("tool_calls must be an object");
    });

    it("should return 400 for array tool_calls", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ ...validPayload, tool_calls: [1, 2, 3] }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toContain("tool_calls must be an object");
    });

    it("should return 400 for non-array skills_invoked", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ ...validPayload, skills_invoked: "commit" }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details).toContain("skills_invoked must be an array of strings");
    });

    it("should return 401 without auth", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(401);
    });

    it("should return 401 with invalid team key", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-key",
        },
        body: JSON.stringify(validPayload),
      });

      expect(res.status).toBe(401);
    });

    it("should auto-create member on first session ingest", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ ...validPayload, member_name: "NewMember" }),
      });

      expect(res.status).toBe(200);

      const member = findMemberByName(db, "NewMember");
      expect(member).not.toBeNull();

      const row = db.query(
        "SELECT * FROM session_metrics WHERE member_id = ?"
      ).get(member!.id) as any;
      expect(row).not.toBeNull();
    });

    it("should handle idempotent re-ingest (UPSERT)", async () => {
      await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(validPayload),
      });

      const updatedPayload = { ...validPayload, turns: 25, tool_errors: 3 };
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(updatedPayload),
      });

      expect(res.status).toBe(200);

      const rows = db.query("SELECT * FROM session_metrics WHERE session_id = ?").all("sess-abc-123");
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).turns).toBe(25);
      expect((rows[0] as any).tool_errors).toBe(3);
    });

    it("should collect all validation errors at once", async () => {
      const res = await app.request("/api/ingest/session", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          turns: -1,
          tool_calls: "bad",
          skills_invoked: 123,
        }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.details.length).toBeGreaterThanOrEqual(5);
    });
  });
});
