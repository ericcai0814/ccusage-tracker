import { createInterface, type Interface as ReadlineInterface } from "node:readline";
import { isTrackerConfig, writeConfig, type TrackerConfig } from "../config";
import {
  defaultWiringDeps,
  detectClaude,
  installHook,
  wireTools,
  type InstallResult,
  type InstallTargets,
} from "../hooks";
import { detectCodex } from "../codex-hooks";
import { defaultCollectorDeps, ensureCollector } from "../collector";
import { downloadScripts, fetchHookScript, type TrackerScripts } from "../scripts";

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

export interface SetupDeps {
  prompt: (question: string) => Promise<string>;
  writeConfig: (config: TrackerConfig) => void;
  installHook: (scripts: TrackerScripts, targets: InstallTargets) => InstallResult;
  fetchHookScript: (serverUrl: string, scriptName: string) => Promise<string | null>;
  checkServer: (serverUrl: string) => Promise<boolean>;
  detectClaude: () => boolean;
  detectCodex: () => boolean;
  probeCollector: () => string | null;
  installCollector: (command: string) => boolean;
  readCodexConfig: () => string | null;
  log: (msg: string) => void;
  warn: (msg: string) => void;
  exit: (code: number) => void;
}

const defaultDeps: SetupDeps = {
  prompt: defaultPrompt,
  writeConfig,
  installHook,
  fetchHookScript,
  checkServer: defaultCheckServer,
  detectClaude: () => detectClaude(),
  detectCodex,
  probeCollector: defaultCollectorDeps.probe,
  installCollector: defaultCollectorDeps.install,
  readCodexConfig: defaultWiringDeps.readCodexConfig,
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
  if (!isTrackerConfig(config)) {
    deps.warn("Invalid configuration. Server URL must use http or https without embedded credentials.");
    deps.exit(1);
    return;
  }
  deps.writeConfig(config);
  deps.log("\nConfig saved.");

  // Shell installers remain Claude-only; the CLI wires every detected tool.
  // 未偵測到任何工具不算失敗：config 已寫好，裝了工具再跑 update 即可。
  try {
    const scripts = await downloadScripts(config.server_url, deps.fetchHookScript);
    wireTools(scripts, {
      detectClaude: deps.detectClaude,
      detectCodex: deps.detectCodex,
      installHook: deps.installHook,
      readCodexConfig: deps.readCodexConfig,
      log: deps.log,
      warn: deps.warn,
    });
  } catch (err) {
    deps.warn("Could not install tracker scripts. " + (err as Error).message + " Run `tracker update` after resolving the problem.");
    deps.exit(1);
    return;
  }

  // 收集器：失敗只警告，不改 exit code —— hook 已就位，缺 collector 由 status 顯示。
  ensureCollector({
    probe: deps.probeCollector,
    install: deps.installCollector,
    log: deps.log,
    warn: deps.warn,
  });

  // Verify server
  const serverOk = await deps.checkServer(config.server_url);
  if (serverOk) {
    deps.log("Server is reachable.");
  } else {
    deps.warn("Warning: Server is not reachable at " + config.server_url);
  }

  deps.log("\nSetup complete!");
}
