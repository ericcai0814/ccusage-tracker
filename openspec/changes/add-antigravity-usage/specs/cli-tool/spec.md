## MODIFIED Requirements

### Requirement: Setup command

The CLI SHALL provide a `setup` command that configures the user's machine for automatic usage reporting for every detected tool. Hook commands written by setup SHALL quote each tracker script absolute path with double quotes so paths containing spaces remain a single `node` argument. Setup SHALL run tool detection, the Claude hook installation, the Codex hook installation, the Antigravity hook installation and the collector step, and SHALL print one result line per tool followed by the collector result.

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

#### Scenario: Install Antigravity hook

- **WHEN** setup completes successfully and Antigravity is detected and the server provides `agent-sync.mjs`
- **THEN** the CLI SHALL write `agent-sync.mjs` to `~/.config/ccusage-tracker/` and SHALL install the `ccusage-tracker` entry into `~/.gemini/config/hooks.json` as defined by the Antigravity hook installation requirement

#### Scenario: Upgrade existing unquoted tracker hook commands

- **WHEN** setup runs on a machine whose `~/.claude/settings.json` already contains ccusage-tracker hook commands without quoted script paths
- **THEN** the CLI SHALL replace those tracker hook commands with the quoted canonical commands and report the affected hook as changed

#### Scenario: Backup settings before patch

- **WHEN** the CLI patches `~/.claude/settings.json`, `$CODEX_HOME/hooks.json` or `~/.gemini/config/hooks.json`
- **THEN** the CLI SHALL create a backup next to the file with the `.backup` suffix before modifying

#### Scenario: Verify server connectivity

- **WHEN** setup completes
- **THEN** the CLI SHALL call `GET /api/health` on the configured server and report whether it is reachable

#### Scenario: Ensure collector installation

- **WHEN** setup runs
- **THEN** the CLI SHALL run the collector step defined by the Collector dependency requirement and print its result

---

### Requirement: Status command

The CLI SHALL provide a `status` command that displays the current configuration state, the Claude hook state, the Codex hook state including the trust state of each tracker hook as recorded by Codex, and the Antigravity reporting state. The trust lookup SHALL use the actual group index and hook index of each tracker hook in `$CODEX_HOME/hooks.json`. The Codex collector line SHALL report the collector as installed for every `ccusage --version` with major version 20. The Antigravity collector line SHALL report the collector as installed only for versions from 20.0.21 up to but excluding 21.0.0, compared as semantic versions. When Codex is not detected, status SHALL print `Codex: not detected` and SHALL still print the Antigravity state. When Antigravity is detected, status SHALL print, in this order, `Antigravity script:`, `Antigravity hook:`, `Antigravity collector:`, `Antigravity buffer:`, `Antigravity upload error:` and `Antigravity last successful upload:` lines; when it is not detected, status SHALL print the single line `Antigravity: not detected`.

#### Scenario: Show status

- **WHEN** the user runs `tracker status`
- **THEN** the CLI SHALL display: config file path and existence, server URL and reachability, hook installation status, and member name

#### Scenario: Codex hook trust recorded

- **WHEN** both tracker hooks have a `hooks.state` section with a `trusted_hash` key at their actual `<hooks path>:<event>:<group>:<hook>` keys
- **THEN** status SHALL print `Codex hooks: installed, trust recorded`

#### Scenario: Codex hook awaiting trust

- **WHEN** neither tracker hook has a matching `hooks.state` section with `trusted_hash`, or `config.toml` is missing
- **THEN** status SHALL print `Codex hooks: installed, awaiting trust (open /hooks in Codex)`

#### Scenario: Codex hooks partially trusted

- **WHEN** the `Stop` tracker hook has a trust record and the `SessionEnd` tracker hook does not
- **THEN** status SHALL print `Codex hooks: installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)`

#### Scenario: Codex hook disabled

- **WHEN** the matching `hooks.state` section for a tracker hook contains `enabled = false`
- **THEN** status SHALL name that hook as disabled in Codex, for example `Codex hooks: installed, Stop disabled in Codex, SessionEnd trusted`

#### Scenario: Mixed group index

- **WHEN** the tracker `Stop` hook is the second entry (`hooks[1]`) of the group at index 2
- **THEN** status SHALL look up `<hooks path>:stop:2:1` and SHALL NOT read the state of the first entry

#### Scenario: Codex not detected in status

- **WHEN** Codex is not detected
- **THEN** status SHALL print a single line `Codex: not detected` instead of the Codex block

