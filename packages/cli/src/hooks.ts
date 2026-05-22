import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

interface HookEntry {
  type: string;
  command: string;
}

interface HookMatcher {
  matcher?: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    SessionEnd?: HookMatcher[];
    SessionStart?: HookMatcher[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const CCUSAGE_TRACKER_MARKER = "ccusage-tracker";

export function getClaudeSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

export function getHookCommand(): string {
  return "tracker hook session-end";
}

export function getStartHookCommand(): string {
  return "tracker hook session-start";
}

export interface InstallResult {
  installed: boolean;
  backedUp: boolean;
  migratedLegacy: boolean;
}

function isLegacyBashHook(cmd: string): boolean {
  return cmd.startsWith("bash ") && cmd.includes(CCUSAGE_TRACKER_MARKER);
}

function appendIfMissing(matchers: HookMatcher[] | undefined, cmd: string): HookMatcher[] {
  const arr = matchers ?? [];
  const exists = arr.some((m) => (m.hooks ?? []).some((h) => h.command === cmd));
  if (exists) return arr;
  return [...arr, { matcher: "", hooks: [{ type: "command", command: cmd }] }];
}

function migrateLegacyEntries(matchers: HookMatcher[] | undefined, newCmd: string): { matchers: HookMatcher[]; migrated: boolean } {
  const arr = matchers ?? [];
  let migrated = false;
  const next = arr.map((m) => ({
    ...m,
    hooks: (m.hooks ?? []).map((h) => {
      if (isLegacyBashHook(h.command)) {
        migrated = true;
        return { ...h, command: newCmd };
      }
      return h;
    }),
  }));
  return { matchers: next, migrated };
}

export function installHook(settingsPath: string = getClaudeSettingsPath()): InstallResult {
  let settings: ClaudeSettings = {};
  const hadFile = existsSync(settingsPath);

  if (hadFile) {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeSettings;
  }

  const endCmd = getHookCommand();
  const startCmd = getStartHookCommand();

  // Migrate any legacy `bash <path>/ccusage-tracker/...sh` entries to the new
  // CLI subcommand. SessionEnd legacy maps to session-end, SessionStart legacy
  // to session-start.
  const migratedEnd = migrateLegacyEntries(settings.hooks?.SessionEnd, endCmd);
  const migratedStart = migrateLegacyEntries(settings.hooks?.SessionStart, startCmd);
  const migratedLegacy = migratedEnd.migrated || migratedStart.migrated;

  // Add new entries if not already present (idempotent).
  const SessionEnd = appendIfMissing(migratedEnd.matchers, endCmd);
  const SessionStart = appendIfMissing(migratedStart.matchers, startCmd);

  const updatedSettings: ClaudeSettings = {
    ...settings,
    hooks: { ...settings.hooks, SessionEnd, SessionStart },
  };

  const changed = JSON.stringify(settings) !== JSON.stringify(updatedSettings);
  let backedUp = false;

  if (changed && hadFile) {
    const suffix = migratedLegacy ? ".backup-pre-cli-migration" : ".backup";
    copyFileSync(settingsPath, settingsPath + suffix);
    backedUp = true;
  }

  if (changed) {
    mkdirSync(dirname(settingsPath), { recursive: true });
    writeFileSync(settingsPath, JSON.stringify(updatedSettings, null, 2) + "\n");
  }

  return { installed: changed, backedUp, migratedLegacy };
}

export function isHookInstalled(settingsPath: string = getClaudeSettingsPath()): boolean {
  if (!existsSync(settingsPath)) return false;
  try {
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8")) as ClaudeSettings;
    const endCmd = getHookCommand();
    return (settings.hooks?.SessionEnd ?? []).some(
      (m) => (m.hooks ?? []).some((h) => h.command === endCmd)
    );
  } catch {
    return false;
  }
}
