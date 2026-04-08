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

export interface SessionMetricsPayload {
  member_name: string;
  session_id: string;
  session_name?: string;
  project?: string;
  branch?: string;
  started_at: string;
  ended_at: string;
  duration_minutes?: number;
  turns?: number;
  user_messages?: number;
  assistant_messages?: number;
  user_avg_chars?: number;
  tool_calls?: Record<string, number>;
  tool_call_total?: number;
  tool_errors?: number;
  skills_invoked?: string[];
  hook_blocks?: number;
  files_read?: number;
  files_written?: number;
  files_edited?: number;
  has_commit?: boolean;
}

export function insertSessionMetrics(db: Database, memberId: string, payload: SessionMetricsPayload): void {
  const tx = db.transaction(() => {
    db.run(
      `INSERT INTO session_metrics
       (member_id, session_id, session_name, project, branch,
        started_at, ended_at, duration_minutes, turns,
        user_messages, assistant_messages, user_avg_chars,
        tool_calls, tool_call_total, tool_errors,
        skills_invoked, hook_blocks,
        files_read, files_written, files_edited, has_commit)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(member_id, session_id) DO UPDATE SET
         session_name = excluded.session_name,
         project = excluded.project,
         branch = excluded.branch,
         started_at = excluded.started_at,
         ended_at = excluded.ended_at,
         duration_minutes = excluded.duration_minutes,
         turns = excluded.turns,
         user_messages = excluded.user_messages,
         assistant_messages = excluded.assistant_messages,
         user_avg_chars = excluded.user_avg_chars,
         tool_calls = excluded.tool_calls,
         tool_call_total = excluded.tool_call_total,
         tool_errors = excluded.tool_errors,
         skills_invoked = excluded.skills_invoked,
         hook_blocks = excluded.hook_blocks,
         files_read = excluded.files_read,
         files_written = excluded.files_written,
         files_edited = excluded.files_edited,
         has_commit = excluded.has_commit`,
      [
        memberId,
        payload.session_id,
        payload.session_name ?? "",
        payload.project ?? "",
        payload.branch ?? "",
        payload.started_at,
        payload.ended_at,
        payload.duration_minutes ?? 0,
        payload.turns ?? 0,
        payload.user_messages ?? 0,
        payload.assistant_messages ?? 0,
        payload.user_avg_chars ?? 0,
        JSON.stringify(payload.tool_calls ?? {}),
        payload.tool_call_total ?? 0,
        payload.tool_errors ?? 0,
        JSON.stringify(payload.skills_invoked ?? []),
        payload.hook_blocks ?? 0,
        payload.files_read ?? 0,
        payload.files_written ?? 0,
        payload.files_edited ?? 0,
        payload.has_commit ? 1 : 0,
      ]
    );
    db.run(
      "UPDATE members SET last_seen_at = datetime('now') WHERE id = ?",
      [memberId]
    );
  });
  tx();
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

// --- Session Analytics Aggregation Queries ---

export interface WeeklyOverview {
  total_sessions: number;
  total_duration_hours: number;
  commit_rate: number;
  avg_turns: number;
  total_tool_errors: number;
}

export function getWeeklyOverview(
  db: Database,
  from: string,
  to: string
): WeeklyOverview {
  const row = db
    .query(
      `SELECT
        COUNT(*) as total_sessions,
        ROUND(COALESCE(SUM(duration_minutes), 0) / 60.0, 1) as total_duration_hours,
        CASE WHEN COUNT(*) > 0
          THEN ROUND(100.0 * SUM(CASE WHEN has_commit = 1 THEN 1 ELSE 0 END) / COUNT(*), 1)
          ELSE 0 END as commit_rate,
        ROUND(COALESCE(AVG(turns), 0), 1) as avg_turns,
        COALESCE(SUM(tool_errors), 0) as total_tool_errors
      FROM session_metrics
      WHERE started_at >= ? AND started_at < ?`
    )
    .get(from, to) as WeeklyOverview;
  return row;
}

export interface MemberComparison {
  member_name: string;
  sessions: number;
  total_turns: number;
  total_files_edited: number;
  total_files_written: number;
  commit_sessions: number;
  total_tool_errors: number;
}

export function getMemberComparison(
  db: Database,
  from: string,
  to: string
): MemberComparison[] {
  return db
    .query(
      `SELECT
        m.name as member_name,
        COUNT(*) as sessions,
        SUM(sm.turns) as total_turns,
        SUM(sm.files_edited) as total_files_edited,
        SUM(sm.files_written) as total_files_written,
        SUM(CASE WHEN sm.has_commit = 1 THEN 1 ELSE 0 END) as commit_sessions,
        SUM(sm.tool_errors) as total_tool_errors
      FROM session_metrics sm
      JOIN members m ON sm.member_id = m.id
      WHERE sm.started_at >= ? AND sm.started_at < ?
      GROUP BY sm.member_id
      ORDER BY total_turns DESC`
    )
    .all(from, to) as MemberComparison[];
}

export interface ToolHeatmapEntry {
  tool_name: string;
  member_name: string;
  usage_count: number;
}

export function getToolHeatmap(
  db: Database,
  from: string,
  to: string
): ToolHeatmapEntry[] {
  return db
    .query(
      `SELECT
        je.key as tool_name,
        m.name as member_name,
        SUM(je.value) as usage_count
      FROM session_metrics sm
      JOIN members m ON sm.member_id = m.id,
      json_each(sm.tool_calls) je
      WHERE sm.started_at >= ? AND sm.started_at < ?
      GROUP BY je.key, m.name
      ORDER BY SUM(je.value) DESC`
    )
    .all(from, to) as ToolHeatmapEntry[];
}

export interface AnomalousSession {
  member_name: string;
  session_name: string;
  project: string;
  turns: number;
  duration_minutes: number;
  files_edited: number;
  files_written: number;
  tool_errors: number;
  has_commit: number;
}

export function getAnomalousSessions(
  db: Database,
  from: string,
  to: string
): AnomalousSession[] {
  return db
    .query(
      `SELECT
        m.name as member_name,
        sm.session_name,
        sm.project,
        sm.turns,
        sm.duration_minutes,
        sm.files_edited,
        sm.files_written,
        sm.tool_errors,
        sm.has_commit
      FROM session_metrics sm
      JOIN members m ON sm.member_id = m.id
      WHERE sm.started_at >= ? AND sm.started_at < ?
        AND (
          (sm.turns >= 20 AND sm.files_edited + sm.files_written = 0)
          OR sm.tool_errors >= 5
          OR (sm.duration_minutes >= 60 AND sm.has_commit = 0)
        )
      ORDER BY sm.turns DESC`
    )
    .all(from, to) as AnomalousSession[];
}

export interface SkillUsageEntry {
  skill_name: string;
  session_count: number;
  members: string;
}

export function getSkillUsageSummary(
  db: Database,
  from: string,
  to: string
): SkillUsageEntry[] {
  return db
    .query(
      `SELECT
        je.value as skill_name,
        COUNT(DISTINCT sm.id) as session_count,
        GROUP_CONCAT(DISTINCT m.name) as members
      FROM session_metrics sm
      JOIN members m ON sm.member_id = m.id,
      json_each(sm.skills_invoked) je
      WHERE sm.started_at >= ? AND sm.started_at < ?
      GROUP BY je.value
      ORDER BY session_count DESC`
    )
    .all(from, to) as SkillUsageEntry[];
}

export interface DailyCostEntry {
  date: string;
  total_cost_usd: number;
}

export function getWeeklyCostTrend(
  db: Database,
  from: string,
  to: string
): DailyCostEntry[] {
  return db
    .query(
      `SELECT
        date,
        SUM(total_cost_usd) as total_cost_usd
      FROM usage_records
      WHERE date >= ? AND date < ?
      GROUP BY date
      ORDER BY date ASC`
    )
    .all(from, to) as DailyCostEntry[];
}
