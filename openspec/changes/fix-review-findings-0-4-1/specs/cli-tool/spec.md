## ADDED Requirements

### Requirement: Tracker hook recognition

The CLI SHALL treat a hook command as a tracker hook only when the whole command matches one of the canonical or known historical shapes: an optional interpreter (`node`, `bash`, `sh`, `powershell` or `pwsh`, bare or as an absolute path, and for PowerShell followed by its own switches and `-File`), then the tracker script path — bare, or double-quoted — ending in `/ccusage-tracker/codex-sync.mjs`, `/ccusage-tracker/session-end.mjs` or `/ccusage-tracker/session-start.mjs` (Claude legacy `.sh` and `.ps1` included), then only tracker arguments (`--hook`, `--notify`, `--mode=<value>`). The interpreter SHALL match the script extension: `node` for `.mjs`, `bash`/`sh` for `.sh`, `powershell`/`pwsh` for `.ps1`. A command containing any shell syntax outside double quotes (`&`, `|`, `;`, `<`, `>`, backtick, `$`, parentheses, single quote, or a line break), or one where the tracker path is an argument to another program, SHALL be treated as third-party and SHALL be preserved unchanged, as SHALL any command that merely contains a tracker script path.

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

- **WHEN** an event contains one of the commands earlier installers wrote — `bash <home>/.config/ccusage-tracker/session-end.sh`, `node <home>/.config/ccusage-tracker/session-start.mjs`, or `node <home>/.config/ccusage-tracker/session-end.mjs --mode=stop` with an unquoted home directory that contains spaces — or `powershell -NoProfile -ExecutionPolicy Bypass -File "<home>/.config/ccusage-tracker/session-end.ps1"`
- **THEN** the CLI SHALL recognize it, replace it in place with the canonical command, and leave exactly one tracker hook for that event

#### Scenario: Tracker path passed as an argument to another program

- **WHEN** a command is `node /usr/local/lib/lint.js <home>/.config/ccusage-tracker/session-end.mjs`
- **THEN** the CLI SHALL treat it as third-party, because the reassembled path would contain a second absolute path start

#### Scenario: Interpreter does not match the script extension

- **WHEN** a command is `bash <home>/.config/ccusage-tracker/session-end.mjs` or `node <home>/.config/ccusage-tracker/session-end.sh`
- **THEN** the CLI SHALL treat it as third-party

## MODIFIED Requirements

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
