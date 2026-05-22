## MODIFIED Requirements

### Requirement: Report usage on session end

The SessionEnd hook SHALL execute when a Claude Code session ends as a subcommand of the `tracker` CLI (`tracker hook session-end`), collect token usage data via `ccusage`, and POST it to the configured server. The hook MUST run on Node 18+ and SHALL NOT depend on `bash`, `jq`, or any shell-specific tooling.

#### Scenario: Successful session end report

- **WHEN** a Claude Code session ends and `tracker hook session-end` is triggered
- **THEN** the hook SHALL read the config file at `~/.config/ccusage-tracker/config.json`, invoke `ccusage daily --json --since <today>`, extract token totals, and POST to the server's `/api/ingest` endpoint with the same body shape produced by prior versions

#### Scenario: Config file missing

- **WHEN** the hook is triggered but `~/.config/ccusage-tracker/config.json` does not exist
- **THEN** the hook SHALL exit with code 0 without performing any action

#### Scenario: ccusage not installed

- **WHEN** the hook is triggered but the `ccusage` command is not found in PATH
- **THEN** the hook SHALL exit with code 0 without performing any action

#### Scenario: Cross-platform ccusage invocation

- **WHEN** the hook invokes `ccusage` on Windows
- **THEN** the hook SHALL resolve the Windows `ccusage.cmd` shim via `child_process.execFile` with `shell: true`, and SHALL NOT require a POSIX shell

##### Example: platform-specific ccusage resolution

| Platform | Resolved executable | Mechanism |
| -------- | ------------------- | --------- |
| macOS    | `ccusage`           | PATH lookup via execFile |
| Linux    | `ccusage`           | PATH lookup via execFile |
| Windows  | `ccusage.cmd`       | execFile with `shell: true` delegates to cmd.exe |

---

### Requirement: Non-blocking execution

The hook SHALL NOT block Claude Code from exiting, regardless of success or failure. The hook process SHALL exit with code 0 within a bounded time even when network I/O is pending.

#### Scenario: Server unreachable

- **WHEN** the hook attempts to POST but the server is unreachable
- **THEN** the hook SHALL persist the payload to `~/.config/ccusage-tracker/buffer.jsonl` (appended with a `_buffered_at` ISO-8601 timestamp field) and exit with code 0

#### Scenario: Background POST

- **WHEN** the hook sends the POST request
- **THEN** the hook SHALL initiate the POST without awaiting completion before exit (e.g., using `unref()` on the underlying handle or a detached child process), allowing the Node process to exit within 1 second of receiving the SessionEnd event in the common case

#### Scenario: Hook uncaught exception

- **WHEN** the hook encounters an unhandled exception during execution
- **THEN** the hook SHALL catch the exception, exit with code 0, and SHALL NOT print a stack trace to stderr unless `CCUSAGE_TRACKER_DEBUG=1` is set in the environment

---

### Requirement: Read hook payload

The hook SHALL read the JSON payload from stdin provided by Claude Code's SessionEnd event using Node's built-in stdin streaming, and SHALL NOT depend on external JSON parsers.

#### Scenario: Extract session_id from payload

- **WHEN** the hook receives a JSON payload on stdin containing `session_id`
- **THEN** the hook SHALL parse the payload using `JSON.parse`, extract the `session_id`, and include it in the POST body

#### Scenario: Extract transcript_path from payload

- **WHEN** the hook receives a JSON payload on stdin containing `transcript_path`
- **THEN** the hook SHALL read the transcript file, compute session metrics (turns, tool calls, files touched, approximate token count, duration), and POST them to `/api/ingest/session` with the same field set produced by the prior bash hook

#### Scenario: Malformed or empty payload

- **WHEN** the hook receives malformed JSON or empty stdin
- **THEN** the hook SHALL proceed with an empty `session_id` and SHALL still attempt to report daily usage

---

### Requirement: Privacy protection

The hook SHALL only transmit token counts, session metrics, and metadata. It SHALL NOT transmit conversation content (user or assistant message bodies, tool inputs, tool outputs).

#### Scenario: Data transmitted to /api/ingest

