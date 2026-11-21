import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir, readConfig } from "../config";
import { resolveAgentSource } from "../agent-sources";

const USAGE = "Usage: tracker sync codex|antigravity";

interface SyncTarget {
  scriptName: string;
  scriptArgs: string[];
  missing: string;
  label: string;
}

// codex 走自己的 codex-sync.mjs；其他工具（目前是 Antigravity，別名 agy）走 agent-sync.mjs <來源>。
function resolveTarget(name: string): SyncTarget | null {
  if (name === "codex") {
    return {
      scriptName: "codex-sync.mjs",
      scriptArgs: [],
      missing: "Codex script not installed. Run `tracker update` with a server that supports Codex.",
      label: "Codex",
    };
  }
  const source = resolveAgentSource(name);
  if (source === null) return null;
  return {
    scriptName: source.scriptName,
    scriptArgs: [source.id],
    missing: `${source.label} script not installed. Run tracker update with a server that provides ${source.scriptName}.`,
    label: source.label,
  };
}

export async function syncCommand(args: string[]): Promise<void> {
  const target = args.length === 1 ? resolveTarget(args[0]) : null;
  if (target === null) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  if (!readConfig()) {
    console.error("Missing or invalid configuration. Run `tracker setup` first.");
    process.exitCode = 1;
    return;
  }
  const script = join(getConfigDir(), target.scriptName);
  if (!existsSync(script)) {
    console.error(target.missing);
    process.exitCode = 1;
    return;
  }
  // argv avoids shell quoting and safely handles home paths containing spaces.
  process.exitCode = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, [script, ...target.scriptArgs], { stdio: "inherit" });
    child.on("error", (error) => {
      console.error(`Could not run ${target.label} sync: ` + error.message);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 1));
  });
}
