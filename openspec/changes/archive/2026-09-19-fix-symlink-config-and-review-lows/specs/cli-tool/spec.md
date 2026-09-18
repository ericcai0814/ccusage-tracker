## ADDED Requirements

### Requirement: Symlinked configuration files

When a file targeted by the installation transaction is a symbolic link, the CLI SHALL resolve it to its real path. When the real path is a regular file, the CLI SHALL stage, back up and rename against the real path and SHALL leave the symbolic link unchanged. When the link cannot be resolved or the real path is not a regular file, the CLI SHALL refuse the whole transaction with a message that names the original path and the link target. This rule SHALL apply to `~/.claude/settings.json`, `$CODEX_HOME/hooks.json` and the tracker scripts under `~/.config/ccusage-tracker`.

#### Scenario: Symlink to a regular file

- **WHEN** `~/.claude/settings.json` is a symbolic link to `~/dotfiles/claude/settings.json`
- **THEN** after setup the link SHALL still be a symbolic link, the target file SHALL contain the tracker hooks and the backup SHALL be `~/dotfiles/claude/settings.json.backup`

#### Scenario: Dangling symlink

- **WHEN** `$CODEX_HOME/hooks.json` is a symbolic link whose target does not exist
- **THEN** the CLI SHALL exit nonzero, SHALL NOT write any file in that transaction and the message SHALL contain the link target path

#### Scenario: Symlink to a directory

- **WHEN** a targeted path is a symbolic link to a directory
- **THEN** the CLI SHALL refuse the transaction with the same non-regular-file message

## MODIFIED Requirements

### Requirement: Codex hook installation

Setup and update SHALL install tracker hooks into the user-level Codex hooks file `$CODEX_HOME/hooks.json` for the `Stop` and `SessionEnd` events. Each installed group SHALL contain exactly one command hook whose command is `node "<home>/.config/ccusage-tracker/codex-sync.mjs" --hook` with timeout 45, and the group SHALL NOT contain a `matcher` key. The CLI SHALL append the tracker group at the end of the event array when absent and SHALL replace an existing tracker group in place at its original index when its content differs. The CLI SHALL NOT remove, reorder or rewrite non-tracker groups, other events or other top-level keys. The CLI SHALL NOT read the hooks file as executable input and SHALL NOT modify `$CODEX_HOME/config.toml`. The Codex result line SHALL distinguish a hook that Codex has disabled from a hook that awaits trust.

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

#### Scenario: Trust reminder after installation

- **WHEN** Codex hooks are installed or changed and no trust record is found for them
- **THEN** the Codex result line SHALL read `Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.`

#### Scenario: Hooks disabled in Codex

- **WHEN** the matching `hooks.state` section for the tracker hook contains `enabled = false`
- **THEN** the Codex result line SHALL read `Codex: hooks installed but disabled in Codex` and SHALL NOT ask the user to trust the hook

#### Scenario: Manual notify entry detected

- **WHEN** `$CODEX_HOME/config.toml` contains a top-level `notify` array that references the tracker `codex-sync.mjs`
- **THEN** the CLI SHALL print a reminder to remove that notify entry because hooks now handle Codex reporting, and SHALL NOT edit the TOML file

#### Scenario: Multi-line top-level array before notify

- **WHEN** a multi-line top-level array whose continuation line starts with `[` appears before the `notify` key
- **THEN** the scan SHALL continue past that line and SHALL still print the reminder; the scan SHALL stop only at a line that is a table header of the form `[name]`

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
