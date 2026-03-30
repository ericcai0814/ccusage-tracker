import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createDatabase } from "./db";
import type { Database } from "bun:sqlite";

const TEST_DB = ":memory:";

describe("Database Schema", () => {
  let db: Database;

  beforeEach(() => {
    db = createDatabase(TEST_DB);
  });

  afterEach(() => {
    db.close();
  });

  it("should create members table with correct columns", () => {
    const columns = db
      .query("PRAGMA table_info(members)")
      .all() as Array<{ name: string; type: string; notnull: number }>;

    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("name");
    expect(columnNames).toContain("api_key_hash");
    expect(columnNames).toContain("created_at");
  });

  it("should create usage_records table with correct columns", () => {
    const columns = db
      .query("PRAGMA table_info(usage_records)")
      .all() as Array<{ name: string; type: string }>;

    const columnNames = columns.map((c) => c.name);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("member_id");
    expect(columnNames).toContain("date");
    expect(columnNames).toContain("session_id");
    expect(columnNames).toContain("input_tokens");
    expect(columnNames).toContain("output_tokens");
    expect(columnNames).toContain("cache_creation_tokens");
    expect(columnNames).toContain("cache_read_tokens");
    expect(columnNames).toContain("total_cost_usd");
    expect(columnNames).toContain("models");
  });

  it("should enforce unique constraint on members.name", () => {
    db.run("INSERT INTO members (id, name, api_key_hash) VALUES ('1', 'eric', 'hash1')");
    expect(() => {
      db.run("INSERT INTO members (id, name, api_key_hash) VALUES ('2', 'eric', 'hash2')");
    }).toThrow();
  });

  it("should enforce unique constraint on (member_id, date, session_id)", () => {
    db.run("INSERT INTO members (id, name, api_key_hash) VALUES ('m1', 'eric', 'hash1')");
    db.run(
      "INSERT INTO usage_records (member_id, date, session_id, input_tokens, output_tokens) VALUES ('m1', '2026-03-30', 'sess1', 100, 50)"
    );
    expect(() => {
      db.run(
        "INSERT INTO usage_records (member_id, date, session_id, input_tokens, output_tokens) VALUES ('m1', '2026-03-30', 'sess1', 200, 100)"
      );
    }).toThrow();
  });

  it("should allow INSERT OR REPLACE for idempotent upserts", () => {
    db.run("INSERT INTO members (id, name, api_key_hash) VALUES ('m1', 'eric', 'hash1')");
    db.run(
      "INSERT INTO usage_records (member_id, date, session_id, input_tokens, output_tokens) VALUES ('m1', '2026-03-30', 'sess1', 100, 50)"
    );
    db.run(
      "INSERT OR REPLACE INTO usage_records (member_id, date, session_id, input_tokens, output_tokens) VALUES ('m1', '2026-03-30', 'sess1', 200, 100)"
    );

    const record = db
      .query("SELECT input_tokens, output_tokens FROM usage_records WHERE member_id = 'm1' AND session_id = 'sess1'")
      .get() as { input_tokens: number; output_tokens: number };

    expect(record.input_tokens).toBe(200);
    expect(record.output_tokens).toBe(100);
  });

  it("should enforce foreign key constraint on usage_records.member_id", () => {
    expect(() => {
      db.run(
        "INSERT INTO usage_records (member_id, date, session_id, input_tokens, output_tokens) VALUES ('nonexistent', '2026-03-30', 'sess1', 100, 50)"
      );
    }).toThrow();
  });
});
