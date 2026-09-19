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

The CLI SHALL provide a `status` command that displays the current configuration state, the Claude hook state and the Codex hook state including the trust state of each tracker hook as recorded by Codex. The trust lookup SHALL use the actual group index and hook index of each tracker hook in `$CODEX_HOME/hooks.json`.

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

Setup and update SHALL install tracker hooks into the user-level Codex hooks file `$CODEX_HOME/hooks.json` for the `Stop` and `SessionEnd` events. Each installed group SHALL contain exactly one command hook whose command is `node "<home>/.config/ccusage-tracker/codex-sync.mjs" --hook` with timeout 45, and the group SHALL NOT contain a `matcher` key. The CLI SHALL append the tracker group at the end of the event array when absent and SHALL replace an existing tracker group in place at its original index when its content differs. Recognition of a tracker hook SHALL follow the Tracker hook recognition requirement. The CLI SHALL NOT remove, reorder or rewrite non-tracker groups, other events or other top-level keys. The CLI SHALL NOT read the hooks file as executable input and SHALL NOT modify `$CODEX_HOME/config.toml`. The Codex result line SHALL report the trust state of each installed hook using the same wording as the Status command.

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

- **WHEN** the server returns 404 or 410 for the Codex script and Codex is detected
- **THEN** the CLI SHALL NOT write `$CODEX_HOME/hooks.json`, SHALL print the existing Codex compatibility message and SHALL still complete the Claude installation

#### Scenario: Server without Codex script and Codex not detected

- **WHEN** the server returns 404 or 410 for the Codex script and Codex is not detected
- **THEN** the CLI SHALL print only `Codex: not detected` and SHALL NOT print the Codex compatibility message

#### Scenario: Trust invalidated only for the hook that changed

- **WHEN** the `Stop` tracker hook is already canonical and has a trust record, and only the `SessionEnd` tracker group is installed in this run
- **THEN** the Codex result line SHALL still report `Stop` as trusted and SHALL ask the user to trust only the remaining hook

#### Scenario: Trust reminder after installation

- **WHEN** Codex hooks are installed or changed and no trust record is found for either of them
- **THEN** the Codex result line SHALL read `Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.`

#### Scenario: Partial trust after installation

- **WHEN** the `Stop` tracker hook has a trust record and the `SessionEnd` tracker hook does not
- **THEN** the Codex result line SHALL read `Codex: hooks installed (Stop trusted, SessionEnd awaiting trust). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook.`

#### Scenario: Hooks disabled in Codex

- **WHEN** the matching `hooks.state` section for a tracker hook contains `enabled = false`
- **THEN** the Codex result line SHALL name that hook as disabled in Codex and SHALL NOT ask the user to trust it

#### Scenario: Manual notify entry detected

- **WHEN** `$CODEX_HOME/config.toml` contains a top-level `notify` array that references the tracker `codex-sync.mjs` and the Codex hooks are installed in this run or were already installed
- **THEN** the CLI SHALL print a reminder to remove that notify entry because hooks now handle Codex reporting, and SHALL NOT edit the TOML file

#### Scenario: Manual notify entry with server lacking Codex script

- **WHEN** the server returns 404 or 410 for the Codex script, Codex is detected and `config.toml` contains a tracker `notify` entry
- **THEN** the CLI SHALL NOT print the notify removal reminder

#### Scenario: Top-level scan handles arrays, strings and comments

- **WHEN** `config.toml` contains, before the `notify` key, a `[[servers]]` table header, a `[tui] # comment` header, a multi-line top-level array with a continuation line `[3, 4]` without trailing comma, or a string value containing `[`
- **THEN** the scan SHALL treat `[[servers]]` and `[tui] # comment` as table headers that end the top-level scope, SHALL treat the `[3, 4]` line and the string as part of top-level values, and SHALL print the reminder only when the tracker `notify` key is at top level
#### Scenario: Escapes inside basic strings

