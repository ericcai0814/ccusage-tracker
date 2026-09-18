## ADDED Requirements

### Requirement: Noninteractive update

The CLI SHALL provide update using existing validated server_url, team_key and member_name without prompts. It SHALL download and validate required scripts before installation, preserve config bytes, buffer and sessions, migrate only tracker hooks, preserve unrelated settings and matcher fields, back up changed files and remain idempotent. Failure SHALL return nonzero with actionable guidance and preserve the working installation.

#### Scenario: Repeated update

- **WHEN** update runs twice with existing config, third-party hooks and pending data in a home path containing spaces
- **THEN** config and pending data SHALL remain byte-identical, tracker hooks SHALL occur once and unrelated hooks SHALL retain all fields

#### Scenario: Missing configuration or failed installation

- **WHEN** config is missing or invalid, required download fails, or installation fails
- **THEN** update SHALL return nonzero, SHALL NOT claim success, and SHALL preserve prior scripts/settings; invalid config SHALL include setup guidance

#### Scenario: Older server

- **WHEN** only the Codex script endpoint returns 404 or 410
- **THEN** update SHALL retain the Claude path and any prior Codex script and explicitly report that Codex support requires the corresponding server version

### Requirement: Codex command and adoption

Setup and update SHALL make the Codex script available when the server supports it. The CLI SHALL provide sync codex to run it and return its exit status, and status SHALL distinguish installed support, reader availability, pending data, collection errors and confirmed uploads. Missing Claude SHALL NOT prevent Codex-only usage.

#### Scenario: Manual sync

- **WHEN** a configured user runs tracker sync codex with the supported collector and no Claude installation
- **THEN** the installed script SHALL run under Node and report the actual result

#### Scenario: Missing optional prerequisites

- **WHEN** the Codex script, required Node version or collector is absent
- **THEN** status or sync SHALL give an actionable diagnosis without breaking Claude-only operation

#### Scenario: Existing notify integration

- **WHEN** setup or update runs
- **THEN** it SHALL NOT modify Codex TOML, and documentation SHALL give exact manual opt-in notify instructions and distinguish unreleased CLI behavior from server hook deployment

## MODIFIED Requirements

### Requirement: Setup command

The CLI SHALL provide a `setup` command that configures the user's machine for automatic usage reporting. Hook commands written by setup SHALL quote each tracker script absolute path with double quotes so paths containing spaces remain a single `node` argument.

#### Scenario: Interactive setup

- **WHEN** the user runs `tracker setup`
- **THEN** the CLI SHALL interactively prompt for: member name, server URL, and team key

#### Scenario: Write config file

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL write the configuration to `~/.config/ccusage-tracker/config.json` containing `server_url`, `team_key`, and `member_name`

#### Scenario: Install SessionStart hook with quoted script path

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL patch `~/.claude/settings.json` to add a SessionStart hook entry whose command is `node "<home>/.config/ccusage-tracker/session-start.mjs"`

#### Scenario: Install SessionEnd hook with quoted script path

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL patch `~/.claude/settings.json` to add a SessionEnd hook entry whose command is `node "<home>/.config/ccusage-tracker/session-end.mjs" --mode=session-end`, preserving all existing hooks via deep merge

#### Scenario: Install Stop hook with quoted script path

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL patch `~/.claude/settings.json` to add a Stop hook entry whose command is `node "<home>/.config/ccusage-tracker/session-end.mjs" --mode=stop`

#### Scenario: Upgrade existing unquoted tracker hook commands

- **WHEN** setup runs on a machine whose `~/.claude/settings.json` already contains ccusage-tracker hook commands without quoted script paths
- **THEN** the CLI SHALL replace those tracker hook commands with the quoted canonical commands and report the affected hook as changed

#### Scenario: Backup settings before patch

- **WHEN** the CLI patches `~/.claude/settings.json`
- **THEN** the CLI SHALL create a backup at `~/.claude/settings.json.backup` before modifying

#### Scenario: Verify server connectivity

- **WHEN** setup completes
- **THEN** the CLI SHALL call `GET /api/health` on the configured server and report whether it is reachable

#### Scenario: Check ccusage installation

- **WHEN** setup runs
- **THEN** the CLI SHALL check if `ccusage` is available in PATH and warn the user with installation instructions if not found