#### Scenario: Codex collector on a newer patch

- **WHEN** Codex is detected and `ccusage --version` reports `ccusage 20.0.51`
- **THEN** status SHALL print `Codex collector: installed (ccusage 20.0.51)`

#### Scenario: Antigravity fully installed

- **WHEN** Antigravity is detected, `agent-sync.mjs` exists, the `ccusage-tracker` entry in `~/.gemini/config/hooks.json` is canonical without `"enabled": false`, and `ccusage --version` reports 20.0.51
- **THEN** status SHALL print `Antigravity script: installed`, `Antigravity hook: installed` and `Antigravity collector: installed (ccusage 20.0.51)`, followed by the buffer, upload error and last successful upload lines

#### Scenario: Antigravity hook disabled

- **WHEN** the `ccusage-tracker` entry contains `"enabled": false`
- **THEN** status SHALL print `Antigravity hook: installed, disabled in Antigravity (Settings > Customizations > Hooks)`

#### Scenario: Collector without an Antigravity reader

- **WHEN** Antigravity is detected and `ccusage --version` reports 20.0.20
- **THEN** status SHALL print `Antigravity collector: unavailable (ccusage 20.0.20 has no Antigravity reader; install with: npm install -g ccusage@20.0.51)`

#### Scenario: Codex absent, Antigravity present

- **WHEN** Codex is not detected and Antigravity is detected
- **THEN** status SHALL print `Codex: not detected` followed by the Antigravity lines

#### Scenario: Antigravity not detected in status

- **WHEN** Antigravity is not detected
- **THEN** status SHALL print the single line `Antigravity: not detected` and no other `Antigravity` line

---

### Requirement: Noninteractive update

The CLI SHALL provide update using existing validated server_url, team_key and member_name without prompts. It SHALL download and validate required scripts before installation, preserve config bytes, buffer and sessions, migrate only tracker hooks, preserve unrelated settings and matcher fields, back up changed files and remain idempotent. Update SHALL run the same tool detection, Codex hook installation, Antigravity hook installation and collector step as setup. Failure SHALL return nonzero with actionable guidance and preserve the working installation.

#### Scenario: Repeated update

- **WHEN** update runs twice with existing config, third-party hooks in `~/.claude/settings.json`, `$CODEX_HOME/hooks.json` and `~/.gemini/config/hooks.json`, and pending data in a home path containing spaces
- **THEN** config and pending data SHALL remain byte-identical, tracker hooks SHALL occur once per event in each file, and unrelated hooks SHALL retain all fields and their order

#### Scenario: Missing configuration or failed installation

- **WHEN** config is missing or invalid, required download fails, or installation fails
- **THEN** update SHALL return nonzero, SHALL NOT claim success, and SHALL preserve prior scripts/settings; invalid config SHALL include setup guidance

#### Scenario: Older server

- **WHEN** only the Codex script endpoint returns 404 or 410
- **THEN** update SHALL retain the Claude path and any prior Codex script, SHALL NOT write `$CODEX_HOME/hooks.json`, and SHALL explicitly report that Codex support requires the corresponding server version

#### Scenario: Older server without agent-sync

- **WHEN** the `agent-sync.mjs` endpoint returns 404 or 410 and Antigravity is detected
- **THEN** update SHALL keep any prior `agent-sync.mjs`, SHALL NOT write `~/.gemini/config/hooks.json`, SHALL print `Antigravity: hook not installed (this server does not provide agent-sync.mjs)` and SHALL still complete the Claude and Codex installation

#### Scenario: Update never requires manual sync

- **WHEN** update completes on a machine with Codex detected and the Codex hooks trusted, or with Antigravity detected and the Antigravity hook installed
- **THEN** usage of that tool SHALL be reported automatically at its next hook event, or at the next Claude or Codex worker run, without running `tracker sync codex` or `tracker sync antigravity`

---

### Requirement: Tool detection

Setup and update SHALL detect which supported tools exist on the machine and SHALL wire automatic reporting for each detected tool. Claude Code SHALL count as detected when the `~/.claude` directory exists or `claude` is on PATH. Codex SHALL count as detected when the `$CODEX_HOME` directory (default `~/.codex`) exists or `codex` is on PATH. Antigravity SHALL count as detected when a `conversations` directory exists directly below at least one of `~/.gemini/antigravity`, `~/.gemini/antigravity-cli`, `~/.gemini/antigravity-ide`, `~/.gemini/antigravity-backup`, `~/.gemini/antigravity-acp` and `~/.config/antigravity`, or `agy` or `antigravity` is on PATH; a root directory without `conversations` SHALL NOT count. The final output SHALL contain one result line per tool.

