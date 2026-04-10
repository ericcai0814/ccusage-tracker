import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { insertMember, hashApiKey, insertSessionMetrics, insertUsageRecord } from "../queries";
import type { Database } from "bun:sqlite";

describe("Weekly Report API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    delete process.env.DASHBOARD_PASSWORD;
    db = createDatabase(":memory:");
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
    delete process.env.DASHBOARD_PASSWORD;
  });

  function seedSessionData() {
    insertMember(db, "m1", "Eric", hashApiKey("key1"));
    insertMember(db, "m2", "Alice", hashApiKey("key2"));

    insertSessionMetrics(db, "m1", {
      member_name: "Eric",
      session_id: "s1",
      session_name: "debug feature",
      project: "ccusage-tracker",
      branch: "main",
      started_at: "2026-04-07T10:00:00Z",
      ended_at: "2026-04-07T11:30:00Z",
      duration_minutes: 90,
      turns: 15,
      user_messages: 15,
      assistant_messages: 14,
      tool_calls: { Bash: 10, Read: 5, Edit: 3 },
      tool_call_total: 18,
      tool_errors: 1,
      skills_invoked: ["commit"],
      files_read: 12,
      files_written: 2,
      files_edited: 5,
      has_commit: true,
    });

    insertSessionMetrics(db, "m2", {
      member_name: "Alice",
      session_id: "s2",
      session_name: "refactor auth",
      project: "ccusage-tracker",
      branch: "feat/auth",
      started_at: "2026-04-08T09:00:00Z",
      ended_at: "2026-04-08T10:00:00Z",
      duration_minutes: 60,
      turns: 20,
      user_messages: 20,
      assistant_messages: 19,
      tool_calls: { Bash: 5, Edit: 15 },
      tool_call_total: 20,
      tool_errors: 0,
      skills_invoked: ["commit", "review-pr"],
      files_read: 8,
      files_written: 1,
      files_edited: 10,
      has_commit: true,
    });

    insertUsageRecord(db, "m1", {
      member_name: "Eric",
      date: "2026-04-07",
      session_id: "cost-s1",
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_cost_usd: 0.05,
      models: ["claude-sonnet-4-6"],
    });
  }

  describe("GET /api/report/weekly", () => {
    it("should return HTML report for specific week with data", async () => {
      seedSessionData();
      const res = await app.request("/api/report/weekly?week=2026-W15");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");

      const html = await res.text();
      expect(html).toContain("Weekly Report");
      expect(html).toContain("2026-W15");
      expect(html).toContain("Eric");
      expect(html).toContain("Alice");
    });

    it("should show overview three-layer structure", async () => {
      seedSessionData();
      const res = await app.request("/api/report/weekly?week=2026-W15");
      const html = await res.text();

      expect(html).toContain("Sessions");
      expect(html).toContain("Total Hours");
      expect(html).toContain("Active Members");
      // Distribution bar
      expect(html).toContain("dist-seg");
      // Highlights
      expect(html).toContain("Longest session");
    });

    it("should show project activity section", async () => {
      seedSessionData();
      const res = await app.request("/api/report/weekly?week=2026-W15");
      const html = await res.text();

      expect(html).toContain("Project Activity");
      expect(html).toContain("ccusage-tracker");
    });

    it("should show session log section", async () => {
      seedSessionData();
      const res = await app.request("/api/report/weekly?week=2026-W15");
      const html = await res.text();

      expect(html).toContain("Session Log");
      expect(html).toContain("debug feature");
      expect(html).toContain("refactor auth");
      expect(html).toContain("Context %");
    });

    it("should show skill usage section with ranking", async () => {
      seedSessionData();
      const res = await app.request("/api/report/weekly?week=2026-W15");
      const html = await res.text();

      expect(html).toContain("Skill Usage");
      expect(html).toContain("commit");
      expect(html).toContain("skill-rank");
    });

    it("should return HTML for current week when no week param", async () => {
      const res = await app.request("/api/report/weekly");

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("text/html");
    });

    it("should return 400 for invalid week format", async () => {
      const res = await app.request("/api/report/weekly?week=2026-15");

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain("YYYY-Www");
    });

    it("should return 400 for completely invalid week", async () => {
      const res = await app.request("/api/report/weekly?week=invalid");

      expect(res.status).toBe(400);
    });

    it("should show empty state when no data for week", async () => {
      const res = await app.request("/api/report/weekly?week=2025-W01");

      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("No data available for this week");
    });

    it("should require auth when DASHBOARD_PASSWORD is set", async () => {
      process.env.DASHBOARD_PASSWORD = "secret123";
      const protectedApp = createApp(createDatabase(":memory:"));

      const res = await protectedApp.request("/api/report/weekly?week=2026-W15");
      expect(res.status).toBe(401);
    });

    it("should allow access with correct basic auth", async () => {
      process.env.DASHBOARD_PASSWORD = "secret123";
      const protectedDb = createDatabase(":memory:");
      const protectedApp = createApp(protectedDb);

      const credentials = Buffer.from("admin:secret123").toString("base64");
      const res = await protectedApp.request("/api/report/weekly?week=2026-W15", {
        headers: { Authorization: `Basic ${credentials}` },
      });

      expect(res.status).toBe(200);
      protectedDb.close();
    });

    it("should highlight high context sessions in session log", async () => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));

      insertSessionMetrics(db, "m1", {
        member_name: "Eric",
        session_id: "high-ctx-1",
        session_name: "long context session",
        project: "test",
        started_at: "2026-04-07T10:00:00Z",
        ended_at: "2026-04-07T12:00:00Z",
        duration_minutes: 120,
        turns: 25,
        context_estimate_pct: 85,
      });

      const res = await app.request("/api/report/weekly?week=2026-W15");
      const html = await res.text();

      expect(html).toContain("Session Log");
      expect(html).toContain("long context session");
      expect(html).toContain("85%");
      expect(html).toContain("ctx-warn");
    });

    it("should show unused skills detection", async () => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));

      // Historical session with extra skill
      insertSessionMetrics(db, "m1", {
        member_name: "Eric",
        session_id: "hist-skill",
        started_at: "2026-03-30T10:00:00Z",
        ended_at: "2026-03-30T11:00:00Z",
        skills_invoked: ["tdd", "architect"],
      });

      // Current week session
      insertSessionMetrics(db, "m1", {
        member_name: "Eric",
        session_id: "curr-skill",
        started_at: "2026-04-07T10:00:00Z",
        ended_at: "2026-04-07T11:00:00Z",
        skills_invoked: ["commit"],
      });

      const res = await app.request("/api/report/weekly?week=2026-W15");
      const html = await res.text();

      expect(html).toContain("Unused Skills");
      expect(html).toContain("tdd");
      expect(html).toContain("architect");
    });
  });
});
