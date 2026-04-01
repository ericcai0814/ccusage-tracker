# local-buffer Specification

## Purpose

Provides local buffering and retry for the SessionEnd hook, ensuring usage data is not permanently lost when the server is unreachable.

## ADDED Requirements

### Requirement: Buffer failed POST payloads locally

The SessionEnd hook SHALL write the JSON payload to `~/.config/ccusage-tracker/buffer.jsonl` when the POST to `/api/ingest` fails (non-2xx HTTP status or connection failure). Each buffered line SHALL include the original payload fields plus a `_buffered_at` ISO 8601 timestamp. If the buffer file write fails (disk full, permission denied), the hook SHALL silently skip the write without affecting hook exit status.

#### Scenario: Server unreachable during POST

- **WHEN** the hook attempts to POST usage data and the server is unreachable (connection timeout or non-2xx response)
- **THEN** the hook SHALL append the JSON payload with a `_buffered_at` timestamp to `~/.config/ccusage-tracker/buffer.jsonl`

#### Scenario: Successful POST

- **WHEN** the hook POSTs usage data and receives a 2xx response
- **THEN** the hook SHALL NOT write anything to the buffer file

#### Scenario: Buffer write failure

- **WHEN** the hook attempts to append to `buffer.jsonl` but the write fails (disk full, permission denied, directory missing)
- **THEN** the hook SHALL silently skip the buffer write and exit with code 0

### Requirement: Retry buffered payloads on next hook invocation

The SessionEnd hook SHALL attempt to resend all buffered payloads from `buffer.jsonl` before sending the current session's data. Each buffered line SHALL be POSTed individually with a 5-second timeout per request, under a 15-second total time limit for the entire retry phase. Successfully sent lines SHALL be collected during the retry loop and removed from the buffer file in a single atomic rewrite (write to temp file, then `mv`) after the loop completes. Failed lines SHALL remain in the buffer for the next retry.

#### Scenario: Buffer file exists with pending entries

- **WHEN** the hook is triggered and `buffer.jsonl` contains one or more lines
- **THEN** the hook SHALL POST each line to `/api/ingest` in order, track which lines succeeded, and atomically rewrite the buffer file to contain only the failed lines

#### Scenario: Buffer file does not exist

- **WHEN** the hook is triggered and `buffer.jsonl` does not exist
- **THEN** the hook SHALL skip the retry step and proceed to collect current usage data

#### Scenario: Retry total time limit

- **WHEN** the retry process has been running for more than 15 seconds
- **THEN** the hook SHALL abort remaining retries, keep unprocessed lines in the buffer, and proceed to collect current usage data

### Requirement: Expire old buffered entries

The SessionEnd hook SHALL remove buffered entries older than 7 days based on the `_buffered_at` timestamp. Expiry cleanup SHALL occur after the retry step and before collecting current usage data. Entries with missing or malformed `_buffered_at` timestamps SHALL be treated as expired and removed.

#### Scenario: Buffer contains entries older than 7 days

- **WHEN** the hook processes the buffer and finds entries where `_buffered_at` is more than 7 days ago
- **THEN** the hook SHALL remove those entries from the buffer file without attempting to send them

#### Scenario: All entries within 7 days

- **WHEN** the hook processes the buffer and all entries have `_buffered_at` within 7 days
- **THEN** the hook SHALL retain all entries (successful retries are still removed normally)

#### Scenario: Malformed buffered entry

- **WHEN** the hook encounters a buffer line with a missing or unparseable `_buffered_at` timestamp
- **THEN** the hook SHALL remove that entry from the buffer file
