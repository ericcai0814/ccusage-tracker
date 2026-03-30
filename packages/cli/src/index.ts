#!/usr/bin/env bun

import { setupCommand } from "./commands/setup";
import { reportCommand } from "./commands/report";
import { statusCommand } from "./commands/status";

const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "setup":
    await setupCommand();
    break;
  case "report":
    await reportCommand(args.slice(1));
    break;
  case "status":
    await statusCommand();
    break;
  default:
    console.log("ccusage-tracker CLI\n");
    console.log("Usage: tracker <command>\n");
    console.log("Commands:");
    console.log("  setup    Configure hook and server connection");
    console.log("  report   View team token usage report");
    console.log("  status   Check current configuration status");
    process.exit(command ? 1 : 0);
}
