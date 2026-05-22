import { sessionEndCommand } from "./session-end";
import { sessionStartCommand } from "./session-start";

function printHookUsage(): void {
  console.log("Usage: tracker hook <subcommand>\n");
  console.log("Subcommands:");
  console.log("  session-end    Process Claude Code SessionEnd hook event");
  console.log("  session-start  Process Claude Code SessionStart hook event");
}

export async function hookCommand(args: string[]): Promise<void> {
  const sub = args[0];

  switch (sub) {
    case "session-end":
      await sessionEndCommand();
      return;
    case "session-start":
      await sessionStartCommand();
      return;
    case "--help":
    case "-h":
    case undefined:
      printHookUsage();
      return;
    default:
      console.error(`Unknown hook subcommand: ${sub}`);
      console.error("Run `tracker hook --help` for usage.");
      process.exit(1);
  }
}