- **WHEN** a multi-line basic string (`"""`) before the `notify` key contains an escaped quote sequence `\"""`
- **THEN** the scan SHALL NOT end the string there, and a multi-line literal string (`'''`) SHALL NOT treat a backslash as an escape

---
### Requirement: Collector dependency

Setup and update SHALL run the same collector step only when at least one supported tool is detected. When `ccusage --version` fails, the CLI SHALL print the command `npm install -g ccusage@20.0.20`, execute it through the shell with a 180 second timeout and inherited stdio, and probe again. After the probe that follows an installation, the CLI SHALL apply the same major-version check as for a pre-existing collector. When the collector is present with major version 20, the CLI SHALL take no action. When the collector is present with another major version, the CLI SHALL warn that Claude reporting works but Codex requires 20.0.20, print the install command and SHALL NOT replace the installed version. When the environment variable `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL` is set to `1`, the CLI SHALL skip installation and print the command instead. Collector installation failure SHALL NOT change the exit code of setup or update.

#### Scenario: Collector missing

- **WHEN** `ccusage --version` fails and the skip variable is not set
- **THEN** the CLI SHALL execute `npm install -g ccusage@20.0.20` and report the result

#### Scenario: Unsupported major version

- **WHEN** `ccusage --version` reports 18.0.9
- **THEN** the CLI SHALL NOT run the installer and SHALL print a warning containing `20.0.20`

#### Scenario: Installation skipped by environment

- **WHEN** `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1` and the collector is missing
- **THEN** the CLI SHALL NOT run the installer and SHALL print the install command

#### Scenario: Unsupported version after installation

- **WHEN** the installer succeeds but the following probe reports 18.0.9 because another `ccusage` is earlier on PATH
- **THEN** the collector result SHALL be unsupported_major and the warning SHALL contain `20.0.20`

#### Scenario: No tool detected skips the collector step

- **WHEN** neither Claude Code nor Codex is detected
- **THEN** the CLI SHALL NOT run the installer and SHALL NOT probe the collector

---
### Requirement: Symlinked configuration files

Before reading any configuration file targeted by the installation transaction, the CLI SHALL check its file type without opening it. When the path is a symbolic link, the CLI SHALL resolve it to its real path. When the real path is a regular file, the CLI SHALL read, stage, back up and rename against the real path and SHALL leave the symbolic link unchanged, and the final output SHALL contain one line `Wrote through symlink: <link> -> <real>` for each file written this way. When the link cannot be resolved or the real path is not a regular file (directory, FIFO, socket or other), the CLI SHALL refuse the whole transaction before any read or write with a message that names the original path and, when it can be read, the link target. Target resolution SHALL happen once per file before staging begins. This rule SHALL apply to `~/.claude/settings.json`, `$CODEX_HOME/hooks.json` and the tracker scripts under `~/.config/ccusage-tracker`.

#### Scenario: Symlink to a regular file

- **WHEN** `~/.claude/settings.json` is a symbolic link to `~/dotfiles/claude/settings.json`
- **THEN** after setup the link SHALL still be a symbolic link, the target file SHALL contain the tracker hooks, the backup SHALL be `~/dotfiles/claude/settings.json.backup` and the output SHALL contain `Wrote through symlink: <home>/.claude/settings.json -> <home>/dotfiles/claude/settings.json`

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

---
### Requirement: Tracker hook recognition

