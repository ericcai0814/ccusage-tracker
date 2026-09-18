# codex-usage Specification

## Purpose

Collect local Codex subscription usage as isolated daily snapshots through the supported ccusage reader. Provide manual and opt-in turn-complete reporting without model API credentials or conversation content uploads.

## Requirements

### Requirement: Canonical Codex snapshots

The reporter SHALL use the known Codex collector format through the explicit major-20 codex daily command and post per-member local-calendar-day snapshots with session_id codex-daily. Verified patch versions SHALL be evidence rather than an exact runtime whitelist; every result SHALL pass schema validation, unknown major families SHALL be rejected, and the reporter SHALL NOT fall back to unified default daily. It SHALL ensure input excludes separately counted cache reads exactly once, retain output including reasoning exactly once, set cache creation to zero, and transmit only token counts, estimated cost and model metadata plus routing identity.

#### Scenario: Compatible patch without source fallback

- **WHEN** a synthetic 20.0.21 collector returns the known valid Codex daily schema through codex daily
- **THEN** sync SHALL accept the snapshot without rejecting its patch number
- **AND** malformed, Claude-only or unified output, or failure of the explicit command, SHALL fail without a fallback to default daily

#### Scenario: Cached input and reasoning

- **WHEN** raw Codex usage is input 1000, cached input 400, output 200 and reasoning 50, and the verified ccusage 20.0.20 collector returns canonical inputTokens 600 and cacheReadTokens 400
- **THEN** ingestion SHALL receive input_tokens 600, cache_read_tokens 400, output_tokens 200 and cache_creation_tokens 0

#### Scenario: Repeated combined ingestion

- **WHEN** Claude daily and Codex codex-daily snapshots for one member/date are each submitted twice
- **THEN** two records SHALL remain and reports SHALL sum each source once

#### Scenario: Invalid or empty output

- **WHEN** collector data has unknown schema, invalid dates, malformed JSON, negative or non-finite values, inconsistent total tokens, or a missing reader
- **THEN** manual sync SHALL return nonzero and record a content-free error without posting fabricated zeros
- **WHEN** the verified daily array is empty
- **THEN** sync SHALL report no data without creating a zero snapshot


<!-- @trace
source: add-codex-usage-and-update
updated: 2026-09-17
code:
  - packages/cli/src/config.ts
  - packages/server/src/hook-scripts/codex-sync.mjs
  - README.md
  - packages/cli/src/commands/setup.ts
  - packages/cli/src/scripts.ts
  - packages/server/src/hook-scripts/session-end.mjs
  - packages/cli/src/commands/status.ts
  - packages/cli/src/hooks.ts
  - CHANGELOG.md
  - packages/cli/src/commands/sync.ts
  - packages/cli/README.md
  - packages/server/src/app.ts
  - packages/cli/src/commands/update.ts
  - packages/server/src/scripts.ts
  - packages/server/src/hook-scripts/codex-sync.d.mts
  - packages/cli/src/index.ts
tests:
  - packages/server/src/claude-usage.test.ts
  - packages/server/src/routes/source-aggregation.test.ts
  - packages/server/src/codex-usage.test.ts
  - packages/cli/src/commands/update.test.ts
-->

---
### Requirement: Isolated retry and notification

Codex SHALL use independent locks, buffers and status files. A newer snapshot SHALL supersede buffered snapshots for the same identity before replay; a failed source SHALL NOT modify the other source's pending data. The hook entry SHALL discard event payload content and only act on `Stop` and `SessionEnd`. The legacy `--notify` entry SHALL remain functional for users who configured it manually, SHALL discard JSON payload content and SHALL only act on agent-turn-complete; documentation SHALL mark it as deprecated in favor of hooks.

#### Scenario: Offline recovery

- **WHEN** a snapshot of 100 tokens fails offline and the next snapshot of 200 succeeds
- **THEN** the final stored snapshot SHALL remain 200 and the stale 100 snapshot SHALL NOT overwrite it

#### Scenario: Notification privacy and standalone operation

- **WHEN** a Codex completion payload containing raw messages arrives as argv through `--notify` or as stdin through `--hook` with Claude unavailable
- **THEN** the Codex reporter SHALL run without Claude and SHALL NOT log, persist or forward those messages

#### Scenario: Independent concurrency

- **WHEN** Claude and Codex reporting overlap or two Codex syncs overlap
- **THEN** sources SHALL use independent locks and same-source buffer writes SHALL be serialized

#### Scenario: Hook and notify both configured

- **WHEN** a user still has the manual notify entry and the hooks are installed and trusted
- **THEN** the second trigger inside the throttle window SHALL NOT start a worker and the same-day snapshot SHALL remain a single idempotent record

---
### Requirement: Hook entry point never blocks Codex

The Codex reporter SHALL provide a `--hook` mode for Codex hooks. In this mode it SHALL read stdin to end of input with a 2 second limit and a 64 KB limit, parse it as JSON and use only the `hook_event_name` field. When the event is `Stop` or `SessionEnd` it SHALL start the detached background worker; for any other event it SHALL exit 0 without starting the worker. Any read, parse or validation error in hook mode SHALL exit 0 without starting the worker and SHALL NOT write the error file. Stdin content SHALL NOT be written to disk, passed as worker arguments or included in any message.

#### Scenario: Stop event starts the worker

- **WHEN** the script runs with `--hook` and stdin is `{"hook_event_name":"Stop","session_id":"s1","cwd":"/tmp"}`
- **THEN** exactly one detached worker SHALL start and the parent SHALL exit 0 before the worker finishes

#### Scenario: Other events are ignored

- **WHEN** the script runs with `--hook` and stdin is `{"hook_event_name":"UserPromptSubmit"}`
- **THEN** no worker SHALL start and the parent SHALL exit 0

#### Scenario: Malformed stdin

- **WHEN** the script runs with `--hook` and stdin is not JSON, is empty, or exceeds 64 KB
- **THEN** no worker SHALL start, the parent SHALL exit 0 and no error file SHALL be written

#### Scenario: Payload privacy

- **WHEN** the hook payload contains a `transcript_path` and message text
- **THEN** none of that content SHALL appear in the worker arguments, the buffer, the error file or stdout

---
### Requirement: Hook-triggered throttle

Hook and notify triggers SHALL check `~/.config/ccusage-tracker/codex-last-flush.txt` before starting the worker. When the recorded timestamp is less than 5 minutes old the trigger SHALL NOT start the worker. When the check passes the trigger SHALL write the current timestamp before starting the worker. Manual `sync codex` SHALL ignore the throttle.

#### Scenario: Second trigger within five minutes

- **WHEN** a `Stop` hook triggers at T and another `Stop` hook triggers at T plus 2 minutes
- **THEN** only the first trigger SHALL start a worker

#### Scenario: Manual sync during throttle

- **WHEN** `tracker sync codex` runs 1 minute after a hook-triggered worker
- **THEN** the manual sync SHALL run the collector and report the result
