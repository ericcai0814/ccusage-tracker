import type { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { nanoid } from "nanoid";

export interface Member {
  id: string;
  name: string;
  api_key_hash: string;
  created_at: string;
  last_seen_at: string | null;
}

export interface UsageRecord {
  id: number;
  member_id: string;
  date: string;
  session_id: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost_usd: number;
  models: string;
  created_at: string;
}

export interface UsageSummary {
  member_id: string;
  member_name: string;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost_usd: number;
  last_seen_at: string | null;
}

export interface IngestPayload {
  member_name: string;
  date: string;
  session_id?: string | null;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  total_cost_usd: number;
  models: string[];
}

export function hashApiKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function insertMember(db: Database, id: string, name: string, apiKeyHash: string): Member {
  db.run(
    "INSERT INTO members (id, name, api_key_hash) VALUES (?, ?, ?)",
    [id, name, apiKeyHash]
  );
  return db.query("SELECT * FROM members WHERE id = ?").get(id) as Member;
}

export function findMemberByApiKeyHash(db: Database, apiKeyHash: string): Member | null {
  return db.query("SELECT * FROM members WHERE api_key_hash = ?").get(apiKeyHash) as Member | null;
}

export function listMembers(db: Database): Omit<Member, "api_key_hash">[] {
  return db.query("SELECT id, name, created_at FROM members ORDER BY created_at").all() as Omit<Member, "api_key_hash">[];
}

export function insertUsageRecord(db: Database, memberId: string, payload: IngestPayload): void {
  const tx = db.transaction(() => {
    db.run(
      `INSERT INTO usage_records
       (member_id, date, session_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_cost_usd, models)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(member_id, date, session_id) DO UPDATE SET
         input_tokens = excluded.input_tokens,
         output_tokens = excluded.output_tokens,
         cache_creation_tokens = excluded.cache_creation_tokens,
         cache_read_tokens = excluded.cache_read_tokens,
         total_cost_usd = excluded.total_cost_usd,
         models = excluded.models`,
      [
        memberId,
        payload.date,
        payload.session_id ?? null,
        payload.input_tokens,
        payload.output_tokens,
        payload.cache_creation_tokens,
        payload.cache_read_tokens,
        payload.total_cost_usd,
        JSON.stringify(payload.models),
      ]
    );
    db.run(
      "UPDATE members SET last_seen_at = datetime('now') WHERE id = ?",
      [memberId]
    );
  });
  tx();
}

export function findMemberByName(db: Database, name: string): Member | null {
  return db.query("SELECT * FROM members WHERE name = ?").get(name) as Member | null;
}

export function findOrCreateMember(db: Database, name: string): Member {
  const existing = findMemberByName(db, name);
  if (existing) {
    return existing;
  }
  const id = nanoid();
  const dummyApiKeyHash = hashApiKey(`dummy-${id}`);
  return insertMember(db, id, name, dummyApiKeyHash);
}

export function queryUsageRecords(
  db: Database,
  options: { from?: string; to?: string; memberId?: string }
): UsageRecord[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.from) {
    conditions.push("date >= ?");
    params.push(options.from);
  }
  if (options.to) {
    conditions.push("date <= ?");
    params.push(options.to);
  }
  if (options.memberId) {
    conditions.push("member_id = ?");
    params.push(options.memberId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return db.query(`SELECT * FROM usage_records ${where} ORDER BY date DESC`).all(...params) as UsageRecord[];
}

export interface DailyUsage {
  date: string;
  total_cost_usd: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
}

export function aggregateUsageByDate(
  db: Database,
  options: { from?: string; to?: string }
): DailyUsage[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.from) {
    conditions.push("date >= ?");
    params.push(options.from);
  }
  if (options.to) {
    conditions.push("date <= ?");
    params.push(options.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return db
    .query(
      `SELECT
        date,
        SUM(input_tokens) as input_tokens,
        SUM(output_tokens) as output_tokens,
        SUM(cache_creation_tokens) as cache_creation_tokens,
        SUM(cache_read_tokens) as cache_read_tokens,
        SUM(total_cost_usd) as total_cost_usd
      FROM usage_records
      ${where}
      GROUP BY date
      ORDER BY date ASC`
    )
    .all(...params) as DailyUsage[];
}

export function aggregateUsage(
  db: Database,
  options: { from?: string; to?: string }
): UsageSummary[] {
  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.from) {
    conditions.push("ur.date >= ?");
    params.push(options.from);
  }
  if (options.to) {
    conditions.push("ur.date <= ?");
    params.push(options.to);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  return db
    .query(
      `SELECT
        ur.member_id,
        m.name as member_name,
        SUM(ur.input_tokens) as input_tokens,
        SUM(ur.output_tokens) as output_tokens,
        SUM(ur.cache_creation_tokens) as cache_creation_tokens,
        SUM(ur.cache_read_tokens) as cache_read_tokens,
        SUM(ur.total_cost_usd) as total_cost_usd,
        m.last_seen_at
      FROM usage_records ur
      JOIN members m ON ur.member_id = m.id
      ${where}
      GROUP BY ur.member_id
      ORDER BY total_cost_usd DESC`
    )
    .all(...params) as UsageSummary[];
}
