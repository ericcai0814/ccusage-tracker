# cli-tool Specification

## Purpose

TBD - created by archiving change 'ccusage-tracker-mvp'. Update Purpose after archive.

## Requirements

### Requirement: Setup command

The CLI SHALL provide a `setup` command that configures the user's machine for automatic usage reporting for every detected tool. Hook commands written by setup SHALL quote each tracker script absolute path with double quotes so paths containing spaces remain a single `node` argument. Setup SHALL run tool detection, the Claude hook installation, the Codex hook installation and the collector step, and SHALL print one result line per tool followed by the collector result.

#### Scenario: Interactive setup

- **WHEN** the user runs `tracker setup`
- **THEN** the CLI SHALL interactively prompt for: member name, server URL, and team key

#### Scenario: Write config file

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL write the configuration to `~/.config/ccusage-tracker/config.json` containing `server_url`, `team_key`, and `member_name`

#### Scenario: Install SessionStart hook with quoted script path

- **WHEN** setup completes successfully and Claude Code is detected
- **THEN** the CLI SHALL patch `~/.claude/settings.json` to add a SessionStart hook entry whose command is `node "<home>/.config/ccusage-tracker/session-start.mjs"`

#### Scenario: Install SessionEnd hook with quoted script path

- **WHEN** setup completes successfully and Claude Code is detected
- **THEN** the CLI SHALL patch `~/.claude/settings.json` to add a SessionEnd hook entry whose command is `node "<home>/.config/ccusage-tracker/session-end.mjs" --mode=session-end`, preserving all existing hooks via deep merge

#### Scenario: Install Stop hook with quoted script path

- **WHEN** setup completes successfully and Claude Code is detected
- **THEN** the CLI SHALL patch `~/.claude/settings.json` to add a Stop hook entry whose command is `node "<home>/.config/ccusage-tracker/session-end.mjs" --mode=stop`

#### Scenario: Install Codex hooks

- **WHEN** setup completes successfully and Codex is detected and the server provides the Codex script
- **THEN** the CLI SHALL install the tracker `Stop` and `SessionEnd` groups into `$CODEX_HOME/hooks.json` as defined by the Codex hook installation requirement, and SHALL leave `$CODEX_HOME/config.toml` byte-identical

#### Scenario: Upgrade existing unquoted tracker hook commands

- **WHEN** setup runs on a machine whose `~/.claude/settings.json` already contains ccusage-tracker hook commands without quoted script paths
- **THEN** the CLI SHALL replace those tracker hook commands with the quoted canonical commands and report the affected hook as changed

#### Scenario: Backup settings before patch

- **WHEN** the CLI patches `~/.claude/settings.json` or `$CODEX_HOME/hooks.json`
- **THEN** the CLI SHALL create a backup next to the file with the `.backup` suffix before modifying

#### Scenario: Verify server connectivity

- **WHEN** setup completes
- **THEN** the CLI SHALL call `GET /api/health` on the configured server and report whether it is reachable

#### Scenario: Ensure collector installation

- **WHEN** setup runs
- **THEN** the CLI SHALL run the collector step defined by the Collector dependency requirement and print its result

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

The CLI SHALL provide a `status` command that displays the current configuration state, the Claude hook state and the Codex hook state including its trust state as recorded by Codex.

#### Scenario: Show status

- **WHEN** the user runs `tracker status`
- **THEN** the CLI SHALL display: config file path and existence, server URL and reachability, hook installation status, and member name

#### Scenario: Codex hook trust recorded

- **WHEN** `$CODEX_HOME/hooks.json` contains the tracker `Stop` group at index N and `$CODEX_HOME/config.toml` contains a `[hooks.state."<hooks path>:stop:N:0"]` section with a `trusted_hash` key
- **THEN** status SHALL print `Codex hooks: installed, trust recorded`

#### Scenario: Codex hook awaiting trust

- **WHEN** the tracker `Stop` group is installed and no matching `hooks.state` section with `trusted_hash` exists, or `config.toml` is missing
- **THEN** status SHALL print `Codex hooks: installed, awaiting trust (open /hooks in Codex)`

#### Scenario: Codex hook disabled

