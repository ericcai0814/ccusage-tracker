# ccusage-tracker

CLI for [ccusage-tracker](https://github.com/ericcai0814/ccusage-tracker) — a self-hosted Claude Code usage tracker for teams.

Install Claude Code SessionStart/SessionEnd hooks that report token usage to a self-hosted tracker server. Runs on macOS, Linux, and Windows.

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

`setup` writes a config file to `~/.config/ccusage-tracker/config.json` and adds two hooks to your Claude Code `~/.claude/settings.json`:

- **SessionStart** — records the model at session start
- **SessionEnd** — POSTs token usage (and session metrics in 0.2.1+) to your team's tracker server

Hook scripts are downloaded from your tracker server, so they always match the server version.

## Requirements

- Node.js 18+
- A running ccusage-tracker server (see [main repo](https://github.com/ericcai0814/ccusage-tracker) for self-hosting)

## License

MIT
