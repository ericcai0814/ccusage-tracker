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
    SessionStart?: HookMatcher[];
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

export function getStartHookCommand(): string {
  return "node " + join(homedir(), ".config", "ccusage-tracker", "session-start.mjs");
}

// 以路徑片段判斷,可同時辨識新版（node .mjs）與舊版（bash .sh）hook
function isCcusageTrackerHook(command?: string): boolean {
  return !!command && command.includes("ccusage-tracker");
}

// 對單一 hook 陣列做冪等 append：若已有 tracker hook 則原樣回傳，否則補上一筆 matcher
function appendHookIfMissing(
  existing: HookMatcher[],
  command: string
): { matchers: HookMatcher[]; installed: boolean } {
  const present = existing.some((m) => m.hooks?.some((h) => isCcusageTrackerHook(h.command)));
  if (present) {
    return { matchers: existing, installed: false };
  }
  const newMatcher: HookMatcher = {
    matcher: "",
    hooks: [{ type: "command", command }],
  };
  return { matchers: [...existing, newMatcher], installed: true };
}

// 純函式：在記憶體中對 settings 冪等 merge tracker 的 SessionStart + SessionEnd hook。
// 不碰檔案系統，便於測試。
export function applyTrackerHooks(settings: ClaudeSettings): {
  updated: ClaudeSettings;
  sessionStartInstalled: boolean;
  sessionEndInstalled: boolean;
} {
  const start = appendHookIfMissing(settings.hooks?.SessionStart ?? [], getStartHookCommand());
  const end = appendHookIfMissing(settings.hooks?.SessionEnd ?? [], getHookCommand());

  const updated: ClaudeSettings =
    start.installed || end.installed
      ? {
          ...settings,
          hooks: {
            ...settings.hooks,
            SessionStart: start.matchers,
            SessionEnd: end.matchers,
          },
        }
      : settings;

  return {
    updated,
    sessionStartInstalled: start.installed,
    sessionEndInstalled: end.installed,
  };
}

export function installHook(scripts: {
  sessionEnd: string;
  sessionStart: string;
}): { sessionEndInstalled: boolean; sessionStartInstalled: boolean; backedUp: boolean } {
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

  // 寫出（或更新）兩個上報腳本到 config 目錄
  const destDir = join(homedir(), ".config", "ccusage-tracker");
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "session-end.mjs"), scripts.sessionEnd);
  writeFileSync(join(destDir, "session-start.mjs"), scripts.sessionStart);

  // 對 SessionStart / SessionEnd 各自冪等 merge，單次寫回 settings.json
  const { updated, sessionStartInstalled, sessionEndInstalled } = applyTrackerHooks(settings);
  if (sessionStartInstalled || sessionEndInstalled) {
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + "\n");
  }

  return { sessionEndInstalled, sessionStartInstalled, backedUp };
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
