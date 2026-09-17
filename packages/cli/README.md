# ccusage-tracker

CLI for [ccusage-tracker](https://github.com/ericcai0814/ccusage-tracker), a self-hosted Claude Code and Codex usage tracker for teams.

Reports usage from local subscription/OAuth logs. No model API key is needed, and reporting does not upload prompts, responses, or tool results. The tracker team key is a separate server access credential.

**Unreleased:** `update`, `sync codex`, and the Codex script on this branch have not been published or deployed. The commands below require the corresponding CLI release and server deployment. For a local checkout, build with `pnpm --filter ccusage-tracker build` and use `node packages/cli/dist/index.js <command>`.

## Quick start

```bash
npx ccusage-tracker@latest setup
```

You'll be asked for your name, the team's server URL, and a team key (ask your admin).

Setup downloads scripts and installs Claude hooks. It does not install a global collector or change Codex configuration. Codex can run independently without Claude Code installed.

## Updating an existing installation

```bash
npx ccusage-tracker@latest update
```

`update` asks no questions and reuses the existing configuration. It preserves the exact config bytes, buffered usage, session data, and unrelated settings/hooks. All required scripts are downloaded and syntax-checked before installation; changed files are backed up. Repeated updates do not duplicate tracker hooks. Missing/invalid configuration, download failures, or installation failures return a nonzero exit status; run `setup` if configuration is missing.

`@latest` runs the latest **published CLI**. It does not refresh server-downloaded hooks by itself: `update` downloads those scripts, and new hook features require the corresponding server deployment. A server returning 404/410 for the optional Codex script keeps the Claude installation working and prints a compatibility message. Other failures abort the update.

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
ccusage-tracker sync codex  Synchronize today's Codex usage
ccusage-tracker report   View team token usage report
ccusage-tracker status   Check configuration and each source's upload status
```

After installation, the binary is also available as `tracker` (if installed globally with `npm i -g ccusage-tracker`).

## What it does

`setup` writes a config file to `~/.config/ccusage-tracker/config.json` and adds three hooks to your Claude Code `~/.claude/settings.json`:

- **SessionStart** — records the model at session start
- **Stop** — primary reporting path: POSTs token usage + session metrics after each assistant turn, throttled to once per 5 minutes
- **SessionEnd** — backup path: same payload at session exit, in case Stop missed the last window

Hook scripts come from your configured tracker server. Setup/update migrate old tracker commands and quote paths containing spaces. Existing shell/PowerShell installers remain Claude-only; they do not install Codex reporting or configure notify.

## Codex usage

Keep your existing ChatGPT subscription/OAuth login. Install the verified collector, with `ccusage` available on both your terminal's and Codex's PATH:

```bash
npm install -g ccusage@20.0.20
ccusage --version

# First installation; existing users run update instead.
npx ccusage-tracker@latest setup
npx ccusage-tracker@latest sync codex
npx ccusage-tracker@latest status
npx ccusage-tracker@latest report --period today --json
```

Manual sync waits for the result and returns nonzero on failure. Status shows the Codex script/collector, pending buffer, last error, and last successful upload. No readable usage means “no data,” without a fabricated zero snapshot.

### Optional automatic reporting

Setup/update never overwrite an existing Codex `notify`. To opt in, add this **at the top level, before any `[table]`**, in `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`):

```toml
notify = ["node", "/Users/your-name/.config/ccusage-tracker/codex-sync.mjs", "--notify"]
```

Use your actual absolute script path, not `~`. Spaces are safe inside an array element. On Windows, a path such as `"C:/Users/Your Name/.config/ccusage-tracker/codex-sync.mjs"` works; use an absolute Node path too if Node is absent from Codex's PATH. Restart Codex CLI after editing.

If you already have `notify`, keep it and use manual sync or have your existing notification program call this script. Do not add a second `notify` key. Codex supplies the event as one JSON argument; the script accepts `agent-turn-complete`, discards message content, and starts a background worker without the payload. See the [official notify documentation](https://developers.openai.com/codex/config-advanced/#notifications). Remove this notify entry before uninstalling tracker; the uninstall script does not edit Codex TOML.

### Accounting and limits

- The verified `ccusage 20.0.20 codex daily --json` output is `{daily, totals}` with `costUSD` and a `models` object. Its input already excludes cache reads. Raw input 1000, cached input 400, output 200, and reasoning 50 become **600 + 400 + 200 = 1200** tokens. Reasoning is already in output; cache creation is zero.
- Claude retains `daily`; Codex uses `codex-daily`. Each is an idempotent member/date snapshot, so repeats update rather than duplicate usage. Reports add the two sources once. Costs are API-equivalent estimates, not subscription invoices.
- Verified published collectors are Claude `18.0.9`/`18.0.10` and Claude/Codex `20.0.20`; these are evidence, not an exact patch whitelist. The legacy family (major <=19) retains `daily --json --since`; major 20 requires explicit `claude daily` or `codex daily`, with day/timezone flags and schema validation on every result. Unknown majors (such as 99), unsupported commands, and invalid schemas fail visibly without falling back to unified daily. `20.0.21` is a synthetic compatibility fixture, not a tested published release; untested versions are not guaranteed. The separate `@ccusage/codex 19.0.0`/`ccusage-codex` package is not used.
- Sync collects the current local day only, with no historical backfill. Keep original compact Codex JSONL: the tested native collector can skip reformatted logs. The server's Today filter uses UTC; use `--period month` or the daily API when local and UTC dates differ.
- Codex has its own lock, buffer, and error/success markers in `~/.config/ccusage-tracker/`. Failed snapshots remain until delivered; newer same-day snapshots replace stale ones before retry. Claude keeps its separate buffer and five-minute Stop throttle. Codex notify has no additional throttle and skips overlapping syncs; manual sync can confirm the final usage.
- An interrupted stale-lock recovery can leave `codex-worker.lock.reclaim` or `worker.lock.reclaim`. If the reported recovery error persists, stop the corresponding workers before removing only that marker and retrying.
- Codex session behavior analytics are outside this feature.

## Requirements

- Tracker CLI/scripts: Node.js 18+; macOS, Linux, and Windows paths are supported. Runtime verification used Node 24 and Node 18.20.8 on macOS, including paths with spaces; other operating systems were not executed. Node 18 fixtures declare ES modules explicitly, matching the CLI package metadata.
- Collector: `ccusage@20.0.20` is the verified Codex installation choice, using its platform-specific native package (verified on macOS arm64). Compatible major-20 patches are not rejected solely for their patch number. Claude-only `ccusage@18.0.9`/`18.0.10` require Node >=20.19.4 independently of tracker's engine. The unused standalone `@ccusage/codex@19.0.0` requires Node >=22.
- A running ccusage-tracker server (see [main repo](https://github.com/ericcai0814/ccusage-tracker) for self-hosting)

## License

MIT