- **WHEN** the matching `hooks.state` section contains `enabled = false`
- **THEN** status SHALL print `Codex hooks: installed, disabled in Codex`

#### Scenario: Codex not detected in status

- **WHEN** Codex is not detected
- **THEN** status SHALL print a single line `Codex: not detected` instead of the Codex block

---
### Requirement: Noninteractive update

The CLI SHALL provide update using existing validated server_url, team_key and member_name without prompts. It SHALL download and validate required scripts before installation, preserve config bytes, buffer and sessions, migrate only tracker hooks, preserve unrelated settings and matcher fields, back up changed files and remain idempotent. Update SHALL run the same tool detection, Codex hook installation and collector step as setup. Failure SHALL return nonzero with actionable guidance and preserve the working installation.

#### Scenario: Repeated update

- **WHEN** update runs twice with existing config, third-party hooks in both `~/.claude/settings.json` and `$CODEX_HOME/hooks.json`, and pending data in a home path containing spaces
- **THEN** config and pending data SHALL remain byte-identical, tracker hooks SHALL occur once per event in each file, and unrelated hooks SHALL retain all fields and their order

#### Scenario: Missing configuration or failed installation

- **WHEN** config is missing or invalid, required download fails, or installation fails
- **THEN** update SHALL return nonzero, SHALL NOT claim success, and SHALL preserve prior scripts/settings; invalid config SHALL include setup guidance

#### Scenario: Older server

- **WHEN** only the Codex script endpoint returns 404 or 410
- **THEN** update SHALL retain the Claude path and any prior Codex script, SHALL NOT write `$CODEX_HOME/hooks.json`, and SHALL explicitly report that Codex support requires the corresponding server version

#### Scenario: Update never requires manual sync

- **WHEN** update completes on a machine with Codex detected and the Codex hooks trusted
- **THEN** Codex usage SHALL be reported automatically at the next `Stop` or `SessionEnd` event without running `tracker sync codex`

---
### Requirement: Codex command and adoption

Setup and update SHALL make the Codex script available and SHALL wire it through Codex hooks when the server supports it. The CLI SHALL provide `sync codex` as a manual fallback and debugging command that runs the script and returns its exit status; normal operation SHALL NOT depend on it. Status SHALL distinguish installed support, hook trust state, reader availability, pending data, collection errors and confirmed uploads. Missing Claude SHALL NOT prevent Codex-only usage.

#### Scenario: Manual sync

- **WHEN** a configured user runs tracker sync codex with the supported collector and no Claude installation
- **THEN** the installed script SHALL run under Node and report the actual result

#### Scenario: Missing optional prerequisites

- **WHEN** the Codex script, required Node version or collector is absent
- **THEN** status or sync SHALL give an actionable diagnosis without breaking Claude-only operation

#### Scenario: Help text positions sync codex as optional

- **WHEN** the user runs `tracker` without a command
- **THEN** the `sync codex` line SHALL read `Report Codex usage now (manual fallback / debugging)`

#### Scenario: Configuration files outside the tracker

- **WHEN** setup or update runs
- **THEN** it SHALL write only `$CODEX_HOME/hooks.json` among Codex files, SHALL NOT modify `$CODEX_HOME/config.toml`, and documentation SHALL describe the one-time `/hooks` trust step and mark the manual notify path as deprecated

---
### Requirement: Tool detection

Setup and update SHALL detect which supported tools exist on the machine and SHALL wire automatic reporting for each detected tool. Claude Code SHALL count as detected when the `~/.claude` directory exists or `claude` is on PATH. Codex SHALL count as detected when the `$CODEX_HOME` directory (default `~/.codex`) exists or `codex` is on PATH. The final output SHALL contain one result line per tool.

#### Scenario: Both tools detected

- **WHEN** setup or update runs on a machine with `~/.claude` and `~/.codex`
- **THEN** the CLI SHALL install Claude hooks into `~/.claude/settings.json` and Codex hooks into `$CODEX_HOME/hooks.json`, and SHALL print a `Claude Code:` result line and a `Codex:` result line

#### Scenario: Codex not detected

- **WHEN** neither the `$CODEX_HOME` directory exists nor `codex` is on PATH
- **THEN** the CLI SHALL NOT create `$CODEX_HOME/hooks.json` and SHALL print `Codex: not detected`

