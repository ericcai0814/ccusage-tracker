import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createDatabase } from "./db";
import {
  insertMember,
  findMemberByApiKeyHash,
  findOrCreateMember,
  listMembers,
  insertUsageRecord,
  queryUsageRecords,
  aggregateUsage,
  aggregateUsageByDate,
  hashApiKey,
  insertSessionMetrics,
  getWeeklyOverview,
  getMemberComparison,
  getToolHeatmap,
  getAnomalousSessions,
  getSkillUsageSummary,
  getWeeklyCostTrend,
} from "./queries";
import type { Database } from "bun:sqlite";

describe("Query Helpers", () => {
  let db: Database;

  beforeEach(() => {
    db = createDatabase(":memory:");
  });

  afterEach(() => {
    db.close();
  });

  describe("hashApiKey", () => {
    it("should produce consistent SHA-256 hash", () => {
      const hash1 = hashApiKey("sk-tracker-abc123");
      const hash2 = hashApiKey("sk-tracker-abc123");
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("should produce different hashes for different keys", () => {
      const hash1 = hashApiKey("key1");
      const hash2 = hashApiKey("key2");
      expect(hash1).not.toBe(hash2);
    });
  });

  describe("insertMember", () => {
    it("should insert and return a member", () => {
      const member = insertMember(db, "m1", "Eric", hashApiKey("sk-tracker-abc"));
      expect(member.id).toBe("m1");
      expect(member.name).toBe("Eric");
      expect(member.api_key_hash).toBe(hashApiKey("sk-tracker-abc"));
      expect(member.created_at).toBeTruthy();
    });

    it("should reject duplicate names", () => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));
      expect(() => {
        insertMember(db, "m2", "Eric", hashApiKey("key2"));
      }).toThrow();
    });
  });

  describe("findMemberByApiKeyHash", () => {
    it("should find member by API key hash", () => {
      const hash = hashApiKey("sk-tracker-abc");
      insertMember(db, "m1", "Eric", hash);

      const found = findMemberByApiKeyHash(db, hash);
      expect(found).not.toBeNull();
      expect(found!.name).toBe("Eric");
    });

    it("should return null for unknown hash", () => {
      const found = findMemberByApiKeyHash(db, "nonexistent");
      expect(found).toBeNull();
    });
  });

  describe("listMembers", () => {
    it("should list members without api_key_hash", () => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));
      insertMember(db, "m2", "Alice", hashApiKey("key2"));

      const members = listMembers(db);
      expect(members).toHaveLength(2);
      expect(members[0]).not.toHaveProperty("api_key_hash");
      expect(members[0]).toHaveProperty("name");
    });
  });

  describe("insertUsageRecord", () => {
    it("should insert a usage record", () => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));
      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-03-30",
        session_id: "sess1",
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 100,
        cache_read_tokens: 200,
        total_cost_usd: 0.05,
        models: ["claude-sonnet-4-6"],
      });

      const records = queryUsageRecords(db, {});
      expect(records).toHaveLength(1);
      expect(records[0].input_tokens).toBe(1000);
      expect(records[0].output_tokens).toBe(500);
    });

    it("should handle INSERT OR REPLACE for same (member_id, date, session_id)", () => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));

      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-03-30",
        session_id: "sess1",
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0.05,
        models: [],
      });

      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-03-30",
        session_id: "sess1",
        input_tokens: 2000,
        output_tokens: 1000,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0.10,
        models: [],
      });

      const records = queryUsageRecords(db, {});
      expect(records).toHaveLength(1);
      expect(records[0].input_tokens).toBe(2000);
    });
  });

  describe("queryUsageRecords", () => {
    beforeEach(() => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));
      insertMember(db, "m2", "Alice", hashApiKey("key2"));

      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-03-28",
        session_id: "s1",
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0.01,
        models: [],
      });
      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-03-30",
        session_id: "s2",
        input_tokens: 200,
        output_tokens: 100,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0.02,
        models: [],
      });
      insertUsageRecord(db, "m2", {
        member_name: "Alice",
        date: "2026-03-30",
        session_id: "s3",
        input_tokens: 300,
        output_tokens: 150,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0.03,
        models: [],
      });
    });

    it("should filter by date range", () => {
      const records = queryUsageRecords(db, { from: "2026-03-29", to: "2026-03-30" });
      expect(records).toHaveLength(2);
    });

    it("should filter by member", () => {
      const records = queryUsageRecords(db, { memberId: "m1" });
      expect(records).toHaveLength(2);
    });

    it("should return all records without filters", () => {
      const records = queryUsageRecords(db, {});
      expect(records).toHaveLength(3);
    });
  });

  describe("aggregateUsage", () => {
    beforeEach(() => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));
      insertMember(db, "m2", "Alice", hashApiKey("key2"));

      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-03-28",
        session_id: "s1",
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_tokens: 10,
        cache_read_tokens: 20,
        total_cost_usd: 0.01,
        models: [],
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
        models: [],
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
        models: [],
      });
    });

    it("should aggregate by member", () => {
      const summary = aggregateUsage(db, {});
      expect(summary).toHaveLength(2);

      const eric = summary.find((s) => s.member_name === "Eric");
      expect(eric!.input_tokens).toBe(300);
      expect(eric!.output_tokens).toBe(150);
      expect(eric!.cache_creation_tokens).toBe(30);
      expect(eric!.cache_read_tokens).toBe(60);
      expect(eric!.total_cost_usd).toBeCloseTo(0.03);
    });

    it("should filter by date range", () => {
      const summary = aggregateUsage(db, { from: "2026-03-30", to: "2026-03-30" });
      expect(summary).toHaveLength(2);

      const eric = summary.find((s) => s.member_name === "Eric");
      expect(eric!.input_tokens).toBe(200);
    });

    it("should include last_seen_at in results", () => {
      const summary = aggregateUsage(db, {});
      expect(summary).toHaveLength(2);
      for (const member of summary) {
        expect(member).toHaveProperty("last_seen_at");
        expect(typeof member.last_seen_at).toBe("string");
      }
    });

    it("should order by total_cost_usd descending", () => {
      // Eric: 0.01 + 0.02 = 0.03, Alice: 0.03 — tied, so order may vary
      // Insert extra record to make Alice clearly higher
      insertUsageRecord(db, "m2", {
        member_name: "Alice",
        date: "2026-03-29",
        session_id: "s4",
        input_tokens: 500,
        output_tokens: 250,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0.10,
        models: [],
      });

      const summary = aggregateUsage(db, {});
      expect(summary[0].member_name).toBe("Alice");
      expect(summary[1].member_name).toBe("Eric");
    });
  });

  describe("aggregateUsageByDate", () => {
    beforeEach(() => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));
      insertMember(db, "m2", "Alice", hashApiKey("key2"));

      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-03-28",
        session_id: "s1",
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_tokens: 10,
        cache_read_tokens: 20,
        total_cost_usd: 0.01,
        models: [],
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
        models: [],
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
        models: [],
      });
    });

    it("should aggregate by date", () => {
      const daily = aggregateUsageByDate(db, {});
      expect(daily).toHaveLength(2);
      expect(daily[0].date).toBe("2026-03-28");
      expect(daily[1].date).toBe("2026-03-30");
    });

    it("should sum tokens across members for the same date", () => {
      const daily = aggregateUsageByDate(db, {});
      const march30 = daily.find((d) => d.date === "2026-03-30")!;

      expect(march30.input_tokens).toBe(500);
      expect(march30.output_tokens).toBe(250);
      expect(march30.cache_creation_tokens).toBe(50);
      expect(march30.cache_read_tokens).toBe(100);
      expect(march30.total_cost_usd).toBeCloseTo(0.05);
    });

    it("should filter by date range", () => {
      const daily = aggregateUsageByDate(db, { from: "2026-03-30", to: "2026-03-30" });
      expect(daily).toHaveLength(1);
      expect(daily[0].date).toBe("2026-03-30");
    });

    it("should order by date ascending", () => {
      const daily = aggregateUsageByDate(db, {});
      expect(daily[0].date).toBe("2026-03-28");
      expect(daily[1].date).toBe("2026-03-30");
    });

    it("should return empty array when no data", () => {
      const daily = aggregateUsageByDate(db, { from: "2099-01-01", to: "2099-12-31" });
      expect(daily).toHaveLength(0);
    });
  });

  describe("insertSessionMetrics", () => {
    it("should insert session metrics", () => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));
      insertSessionMetrics(db, "m1", {
        member_name: "Eric",
        session_id: "sess1",
        started_at: "2026-04-07T10:00:00Z",
        ended_at: "2026-04-07T11:00:00Z",
        turns: 10,
        tool_calls: { Bash: 5 },
        has_commit: true,
      });

      const row = db.query("SELECT * FROM session_metrics WHERE session_id = ?").get("sess1") as any;
      expect(row).not.toBeNull();
      expect(row.member_id).toBe("m1");
      expect(row.turns).toBe(10);
      expect(row.has_commit).toBe(1);
      expect(JSON.parse(row.tool_calls)).toEqual({ Bash: 5 });
    });

    it("should upsert on duplicate (member_id, session_id)", () => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));

      insertSessionMetrics(db, "m1", {
        member_name: "Eric",
        session_id: "sess1",
        started_at: "2026-04-07T10:00:00Z",
        ended_at: "2026-04-07T11:00:00Z",
        turns: 10,
      });

      insertSessionMetrics(db, "m1", {
        member_name: "Eric",
        session_id: "sess1",
        started_at: "2026-04-07T10:00:00Z",
        ended_at: "2026-04-07T11:30:00Z",
        turns: 20,
      });

      const rows = db.query("SELECT * FROM session_metrics WHERE session_id = ?").all("sess1");
      expect(rows).toHaveLength(1);
      expect((rows[0] as any).turns).toBe(20);
    });

    it("should default optional fields", () => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));
      insertSessionMetrics(db, "m1", {
        member_name: "Eric",
        session_id: "sess-min",
        started_at: "2026-04-07T10:00:00Z",
        ended_at: "2026-04-07T10:30:00Z",
      });

      const row = db.query("SELECT * FROM session_metrics WHERE session_id = ?").get("sess-min") as any;
      expect(row.turns).toBe(0);
      expect(row.duration_minutes).toBe(0);
      expect(row.tool_call_total).toBe(0);
      expect(row.has_commit).toBe(0);
      expect(JSON.parse(row.tool_calls)).toEqual({});
      expect(JSON.parse(row.skills_invoked)).toEqual([]);
    });
  });

  describe("Session Analytics Aggregation Queries", () => {
    const WEEK_FROM = "2026-04-06T00:00:00.000Z";
    const WEEK_TO = "2026-04-13T00:00:00.000Z";

    beforeEach(() => {
      insertMember(db, "m1", "Eric", hashApiKey("key1"));
      insertMember(db, "m2", "Alice", hashApiKey("key2"));

      insertSessionMetrics(db, "m1", {
        member_name: "Eric",
        session_id: "s1",
        started_at: "2026-04-07T10:00:00Z",
        ended_at: "2026-04-07T11:30:00Z",
        duration_minutes: 90,
        turns: 15,
        tool_calls: { Bash: 10, Read: 5 },
        tool_call_total: 15,
        tool_errors: 1,
        skills_invoked: ["commit"],
        files_edited: 5,
        files_written: 2,
        has_commit: true,
      });

      insertSessionMetrics(db, "m2", {
        member_name: "Alice",
        session_id: "s2",
        started_at: "2026-04-08T09:00:00Z",
        ended_at: "2026-04-08T10:00:00Z",
        duration_minutes: 60,
        turns: 20,
        tool_calls: { Bash: 5, Edit: 15 },
        tool_call_total: 20,
        tool_errors: 0,
        skills_invoked: ["commit", "review-pr"],
        files_edited: 10,
        files_written: 1,
        has_commit: true,
      });

      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-04-07",
        session_id: "cost-1",
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0.05,
        models: [],
      });

      insertUsageRecord(db, "m2", {
        member_name: "Alice",
        date: "2026-04-08",
        session_id: "cost-2",
        input_tokens: 2000,
        output_tokens: 1000,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 0.10,
        models: [],
      });
    });

    describe("getWeeklyOverview", () => {
      it("should return aggregated overview", () => {
        const overview = getWeeklyOverview(db, WEEK_FROM, WEEK_TO);
        expect(overview.total_sessions).toBe(2);
        expect(overview.total_duration_hours).toBe(2.5);
        expect(overview.commit_rate).toBe(100);
        expect(overview.avg_turns).toBe(17.5);
        expect(overview.total_tool_errors).toBe(1);
      });

      it("should return zeros for empty week", () => {
        const overview = getWeeklyOverview(db, "2099-01-01T00:00:00Z", "2099-01-08T00:00:00Z");
        expect(overview.total_sessions).toBe(0);
        expect(overview.total_duration_hours).toBe(0);
      });
    });

    describe("getMemberComparison", () => {
      it("should return per-member stats sorted by turns desc", () => {
        const members = getMemberComparison(db, WEEK_FROM, WEEK_TO);
        expect(members).toHaveLength(2);
        expect(members[0].member_name).toBe("Alice");
        expect(members[0].total_turns).toBe(20);
        expect(members[1].member_name).toBe("Eric");
        expect(members[1].total_turns).toBe(15);
      });
    });

    describe("getToolHeatmap", () => {
      it("should return tool × member usage counts", () => {
        const entries = getToolHeatmap(db, WEEK_FROM, WEEK_TO);
        expect(entries.length).toBeGreaterThan(0);

        const bashEric = entries.find((e) => e.tool_name === "Bash" && e.member_name === "Eric");
        expect(bashEric).not.toBeUndefined();
        expect(bashEric!.usage_count).toBe(10);

        const editAlice = entries.find((e) => e.tool_name === "Edit" && e.member_name === "Alice");
        expect(editAlice).not.toBeUndefined();
        expect(editAlice!.usage_count).toBe(15);
      });

      it("should return empty for week with no data", () => {
        const entries = getToolHeatmap(db, "2099-01-01T00:00:00Z", "2099-01-08T00:00:00Z");
        expect(entries).toHaveLength(0);
      });
    });

    describe("getAnomalousSessions", () => {
      it("should detect high-turns-no-output anomaly", () => {
        insertSessionMetrics(db, "m1", {
          member_name: "Eric",
          session_id: "anomaly-1",
          started_at: "2026-04-09T10:00:00Z",
          ended_at: "2026-04-09T12:00:00Z",
          turns: 25,
          files_edited: 0,
          files_written: 0,
        });

        const anomalies = getAnomalousSessions(db, WEEK_FROM, WEEK_TO);
        const found = anomalies.find((a) => a.turns === 25);
        expect(found).not.toBeUndefined();
      });

      it("should detect error-heavy anomaly", () => {
        insertSessionMetrics(db, "m1", {
          member_name: "Eric",
          session_id: "anomaly-2",
          started_at: "2026-04-09T10:00:00Z",
          ended_at: "2026-04-09T10:30:00Z",
          tool_errors: 8,
        });

        const anomalies = getAnomalousSessions(db, WEEK_FROM, WEEK_TO);
        const found = anomalies.find((a) => a.tool_errors === 8);
        expect(found).not.toBeUndefined();
      });

      it("should detect long-no-commit anomaly", () => {
        insertSessionMetrics(db, "m1", {
          member_name: "Eric",
          session_id: "anomaly-3",
          started_at: "2026-04-09T10:00:00Z",
          ended_at: "2026-04-09T12:00:00Z",
          duration_minutes: 120,
          has_commit: false,
          files_edited: 5,
          turns: 10,
        });

        const anomalies = getAnomalousSessions(db, WEEK_FROM, WEEK_TO);
        const found = anomalies.find((a) => a.duration_minutes === 120);
        expect(found).not.toBeUndefined();
      });

      it("should return empty when no anomalies", () => {
        const anomalies = getAnomalousSessions(db, WEEK_FROM, WEEK_TO);
        expect(anomalies).toHaveLength(0);
      });
    });

    describe("getSkillUsageSummary", () => {
      it("should aggregate skill usage across sessions", () => {
        const skills = getSkillUsageSummary(db, WEEK_FROM, WEEK_TO);
        expect(skills.length).toBeGreaterThan(0);

        const commit = skills.find((s) => s.skill_name === "commit");
        expect(commit).not.toBeUndefined();
        expect(commit!.session_count).toBe(2);
        expect(commit!.members).toContain("Eric");
        expect(commit!.members).toContain("Alice");
      });

      it("should return empty for week with no skills", () => {
        insertSessionMetrics(db, "m1", {
          member_name: "Eric",
          session_id: "no-skills",
          started_at: "2099-01-07T10:00:00Z",
          ended_at: "2099-01-07T11:00:00Z",
        });

        const skills = getSkillUsageSummary(db, "2099-01-06T00:00:00Z", "2099-01-13T00:00:00Z");
        expect(skills).toHaveLength(0);
      });
    });

    describe("getWeeklyCostTrend", () => {
      it("should return daily costs", () => {
        const costs = getWeeklyCostTrend(db, "2026-04-06", "2026-04-13");
        expect(costs).toHaveLength(2);

        const april7 = costs.find((c) => c.date === "2026-04-07");
        expect(april7).not.toBeUndefined();
        expect(april7!.total_cost_usd).toBeCloseTo(0.05);
      });

      it("should return empty for week with no cost data", () => {
        const costs = getWeeklyCostTrend(db, "2099-01-06", "2099-01-13");
        expect(costs).toHaveLength(0);
      });
    });
  });
});
