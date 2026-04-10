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
  model?: string;
  context_estimate_pct?: number;
}

function touchMemberLastSeen(db: Database, memberId: string): void {
  db.run("UPDATE members SET last_seen_at = datetime('now') WHERE id = ?", [memberId]);
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
        files_read, files_written, files_edited, has_commit,
        model, context_estimate_pct)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         has_commit = excluded.has_commit,
         model = excluded.model,
         context_estimate_pct = excluded.context_estimate_pct`,
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
        payload.model ?? "",
        payload.context_estimate_pct ?? 0,
      ]
    );
    touchMemberLastSeen(db, memberId);
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
    touchMemberLastSeen(db, memberId);
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

// --- Weekly Cost (from usage_records) ---

export interface WeeklyCost {
  total_cost: number;
  total_tokens: number;
}

export function getWeeklyCost(
  db: Database,
  fromDate: string,
  toDate: string
): WeeklyCost {
  const row = db
    .query(
      `SELECT
        COALESCE(SUM(total_cost_usd), 0) as total_cost,
        COALESCE(SUM(input_tokens + output_tokens + cache_creation_tokens + cache_read_tokens), 0) as total_tokens
      FROM usage_records
      WHERE date >= ? AND date < ?`
    )
    .get(fromDate, toDate) as WeeklyCost;
  return row;
}

// --- Session Analytics Aggregation Queries ---

export interface WeeklyOverview {
  total_sessions: number;
  total_duration_hours: number;
  active_members: number;
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
        COUNT(DISTINCT member_id) as active_members
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

export function getUnusedSkills(
  db: Database,
  from: string,
  to: string
): string[] {
  const rows = db
    .query(
      `SELECT DISTINCT je.value as skill_name
      FROM session_metrics sm, json_each(sm.skills_invoked) je
      WHERE je.value NOT IN (
        SELECT DISTINCT je2.value
        FROM session_metrics sm2, json_each(sm2.skills_invoked) je2
        WHERE sm2.started_at >= ? AND sm2.started_at < ?
      )
      ORDER BY skill_name`
    )
    .all(from, to) as { skill_name: string }[];
  return rows.map((r) => r.skill_name);
}

export interface WeeklyHighlights {
  longest_session: { duration_minutes: number; project: string } | null;
  most_active_day: { day_name: string; count: number } | null;
  most_used_project: { name: string; count: number } | null;
  high_context_sessions: number;
}

export function getHighlights(
  db: Database,
  from: string,
  to: string
): WeeklyHighlights {
  const longest = db
    .query(
      `SELECT duration_minutes, project
      FROM session_metrics
      WHERE started_at >= ? AND started_at < ?
      ORDER BY duration_minutes DESC
      LIMIT 1`
    )
    .get(from, to) as { duration_minutes: number; project: string } | null;

  const mostActiveDay = db
    .query(
      `SELECT
        CASE CAST(strftime('%w', started_at) AS INTEGER)
          WHEN 0 THEN 'Sunday'
          WHEN 1 THEN 'Monday'
          WHEN 2 THEN 'Tuesday'
          WHEN 3 THEN 'Wednesday'
          WHEN 4 THEN 'Thursday'
          WHEN 5 THEN 'Friday'
          WHEN 6 THEN 'Saturday'
        END as day_name,
        COUNT(*) as count
      FROM session_metrics
      WHERE started_at >= ? AND started_at < ?
      GROUP BY strftime('%w', started_at)
      ORDER BY count DESC
      LIMIT 1`
    )
    .get(from, to) as { day_name: string; count: number } | null;

  const mostUsedProject = db
    .query(
      `SELECT
        CASE WHEN project = '' THEN '(no project)' ELSE project END as name,
        COUNT(*) as count
      FROM session_metrics
      WHERE started_at >= ? AND started_at < ?
      GROUP BY project
      ORDER BY count DESC
      LIMIT 1`
    )
    .get(from, to) as { name: string; count: number } | null;

  const highCtx = db
    .query(
      `SELECT COUNT(*) as count
      FROM session_metrics
      WHERE started_at >= ? AND started_at < ?
        AND context_estimate_pct >= 70`
    )
    .get(from, to) as { count: number };

  return {
    longest_session: longest ?? null,
    most_active_day: mostActiveDay ?? null,
    most_used_project: mostUsedProject ?? null,
    high_context_sessions: highCtx.count,
  };
}

export interface SessionDistribution {
  quick: number;
  medium: number;
  deep: number;
  marathon: number;
}

export function getSessionDistribution(
  db: Database,
  from: string,
  to: string
): SessionDistribution {
  const row = db
    .query(
      `SELECT
        COALESCE(SUM(CASE WHEN duration_minutes < 15 THEN 1 ELSE 0 END), 0) as quick,
        COALESCE(SUM(CASE WHEN duration_minutes >= 15 AND duration_minutes < 60 THEN 1 ELSE 0 END), 0) as medium,
        COALESCE(SUM(CASE WHEN duration_minutes >= 60 AND duration_minutes < 180 THEN 1 ELSE 0 END), 0) as deep,
        COALESCE(SUM(CASE WHEN duration_minutes >= 180 THEN 1 ELSE 0 END), 0) as marathon
      FROM session_metrics
      WHERE started_at >= ? AND started_at < ?`
    )
    .get(from, to) as SessionDistribution | null;
  return row ?? { quick: 0, medium: 0, deep: 0, marathon: 0 };
}

export interface ProjectActivityEntry {
  project: string;
  member_name: string;
  session_count: number;
  turns: number;
  files_edited: number;
  files_written: number;
  commit_count: number;
}

export function getProjectActivity(
  db: Database,
  from: string,
  to: string
): ProjectActivityEntry[] {
  return db
    .query(
      `SELECT
        CASE WHEN sm.project = '' THEN '(no project)' ELSE sm.project END as project,
        m.name as member_name,
        COUNT(*) as session_count,
        SUM(sm.turns) as turns,
        SUM(sm.files_edited) as files_edited,
        SUM(sm.files_written) as files_written,
        SUM(CASE WHEN sm.has_commit = 1 THEN 1 ELSE 0 END) as commit_count
      FROM session_metrics sm
      JOIN members m ON sm.member_id = m.id
      WHERE sm.started_at >= ? AND sm.started_at < ?
      GROUP BY sm.project, sm.member_id
      ORDER BY session_count DESC`
    )
    .all(from, to) as ProjectActivityEntry[];
}

export interface SessionLogEntry {
  member_name: string;
  session_name: string;
  project: string;
  duration_minutes: number;
  turns: number;
  model: string;
  context_estimate_pct: number;
}

export function getSessionLog(
  db: Database,
  from: string,
  to: string
): SessionLogEntry[] {
  return db
    .query(
      `SELECT
        m.name as member_name,
        sm.session_name,
        sm.project,
        sm.duration_minutes,
        sm.turns,
        sm.model,
        sm.context_estimate_pct
      FROM session_metrics sm
      JOIN members m ON sm.member_id = m.id
      WHERE sm.started_at >= ? AND sm.started_at < ?
      ORDER BY sm.started_at DESC`
    )
    .all(from, to) as SessionLogEntry[];
}

