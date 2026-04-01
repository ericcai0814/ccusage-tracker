import { existsSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    SessionEnd?: HookMatcher[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export function getClaudeSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

export function getHookCommand(): string {
  return "bash " + join(homedir(), ".config", "ccusage-tracker", "session-end.sh");
}

export function installHook(hookScriptSource: string): { installed: boolean; backedUp: boolean } {
  const settingsPath = getClaudeSettingsPath();
  let settings: ClaudeSettings = {};
  let backedUp = false;

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf-8");
    settings = JSON.parse(raw);

    const backupPath = settingsPath + ".backup";
    copyFileSync(settingsPath, backupPath);
    backedUp = true;
  }

  const hookCommand = getHookCommand();
  const existingHooks = settings.hooks?.SessionEnd ?? [];
  const alreadyInstalled = existingHooks.some(
    (m) => m.hooks?.some((h) => h.command === hookCommand)
  );

  if (alreadyInstalled) {
    return { installed: false, backedUp };
  }

  const newMatcher: HookMatcher = {
    matcher: "*",
    hooks: [{ type: "command", command: hookCommand }],
  };
  const updatedSettings: ClaudeSettings = {
    ...settings,
    hooks: {
      ...settings.hooks,
      SessionEnd: [...existingHooks, newMatcher],
    },
  };

  writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2) + "\n");

  // Copy hook script to config directory
  const destDir = join(homedir(), ".config", "ccusage-tracker");
  const destPath = join(destDir, "session-end.sh");
  copyFileSync(hookScriptSource, destPath);

  return { installed: true, backedUp };
}

export function isHookInstalled(): boolean {
  const settingsPath = getClaudeSettingsPath();
  if (!existsSync(settingsPath)) return false;

  try {
    const settings: ClaudeSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const hookCommand = getHookCommand();
    return settings.hooks?.SessionEnd?.some(
      (m) => m.hooks?.some((h) => h.command === hookCommand)
    ) ?? false;
  } catch {
    return false;
  }
}
