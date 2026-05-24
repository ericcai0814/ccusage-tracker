#!/usr/bin/env node

// Suppress Node deprecation warnings (notably DEP0190 about execFile with
// `shell: true` + args). The hook contract requires silent stderr; warnings
// would leak into Claude Code's hook output as user-visible noise.
process.removeAllListeners("warning");

import { setupCommand } from "./commands/setup";
import { reportCommand } from "./commands/report";
import { statusCommand } from "./commands/status";
import { hookCommand } from "./commands/hook";
import { uninstallCommand } from "./commands/uninstall";

const VERSION = "0.1.0";
// Note: keep in sync with packages/cli/package.json "version" field.

const args = process.argv.slice(2);
const command = args[0];

function parseSetupFlags(rest: string[]): { name?: string; serverUrl?: string; teamKey?: string } {
  const out: { name?: string; serverUrl?: string; teamKey?: string } = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    const value = rest[i + 1];
    if (!value || value.startsWith("--")) continue;
    if (flag === "--name") { out.name = value; i++; }
    else if (flag === "--server-url") { out.serverUrl = value; i++; }
    else if (flag === "--team-key") { out.teamKey = value; i++; }
  }
  return out;
}

switch (command) {
  case "setup": {
    const setupOptions = parseSetupFlags(args.slice(1));
    await setupCommand(undefined, setupOptions);
    break;
  }
  case "uninstall": {
    const uninstallOpts = { yes: args.slice(1).some((a) => a === "--yes" || a === "-y") };
    await uninstallCommand(uninstallOpts);
    break;
  }
  case "report":
    await reportCommand(args.slice(1));
    break;
  case "status":
    await statusCommand();
    break;
  case "hook":
    await hookCommand(args.slice(1));
    break;
  case "--version":
  case "-v":
    console.log(VERSION);
    break;
  case "--help":
  case "-h":
  case undefined:
    console.log("ccusage-tracker CLI\n");
    console.log("Usage: tracker <command>\n");
    console.log("Commands:");
    console.log("  setup       Configure hook and server connection (--name, --server-url, --team-key)");
    console.log("  report      View team token usage report");
    console.log("  status      Check current configuration status");
    console.log("  hook        Run a Claude Code hook subcommand (session-end | session-start)");
    console.log("  uninstall   Remove ccusage-tracker hooks and config (use --yes to skip confirmation)");
    break;
  default:
    console.error(`Unknown command: ${command}`);
    console.error("Run `tracker --help` for usage.");
    process.exit(1);
}
