import { Database } from "bun:sqlite";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  api_key_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS usage_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL REFERENCES members(id),
  date TEXT NOT NULL,
  session_id TEXT,
  input_tokens INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
  cache_read_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost_usd REAL NOT NULL DEFAULT 0,
  models TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, date, session_id)
);

CREATE INDEX IF NOT EXISTS idx_usage_member_date ON usage_records(member_id, date);

CREATE TABLE IF NOT EXISTS session_metrics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT NOT NULL REFERENCES members(id),
  session_id TEXT NOT NULL,
  session_name TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  branch TEXT NOT NULL DEFAULT '',
  started_at TEXT NOT NULL,
  ended_at TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL DEFAULT 0,
  turns INTEGER NOT NULL DEFAULT 0,
  user_messages INTEGER NOT NULL DEFAULT 0,
  assistant_messages INTEGER NOT NULL DEFAULT 0,
  user_avg_chars INTEGER NOT NULL DEFAULT 0,
  tool_calls TEXT NOT NULL DEFAULT '{}',
  tool_call_total INTEGER NOT NULL DEFAULT 0,
  tool_errors INTEGER NOT NULL DEFAULT 0,
  skills_invoked TEXT NOT NULL DEFAULT '[]',
  hook_blocks INTEGER NOT NULL DEFAULT 0,
  files_read INTEGER NOT NULL DEFAULT 0,
  files_written INTEGER NOT NULL DEFAULT 0,
  files_edited INTEGER NOT NULL DEFAULT 0,
  has_commit INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(member_id, session_id)
);

CREATE INDEX IF NOT EXISTS idx_session_metrics_started_at ON session_metrics(started_at);
`;

export function createDatabase(path: string = "data.db"): Database {
  const db = new Database(path);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec(SCHEMA);
  migrateLastSeenAt(db);
  migrateSessionMetricsModel(db);
  return db;
}

function migrateSessionMetricsModel(db: Database): void {
  const columns = db.query("SELECT name FROM pragma_table_info('session_metrics')").all() as { name: string }[];
  if (!columns.some((c) => c.name === "model")) {
    db.exec("ALTER TABLE session_metrics ADD COLUMN model TEXT NOT NULL DEFAULT ''");
  }
  if (!columns.some((c) => c.name === "context_estimate_pct")) {
    db.exec("ALTER TABLE session_metrics ADD COLUMN context_estimate_pct INTEGER NOT NULL DEFAULT 0");
  }
}

function migrateLastSeenAt(db: Database): void {
  const columns = db.query("SELECT name FROM pragma_table_info('members')").all() as { name: string }[];
  const hasColumn = columns.some((c) => c.name === "last_seen_at");
  if (!hasColumn) {
    db.exec("ALTER TABLE members ADD COLUMN last_seen_at TEXT");
  }
}

