# cli-tool Delta Specification

## MODIFIED Requirements

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
