import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
}

interface ClaudeSettings {
  hooks?: {
    SessionStart?: HookMatcher[];
    SessionEnd?: HookMatcher[];
    Stop?: HookMatcher[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

const HOOK_TIMEOUT_SEC = 25; // 對齊 .mjs 內部 __deadline 20s + 5s 緩衝

export function getClaudeSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

function sessionEndScriptPath(): string {
  return join(homedir(), ".config", "ccusage-tracker", "session-end.mjs");
}

export function getHookCommand(): string {
  return "node " + sessionEndScriptPath() + " --mode=session-end";
}

export function getStopHookCommand(): string {
  return "node " + sessionEndScriptPath() + " --mode=stop";
}

export function getStartHookCommand(): string {
  return "node " + join(homedir(), ".config", "ccusage-tracker", "session-start.mjs");
}

// 以路徑片段判斷，可同時辨識新版（含 --mode）與舊版（無 --mode）hook
function isCcusageTrackerHook(command?: string): boolean {
  return !!command && command.includes("ccusage-tracker");
}

interface UpsertOptions {
  matcher?: string;
  timeout?: number;
}

// 對單一 hook 陣列做 upsert：
// - 找到屬於我們的 entry 且命令完全相同 → noop
// - 找到屬於我們的 entry 但命令不同 → 原地替換（migration 路徑：舊命令升級到新命令）
// - 找不到 → append
function upsertHook(
  existing: HookMatcher[],
  command: string,
  opts: UpsertOptions = {}
): { matchers: HookMatcher[]; changed: boolean } {
  const newEntry: HookEntry = { type: "command", command };
  if (opts.timeout) newEntry.timeout = opts.timeout;
  const newMatcher: HookMatcher = { matcher: opts.matcher ?? "*", hooks: [newEntry] };

  const ourIdx = existing.findIndex((m) => m.hooks?.some((h) => isCcusageTrackerHook(h.command)));

  if (ourIdx === -1) {
    return { matchers: [...existing, newMatcher], changed: true };
  }

  const current = existing[ourIdx];
  const sameCommand =
    current.hooks?.length === 1 &&
    current.hooks[0].command === command &&
    current.hooks[0].timeout === opts.timeout &&
    current.matcher === (opts.matcher ?? "*");
  if (sameCommand) {
    return { matchers: existing, changed: false };
  }

  const next = [...existing];
  next[ourIdx] = newMatcher;
  return { matchers: next, changed: true };
}

// 純函式：在記憶體中對 settings 三條 tracker hook 做 upsert（install / update / noop）。
// 不碰檔案系統，便於測試。
export function applyTrackerHooks(settings: ClaudeSettings): {
  updated: ClaudeSettings;
  sessionStartChanged: boolean;
  sessionEndChanged: boolean;
  stopChanged: boolean;
} {
  const start = upsertHook(settings.hooks?.SessionStart ?? [], getStartHookCommand());
  const end = upsertHook(settings.hooks?.SessionEnd ?? [], getHookCommand(), { timeout: HOOK_TIMEOUT_SEC });
  const stop = upsertHook(settings.hooks?.Stop ?? [], getStopHookCommand(), { timeout: HOOK_TIMEOUT_SEC });

  const anyChanged = start.changed || end.changed || stop.changed;
  const updated: ClaudeSettings = anyChanged
    ? {
        ...settings,
        hooks: {
          ...settings.hooks,
          SessionStart: start.matchers,
          SessionEnd: end.matchers,
          Stop: stop.matchers,
        },
      }
    : settings;

  return {
    updated,
    sessionStartChanged: start.changed,
    sessionEndChanged: end.changed,
    stopChanged: stop.changed,
  };
}

export function installHook(scripts: {
  sessionEnd: string;
  sessionStart: string;
}): {
  sessionEndChanged: boolean;
  sessionStartChanged: boolean;
  stopChanged: boolean;
  backedUp: boolean;
} {
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
  // Stop hook 共用 session-end.mjs，只是命令帶不同 --mode 參數
  const destDir = join(homedir(), ".config", "ccusage-tracker");
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "session-end.mjs"), scripts.sessionEnd);
  writeFileSync(join(destDir, "session-start.mjs"), scripts.sessionStart);

  const { updated, sessionStartChanged, sessionEndChanged, stopChanged } = applyTrackerHooks(settings);
  if (sessionStartChanged || sessionEndChanged || stopChanged) {
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + "\n");
  }

  return { sessionEndChanged, sessionStartChanged, stopChanged, backedUp };
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
