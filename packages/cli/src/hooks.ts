import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { validateScripts, type TrackerScripts } from "./scripts";

interface HookEntry {
  type: string;
  command: string;
  timeout?: number;
  [key: string]: unknown;
}

interface HookMatcher {
  matcher: string;
  hooks: HookEntry[];
  [key: string]: unknown;
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

const HOOK_TIMEOUT_SEC = 45; // 對齊 .mjs 內部 __deadline 40s + 5s 緩衝（見 scripts.ts __deadline）

export function getClaudeSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

function sessionEndScriptPath(): string {
  return join(homedir(), ".config", "ccusage-tracker", "session-end.mjs");
}

function quoteScriptPath(path: string): string {
  return `"${path}"`;
}

export function buildHookCommand(scriptPath: string, mode?: "session-end" | "stop"): string {
  const command = "node " + quoteScriptPath(scriptPath);
  return mode ? `${command} --mode=${mode}` : command;
}

export function getHookCommand(): string {
  return buildHookCommand(sessionEndScriptPath(), "session-end");
}

export function getStopHookCommand(): string {
  return buildHookCommand(sessionEndScriptPath(), "stop");
}

export function getStartHookCommand(): string {
  return buildHookCommand(join(homedir(), ".config", "ccusage-tracker", "session-start.mjs"));
}

// 以路徑片段判斷，可同時辨識新版（含 --mode）與舊版（無 --mode）hook
function isCcusageTrackerHook(command?: string): boolean {
  return typeof command === "string" && /[/\\]ccusage-tracker(?:[/\\](?:session-end|session-start)\.(?:mjs|sh|ps1)|\.(?:sh|ps1))(?=["'\s]|$)/.test(command);
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
// 2) 若 tracker matcher 的 hooks[] 因此變空，丟掉它；保留原本空的第三方 matcher
// 3) 在尾端 append 一條 canonical matcher
// 4) 若結果與既有等價（normalize matcher "" / "*"），返回 changed: false 並保留 reference
function upsertHook(
  existing: HookMatcher[],
  command: string,
  opts: UpsertOptions = {}
): { matchers: HookMatcher[]; changed: boolean } {
  const newEntry: HookEntry = { type: "command", command };
  if (opts.timeout !== undefined) newEntry.timeout = opts.timeout;
  const previous = existing.find((m) => m.hooks?.length && m.hooks.every((h) => isCcusageTrackerHook(h.command)));
  const newMatcher: HookMatcher = { ...previous, matcher: opts.matcher ?? "*", hooks: [newEntry] };

  const filtered = existing.flatMap((m) => {
    if (!m.hooks?.some((h) => isCcusageTrackerHook(h.command))) return [m];
    const hooks = m.hooks.filter((h) => !isCcusageTrackerHook(h.command));
    return hooks.length ? [{ ...m, hooks }] : [];
  });

  const next = [...filtered, newMatcher];
  const changed = !sameMatchers(existing, next);
  return { matchers: changed ? next : existing, changed };
}

function sameMatchers(a: HookMatcher[], b: HookMatcher[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (!matcherEquivalent(a[i].matcher, b[i].matcher)) return false;
    if (JSON.stringify({ ...a[i], matcher: "*" }) !== JSON.stringify({ ...b[i], matcher: "*" })) return false;
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

export function installHook(scripts: TrackerScripts): {
  sessionEndChanged: boolean;
  sessionStartChanged: boolean;
  stopChanged: boolean;
  backedUp: boolean;
} {
  const settingsPath = getClaudeSettingsPath();
  let settings: ClaudeSettings = {};

  if (existsSync(settingsPath)) {
    const raw = readFileSync(settingsPath, "utf-8");
    settings = JSON.parse(raw);
    if (!settings || typeof settings !== "object" || Array.isArray(settings)) {
      throw new Error("Claude settings.json must contain a JSON object; repair it before updating.");
    }
    if (settings.hooks !== undefined) {
      if (!settings.hooks || typeof settings.hooks !== "object" || Array.isArray(settings.hooks)) {
        throw new Error("Claude settings.json hooks must be an object; repair it before updating.");
      }
      for (const event of ["SessionStart", "SessionEnd", "Stop"] as const) {
        const matchers = settings.hooks[event];
        if (matchers === undefined) continue;
        if (!Array.isArray(matchers) || matchers.some((matcher) =>
          !matcher || !Array.isArray(matcher.hooks) || matcher.hooks.some((hook) => !hook || typeof hook !== "object")
        )) throw new Error(`Claude settings.json ${event} hooks are invalid; repair them before updating.`);
      }
    }
  }

  validateScripts(scripts);
  const { updated, sessionStartChanged, sessionEndChanged, stopChanged, anyChanged } = applyTrackerHooks(settings);
  const destDir = join(homedir(), ".config", "ccusage-tracker");
  const files = [
    { path: join(destDir, "session-end.mjs"), content: scripts.sessionEnd },
    { path: join(destDir, "session-start.mjs"), content: scripts.sessionStart },
    ...(scripts.codexSync === undefined ? [] : [{ path: join(destDir, "codex-sync.mjs"), content: scripts.codexSync }]),
    ...(anyChanged ? [{ path: settingsPath, content: JSON.stringify(updated, null, 2) + "\n" }] : []),
  ];
  const backedUp = installFiles(files);
  return { sessionEndChanged, sessionStartChanged, stopChanged, backedUp };
}

interface StagedFile {
  path: string;
  staged: string;
  rollback?: string;
  installed: boolean;
}

// Stage every replacement and backup first, then rename them into place. Keep
// rollback copies until the entire installation succeeds (including settings).
function installFiles(files: { path: string; content: string }[]): boolean {
  const staged: StagedFile[] = [];
  let backedUp = false;
  let committed = false;
  function stage(path: string, content: Buffer): void {
    mkdirSync(dirname(path), { recursive: true });
    const current = existsSync(path) ? lstatSync(path) : null;
    if (current && !current.isFile()) throw new Error(`Refusing to replace non-regular file: ${path}`);
    const entry: StagedFile = { path, staged: `${path}.${randomUUID()}.tmp`, installed: false };
    staged.push(entry);
    writeFileSync(entry.staged, content, { flag: "wx", mode: current?.mode ?? 0o600 });
    if (current) {
      entry.rollback = `${path}.${randomUUID()}.rollback`;
      writeFileSync(entry.rollback, readFileSync(path), { flag: "wx", mode: current.mode });
    }
  }
  try {
    for (const file of files) {
      const next = Buffer.from(file.content);
      if (existsSync(file.path)) {
        if (!lstatSync(file.path).isFile()) throw new Error(`Refusing to replace non-regular file: ${file.path}`);
        const previous = readFileSync(file.path);
        if (previous.equals(next)) continue;
        stage(file.path + ".backup", previous);
        backedUp = true;
      }
      stage(file.path, next);
    }
    for (const entry of staged) {
      renameSync(entry.staged, entry.path);
      entry.installed = true;
    }
    committed = true;
  } catch (error) {
    const failures: string[] = [];
    for (const entry of [...staged].reverse()) {
      if (!entry.installed) continue;
      try {
        if (entry.rollback) renameSync(entry.rollback, entry.path);
        else unlinkSync(entry.path);
      } catch {
        failures.push(entry.path);
      }
    }
    if (failures.length) throw new Error(`${(error as Error).message}; restore failed for ${failures.join(", ")}. Retained .rollback files require manual recovery.`);
    throw error;
  } finally {
    // A rollback file retained after failed restoration is the recovery copy.
    for (const entry of staged) {
      if (existsSync(entry.staged)) unlinkSync(entry.staged);
      if (entry.rollback && existsSync(entry.rollback) && (committed || !entry.installed)) {
        unlinkSync(entry.rollback);
      }
    }
  }
  return backedUp;
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