#### Scenario: Both tools detected

- **WHEN** setup or update runs on a machine with `~/.claude` and `~/.codex`
- **THEN** the CLI SHALL install Claude hooks into `~/.claude/settings.json` and Codex hooks into `$CODEX_HOME/hooks.json`, and SHALL print a `Claude Code:` result line and a `Codex:` result line

#### Scenario: Codex not detected

- **WHEN** neither the `$CODEX_HOME` directory exists nor `codex` is on PATH
- **THEN** the CLI SHALL NOT create `$CODEX_HOME/hooks.json` and SHALL print `Codex: not detected`

#### Scenario: Antigravity detected by conversation data

- **WHEN** setup or update runs on a machine with the directory `~/.gemini/antigravity-ide/conversations` and neither `agy` nor `antigravity` on PATH
- **THEN** the CLI SHALL treat Antigravity as detected and SHALL print an `Antigravity:` result line describing the hook installation

#### Scenario: Antigravity detected by command

- **WHEN** no Antigravity `conversations` directory exists and `agy` is on PATH
- **THEN** the CLI SHALL treat Antigravity as detected

#### Scenario: Leftover Antigravity directory is not detection

- **WHEN** `~/.gemini/antigravity` holds only a `bin` directory, no other Antigravity root has `conversations`, and neither `agy` nor `antigravity` is on PATH
- **THEN** the CLI SHALL NOT create `~/.gemini/config/hooks.json` and SHALL print `Antigravity: not detected`

#### Scenario: Antigravity not detected

- **WHEN** none of the Antigravity directories exists and neither `agy` nor `antigravity` is on PATH
- **THEN** the CLI SHALL NOT create `~/.gemini/config/hooks.json` and SHALL print `Antigravity: not detected`

#### Scenario: No tool detected

- **WHEN** none of Claude Code, Codex and Antigravity is detected
- **THEN** setup SHALL still save the configuration, print that no supported tool was detected, advise running update after installing one, and exit 0
- **AND** update SHALL print the same advice and exit nonzero

---

### Requirement: Collector dependency

Setup and update SHALL run the same collector step only when at least one supported tool is detected. When `ccusage --version` fails, the CLI SHALL print the command `npm install -g ccusage@20.0.51`, execute it through the shell with a 180 second timeout and inherited stdio, and probe again. After the probe that follows an installation, the CLI SHALL apply the same version checks as for a pre-existing collector. Versions SHALL be compared as semantic versions. When the collector version is at least 20.0.21 and below 21.0.0, the CLI SHALL take no action. When the collector version is a 20.x version below 20.0.21, the CLI SHALL take no action unless Antigravity is detected; when Antigravity is detected it SHALL warn that Claude and Codex reporting work but Antigravity requires ccusage 20.0.21 or later, print the install command and SHALL NOT replace the installed version. When the collector is present with another major version, the CLI SHALL warn that Claude reporting works but Codex and Antigravity require ccusage 20.0.51, print the install command and SHALL NOT replace the installed version. When the environment variable `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL` is set to `1`, the CLI SHALL skip installation and print the command instead. Collector installation failure SHALL NOT change the exit code of setup or update.

#### Scenario: Collector missing

- **WHEN** `ccusage --version` fails and the skip variable is not set
- **THEN** the CLI SHALL execute `npm install -g ccusage@20.0.51` and report the result

#### Scenario: Unsupported major version

- **WHEN** `ccusage --version` reports 18.0.9
- **THEN** the CLI SHALL NOT run the installer and SHALL print a warning containing `20.0.51`

#### Scenario: Patch without an Antigravity reader

- **WHEN** `ccusage --version` reports 20.0.20 and Antigravity is detected
- **THEN** the CLI SHALL NOT run the installer and SHALL print a warning containing `Antigravity` and `npm install -g ccusage@20.0.51`

#### Scenario: Older patch without Antigravity in use

- **WHEN** `ccusage --version` reports 20.0.20 and Antigravity is not detected
- **THEN** the CLI SHALL NOT run the installer and SHALL NOT print a collector warning

#### Scenario: Installation skipped by environment

