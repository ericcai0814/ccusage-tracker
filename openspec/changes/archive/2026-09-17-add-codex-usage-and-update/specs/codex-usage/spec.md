## Purpose

Collect local Codex subscription usage as isolated daily snapshots through the supported ccusage reader. Provide manual and opt-in turn-complete reporting without model API credentials or conversation content uploads.

## ADDED Requirements

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

### Requirement: Isolated retry and notification

Codex SHALL use independent locks, buffers and status files. A newer snapshot SHALL supersede buffered snapshots for the same identity before replay; a failed source SHALL NOT modify the other source's pending data. The notify entry SHALL discard JSON payload content and only act on agent-turn-complete.

#### Scenario: Offline recovery

- **WHEN** a snapshot of 100 tokens fails offline and the next snapshot of 200 succeeds
- **THEN** the final stored snapshot SHALL remain 200 and the stale 100 snapshot SHALL NOT overwrite it

#### Scenario: Notification privacy and standalone operation

- **WHEN** a Codex completion payload containing raw messages arrives as argv with Claude unavailable
- **THEN** the Codex reporter SHALL run without Claude and SHALL NOT log, persist or forward those messages

#### Scenario: Independent concurrency

- **WHEN** Claude and Codex reporting overlap or two Codex syncs overlap
- **THEN** sources SHALL use independent locks and same-source buffer writes SHALL be serialized
