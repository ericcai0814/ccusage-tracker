# ccusage-tracker

CLI for [ccusage-tracker](https://github.com/ericcai0814/ccusage-tracker) — a self-hosted Claude Code usage tracker for teams.

Install Claude Code SessionStart/SessionEnd/Stop hooks that report token usage to a self-hosted tracker server. Runs on macOS, Linux, and Windows.

## Quick start

```bash
npx ccusage-tracker setup
```

You'll be asked for your name, the team's server URL, and a team key (ask your admin).

## Commands

```
ccusage-tracker setup    Install hooks and configure server connection
ccusage-tracker report   View team token usage report
ccusage-tracker status   Check current configuration status
```

After installation, the binary is also available as `tracker` (if installed globally with `npm i -g ccusage-tracker`).

## What it does

`setup` writes a config file to `~/.config/ccusage-tracker/config.json` and adds three hooks to your Claude Code `~/.claude/settings.json`:

- **SessionStart** — records the model at session start
- **Stop** — primary reporting path: POSTs token usage + session metrics after each assistant turn, throttled to once per 5 minutes
- **SessionEnd** — backup path: same payload at session exit, in case Stop missed the last window

Hook scripts are downloaded from your tracker server, so they always match the server version. Re-running `setup` migrates old (no `--mode`) commands in-place — no manual cleanup needed.

## Requirements

- Node.js 18+
- A running ccusage-tracker server (see [main repo](https://github.com/ericcai0814/ccusage-tracker) for self-hosting)

## License

MIT
