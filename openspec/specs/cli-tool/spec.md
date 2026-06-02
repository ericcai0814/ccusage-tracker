# cli-tool Specification

## Purpose

TBD - created by archiving change 'ccusage-tracker-mvp'. Update Purpose after archive.

## Requirements

### Requirement: Setup command

The CLI SHALL provide a `setup` command that configures the user's machine for automatic usage reporting. Hook commands written by setup SHALL quote each tracker script absolute path with double quotes so paths containing spaces remain a single `node` argument.

#### Scenario: Interactive setup

- **WHEN** the user runs `tracker setup`
- **THEN** the CLI SHALL interactively prompt for: member name, server URL, and API key

#### Scenario: Write config file

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL write the configuration to `~/.config/ccusage-tracker/config.json` containing `server_url`, `api_key`, and `member_name`

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


<!-- @trace
source: fix-windows-hook-path-quoting
updated: 2026-06-02
code:
  - packages/cli/src/hooks.ts
tests:
  - packages/cli/src/hooks.test.ts
-->

---
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


<!-- @trace
source: ccusage-tracker-mvp
updated: 2026-03-31
code:
  - packages/server/src/routes/report.ts
  - packages/server/src/app.ts
  - Dockerfile
  - packages/server/src/routes/ingest.ts
  - .dockerignore
  - packages/server/src/routes/dashboard.tsx
  - packages/server/src/queries.ts
  - packages/server/src/middleware/team-auth.ts
  - packages/server/src/scripts.ts
  - README.md
tests:
  - packages/server/src/routes/report.test.ts
  - packages/server/src/routes/ingest.test.ts
  - packages/server/src/routes/dashboard.test.ts
  - packages/server/src/queries.test.ts
-->

---
### Requirement: Status command

The CLI SHALL provide a `status` command that displays the current configuration state.

#### Scenario: Show status

- **WHEN** the user runs `tracker status`
- **THEN** the CLI SHALL display: config file path and existence, server URL and reachability, hook installation status, and member name

<!-- @trace
source: ccusage-tracker-mvp
updated: 2026-03-31
code:
  - packages/server/src/routes/report.ts
  - packages/server/src/app.ts
  - Dockerfile
  - packages/server/src/routes/ingest.ts
  - .dockerignore
  - packages/server/src/routes/dashboard.tsx
  - packages/server/src/queries.ts
  - packages/server/src/middleware/team-auth.ts
  - packages/server/src/scripts.ts
  - README.md
tests:
  - packages/server/src/routes/report.test.ts
  - packages/server/src/routes/ingest.test.ts
  - packages/server/src/routes/dashboard.test.ts
  - packages/server/src/queries.test.ts
-->