- **WHEN** `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1` and the collector is missing
- **THEN** the CLI SHALL NOT run the installer and SHALL print the install command

#### Scenario: Unsupported version after installation

- **WHEN** the installer succeeds but the following probe reports 18.0.9 because another `ccusage` is earlier on PATH
- **THEN** the collector result SHALL be unsupported_major and the warning SHALL contain `20.0.51`

#### Scenario: No tool detected skips the collector step

- **WHEN** none of Claude Code, Codex and Antigravity is detected
- **THEN** the CLI SHALL NOT run the installer and SHALL NOT probe the collector

---

### Requirement: Symlinked configuration files

Before reading any configuration file targeted by the installation transaction, the CLI SHALL check its file type without opening it. When the path is a symbolic link, the CLI SHALL resolve it to its real path. When the real path is a regular file, the CLI SHALL read, stage, back up and rename against the real path and SHALL leave the symbolic link unchanged, and the final output SHALL contain one line `Wrote through symlink: <link> -> <real>` for each file written this way. When the link cannot be resolved or the real path is not a regular file (directory, FIFO, socket or other), the CLI SHALL refuse the whole transaction before any read or write with a message that names the original path and, when it can be read, the link target. Target resolution SHALL happen once per file before staging begins. This rule SHALL apply to `~/.claude/settings.json`, `$CODEX_HOME/hooks.json`, `~/.gemini/config/hooks.json` and the tracker scripts under `~/.config/ccusage-tracker`.

#### Scenario: Symlink to a regular file

- **WHEN** `~/.claude/settings.json` is a symbolic link to `~/dotfiles/claude/settings.json`
- **THEN** after setup the link SHALL still be a symbolic link, the target file SHALL contain the tracker hooks, the backup SHALL be `~/dotfiles/claude/settings.json.backup` and the output SHALL contain `Wrote through symlink: <home>/.claude/settings.json -> <home>/dotfiles/claude/settings.json`

#### Scenario: Antigravity hooks file behind a symlink

- **WHEN** `~/.gemini/config/hooks.json` is a symbolic link to `~/dotfiles/gemini/hooks.json` and Antigravity is detected
- **THEN** after setup the link SHALL still be a symbolic link, the target file SHALL contain the `ccusage-tracker` entry and the output SHALL contain `Wrote through symlink: <home>/.gemini/config/hooks.json -> <home>/dotfiles/gemini/hooks.json`

#### Scenario: Dangling symlink

- **WHEN** `$CODEX_HOME/hooks.json` is a symbolic link whose target does not exist
- **THEN** the CLI SHALL exit nonzero, SHALL NOT write any file in that transaction and the message SHALL contain the link target path

#### Scenario: Symlink to a directory

- **WHEN** a targeted path is a symbolic link to a directory
- **THEN** the CLI SHALL refuse the transaction with the same non-regular-file message

#### Scenario: Symlink to a FIFO without a writer

- **WHEN** `$CODEX_HOME/hooks.json` is a symbolic link to a FIFO that no process is writing to
- **THEN** setup and update SHALL refuse with the non-regular-file message within 2 seconds, SHALL NOT open the FIFO and SHALL NOT report a JSON error

#### Scenario: Link target unreadable during refusal

- **WHEN** a dangling symbolic link is removed between resolution and the attempt to read its target for the message
- **THEN** the CLI SHALL still refuse with the non-regular-file message without the target path instead of failing with a different error

#### Scenario: Validation failure leaves no staging files

- **WHEN** the second targeted file in a transaction fails type validation
- **THEN** no `.tmp`, `.rollback` or `.backup` file SHALL exist for the first targeted file

## ADDED Requirements

### Requirement: Antigravity hook installation

When Antigravity is detected and the server provides `agent-sync.mjs`, setup and update SHALL install the tracker hook into the Antigravity global hooks file `~/.gemini/config/hooks.json`, creating the file and its parent directory when absent. The tracker hook SHALL be the top-level key `ccusage-tracker` whose value is an object with exactly one event key `Stop` holding exactly one handler `{"type":"command","command":"node \"<home>/.config/ccusage-tracker/agent-sync.mjs\" --hook antigravity"}`, plus the `enabled` field when the existing tracker entry has one. The CLI SHALL add the key after all existing keys when absent, SHALL replace an existing `ccusage-tracker` value in place when it differs from the canonical value, and SHALL leave the file unwritten when it already equals the canonical value. The CLI SHALL NOT remove, reorder or change any other top-level key or its value, SHALL NOT write a `timeout` or `matcher` field, and SHALL NOT write any other Antigravity file. The file SHALL join the same staged transaction, backup and rollback as the Claude and Codex files. The Antigravity result line SHALL read `Antigravity: hook installed (Stop). Restart Antigravity to load it.` when the file was written, `Antigravity: hook already up to date` when it was not, and `Antigravity: hook installed but disabled in Antigravity (Settings > Customizations > Hooks)` when the tracker entry carries `"enabled": false`.

