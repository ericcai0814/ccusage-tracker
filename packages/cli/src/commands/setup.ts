import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { writeConfig, type TrackerConfig } from "../config";
import { installHook } from "../hooks";

// piped stdin 下，readline 的 'line' event 會在下一個 rl.question 註冊監聽器前就觸發，
// 導致行被吞掉、後續 prompt 永遠等不到 callback。
// 改用 readline 的 async iterator：line 會 buffer，await .next() 一筆筆取，避免 race。
let sharedRl: ReadlineInterface | null = null;
let lineIterator: AsyncIterator<string> | null = null;

async function defaultPrompt(question: string): Promise<string> {
  if (!sharedRl || !lineIterator) {
    sharedRl = createInterface({ input: process.stdin, output: process.stdout });
    lineIterator = sharedRl[Symbol.asyncIterator]();
  }
  process.stdout.write(question);
  const { value, done } = await lineIterator.next();
  return done ? "" : value.trim();
}

function closeSharedPrompt(): void {
  if (sharedRl) {
    sharedRl.close();
    sharedRl = null;
    lineIterator = null;
  }
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

async function defaultFetchHookScript(serverUrl: string, scriptName: string): Promise<string | null> {
  try {
    const res = await fetch(`${serverUrl}/scripts/${scriptName}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

export interface SetupDeps {
  prompt: (question: string) => Promise<string>;
  writeConfig: (config: TrackerConfig) => void;
  installHook: (scripts: { sessionEnd: string; sessionStart: string }) => {
    sessionEndInstalled: boolean;
    sessionStartInstalled: boolean;
    backedUp: boolean;
  };
  fetchHookScript: (serverUrl: string, scriptName: string) => Promise<string | null>;
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

  try {
    await runSetup(deps);
  } finally {
    closeSharedPrompt();
  }
}

async function runSetup(deps: SetupDeps): Promise<void> {
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

  // Install hooks（從 server 下載最新的 .mjs 上報腳本，與 setup.sh/setup.ps1 一致：
  // SessionEnd 上報用量、SessionStart 記錄 model）
  const [sessionEnd, sessionStart] = await Promise.all([
    deps.fetchHookScript(config.server_url, "session-end.mjs"),
    deps.fetchHookScript(config.server_url, "session-start.mjs"),
  ]);
  if (sessionEnd && sessionStart) {
    try {
      const { sessionEndInstalled, sessionStartInstalled, backedUp } = deps.installHook({
        sessionEnd,
        sessionStart,
      });
      if (sessionEndInstalled || sessionStartInstalled) {
        deps.log("SessionStart + SessionEnd hooks installed." + (backedUp ? " (settings.json backed up)" : ""));
      } else {
        deps.log("SessionStart + SessionEnd hooks already installed.");
      }
    } catch (err) {
      deps.warn("Warning: Could not install hooks automatically. " + (err as Error).message);
    }
  } else {
    deps.warn("Warning: Could not download hook scripts from " + config.server_url);
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
