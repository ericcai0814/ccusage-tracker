import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { homedir } from "node:os";

export interface CodexHookEntry {
  type?: string;
  command?: string;
  timeout?: number;
  [key: string]: unknown;
}

export interface CodexHookGroup {
  // Codex 的 Stop 不支援 matcher，群組只有 hooks 陣列（官方文件）。
  hooks: CodexHookEntry[];
  [key: string]: unknown;
}

export interface CodexHooksFile {
  hooks?: Record<string, CodexHookGroup[]>;
  [key: string]: unknown;
}

export type CodexTrustState = "recorded" | "awaiting" | "disabled";

export interface CodexGroupIndexes {
  stop?: number;
  sessionEnd?: number;
}

// 與 Claude hook 相同的 45 秒：codex-sync.mjs 的 worker deadline 是 180s，但 hook
// 程序本身只讀 stdin 加 spawn，45s 足夠且與 settings.json 那側對齊。
const CODEX_HOOK_TIMEOUT_SEC = 45;

// Codex 的信任 key 由「事件」小寫底線形式組成
const TRUST_EVENT_KEYS = { stop: "stop", sessionEnd: "session_end" } as const;
const CODEX_EVENTS = { stop: "Stop", sessionEnd: "SessionEnd" } as const;

export function getCodexHome(): string {
  const configured = process.env.CODEX_HOME?.trim();
  return configured ? configured : join(homedir(), ".codex");
}

export function getCodexHooksPath(): string {
  return join(getCodexHome(), "hooks.json");
}

export function getCodexSyncScriptPath(): string {
  return join(homedir(), ".config", "ccusage-tracker", "codex-sync.mjs");
}

export function getCodexHookCommand(): string {
  return `node "${getCodexSyncScriptPath()}" --hook`;
}

