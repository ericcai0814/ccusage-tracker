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
});
