import { createInterface } from "node:readline";
import { execFileSync } from "node:child_process";
import { writeConfig, type TrackerConfig } from "../config";
import { installHook } from "../hooks";

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

async function defaultCheckServer(serverUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${serverUrl}/api/health`, { signal: AbortSignal.timeout(5000) });
    const body = await res.json() as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

function defaultCheckCcusage(): boolean {
  try {
    execFileSync("ccusage", ["--version"], {
      shell: true,
      stdio: "ignore",
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

export interface SetupDeps {
  prompt: (question: string) => Promise<string>;
  writeConfig: (config: TrackerConfig) => void;
  installHook: () => { installed: boolean; backedUp: boolean; migratedLegacy: boolean };
  checkServer: (serverUrl: string) => Promise<boolean>;
  checkCcusage: () => boolean;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  exit: (code: number) => void;
}

export interface SetupOptions {
  name?: string;
  serverUrl?: string;
  teamKey?: string;
}

const defaultDeps: SetupDeps = {
  prompt: defaultPrompt,
  writeConfig,
  installHook: () => installHook(),
  checkServer: defaultCheckServer,
  checkCcusage: defaultCheckCcusage,
  log: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  exit: (code) => process.exit(code),
};

async function resolveField(
  current: string | undefined,
  prompt: SetupDeps["prompt"],
  question: string,
): Promise<string> {
  if (current && current.trim()) return current.trim();
  return prompt(question);
}

export async function setupCommand(
  overrides?: Partial<SetupDeps>,
  options: SetupOptions = {},
): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };

  deps.log("ccusage-tracker setup\n");

  const name = await resolveField(options.name, deps.prompt, "Your name: ");
  if (!name) {
    deps.warn("Name is required.");
    deps.exit(1);
    return;
  }

  const serverUrl = await resolveField(options.serverUrl, deps.prompt, "Server URL (e.g. https://tracker.example.com): ");
  if (!serverUrl) {
    deps.warn("Server URL is required.");
    deps.exit(1);
    return;
  }

  const teamKey = await resolveField(options.teamKey, deps.prompt, "Team Key: ");
  if (!teamKey) {
    deps.warn("Team Key is required.");
    deps.exit(1);
    return;
  }

  const config: TrackerConfig = {
    server_url: serverUrl.replace(/\/+$/, ""),
    team_key: teamKey,
    member_name: name,
  };
  deps.writeConfig(config);
  deps.log("\nConfig saved.");

  try {
    const { installed, backedUp, migratedLegacy } = deps.installHook();
    if (migratedLegacy) {
      deps.log("Migrated legacy bash hook to `tracker hook` CLI command." + (backedUp ? " (settings.json backed up to .backup-pre-cli-migration)" : ""));
    } else if (installed) {
      deps.log("SessionStart + SessionEnd hooks installed." + (backedUp ? " (settings.json backed up)" : ""));
    } else {
      deps.log("Hooks already installed.");
    }
  } catch (err) {
    deps.warn("Warning: Could not install hooks automatically. " + (err as Error).message);
  }

  const serverOk = await deps.checkServer(config.server_url);
  if (serverOk) {
    deps.log("Server is reachable.");
  } else {
    deps.warn("Warning: Server is not reachable at " + config.server_url);
  }

  const hasCcusage = deps.checkCcusage();
  if (hasCcusage) {
    deps.log("ccusage is installed.");
  } else {
    deps.warn("Warning: ccusage not found. Install with: npx ccusage@latest");
  }

  deps.log("\nSetup complete!");
}
