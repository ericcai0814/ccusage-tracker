## ADDED Requirements

### Requirement: Store session behavior metrics

The system SHALL provide a `session_metrics` table in SQLite to persist per-session behavior data. The table SHALL include the following columns:

- `id` (INTEGER PRIMARY KEY AUTOINCREMENT)
- `member_id` (TEXT, FK to members.id, NOT NULL)
- `session_id` (TEXT, NOT NULL)
- `session_name` (TEXT, NOT NULL, DEFAULT '')
- `project` (TEXT, NOT NULL, DEFAULT '')
- `branch` (TEXT, NOT NULL, DEFAULT '')
- `started_at` (TEXT, NOT NULL) — ISO 8601 timestamp
- `ended_at` (TEXT, NOT NULL) — ISO 8601 timestamp
- `duration_minutes` (INTEGER, NOT NULL, DEFAULT 0)
- `turns` (INTEGER, NOT NULL, DEFAULT 0)
- `user_messages` (INTEGER, NOT NULL, DEFAULT 0)
- `assistant_messages` (INTEGER, NOT NULL, DEFAULT 0)
- `user_avg_chars` (INTEGER, NOT NULL, DEFAULT 0)
- `tool_calls` (TEXT, NOT NULL, DEFAULT '{}') — JSON object mapping tool name to count
- `tool_call_total` (INTEGER, NOT NULL, DEFAULT 0)
- `tool_errors` (INTEGER, NOT NULL, DEFAULT 0)
- `skills_invoked` (TEXT, NOT NULL, DEFAULT '[]') — JSON array of skill names
- `hook_blocks` (INTEGER, NOT NULL, DEFAULT 0)
- `files_read` (INTEGER, NOT NULL, DEFAULT 0)
- `files_written` (INTEGER, NOT NULL, DEFAULT 0)
- `files_edited` (INTEGER, NOT NULL, DEFAULT 0)
- `has_commit` (INTEGER, NOT NULL, DEFAULT 0) — boolean as 0/1
- `created_at` (TEXT, NOT NULL, DEFAULT datetime('now'))

The table SHALL enforce a UNIQUE constraint on (member_id, session_id) to ensure idempotent ingestion.

#### Scenario: Table creation on startup

- **WHEN** the server starts and the database is initialized
- **THEN** the `session_metrics` table SHALL exist with all specified columns and constraints

#### Scenario: Duplicate session ingestion

- **WHEN** a session with the same member_id and session_id is ingested twice
- **THEN** the second ingestion SHALL update the existing record (UPSERT) rather than fail or create a duplicate

### Requirement: Ingest session metrics via API

The system SHALL provide a `POST /api/ingest/session` endpoint that accepts session behavior metrics and persists them to the `session_metrics` table.

The endpoint SHALL use the `team-auth` middleware for authentication (same as existing `/api/ingest`).

The request payload SHALL contain the following required fields:
- `member_name` (string) — used to resolve or auto-create the member
- `session_id` (string) — unique identifier for the session
- `started_at` (string) — ISO 8601 timestamp
- `ended_at` (string) — ISO 8601 timestamp

The following fields are optional with defaults:
- `session_name` (string, default: '')
- `project` (string, default: '')
- `branch` (string, default: '')
- `duration_minutes` (integer, default: 0)
- `turns` (integer, default: 0)
- `user_messages` (integer, default: 0)
- `assistant_messages` (integer, default: 0)
- `user_avg_chars` (integer, default: 0)
- `tool_calls` (object, default: {})
- `tool_call_total` (integer, default: 0)
- `tool_errors` (integer, default: 0)
- `skills_invoked` (string array, default: [])
- `hook_blocks` (integer, default: 0)
- `files_read` (integer, default: 0)
- `files_written` (integer, default: 0)
- `files_edited` (integer, default: 0)
- `has_commit` (boolean, default: false)

#### Scenario: Successful session ingest

- **WHEN** a valid POST request is sent to `/api/ingest/session` with required fields and valid team auth
- **THEN** the system SHALL return HTTP 200 with `{"ok": true}`
- **AND** the session metrics SHALL be stored in the `session_metrics` table with the correct `member_id` resolved from `member_name`

#### Scenario: Missing required fields

- **WHEN** a POST request is sent to `/api/ingest/session` without `member_name`, `session_id`, `started_at`, or `ended_at`
- **THEN** the system SHALL return HTTP 400 with an error message listing each missing or invalid field

#### Scenario: Invalid authentication

- **WHEN** a POST request is sent to `/api/ingest/session` without a valid team key
- **THEN** the system SHALL return HTTP 401

#### Scenario: Auto-create member on first session ingest

- **WHEN** a session is ingested for a `member_name` that does not exist in the `members` table
- **THEN** the system SHALL auto-create the member (using the same `findOrCreateMember` logic as `/api/ingest`)
- **AND** the session metrics SHALL be stored with the new member's ID

#### Scenario: Idempotent re-ingestion

- **WHEN** the same session (same member_name + session_id) is ingested again with updated metrics
- **THEN** the system SHALL update the existing record with the new values
- **AND** return HTTP 200 with `{"ok": true}`

### Requirement: Validate numeric fields

The system SHALL validate that all numeric fields in the session ingest payload are non-negative finite numbers when provided. Integer fields (turns, duration_minutes, tool_call_total, tool_errors, hook_blocks, files_read, files_written, files_edited) SHALL be validated as non-negative integers. The `tool_calls` field, when provided, SHALL be a valid JSON object. The `skills_invoked` field, when provided, SHALL be a valid array of strings.

#### Scenario: Negative numeric value rejected

- **WHEN** a POST request includes `turns: -5`
- **THEN** the system SHALL return HTTP 400 with an error indicating the invalid field

#### Scenario: Non-object tool_calls rejected

- **WHEN** a POST request includes `tool_calls: "not an object"`
- **THEN** the system SHALL return HTTP 400 with an error indicating tool_calls must be an object

#### Scenario: Valid tool_calls accepted

- **WHEN** a POST request includes `tool_calls: {"Bash": 10, "Read": 5}`
- **THEN** the system SHALL store the value as-is in the JSON column