#### Scenario: First installation next to third-party hooks

- **WHEN** `~/.gemini/config/hooks.json` contains the keys `my-linter-hook` and `safety-gate` and no `ccusage-tracker` key
- **THEN** after setup both keys SHALL keep their values and their order, `ccusage-tracker` SHALL follow them with the canonical value, and the result line SHALL be `Antigravity: hook installed (Stop). Restart Antigravity to load it.`

#### Scenario: Repeated installation is idempotent

- **WHEN** update runs twice on the same machine
- **THEN** the second run SHALL NOT change `~/.gemini/config/hooks.json` and SHALL print `Antigravity: hook already up to date`

#### Scenario: Stale tracker entry replaced in place

- **WHEN** the `ccusage-tracker` value holds a different command or an extra `PostToolUse` event
- **THEN** the CLI SHALL replace that value with the canonical value at the same key position and SHALL leave every other key unchanged

#### Scenario: Disabled tracker hook stays disabled

- **WHEN** the `ccusage-tracker` value contains `"enabled": false` and a stale command
- **THEN** update SHALL write the canonical command, SHALL keep `"enabled": false`, and SHALL print `Antigravity: hook installed but disabled in Antigravity (Settings > Customizations > Hooks)`

#### Scenario: Invalid hooks file

- **WHEN** `~/.gemini/config/hooks.json` is not valid JSON, is not a JSON object, or its `ccusage-tracker` value is not an object
- **THEN** the CLI SHALL NOT write any file in that transaction, SHALL exit nonzero and SHALL ask the user to repair `~/.gemini/config/hooks.json`

#### Scenario: Server without agent-sync

- **WHEN** the server returns 404 or 410 for `agent-sync.mjs` and Antigravity is detected
- **THEN** the CLI SHALL NOT write `~/.gemini/config/hooks.json`, SHALL print `Antigravity: hook not installed (this server does not provide agent-sync.mjs)` and SHALL still complete the Claude and Codex installation

---

### Requirement: Antigravity command

The CLI SHALL provide `sync antigravity`, accepting `agy` as an alias, as a manual fallback and debugging command that runs `~/.config/ccusage-tracker/agent-sync.mjs antigravity` under the running Node with inherited stdio and returns its exit status; normal operation SHALL NOT depend on it. Missing or invalid configuration SHALL exit nonzero with setup guidance. A missing script SHALL exit nonzero with `Antigravity script not installed. Run tracker update with a server that provides agent-sync.mjs.` `tracker sync` with no argument or any other argument SHALL print `Usage: tracker sync codex|antigravity` and exit 1. The help text SHALL list `sync antigravity` as `Report Antigravity usage now (manual fallback / debugging)`. Missing Claude Code or Codex SHALL NOT prevent Antigravity-only usage.

#### Scenario: Alias runs the same command

- **WHEN** a configured user runs `tracker sync agy` with the script installed
- **THEN** the CLI SHALL run `agent-sync.mjs antigravity` and SHALL return its exit status

#### Scenario: Script missing

- **WHEN** a configured user runs `tracker sync antigravity` and `agent-sync.mjs` does not exist
- **THEN** the CLI SHALL print `Antigravity script not installed. Run tracker update with a server that provides agent-sync.mjs.` and exit 1

#### Scenario: Unknown sync target

- **WHEN** the user runs `tracker sync gemini`
- **THEN** the CLI SHALL print `Usage: tracker sync codex|antigravity` and exit 1

#### Scenario: Help text lists sync antigravity

- **WHEN** the user runs `tracker` without a command
- **THEN** the output SHALL contain a `sync antigravity` line reading `Report Antigravity usage now (manual fallback / debugging)`

#### Scenario: Antigravity-only machine

- **WHEN** setup runs on a machine where only `~/.gemini/antigravity-cli/conversations` exists and neither Claude Code nor Codex is detected
- **THEN** setup SHALL save the configuration, install the Antigravity hook, run the collector step and exit 0
