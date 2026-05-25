import { createInterface } from "node:readline";
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
    Bun.spawnSync(["ccusage", "--version"]);
    return true;
  } catch {
    return false;
  }
}

async function defaultFetchHookScript(serverUrl: string): Promise<string | null> {
  try {
    const res = await fetch(`${serverUrl}/scripts/session-end.mjs`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface SetupDeps {
  prompt: (question: string) => Promise<string>;
  writeConfig: (config: TrackerConfig) => void;
  installHook: (scriptContent: string) => { installed: boolean; backedUp: boolean };
  fetchHookScript: (serverUrl: string) => Promise<string | null>;
  checkServer: (serverUrl: string) => Promise<boolean>;
  checkCcusage: () => boolean;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  exit: (code: number) => void;
}

const defaultDeps: SetupDeps = {
  prompt: defaultPrompt,
  writeConfig,
  installHook,
  fetchHookScript: defaultFetchHookScript,
  checkServer: defaultCheckServer,
  checkCcusage: defaultCheckCcusage,
  log: (msg) => console.log(msg),
  warn: (msg) => console.warn(msg),
  exit: (code) => process.exit(code),
};

export async function setupCommand(overrides?: Partial<SetupDeps>): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };

  deps.log("ccusage-tracker setup\n");

  const name = await deps.prompt("Your name: ");
  if (!name) {
    deps.warn("Name is required.");
    deps.exit(1);
    return;
  }

  const serverUrl = await deps.prompt("Server URL (e.g. https://tracker.example.com): ");
  if (!serverUrl) {
    deps.warn("Server URL is required.");
    deps.exit(1);
    return;
  }

  const teamKey = await deps.prompt("Team Key (ask your admin): ");
  if (!teamKey) {
    deps.warn("Team Key is required.");
    deps.exit(1);
    return;
  }

  // Write config
  const config: TrackerConfig = {
    server_url: serverUrl.replace(/\/+$/, ""),
    team_key: teamKey,
    member_name: name,
  };
  deps.writeConfig(config);
  deps.log("\nConfig saved.");

  // Install hook（從 server 下載最新的 .mjs 上報腳本，與 setup.sh/setup.ps1 一致）
  const scriptContent = await deps.fetchHookScript(config.server_url);
  if (scriptContent) {
    try {
      const { installed, backedUp } = deps.installHook(scriptContent);
      if (installed) {
        deps.log("SessionEnd hook installed." + (backedUp ? " (settings.json backed up)" : ""));
      } else {
        deps.log("SessionEnd hook already installed.");
      }
    } catch (err) {
      deps.warn("Warning: Could not install hook automatically. " + (err as Error).message);
    }
  } else {
    deps.warn("Warning: Could not download hook script from " + config.server_url);
  }

  // Verify server
  const serverOk = await deps.checkServer(config.server_url);
  if (serverOk) {
    deps.log("Server is reachable.");
  } else {
    deps.warn("Warning: Server is not reachable at " + config.server_url);
  }

  // Check ccusage
  const hasCcusage = deps.checkCcusage();
  if (hasCcusage) {
    deps.log("ccusage is installed.");
  } else {
    deps.warn("Warning: ccusage not found. Install with: npx ccusage@latest");
  }

  deps.log("\nSetup complete!");
}