The CLI SHALL recognize a tracker hook in two layers. First, a command byte-identical to one this CLI would write on this machine SHALL always be recognized, whatever characters the home directory contains, because replacing it with itself is a no-op while rejecting it would append a second tracker hook on every run. Otherwise the CLI SHALL treat a hook command as a tracker hook only when the whole command matches one of the canonical or known historical shapes: an optional interpreter (`node`, `bash`, `sh`, `powershell` or `pwsh`, bare or as an absolute path, and for PowerShell followed by its own switches and `-File`), then the tracker script path as exactly one token — bare, or double-quoted — ending in `/ccusage-tracker/codex-sync.mjs`, `/ccusage-tracker/session-end.mjs` or `/ccusage-tracker/session-start.mjs` (Claude legacy `.sh` and `.ps1` included), then only tracker arguments (`--hook`, `--notify`, `--mode=<value>`). The interpreter SHALL match the script extension: `node` for `.mjs`, `bash`/`sh` for `.sh`, `powershell`/`pwsh` for `.ps1`. The CLI SHALL NOT reassemble several whitespace-separated tokens into one path, because `<absolute path> <more text>` cannot be distinguished from a path containing spaces, and guessing wrong deletes a third-party hook. A command containing any shell syntax outside double quotes (`&`, `|`, `;`, `<`, `>`, parentheses, single quote, or a line break), or one where the tracker path is an argument to another program, SHALL be treated as third-party and SHALL be preserved unchanged, as SHALL any command that merely contains a tracker script path. Because a POSIX shell expands `$` and backticks inside double quotes too, and cmd.exe expands `%` and `!` there as well, a command containing any of those four characters SHALL be treated as third-party regardless of quoting. `%` SHALL NOT be narrowed to any subset of expansions: cmd.exe variable names are not limited to letters and underscores (`%ProgramFiles(x86)%` is a real one), `%1` is a batch parameter, and `%NAME:~0,1%` and `%NAME:old=new%` are slice and substitution forms, so every attempt to enumerate the safe cases misses whole families. A home directory containing these characters keeps working because its canonical command is recognized by the first layer. Backslashes SHALL count as path separators only when the path starts with a drive letter (`C:\`) or a UNC prefix (`\\`); in any other path the script suffix SHALL be matched with forward slashes only, so a backslash elsewhere in a POSIX path stays an ordinary character. An unquoted token containing a backslash SHALL make the command third-party, because a POSIX shell consumes it. An unquoted token containing brace or glob syntax (`{`, `}`, `*`, `?`, `[`, `]`) SHALL make the command third-party, because the shell expands it and a different program or script may run; the same characters inside double quotes SHALL NOT, because the shell does not expand them there. A command containing `!` anywhere SHALL be treated as third-party, because cmd.exe expands it when delayed expansion is enabled.

#### Scenario: Third-party command references the tracker script

- **WHEN** a `Stop` group contains the command `sha256sum "<home>/.config/ccusage-tracker/codex-sync.mjs"`
- **THEN** setup and update SHALL leave that group byte-identical at its index and SHALL append the tracker group at the end

#### Scenario: Canonical shapes are recognized

- **WHEN** a command is `node "<home>/.config/ccusage-tracker/codex-sync.mjs" --hook`, `node <home>/.config/ccusage-tracker/session-end.mjs --mode=stop` or `"/usr/local/bin/node" "<home>/.config/ccusage-tracker/session-start.mjs"`
- **THEN** the CLI SHALL recognize each as a tracker hook and replace it in place when its content differs from the canonical command

#### Scenario: Compound command is not recognized

- **WHEN** a command is `node "<home>/.config/ccusage-tracker/codex-sync.mjs" --hook && echo done`
- **THEN** the CLI SHALL treat it as third-party and SHALL NOT replace or remove it

#### Scenario: Compound command without whitespace is not recognized

- **WHEN** a command is `node "<home>/.config/ccusage-tracker/codex-sync.mjs" --mode=stop&&false`, `… --hook;rm -rf /tmp/x`, `… --hook|tee /tmp/x`, `… --hook>/tmp/x` or `… $(whoami)`
- **THEN** the CLI SHALL treat each as third-party and SHALL NOT replace or remove it, even though no whitespace separates the operator from the preceding argument

#### Scenario: Historical installer commands upgrade to exactly one tracker hook

- **WHEN** an event contains one of the commands earlier installers wrote — `bash <home>/.config/ccusage-tracker/session-end.sh`, `node <home>/.config/ccusage-tracker/session-start.mjs`, `node <home>/.config/ccusage-tracker/session-end.mjs --mode=stop`, or `powershell -NoProfile -ExecutionPolicy Bypass -File "<home>/.config/ccusage-tracker/session-end.ps1"` — where the script path is one token
- **THEN** the CLI SHALL recognize it, replace it in place with the canonical command, and leave exactly one tracker hook for that event

#### Scenario: Unquoted path containing spaces is not recognized

- **WHEN** a command is `node /Users/Gill Chiang/.config/ccusage-tracker/session-end.mjs --mode=stop`, written by an installer that expanded an unquoted home directory containing spaces
- **THEN** the CLI SHALL treat it as third-party, SHALL preserve it unchanged and SHALL append the canonical tracker group, leaving two tracker hooks for that event rather than risking the deletion of a third-party hook with the same shape

#### Scenario: Tracker path passed as an argument to another program

- **WHEN** a command is `node /usr/local/lib/lint.js <home>/.config/ccusage-tracker/session-end.mjs`, `/usr/bin/env node <home>/.config/ccusage-tracker/session-end.mjs` or `/opt/tools/run.sh sub/ccusage-tracker/session-end.sh`
- **THEN** the CLI SHALL treat each as third-party, because the script path is not a single token

#### Scenario: Interpreter does not match the script extension

- **WHEN** a command is `bash <home>/.config/ccusage-tracker/session-end.mjs` or `node <home>/.config/ccusage-tracker/session-end.sh`
- **THEN** the CLI SHALL treat it as third-party

#### Scenario: Characters the shell would reinterpret are never recognized

- **WHEN** a command contains `$` or a backtick anywhere, inside double quotes or not (`node "/tmp/$(printf keep)/ccusage-tracker/codex-sync.mjs" --hook`), contains `%` in any form (`%TARGET%`, `%ProgramFiles(x86)%`, `%1%`, `%TARGET:~0,1%`, `%TARGET:old=new%`), or contains a backslash in the script path that is not part of a Windows drive (`C:\…`) or UNC (`\\server\…`) prefix (`node /tmp/ccusage-tracker\codex-sync.mjs --hook`)
- **THEN** the CLI SHALL treat it as third-party, because the shell would run a different file than the literal text suggests
- **AND** a Windows drive path or UNC path whose separators are backslashes SHALL still be recognized
- **AND** a command containing `%` or `!` anywhere SHALL be treated as third-party, whatever follows them

#### Scenario: The command the CLI writes is always recognized

- **WHEN** an existing hook command is byte-identical to the command this CLI would write on this machine, even when the home directory contains characters the shape rules reject (`$`, a backtick, or `%VAR%`)
- **THEN** the CLI SHALL recognize it as a tracker hook, so that repeated setup or update runs stay a no-op instead of appending another tracker hook on every run
- **AND** any command that is not byte-identical SHALL still be judged by the shape rules alone

#### Scenario: Unquoted brace or glob syntax is not recognized

- **WHEN** a command is `/opt/{real,foreign}/node "<home>/.config/ccusage-tracker/codex-sync.mjs" --hook`, `/opt/*/node "…"`, or `node /home/*/.config/ccusage-tracker/codex-sync.mjs --hook`
- **THEN** the CLI SHALL treat it as third-party, because the shell expands the unquoted token and the program that actually runs is not the one the literal text names
- **AND** the same characters inside a double-quoted token SHALL NOT disqualify the command, because the shell does not expand them there

#### Scenario: Backslashes are separators only in Windows paths

- **WHEN** the script path is `/tmp/ccusage-tracker\codex-sync.mjs`
- **THEN** the CLI SHALL treat it as third-party, because on POSIX that is a single file name in `/tmp` rather than a script inside a `ccusage-tracker` directory
- **AND** `"/home/a\b/.config/ccusage-tracker/codex-sync.mjs"` SHALL be recognized, because the backslash is an ordinary character in a POSIX home directory name
- **AND** an unquoted POSIX path containing a backslash SHALL be treated as third-party, because the shell consumes the backslash
- **AND** `C:\…\ccusage-tracker\codex-sync.mjs` and `\\server\…\ccusage-tracker\codex-sync.mjs` SHALL be recognized
