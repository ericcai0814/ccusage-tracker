# ccusage-tracker

CLI for [ccusage-tracker](https://github.com/ericcai0814/ccusage-tracker), a self-hosted Claude Code and Codex usage tracker for teams.

Reports usage from local subscription/OAuth logs. No model API key is needed, and reporting does not upload prompts, responses, or tool results. The tracker team key is a separate server access credential.

## Quick start

```bash
npx ccusage-tracker@latest setup
```

You'll be asked for your name, the team's server URL, and a team key (ask your admin).

Setup detects which supported tools exist on this machine and wires automatic reporting for each of them: Claude Code hooks in `~/.claude/settings.json`, Codex hooks in `$CODEX_HOME/hooks.json`. It installs the verified collector when missing, and never modifies `$CODEX_HOME/config.toml`.

Codex needs one extra, platform-mandated step: **open Codex and run `/hooks` once to trust the ccusage-tracker hooks.** Codex silently skips hooks it has not been told to trust. Codex can run independently without Claude Code installed.

## Updating an existing installation

```bash
npx ccusage-tracker@latest update
```

`update` asks no questions and reuses the existing configuration, running the same detection, hook installation and collector step as `setup`. It preserves the exact config bytes, buffered usage, session data, and unrelated settings/hooks in both files. All required scripts are downloaded and syntax-checked before installation; `settings.json` and `hooks.json` are written in one transaction, so a failure in either leaves both untouched. Changed files are backed up. Repeated updates do not duplicate tracker hooks and leave both files byte-identical.

Third-party Codex hook groups keep their exact bytes and their position: the tracker group is only appended at the end of the event array, or replaced in place at its own index. Codex trust keys are built from group indexes, so reordering would invalidate the trust of every hook after the moved one.

Missing/invalid configuration, download failures, or installation failures return a nonzero exit status; run `setup` if configuration is missing. When neither Claude Code nor Codex is detected, `update` returns nonzero and tells you to install one first (`setup` still saves the configuration and exits 0).

`@latest` runs the latest **published CLI**. It does not refresh server-downloaded hooks by itself: `update` downloads those scripts, and new hook features require the corresponding server deployment. A server returning 404/410 for the optional Codex script keeps the Claude installation working, leaves `$CODEX_HOME/hooks.json` untouched (a hook pointing at a missing script is worse than no hook), and prints a compatibility message. Other failures abort the update.

For a global installation, update the CLI package and hooks separately:

```bash
npm install -g ccusage-tracker@latest
tracker update
```

There is no universal `npx update` command.

## Commands

```
ccusage-tracker setup    Install hooks and configure server connection
ccusage-tracker update   Refresh scripts/hooks using existing configuration
ccusage-tracker sync codex  Report Codex usage now (manual fallback / debugging)
ccusage-tracker report   View team token usage report
ccusage-tracker status   Check configuration and each source's upload status
```

After installation, the binary is also available as `tracker` (if installed globally with `npm i -g ccusage-tracker`).

## What it does

`setup` writes a config file to `~/.config/ccusage-tracker/config.json` and adds three hooks to your Claude Code `~/.claude/settings.json`:

- **SessionStart** — records the model at session start
- **Stop** — primary reporting path: POSTs token usage + session metrics after each assistant turn, throttled to once per 5 minutes
- **SessionEnd** — backup path: same payload at session exit, in case Stop missed the last window

For Codex it appends two groups to `$CODEX_HOME/hooks.json` (default `~/.codex/hooks.json`), each a single `node "<path>/codex-sync.mjs" --hook` command with a 45 second timeout and no `matcher` key:

- **Stop** — reports after each turn, throttled to once per 5 minutes
- **SessionEnd** — backup path at session exit

The hook process only reads `hook_event_name` from the event on stdin and hands the work to a detached background worker; it never blocks Codex and never forwards payload content. The command string is byte-identical across updates, so refreshing the scripts does not require re-trusting the hooks.

Hook scripts come from your configured tracker server. Setup/update migrate old tracker commands and quote paths containing spaces. Existing shell/PowerShell installers remain Claude-only; they do not install Codex reporting.

**Do not hand-edit the tracker hook command.** A hook counts as a tracker hook only when the whole command matches a canonical or known historical shape: an optional interpreter that matches the script extension (`node` for `.mjs`, `bash`/`sh` for `.sh`, `powershell`/`pwsh` with `-File` for `.ps1`), the absolute tracker script path, and only tracker arguments (`--hook`, `--notify`, `--mode=<value>`). Commands written by earlier installers still upgrade in place to exactly one tracker hook, as long as the script path is a single token. An unquoted path containing spaces is not reassembled: that shape cannot be told apart from a command passing the tracker path to another program, and guessing wrong would delete a third-party hook, so such a hook gets a second, canonical tracker entry instead. Anything else is treated as third-party, kept byte-identical, and the tracker group is appended separately: a custom flag, a wrapper, any shell syntax outside quotes (`&&`, `;`, a pipe, a redirect, a substitution — with or without surrounding whitespace), a command that merely passes the script path to another program (`node /opt/lint.js <tracker path>`, `/usr/bin/env node <tracker path>`), or anything the shell would reinterpret — `$` or a backtick anywhere (they expand inside double quotes too), `%` (cmd.exe expansion), a paired `%NAME%` (cmd.exe expansion; a lone `%` is fine), `!` anywhere (cmd.exe delayed expansion), brace or glob syntax in an unquoted token (`/opt/{real,foreign}/node …` runs a different program than it appears to; the same characters inside quotes are fine), or a backslash in an unquoted token (a POSIX shell consumes it). Backslashes count as separators only in Windows drive and UNC paths, so `"/home/a\b/.config/ccusage-tracker/session-end.mjs"` is recognized while `"/tmp/ccusage-tracker\session-end.mjs"` is not — on POSIX the latter is one file name, not a script inside a directory. A command byte-identical to the one this CLI would write is always recognized, so repeated runs stay a no-op even when your home directory contains those characters. That means an edited tracker command results in two tracker hooks rather than an upgraded one.

When `settings.json` or `hooks.json` is a symbolic link (dotfiles setups), the CLI writes through to the real file and leaves the link in place; the `.backup` is written next to the real file, and the output names each file written this way (`Wrote through symlink: <link> -> <real>`). File types are checked before anything is read, so a link that dangles or resolves to a directory, FIFO, socket or other non-regular file is refused before the first read and the whole transaction is rolled back.

### Collector

Setup and update run the same collector step, and only when at least one supported tool is detected. When `ccusage` is missing, the CLI prints and runs `npm install -g ccusage@20.0.20`. That is a global npm install: it downloads the package from the registry and runs its install-time (lifecycle) scripts. If you would rather install the collector yourself, set `CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1` before running setup or update — the CLI then only prints the command. When a different major version is installed, it warns that Claude reporting works but Codex requires 20.0.20, and does not replace it; the same check applies to the version probed right after an automatic install, since another `ccusage` earlier on PATH may win. A failed install never changes the exit status of setup or update — `status` reports what is missing.

## Codex usage

Keep your existing ChatGPT subscription/OAuth login. Make sure `ccusage` is on both your terminal's and Codex's PATH — setup installs it for you when it is missing.

```bash
# First installation; existing users run update instead.
npx ccusage-tracker@latest setup

# Then, inside Codex, trust the hooks once:
/hooks

npx ccusage-tracker@latest status
npx ccusage-tracker@latest report --period today --json
```

### Trust the hooks once

Codex **silently skips** hooks it has not been told to trust, so "installed but never runs" is the most likely way this fails. After setup or update, run `/hooks` inside Codex and trust the ccusage-tracker entries. Codex records that in its own `config.toml`.

`status` prints one `Codex hooks:` line:

| Output | Meaning |
|---|---|
| `installed, trust recorded` | Hooks are installed and a matching trust record exists |
| `installed, awaiting trust (open /hooks in Codex)` | Neither hook is trusted yet, so Codex will not run them |
| `installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)` | Only one of the two is trusted; the line names which one is missing |
| `installed, disabled in Codex` | You disabled them inside Codex |
| `installed, Stop disabled in Codex, SessionEnd trusted` | Only one of the two is disabled |
| `not installed` | Not wired yet — run `update` |

Each hook is trusted separately, so setup, update and `status` all report the two hooks individually when their states differ. The CLI only reads `config.toml` to see whether a trust record exists. It never validates the hash (Codex's algorithm is internal, hence "trust recorded" rather than "trusted") and never writes `hooks.state` on your behalf.

### Manual fallback

`sync codex` remains available for manual reporting and debugging; normal operation does not depend on it. It waits for the result, returns nonzero on failure, and ignores the five-minute throttle, so it is the way to confirm the final usage right now.

```bash
npx ccusage-tracker@latest sync codex
```

Status shows the Codex script/collector, hook trust state, pending buffer, last error, and last successful upload. No readable usage means “no data,” without a fabricated zero snapshot.

### The old notify entry (deprecated)

Earlier versions asked you to add `notify = [... "--notify"]` to `$CODEX_HOME/config.toml` by hand. Hooks now handle automatic reporting and that path is kept only for compatibility. If you configured it, remove the tracker entry yourself to avoid triggering twice — setup/update warn when they see it but **never edit the TOML**. Leaving it in place cannot corrupt the data: same-day snapshots are idempotent, the lock is exclusive, and both trigger paths share the same five-minute throttle. Remove the tracker group from `hooks.json` (and the notify entry, if any) before uninstalling tracker; the uninstall script edits neither file.

### Accounting and limits

- The verified `ccusage 20.0.20 codex daily --json` output is `{daily, totals}` with `costUSD` and a `models` object. Its input already excludes cache reads. Raw input 1000, cached input 400, output 200, and reasoning 50 become **600 + 400 + 200 = 1200** tokens. Reasoning is already in output; cache creation is zero.
- Claude retains `daily`; Codex uses `codex-daily`. Each is an idempotent member/date snapshot, so repeats update rather than duplicate usage. Reports add the two sources once. Costs are API-equivalent estimates, not subscription invoices.
- Verified published collectors are Claude `18.0.9`/`18.0.10` and Claude/Codex `20.0.20`; these are evidence, not an exact patch whitelist. The legacy family (major <=19) retains `daily --json --since`; major 20 requires explicit `claude daily` or `codex daily`, with day/timezone flags and schema validation on every result. Unknown majors (such as 99), unsupported commands, and invalid schemas fail visibly without falling back to unified daily. `20.0.21` is a synthetic compatibility fixture, not a tested published release; untested versions are not guaranteed. The separate `@ccusage/codex 19.0.0`/`ccusage-codex` package is not used.
- Sync collects the current local day only, with no historical backfill. Keep original compact Codex JSONL: the tested native collector can skip reformatted logs. The server's Today filter uses UTC; use `--period month` or the daily API when local and UTC dates differ.
- Codex has its own lock, buffer, and error/success markers in `~/.config/ccusage-tracker/`. Failed snapshots remain until delivered; newer same-day snapshots replace stale ones before retry. Claude keeps its separate buffer and five-minute Stop throttle. Codex hook and legacy notify triggers share their own five-minute throttle recorded in `codex-last-flush.txt` and skip overlapping syncs; manual sync ignores the throttle and can confirm the final usage.
- An interrupted stale-lock recovery can leave `codex-worker.lock.reclaim` or `worker.lock.reclaim`. If the reported recovery error persists, stop the corresponding workers before removing only that marker and retrying.
- Codex session behavior analytics are outside this feature.

## Requirements

- Tracker CLI/scripts: Node.js 18+; macOS, Linux, and Windows paths are supported. Runtime verification used Node 24 and Node 18.20.8 on macOS, including paths with spaces; other operating systems were not executed. Node 18 fixtures declare ES modules explicitly, matching the CLI package metadata.
- Collector: `ccusage@20.0.20` is the verified Codex installation choice, using its platform-specific native package (verified on macOS arm64). Compatible major-20 patches are not rejected solely for their patch number. Claude-only `ccusage@18.0.9`/`18.0.10` require Node >=20.19.4 independently of tracker's engine. The unused standalone `@ccusage/codex@19.0.0` requires Node >=22.
- A running ccusage-tracker server (see [main repo](https://github.com/ericcai0814/ccusage-tracker) for self-hosting)

## License

MIT
