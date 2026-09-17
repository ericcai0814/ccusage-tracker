import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir, readConfig } from "../config";

export async function syncCommand(args: string[]): Promise<void> {
  if (args.length !== 1 || args[0] !== "codex") {
    console.error("Usage: tracker sync codex");
    process.exitCode = 1;
    return;
  }
  if (!readConfig()) {
    console.error("Missing or invalid configuration. Run `tracker setup` first.");
    process.exitCode = 1;
    return;
  }
  const script = join(getConfigDir(), "codex-sync.mjs");
  if (!existsSync(script)) {
    console.error("Codex script not installed. Run `tracker update` with a server that supports Codex.");
    process.exitCode = 1;
    return;
  }
  // argv avoids shell quoting and safely handles home paths containing spaces.
  process.exitCode = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [script], { stdio: "inherit" });
    child.on("error", (error) => {
      console.error("Could not run Codex sync: " + error.message);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}
