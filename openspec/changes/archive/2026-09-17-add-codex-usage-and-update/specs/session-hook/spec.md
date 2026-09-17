## ADDED Requirements

### Requirement: Source-safe Claude daily snapshots

The Node Claude hook SHALL preserve the legacy daily identity, background execution, Stop throttle, timeout, model and session metrics. It SHALL retain the original Claude-only daily --json --since command for the legacy family (major <=19), select claude daily explicitly for major 20, and validate the known Claude-only schema on every result. Verified patch versions SHALL be evidence rather than an exact runtime whitelist. It SHALL reject unknown major families and SHALL NOT count a unified multi-agent aggregate as Claude usage. It SHALL reject invalid schema or numbers visibly instead of posting zeros, and SHALL prevent stale buffered daily snapshots from overwriting newer successful snapshots.

#### Scenario: Adjacent collector compatibility

- **WHEN** published ccusage 18.0.9 returns valid Claude daily data, or a synthetic schema-compatible 20.0.21 collector returns it through claude daily
- **THEN** the hook SHALL upload the snapshot without rejecting its patch number, preserving the original legacy flags or explicit unified-source command respectively
- **AND** malformed or unified output from either path SHALL still be rejected

#### Scenario: Source schema drift

- **WHEN** the installed ccusage emits an unknown or unified multi-agent output
- **THEN** the hook SHALL record an error and SHALL NOT upload it as Claude daily

#### Scenario: Buffered daily recovery

- **WHEN** a newer Claude daily snapshot succeeds while an older same-day daily snapshot remains buffered
- **THEN** replay SHALL NOT replace the newer snapshot with the older one

#### Scenario: Legacy behavior

- **WHEN** a supported Claude collector is used without a Codex collector
- **THEN** existing Claude background hooks and session metrics SHALL continue working independently

## MODIFIED Requirements

### Requirement: Report usage on session end

The SessionEnd Node hook SHALL collect Claude token usage through a supported ccusage reader and POST the local-calendar-day snapshot to the configured server.

#### Scenario: Successful session end report

- **WHEN** a Claude Code session ends and the hook is triggered
- **THEN** the worker SHALL read server_url, team_key and member_name from the tracker config, collect Claude-only daily data and POST it to /api/ingest with session_id daily

#### Scenario: Config file missing

- **WHEN** the hook is triggered but the tracker config does not exist
- **THEN** the hook SHALL exit with code 0 without performing any action

#### Scenario: ccusage not installed

- **WHEN** the hook is triggered with valid tracker config but the ccusage command is not found
- **THEN** the hook SHALL exit with code 0 and the worker SHALL record a content-free collection error for status

### Requirement: Non-blocking execution

The hook SHALL NOT block Claude Code from exiting, regardless of collection or upload success.

#### Scenario: Server unreachable

- **WHEN** the worker attempts to POST but the server is unreachable
- **THEN** it SHALL buffer the usage snapshot for retry without affecting Claude Code

#### Scenario: Background POST

- **WHEN** the hook receives a reporting event
- **THEN** it SHALL detach a Node worker with disconnected stdio and exit without waiting for collection or POST

### Requirement: Read hook payload

The Claude hook SHALL read JSON from stdin to obtain the transcript path and session identity used for model lookup and session metrics. Daily token snapshots SHALL use the stable daily identity.

#### Scenario: Extract session_id from payload

- **WHEN** the hook receives a JSON payload on stdin containing session_id
- **THEN** it SHALL use the identity for session model lookup while keeping session_id daily in the usage snapshot

#### Scenario: Malformed or empty payload

- **WHEN** the hook receives malformed JSON or empty stdin
- **THEN** it SHALL still attempt the daily usage snapshot without session transcript metrics

### Requirement: Privacy protection

Usage hooks SHALL transmit token counts and metadata without raw conversation content.

#### Scenario: Data transmitted

- **WHEN** the hook constructs a usage POST body
- **THEN** it SHALL contain only member_name, date, session_id, input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_cost_usd and models
- **AND** Claude session metrics SHALL contain aggregate behavioral metadata rather than raw prompts, responses or tool results