// 以路徑片段判斷，與 hooks.ts 的 isCcusageTrackerHook 同樣策略：認得舊的
// --notify 寫法與未加旗標的寫法，才能就地升級而不是又 append 一份。
export function isCodexTrackerHook(command?: unknown): boolean {
  return typeof command === "string" && /[/\\]ccusage-tracker[/\\]codex-sync\.mjs(?=["'\s]|$)/.test(command);
}

export function isOnPath(name: string): boolean {
  const entries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const suffixes = process.platform === "win32"
    ? (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean)
    : [""];
  return entries.some((dir) => suffixes.some((suffix) => existsSync(join(dir, name + suffix))));
}

// Codex 視為存在：$CODEX_HOME（預設 ~/.codex）目錄存在，或 codex 在 PATH。
export function detectCodex(): boolean {
  return existsSync(getCodexHome()) || isOnPath("codex");
}

function invalid(detail: string): never {
  throw new Error(`Codex hooks.json ${detail}; repair it before updating.`);
}

function readGroups(file: CodexHooksFile, event: string): CodexHookGroup[] {
  const groups = file.hooks?.[event];
  if (groups === undefined) return [];
  if (!Array.isArray(groups)) invalid(`${event} hooks must be an array`);
  for (const group of groups) {
    if (!group || typeof group !== "object" || Array.isArray(group)) invalid(`${event} hook groups must be objects`);
    if (!Array.isArray(group.hooks) || group.hooks.some((hook) => !hook || typeof hook !== "object" || Array.isArray(hook))) {
      invalid(`${event} hook entries are invalid`);
    }
  }
  return groups;
}

// Upsert 一個事件的 tracker 群組：
// 1) 沒有 → append 到陣列尾端（信任 key 以索引組成，只能往後加）
// 2) 有且整組都是 tracker → 原索引就地換成 canonical 群組（順帶丟掉 matcher 之類的殘留鍵）
// 3) 有但與第三方 hook 同群組 → 只換掉 tracker 那一條，第三方保留
// 永不移除、重排既有群組；多份重複 tracker 群組只處理第一份，避免索引位移
// 讓使用者其他 hook 的信任全部失效。
function upsertCodexGroups(groups: CodexHookGroup[], command: string): { groups: CodexHookGroup[]; changed: boolean } {
  const entry: CodexHookEntry = { type: "command", command, timeout: CODEX_HOOK_TIMEOUT_SEC };
  const index = groups.findIndex((group) => group.hooks.some((hook) => isCodexTrackerHook(hook.command)));
  if (index === -1) return { groups: [...groups, { hooks: [entry] }], changed: true };

  const current = groups[index];
  const onlyTracker = current.hooks.every((hook) => isCodexTrackerHook(hook.command));
  const replacement: CodexHookGroup = onlyTracker
    ? { hooks: [entry] }
    : { ...current, hooks: current.hooks.map((hook) => (isCodexTrackerHook(hook.command) ? entry : hook)) };
  if (JSON.stringify(current) === JSON.stringify(replacement)) return { groups, changed: false };
  return { groups: groups.map((group, at) => (at === index ? replacement : group)), changed: true };
}

// 純函式：在記憶體中對 Codex hooks.json 的 Stop 與 SessionEnd 做 upsert。
// 不碰檔案系統；未變更時回傳原物件參考，讓呼叫端可以直接略過寫檔。
export function applyCodexHooks(
  file: CodexHooksFile,
  command = getCodexHookCommand(),
): { updated: CodexHooksFile; stopChanged: boolean; sessionEndChanged: boolean; anyChanged: boolean } {
  if (!file || typeof file !== "object" || Array.isArray(file)) invalid("must contain a JSON object");
  if (file.hooks !== undefined && (!file.hooks || typeof file.hooks !== "object" || Array.isArray(file.hooks))) {
    invalid("hooks must be an object");
  }

  const stop = upsertCodexGroups(readGroups(file, CODEX_EVENTS.stop), command);
  const sessionEnd = upsertCodexGroups(readGroups(file, CODEX_EVENTS.sessionEnd), command);
  const anyChanged = stop.changed || sessionEnd.changed;

  return {
    updated: anyChanged
      ? { ...file, hooks: { ...file.hooks, [CODEX_EVENTS.stop]: stop.groups, [CODEX_EVENTS.sessionEnd]: sessionEnd.groups } }
      : file,
    stopChanged: stop.changed,
    sessionEndChanged: sessionEnd.changed,
    anyChanged,
  };
}

// hooks.json 中 tracker 群組的索引，信任 key 需要它；找不到回 undefined。
export function findCodexTrackerIndexes(file: CodexHooksFile): CodexGroupIndexes {
  const find = (event: string): number | undefined => {
    const groups = file.hooks?.[event];
    if (!Array.isArray(groups)) return undefined;
    const index = groups.findIndex((group) =>
      Array.isArray(group?.hooks) && group.hooks.some((hook) => isCodexTrackerHook(hook?.command)));
    return index === -1 ? undefined : index;
  };
  const stop = find(CODEX_EVENTS.stop);
  const sessionEnd = find(CODEX_EVENTS.sessionEnd);
  return { ...(stop === undefined ? {} : { stop }), ...(sessionEnd === undefined ? {} : { sessionEnd }) };
}

// TOML 逐行唯讀解析，不引入 parser：只認 [hooks.state."<key>"] 區段標頭，
// 以及其後到下一個 [ 之前的 key = value 行。雜湊值本身不驗證 —— 演算法是
// Codex 內部實作，所以措辭是 trust recorded 而不是 trusted。
export function readCodexTrustState(
  configToml: string,
  hooksPath: string,
  indexes: CodexGroupIndexes,
): { stop?: CodexTrustState; sessionEnd?: CodexTrustState } {
  const wanted = new Map<string, "stop" | "sessionEnd">();
  for (const event of ["stop", "sessionEnd"] as const) {
    const index = indexes[event];
    if (index !== undefined) wanted.set(`${hooksPath}:${TRUST_EVENT_KEYS[event]}:${index}:0`, event);
  }

  const state: { stop?: CodexTrustState; sessionEnd?: CodexTrustState } = {};
  for (const event of wanted.values()) state[event] = "awaiting";

  let current: "stop" | "sessionEnd" | null = null;
  for (const line of configToml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[")) {
      const header = /^\[hooks\.state\."(.*)"\]$/.exec(trimmed);
      const key = header ? header[1].replace(/\\(["\\])/g, "$1") : null;
      current = key !== null && wanted.has(key) ? wanted.get(key)! : null;
      continue;
    }
    if (!current) continue;
    if (/^enabled\s*=\s*false\b/.test(trimmed)) state[current] = "disabled";
    else if (/^trusted_hash\s*=/.test(trimmed) && state[current] !== "disabled") state[current] = "recorded";
  }
  return state;
}

// 唯讀掃描 config.toml 頂層的 notify 陣列。只用來提示使用者自行移除重複觸發的
// 舊設定 —— 本工具永不編輯 Codex 的 TOML。
export function hasTrackerNotify(configToml: string): boolean {
  const lines = configToml.split(/\r?\n/);
  let collected: string | null = null;
  let depth = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    // 只有整行是 table 標頭才代表頂層結束；跨行陣列的續行（例如 `[1, 2],`）也以
    // `[` 開頭，但仍在頂層，不能提早中斷掃描。
    if (collected === null && /^\[[^\]]*\]$/.test(trimmed)) return false;
    if (collected === null && !/^notify\s*=/.test(trimmed)) continue;
    collected = (collected ?? "") + trimmed;
    depth += (trimmed.match(/\[/g)?.length ?? 0) - (trimmed.match(/\]/g)?.length ?? 0);
    if (depth <= 0) break;
  }
  return collected !== null && /[/\\]ccusage-tracker[/\\]codex-sync\.mjs/.test(collected);
}
