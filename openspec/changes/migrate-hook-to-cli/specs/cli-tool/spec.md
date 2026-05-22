## MODIFIED Requirements

### Requirement: Setup command

The CLI SHALL provide a `setup` command that configures the user's machine for automatic usage reporting. The command MUST run on macOS, Linux, and Windows (PowerShell or Windows Terminal) without requiring a POSIX shell or `jq`.

#### Scenario: Interactive setup

- **WHEN** the user runs `tracker setup` with no arguments
- **THEN** the CLI SHALL interactively prompt for: member name, server URL, and team key

#### Scenario: Non-interactive setup via flags

- **WHEN** the user runs `tracker setup --name <name> --server-url <url> --team-key <key>`
- **THEN** the CLI SHALL skip the interactive prompts for any field provided as a flag and use the flag values directly

#### Scenario: Write config file

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL write the configuration to `~/.config/ccusage-tracker/config.json` containing `server_url`, `team_key`, and `member_name`, using `os.homedir()` so the path resolves correctly on Windows

#### Scenario: Install SessionEnd and SessionStart hooks

- **WHEN** setup completes successfully
- **THEN** the CLI SHALL patch `~/.claude/settings.json` to add `tracker hook session-end` to `hooks.SessionEnd` and `tracker hook session-start` to `hooks.SessionStart`, preserving all existing hooks via deep merge

#### Scenario: Hook command is platform-independent

- **WHEN** the CLI writes the hook command into `settings.json`
- **THEN** the command value SHALL be the literal string `tracker hook session-end` (or `tracker hook session-start`), and SHALL NOT contain `bash`, an absolute file path, or any platform-specific prefix

#### Scenario: Backup settings before patch

- **WHEN** the CLI patches `~/.claude/settings.json` for the first time on a machine with no prior ccusage-tracker hook
- **THEN** the CLI SHALL create a backup at `~/.claude/settings.json.backup` before modifying

#### Scenario: Verify server connectivity

- **WHEN** setup completes
- **THEN** the CLI SHALL call `GET /api/health` on the configured server and report whether it is reachable

#### Scenario: Check ccusage installation

- **WHEN** setup runs
- **THEN** the CLI SHALL check if `ccusage` is available in PATH (using `child_process.execFile('ccusage', ['--version'], { shell: true })` to resolve `ccusage.cmd` on Windows) and warn the user with installation instructions if not found

#### Scenario: Detect and migrate legacy bash hook

- **WHEN** setup runs on a machine where `~/.claude/settings.json` already contains a hook entry with `command` starting with `bash ` and containing the substring `ccusage-tracker`
- **THEN** the CLI SHALL back up the current `settings.json` to `settings.json.backup-pre-cli-migration`, rewrite the matching hook entries' `command` field to `tracker hook session-end` (or `tracker hook session-start`), and report the migration to the user

##### Example: legacy hook detection

| Existing `command` value                                           | Action    |
| ------------------------------------------------------------------ | --------- |
| `bash /Users/alice/.config/ccusage-tracker/session-end.sh`         | rewrite to `tracker hook session-end` |
| `bash /Users/alice/.config/ccusage-tracker/session-start.sh`       | rewrite to `tracker hook session-start` |
| `tracker hook session-end`                                         | leave unchanged |
| `bash /Users/alice/.config/other-tool/hook.sh`                     | leave unchanged (no ccusage-tracker substring) |
| `node /Users/alice/some-other-hook.mjs`                            | leave unchanged |

## ADDED Requirements

### Requirement: Hook session-end subcommand

The CLI SHALL provide a `tracker hook session-end` subcommand that implements the SessionEnd hook behavior defined by the `session-hook` capability.

#### Scenario: Subcommand registration

- **WHEN** the user runs `tracker hook session-end` from any working directory
- **THEN** the CLI SHALL execute the SessionEnd hook logic (read stdin payload, replay buffer, post current usage, post session metrics) and exit with code 0

#### Scenario: Subcommand discoverable

- **WHEN** the user runs `tracker hook --help` or `tracker --help`
- **THEN** the CLI SHALL list `session-end` and `session-start` as available hook subcommands

---

### Requirement: Hook session-start subcommand

The CLI SHALL provide a `tracker hook session-start` subcommand that implements the SessionStart hook behavior defined by the `session-hook` capability.

#### Scenario: Subcommand registration

- **WHEN** the user runs `tracker hook session-start` with a JSON payload on stdin
- **THEN** the CLI SHALL execute the SessionStart hook logic (parse payload, write model to sessions directory) and exit with code 0

---

### Requirement: Uninstall command

The CLI SHALL provide an `uninstall` command that removes ccusage-tracker hooks and configuration from the user's machine, while leaving the `tracker` CLI binary itself in place (the user removes the CLI separately via `npm uninstall -g`).

#### Scenario: Remove hooks from settings.json

- **WHEN** the user runs `tracker uninstall`
- **THEN** the CLI SHALL remove all entries from `~/.claude/settings.json` `hooks.SessionEnd` and `hooks.SessionStart` whose `command` equals `tracker hook session-end` or `tracker hook session-start`, leaving other hook entries unchanged

#### Scenario: Remove config directory

- **WHEN** the user runs `tracker uninstall`
- **THEN** the CLI SHALL recursively delete `~/.config/ccusage-tracker/` after confirming with the user (unless `--yes` is passed)

#### Scenario: Settings file missing

- **WHEN** the user runs `tracker uninstall` but `~/.claude/settings.json` does not exist
- **THEN** the CLI SHALL proceed with config directory removal and SHALL NOT report an error for the missing settings file

---

### Requirement: CLI distributed as plain Node ESM via npm

The `@ccusage-tracker/cli` package SHALL be published to an npm registry as a plain Node ESM package executable via `npx` without requiring Bun or any non-npm toolchain on the user's machine.

#### Scenario: npx invocation

- **WHEN** a user with Node 18+ runs `npx @ccusage-tracker/cli@latest setup`
- **THEN** npm SHALL download the package and execute the `tracker` bin, completing setup without prompting for additional tool installation

#### Scenario: Global install

- **WHEN** a user runs `npm install -g @ccusage-tracker/cli`
- **THEN** the `tracker` command SHALL be available on PATH on macOS, Linux, and Windows

#### Scenario: Engine constraint

- **WHEN** a user attempts to install on Node < 18
- **THEN** npm SHALL emit an engine-mismatch warning declared via the package's `engines.node` field
