import { existsSync, readFileSync, writeFileSync, mkdirSync, lstatSync, readlinkSync, realpathSync, renameSync, statSync, unlinkSync } from "node:fs";
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

export const CODEX_DISABLED_MESSAGE = "Codex: hooks installed but disabled in Codex";

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

  // 相容訊息只對真的有 Codex 的人有意義：純 Claude 使用者同時看到長段「不支援
  // Codex」與「Codex: not detected」只是矛盾的噪音。
  if (codexDetected && scripts.codexSync === undefined) deps.warn(CODEX_COMPATIBILITY_MESSAGE);

  const configToml = codexDetected ? deps.readCodexConfig() ?? "" : "";
  if (!codexDetected) deps.log("Codex: not detected");
  else if (!result.codexWired) deps.log("Codex: hooks not installed (this server does not provide the Codex script)");
  else {
    // 信任雜湊算的是 hook 設定身分，內容一改就作廢，所以只有「沒動過且已有紀錄」
    // 才敢說 trust recorded；其餘一律請使用者跑一次 /hooks。
    const trust = readCodexTrustState(configToml, getCodexHooksPath(), result.codexIndexes);
    const states = Object.values(trust);
    const recorded = states.length > 0 && states.every((state) => state === "recorded");
    // 使用者信任後主動停用，不是還沒信任：再叫他去跑 /hooks 是錯的指引（status 判得對，這裡對齊）。
    if (states.includes("disabled")) deps.log(CODEX_DISABLED_MESSAGE);
    else deps.log(!result.codexChanged && recorded ? "Codex: hooks already up to date (trust recorded)" : CODEX_TRUST_MESSAGE);
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

function nonRegularFileError(path: string, linkTarget?: string): Error {
  return new Error(
    `Refusing to replace non-regular file: ${path}` +
      (linkTarget === undefined ? "" : ` (symlink target: ${linkTarget})`)
  );
}

// dotfiles 使用者的設定檔常是 symlink。寫穿：解析到真實檔案後，暫存、backup 與
// rename 全部套在真實路徑上，symlink 本身不動（unlink 它等於毀掉使用者的 dotfiles
// 管理）。斷鏈或解析後不是一般檔案（目錄、socket…）一律拒絕整筆交易，訊息帶出
// link 目標，使用者才知道擋在哪、寫去哪。
function resolveWriteTarget(path: string): string {
  let link;
  try {
    link = lstatSync(path);
  } catch {
    return path; // 路徑還不存在：照常新建一般檔案
  }
  if (!link.isSymbolicLink()) {
    if (!link.isFile()) throw nonRegularFileError(path);
    return path;
  }
  let real: string;
  try {
    real = realpathSync(path);
  } catch {
    // 斷鏈：realpath 解不出來，只能報 link 自己記的目標
    throw nonRegularFileError(path, readlinkSync(path));
  }
  if (!statSync(real).isFile()) throw nonRegularFileError(path, real);
  return real;
}

// Stage every replacement and backup first, then rename them into place. Keep
// rollback copies until the entire installation succeeds (including settings).
// Exported for tests: installHook 自己走 homedir()（bun 啟動時就快取），交易層
// 的檔案系統行為只能用測試給定的路徑直接驗。
export function installFiles(files: { path: string; content: string }[]): boolean {
  const staged: StagedFile[] = [];
  let backedUp = false;
  let committed = false;
  function stage(path: string, content: Buffer): void {
    const target = resolveWriteTarget(path);
    mkdirSync(dirname(target), { recursive: true });
    const current = existsSync(target) ? lstatSync(target) : null;
    const entry: StagedFile = { path: target, staged: `${target}.${randomUUID()}.tmp`, installed: false };
    staged.push(entry);
    writeFileSync(entry.staged, content, { flag: "wx", mode: current?.mode ?? 0o600 });
    if (current) {
      entry.rollback = `${target}.${randomUUID()}.rollback`;
      writeFileSync(entry.rollback, readFileSync(target), { flag: "wx", mode: current.mode });
    }
  }
  try {
    for (const file of files) {
      const next = Buffer.from(file.content);
      const target = resolveWriteTarget(file.path);
      if (existsSync(target)) {
        const previous = readFileSync(target);
        if (previous.equals(next)) continue;
        stage(target + ".backup", previous);
        backedUp = true;
      }
      stage(target, next);
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
