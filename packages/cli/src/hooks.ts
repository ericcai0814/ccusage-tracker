import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
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
  return "node " + join(homedir(), ".config", "ccusage-tracker", "session-end.mjs");
}

// 以路徑片段判斷,可同時辨識新版（node .mjs）與舊版（bash .sh）hook
function isCcusageTrackerHook(command?: string): boolean {
  return !!command && command.includes("ccusage-tracker");
}

export function installHook(scriptContent: string): { installed: boolean; backedUp: boolean } {
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

  // 寫出（或更新）上報腳本到 config 目錄
  const destDir = join(homedir(), ".config", "ccusage-tracker");
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "session-end.mjs"), scriptContent);

  const hookCommand = getHookCommand();
  const existingHooks = settings.hooks?.SessionEnd ?? [];
  const alreadyInstalled = existingHooks.some(
    (m) => m.hooks?.some((h) => isCcusageTrackerHook(h.command))
  );

  if (alreadyInstalled) {
    return { installed: false, backedUp };
  }

  const newMatcher: HookMatcher = {
    matcher: "",
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

  return { installed: true, backedUp };
}

export function isHookInstalled(): boolean {
  const settingsPath = getClaudeSettingsPath();
  if (!existsSync(settingsPath)) return false;

  try {
    const settings: ClaudeSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    return settings.hooks?.SessionEnd?.some(
      (m) => m.hooks?.some((h) => isCcusageTrackerHook(h.command))
    ) ?? false;
  } catch {
    return false;
  }
}
