#!/usr/bin/env node

import { setupCommand } from "./commands/setup";
import { reportCommand } from "./commands/report";
import { statusCommand } from "./commands/status";
import { updateCommand } from "./commands/update";
import { syncCommand } from "./commands/sync";

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
  case "update":
    await updateCommand();
    break;
  case "sync":
    await syncCommand(args.slice(1));
    break;
  default:
    console.log("ccusage-tracker CLI\n");
    console.log("Usage: tracker <command>\n");
    console.log("Commands:");
    console.log("  setup    Configure hook and server connection");
    console.log("  update   Refresh installed scripts/hooks using existing configuration");
    console.log("  sync codex  Report Codex daily usage now");
    console.log("  report   View team token usage report");
    console.log("  status   Check current configuration status");
    process.exit(command ? 1 : 0);
}
