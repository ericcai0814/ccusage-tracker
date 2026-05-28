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

// Claude Code 將 matcher: "" 與 "*" 視為等價（都是 match-all）；早期 setup.sh 寫 "" 新版寫 "*"
function matcherEquivalent(a: string, b: string): boolean {
  const norm = (s: string) => (s === "" ? "*" : s);
  return norm(a) === norm(b);
}

interface UpsertOptions {
  matcher?: string;
  timeout?: number;
}

// Upsert tracker hook：
// 1) 從所有現有 matcher 的 hooks[] 中濾掉**所有** tracker entries（同時處理 duplicate matcher
//    與 co-bundled 第三方 hook 場景，第三方 hook 留在原 matcher 中不會被誤刪）
// 2) 若 matcher 的 hooks[] 因此變空，丟掉該 matcher
// 3) 在尾端 append 一條 canonical matcher
// 4) 若結果與既有等價（normalize matcher "" / "*"），返回 changed: false 並保留 reference
function upsertHook(
  existing: HookMatcher[],
  command: string,
  opts: UpsertOptions = {}
): { matchers: HookMatcher[]; changed: boolean } {
  const newEntry: HookEntry = { type: "command", command };
  if (opts.timeout !== undefined) newEntry.timeout = opts.timeout;
  const newMatcher: HookMatcher = { matcher: opts.matcher ?? "*", hooks: [newEntry] };

  const filtered = existing
    .map((m) => ({
      matcher: m.matcher,
      hooks: (m.hooks ?? []).filter((h) => !isCcusageTrackerHook(h.command)),
    }))
    .filter((m) => m.hooks.length > 0);

  const next = [...filtered, newMatcher];
  const changed = !sameMatchers(existing, next);
  return { matchers: changed ? next : existing, changed };
}

function sameMatchers(a: HookMatcher[], b: HookMatcher[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!matcherEquivalent(a[i].matcher, b[i].matcher)) return false;
    const ha = a[i].hooks ?? [];
    const hb = b[i].hooks ?? [];
    if (ha.length !== hb.length) return false;
    for (let j = 0; j < ha.length; j++) {
      if (ha[j].command !== hb[j].command) return false;
      if (ha[j].timeout !== hb[j].timeout) return false;
    }
  }
  return true;
}

// 純函式：在記憶體中對 settings 三條 tracker hook 做 upsert（install / update / noop）。
// 不碰檔案系統，便於測試。
export function applyTrackerHooks(settings: ClaudeSettings): {
  updated: ClaudeSettings;
  sessionStartChanged: boolean;
  sessionEndChanged: boolean;
  stopChanged: boolean;
  anyChanged: boolean;
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
    anyChanged,
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
  }

  // 寫出（或更新）兩個上報腳本到 config 目錄
  // Stop hook 共用 session-end.mjs，只是命令帶不同 --mode 參數
  const destDir = join(homedir(), ".config", "ccusage-tracker");
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "session-end.mjs"), scripts.sessionEnd);
  writeFileSync(join(destDir, "session-start.mjs"), scripts.sessionStart);

  const { updated, sessionStartChanged, sessionEndChanged, stopChanged, anyChanged } = applyTrackerHooks(settings);
  if (anyChanged) {
    if (existsSync(settingsPath)) {
      // 只有真的要寫才建 backup，避免 noop 跑也產生 .backup 殘檔
      copyFileSync(settingsPath, settingsPath + ".backup");
      backedUp = true;
    }
    writeFileSync(settingsPath, JSON.stringify(updated, null, 2) + "\n");
  }

  return { sessionEndChanged, sessionStartChanged, stopChanged, backedUp };
}

export function isHookInstalled(): boolean {
  const settingsPath = getClaudeSettingsPath();
  if (!existsSync(settingsPath)) return false;

  try {
    const settings: ClaudeSettings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    const hasIn = (arr?: HookMatcher[]) =>
      arr?.some((m) => m.hooks?.some((h) => isCcusageTrackerHook(h.command))) ?? false;
    // Stop hook 已是主要上報路徑；SessionEnd 是備援。任一存在即視為已安裝
    return hasIn(settings.hooks?.Stop) || hasIn(settings.hooks?.SessionEnd);
  } catch {
    return false;
  }
}
