## ADDED Requirements

### Requirement: Setup command

The CLI SHALL provide a `setup` command that configures the user's machine for automatic usage reporting.

#### Scenario: Interactive setup

- **WHEN** the user runs `tracker setup`
- **THEN** the CLI SHALL interactively prompt for: member name, server URL, and API key

#### Scenario: Write config file

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL write the configuration to `~/.config/ccusage-tracker/config.json` containing `server_url`, `api_key`, and `member_name`

#### Scenario: Install SessionEnd hook

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL patch `~/.claude/settings.json` to add a SessionEnd hook entry, preserving all existing hooks via deep merge

#### Scenario: Backup settings before patch

- **WHEN** the CLI patches `~/.claude/settings.json`
- **THEN** the CLI SHALL create a backup at `~/.claude/settings.json.backup` before modifying

#### Scenario: Verify server connectivity

- **WHEN** setup completes
- **THEN** the CLI SHALL call `GET /api/health` on the configured server and report whether it is reachable

#### Scenario: Check ccusage installation

- **WHEN** setup runs
- **THEN** the CLI SHALL check if `ccusage` is available in PATH and warn the user with installation instructions if not found

### Requirement: Report command

The CLI SHALL provide a `report` command that queries the server and displays token usage in the terminal.

#### Scenario: Default report

- **WHEN** the user runs `tracker report`
- **THEN** the CLI SHALL query `/api/report/summary?period=month` and display a formatted table with all members' usage

#### Scenario: Period filter

- **WHEN** the user runs `tracker report --period week`
- **THEN** the CLI SHALL query the server with the specified period (today, week, or month)

#### Scenario: JSON output

- **WHEN** the user runs `tracker report --json`
- **THEN** the CLI SHALL output the raw JSON response from the server

### Requirement: Status command

The CLI SHALL provide a `status` command that displays the current configuration state.

#### Scenario: Show status

- **WHEN** the user runs `tracker status`
- **THEN** the CLI SHALL display: config file path and existence, server URL and reachability, hook installation status, and member name