- **WHEN** the hook constructs the POST body for `/api/ingest`
- **THEN** the body SHALL contain only: `date`, `session_id`, `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`, `total_cost_usd`, `models`, and `member_name`

#### Scenario: Data transmitted to /api/ingest/session

- **WHEN** the hook constructs the POST body for `/api/ingest/session`
- **THEN** the body SHALL contain only structural metrics (counts, names, durations, paths' basenames) and SHALL NOT contain any message content, tool input arguments, or tool output text

## ADDED Requirements

### Requirement: Buffer retry on next session end

The hook SHALL attempt to resend buffered payloads before sending the current session's payload. Buffered entries older than 7 days SHALL be dropped.

#### Scenario: Successful retry

- **WHEN** the hook starts and `buffer.jsonl` contains entries less than 7 days old
- **THEN** the hook SHALL POST each entry to `/api/ingest`, remove successfully sent entries from the buffer, and retain entries whose POST failed

#### Scenario: Retry time budget

- **WHEN** the hook is processing buffered retries
- **THEN** the hook SHALL spend no more than 15 seconds total on retries before proceeding to send the current session payload

#### Scenario: Expired buffer entries

- **WHEN** the hook reads a buffered entry with `_buffered_at` older than 7 days
- **THEN** the hook SHALL drop the entry without attempting to resend it

##### Example: buffer retention behavior

| `_buffered_at`        | Current time          | Action      |
| --------------------- | --------------------- | ----------- |
| 2026-05-22T10:00:00Z  | 2026-05-22T18:00:00Z  | retry       |
| 2026-05-20T10:00:00Z  | 2026-05-22T18:00:00Z  | retry       |
| 2026-05-15T09:00:00Z  | 2026-05-22T18:00:00Z  | drop (>7d)  |
| missing `_buffered_at`| 2026-05-22T18:00:00Z  | drop        |

---

### Requirement: Session start hook records model

The SessionStart hook SHALL execute as `tracker hook session-start`, read the JSON payload from stdin, and persist the active model name for later use by SessionEnd to compute context window utilization.

#### Scenario: Persist model on session start

- **WHEN** `tracker hook session-start` receives a payload containing `session_id` and `model`
- **THEN** the hook SHALL write the model string to `~/.config/ccusage-tracker/sessions/<session_id>` and exit with code 0

#### Scenario: Missing model or session_id

- **WHEN** the payload lacks either `session_id` or `model`
- **THEN** the hook SHALL exit with code 0 without writing any file

#### Scenario: SessionEnd reads recorded model

- **WHEN** `tracker hook session-end` runs and `~/.config/ccusage-tracker/sessions/<session_id>` exists
- **THEN** the hook SHALL read the model string, include it in the `/api/ingest/session` POST body as `model`, delete the file, and compute `context_estimate_pct` based on the model's context window limit

## REMOVED Requirements

### Requirement: Hook delivered as bash script via server endpoint

**Reason**: The bash script delivery model required `bash` and `jq` runtime dependencies that are not available on Windows by default, and the manual `curl -o` update flow lacked version visibility. The hook is now delivered as a Node CLI subcommand distributed via npm.

**Migration**: Existing installations are migrated automatically by `tracker setup`, which detects the legacy `bash <path>/session-end.sh` command in `~/.claude/settings.json` and rewrites it to `tracker hook session-end`. The legacy `~/.config/ccusage-tracker/session-end.sh` file is retained for two release cycles before being removed by setup.

#### Scenario: Legacy bash hook delivery (no longer supported)

- **WHEN** a user previously ran `curl -fsSL <server>/setup.sh | bash`
- **THEN** the legacy flow installed `~/.config/ccusage-tracker/session-end.sh` and wrote `bash <path>/session-end.sh` into `~/.claude/settings.json`; this delivery path SHALL no longer be supported by the server or the CLI

#### Scenario: Legacy server endpoint requests (no longer served)

- **WHEN** a client requests `GET /setup.sh`, `GET /uninstall.sh`, `GET /scripts/session-end.sh`, or `GET /scripts/session-start.sh` after this change ships
- **THEN** the server SHALL return HTTP 404, and the routes SHALL NOT be present in the server's route table
