import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, renameSync, unlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { CODEX_COMPATIBILITY_MESSAGE, validateScripts, type TrackerScripts } from "./scripts";
import {
  applyCodexHooks,
  detectCodex,
  findCodexTrackerIndexes,
  getCodexHome,
  getCodexHooksPath,
  hasTrackerNotify,
  isOnPath,
  readCodexTrustState,
  type CodexGroupIndexes,
  type CodexHooksFile,
} from "./codex-hooks";

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

// 以路徑片段判斷，可同時辨識新版（含 --mode）與舊版（無 --mode）hook。
// codex-sync.mjs 也算 tracker hook：它屬於 Codex 的 hooks.json，被手動塞進
// Claude settings.json 時要一併收掉，否則會重複觸發。
function isCcusageTrackerHook(command?: string): boolean {
  return typeof command === "string" && /[/\\]ccusage-tracker(?:[/\\](?:session-end|session-start|codex-sync)\.(?:mjs|sh|ps1)|\.(?:sh|ps1))(?=["'\s]|$)/.test(command);
}

// Claude 視為存在：~/.claude 目錄存在，或 claude 在 PATH。
// home 可注入：bun 在 process 啟動時就快取 os.homedir()，測試無法改寫 $HOME。
export function detectClaude(home = homedir()): boolean {
  return existsSync(join(home, ".claude")) || isOnPath("claude");
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

export interface InstallTargets {
  claude: boolean;
  codex: boolean;
}

export interface InstallResult {
  sessionEndChanged: boolean;
  sessionStartChanged: boolean;
  stopChanged: boolean;
  claudeChanged: boolean;
  codexStopChanged: boolean;
  codexSessionEndChanged: boolean;
  codexChanged: boolean;
  codexWired: boolean;
  codexIndexes: CodexGroupIndexes;
  backedUp: boolean;
}

function readCodexHooksFile(path: string): CodexHooksFile {
  if (!existsSync(path)) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch {
    throw new Error("Codex hooks.json is not valid JSON; repair it before updating.");
  }
  return parsed as CodexHooksFile;
}

// scripts.codexSync 缺席（舊 server 回 404/410）時不接 Codex hook：hook 指向不存在的
// 腳本比沒有 hook 更糟。settings.json 與 hooks.json 走同一筆 staged 交易與 rollback，
// 任一步失敗兩邊都回到原狀。
export function installHook(
  scripts: TrackerScripts,
  targets: InstallTargets = { claude: true, codex: false },
): InstallResult {
  const settingsPath = getClaudeSettingsPath();
  let settings: ClaudeSettings = {};

  if (targets.claude && existsSync(settingsPath)) {
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
  const claude = applyTrackerHooks(settings);
  const claudeChanged = targets.claude && claude.anyChanged;

  const codexWired = targets.codex && scripts.codexSync !== undefined;
  const codexHooksPath = getCodexHooksPath();
  const codex = codexWired
    ? applyCodexHooks(readCodexHooksFile(codexHooksPath))
    : { updated: {} as CodexHooksFile, stopChanged: false, sessionEndChanged: false, anyChanged: false };

  const destDir = join(homedir(), ".config", "ccusage-tracker");
  const files = [
    { path: join(destDir, "session-end.mjs"), content: scripts.sessionEnd },
    { path: join(destDir, "session-start.mjs"), content: scripts.sessionStart },
    ...(scripts.codexSync === undefined ? [] : [{ path: join(destDir, "codex-sync.mjs"), content: scripts.codexSync }]),
    ...(claudeChanged ? [{ path: settingsPath, content: JSON.stringify(claude.updated, null, 2) + "\n" }] : []),
    ...(codex.anyChanged ? [{ path: codexHooksPath, content: JSON.stringify(codex.updated, null, 2) + "\n" }] : []),
  ];
  const backedUp = installFiles(files);
  return {
    sessionEndChanged: targets.claude && claude.sessionEndChanged,
    sessionStartChanged: targets.claude && claude.sessionStartChanged,
    stopChanged: targets.claude && claude.stopChanged,
    claudeChanged,
    codexStopChanged: codex.stopChanged,
    codexSessionEndChanged: codex.sessionEndChanged,
    codexChanged: codex.anyChanged,
    codexWired,
    codexIndexes: codexWired ? findCodexTrackerIndexes(codex.updated) : {},
    backedUp,
  };
}

export const NO_TOOL_MESSAGE =
  "No supported tool detected (Claude Code or Codex). Install one, then run `tracker update`.";

export const CODEX_TRUST_MESSAGE =
  "Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.";

export interface WiringDeps {
  detectClaude: () => boolean;
  detectCodex: () => boolean;
  installHook: (scripts: TrackerScripts, targets: InstallTargets) => InstallResult;
  readCodexConfig: () => string | null;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

export const defaultWiringDeps: Omit<WiringDeps, "log" | "warn"> = {
  detectClaude: () => detectClaude(),
  detectCodex,
  installHook,
  readCodexConfig: () => {
    const path = join(getCodexHome(), "config.toml");
    try {
      return existsSync(path) ? readFileSync(path, "utf-8") : null;
    } catch {
      return null;
    }
  },
};

// setup 與 update 共用的逐工具接線：偵測、安裝、印出每個工具一行結果。
// 不決定 exit code —— 由呼叫端依回傳的偵測結果決定（setup 0、update 非零）。
export function wireTools(
  scripts: TrackerScripts,
  deps: WiringDeps,
): { claudeDetected: boolean; codexDetected: boolean } {
  const claudeDetected = deps.detectClaude();
  const codexDetected = deps.detectCodex();
  const result = deps.installHook(scripts, { claude: claudeDetected, codex: codexDetected });

  if (!claudeDetected) deps.log("Claude Code: not detected");
  else if (result.claudeChanged) deps.log("Claude Code: hooks installed/updated (SessionStart, SessionEnd, Stop)");
  else deps.log("Claude Code: hooks already up to date");

  if (scripts.codexSync === undefined) deps.warn(CODEX_COMPATIBILITY_MESSAGE);

  const configToml = codexDetected ? deps.readCodexConfig() ?? "" : "";
  if (!codexDetected) deps.log("Codex: not detected");
  else if (!result.codexWired) deps.log("Codex: hooks not installed (this server does not provide the Codex script)");
  else {
    // 信任雜湊算的是 hook 設定身分，內容一改就作廢，所以只有「沒動過且已有紀錄」
    // 才敢說 trust recorded；其餘一律請使用者跑一次 /hooks。
    const trust = readCodexTrustState(configToml, getCodexHooksPath(), result.codexIndexes);
    const states = Object.values(trust);
    const recorded = states.length > 0 && states.every((state) => state === "recorded");
    deps.log(!result.codexChanged && recorded ? "Codex: hooks already up to date (trust recorded)" : CODEX_TRUST_MESSAGE);
  }

  if (hasTrackerNotify(configToml)) {
    deps.warn("Codex hooks now handle reporting. Remove the ccusage-tracker `notify` entry from $CODEX_HOME/config.toml to avoid triggering it twice; this tool never edits that file.");
  }

  if (result.backedUp) deps.log("Changed files backed up (.backup).");
  if (!claudeDetected && !codexDetected) deps.log(NO_TOOL_MESSAGE);

  return { claudeDetected, codexDetected };
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