#### Scenario: No tool detected

- **WHEN** neither Claude Code nor Codex is detected
- **THEN** setup SHALL still save the configuration, print that no supported tool was detected, advise running update after installing one, and exit 0
- **AND** update SHALL print the same advice and exit nonzero

---
### Requirement: Codex hook installation

Setup and update SHALL install tracker hooks into the user-level Codex hooks file `$CODEX_HOME/hooks.json` for the `Stop` and `SessionEnd` events. Each installed group SHALL contain exactly one command hook whose command is `node "<home>/.config/ccusage-tracker/codex-sync.mjs" --hook` with timeout 45, and the group SHALL NOT contain a `matcher` key. The CLI SHALL append the tracker group at the end of the event array when absent and SHALL replace an existing tracker group in place at its original index when its content differs. The CLI SHALL NOT remove, reorder or rewrite non-tracker groups, other events or other top-level keys. The CLI SHALL NOT read the hooks file as executable input and SHALL NOT modify `$CODEX_HOME/config.toml`.

#### Scenario: First installation with third-party hooks present

- **WHEN** `$CODEX_HOME/hooks.json` already contains three third-party `Stop` groups and no tracker group
- **THEN** after setup the three groups SHALL remain byte-identical at indexes 0 to 2 and the tracker group SHALL be at index 3, and a `SessionEnd` tracker group SHALL exist

#### Scenario: Repeated installation is idempotent

- **WHEN** update runs twice on the same machine
- **THEN** the second run SHALL NOT change `$CODEX_HOME/hooks.json` and SHALL report the Codex hooks as already up to date

#### Scenario: Legacy tracker command replaced in place

- **WHEN** a `Stop` group at index 1 contains a tracker command that differs from the canonical command
- **THEN** the CLI SHALL replace that group at index 1 with the canonical group and SHALL leave groups at other indexes unchanged

#### Scenario: Invalid hooks file

- **WHEN** `$CODEX_HOME/hooks.json` exists but is not a JSON object or its `hooks` value is not an object
- **THEN** the CLI SHALL NOT write any file in that transaction, SHALL exit nonzero and SHALL ask the user to repair the file

#### Scenario: Server without Codex script

- **WHEN** the server returns 404 or 410 for the Codex script
- **THEN** the CLI SHALL NOT write `$CODEX_HOME/hooks.json`, SHALL print the existing Codex compatibility message and SHALL still complete the Claude installation

#### Scenario: Trust reminder after installation

- **WHEN** Codex hooks are installed or changed and no trust record is found for them
- **THEN** the Codex result line SHALL read `Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.`

#### Scenario: Manual notify entry detected

- **WHEN** `$CODEX_HOME/config.toml` contains a top-level `notify` array that references the tracker `codex-sync.mjs`
- **THEN** the CLI SHALL print a reminder to remove that notify entry because hooks now handle Codex reporting, and SHALL NOT edit the TOML file

---
### Requirement: Collector dependency

Setup and update SHALL run the same collector step. When `ccusage --version` fails, the CLI SHALL print the command `npm install -g ccusage@20.0.20`, execute it through the shell with a 180 second timeout and inherited stdio, and probe again. When the collector is present with major version 20, the CLI SHALL take no action. When the collector is present with another major version, the CLI SHALL warn that Claude reporting works but Codex requires 20.0.20, print the install command and SHALL NOT replace the installed version. When the environment variable `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL` is set to `1`, the CLI SHALL skip installation and print the command instead. Collector installation failure SHALL NOT change the exit code of setup or update.

#### Scenario: Collector missing

- **WHEN** `ccusage --version` fails and the skip variable is not set
- **THEN** the CLI SHALL execute `npm install -g ccusage@20.0.20` and report the result

#### Scenario: Unsupported major version

- **WHEN** `ccusage --version` reports 18.0.9
- **THEN** the CLI SHALL NOT run the installer and SHALL print a warning containing `20.0.20`

#### Scenario: Installation skipped by environment

- **WHEN** `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1` and the collector is missing
- **THEN** the CLI SHALL NOT run the installer and SHALL print the install command
