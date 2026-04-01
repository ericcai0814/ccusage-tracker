## ADDED Requirements

### Requirement: Report usage on session end

The SessionEnd hook script SHALL execute when a Claude Code session ends, collect token usage data via `ccusage`, and POST it to the configured server.

#### Scenario: Successful session end report

- **WHEN** a Claude Code session ends and the hook is triggered
- **THEN** the hook SHALL read the config file at `~/.config/ccusage-tracker/config.json`, invoke `ccusage session --json --since today`, extract token data, and POST to the server's `/api/ingest` endpoint

#### Scenario: Config file missing

- **WHEN** the hook is triggered but `~/.config/ccusage-tracker/config.json` does not exist
- **THEN** the hook SHALL exit with code 0 without performing any action

#### Scenario: ccusage not installed

- **WHEN** the hook is triggered but the `ccusage` command is not found
- **THEN** the hook SHALL exit with code 0 without performing any action

### Requirement: Non-blocking execution

The hook SHALL NOT block Claude Code from exiting, regardless of success or failure.

#### Scenario: Server unreachable

- **WHEN** the hook attempts to POST but the server is unreachable
- **THEN** the hook SHALL fail silently (background curl) and exit with code 0

#### Scenario: Background POST

- **WHEN** the hook sends the POST request
- **THEN** the hook SHALL execute the curl command in the background (`&`) and exit immediately

### Requirement: Read hook payload

The hook SHALL read the JSON payload from stdin provided by Claude Code's SessionEnd event.

#### Scenario: Extract session_id from payload

- **WHEN** the hook receives a JSON payload on stdin containing `session_id`
- **THEN** the hook SHALL extract the `session_id` and include it in the POST body

#### Scenario: Malformed or empty payload

- **WHEN** the hook receives malformed JSON or empty stdin
- **THEN** the hook SHALL proceed with an empty `session_id` and still attempt to report usage

### Requirement: Privacy protection

The hook SHALL only transmit token counts and metadata. It SHALL NOT transmit conversation content.

#### Scenario: Data transmitted

- **WHEN** the hook constructs the POST body
- **THEN** the body SHALL contain only: `date`, `session_id`, `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`, `total_cost_usd`, and `models`
