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

// 信任 key 由「群組索引:群組內 hook 索引」組成。安裝支援「第三方在前、tracker 在後」
// 的混合群組，所以 hook 索引不能寫死 0，否則會讀到隔壁第三方 hook 的信任或停用紀錄。
export interface CodexHookLocation {
  group: number;
  hook: number;
}

export interface CodexGroupIndexes {
  stop?: CodexHookLocation;
  sessionEnd?: CodexHookLocation;
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

// tracker 自己寫出來的命令只有一種形狀：可選的 node 執行檔、tracker 腳本的絕對路徑、
// 以及 tracker 自己的參數。只要命令「含有」腳本路徑就認定是 tracker，會讓
// `sha256sum "<script>"` 這類第三方命令被整組換成上報 hook，原有功能與額外欄位一併消失
// （Codex 補審 med）。因此改為整條命令的形狀比對：多出任何一個 token 就是第三方。
const TRACKER_ARGUMENT = /^(?:--hook|--notify|--mode=\S+)$/;

// 只認雙引號 —— 三支安裝器（setup.sh、setup.ps1、CLI 的 buildHookCommand）寫出來的
// 都是 `node "<path>"`。單引號、管線、`&&` 之類的 token 進不了白名單，自然被判為第三方。
function tokenizeCommand(command: string): string[] {
  const tokens: string[] = [];
  let token = "";
  let present = false;
  let quoted = false;
  for (const character of command) {
    if (quoted) {
      if (character === '"') quoted = false;
      else token += character;
      continue;
    }
    if (character === '"') {
      quoted = true;
      present = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (present) tokens.push(token);
      token = "";
      present = false;
      continue;
    }
    token += character;
    present = true;
  }
  return present ? [...tokens, token] : tokens;
}

// POSIX 絕對路徑、Windows 磁碟機路徑（setup.ps1 會把反斜線換成正斜線）與 UNC 路徑。
// 相對路徑一律不算：tracker 寫進設定檔的永遠是絕對路徑。
function isAbsolutePathToken(token: string): boolean {
  return token.startsWith("/") || token.startsWith("\\\\") || /^[A-Za-z]:[/\\]/.test(token);
}

function isNodeExecutable(token: string): boolean {
  if (token === "node" || token === "node.exe") return true;
  return isAbsolutePathToken(token) && /[/\\]node(?:\.exe)?$/.test(token);
}

// script 是腳本路徑本身（已去引號）必須符合的尾綴樣式；Claude 端與 Codex 端各給一組。
export function isTrackerHookCommand(command: unknown, script: RegExp): boolean {
  if (typeof command !== "string") return false;
  const tokens = tokenizeCommand(command);
  const [scriptPath, ...args] = tokens.length > 0 && isNodeExecutable(tokens[0]) ? tokens.slice(1) : tokens;
  if (scriptPath === undefined || !isAbsolutePathToken(scriptPath) || !script.test(scriptPath)) return false;
  return args.every((argument) => TRACKER_ARGUMENT.test(argument));
}

const CODEX_TRACKER_SCRIPT = /[/\\]ccusage-tracker[/\\]codex-sync\.mjs$/;

// 認得舊的 --notify 寫法與未加旗標的寫法，才能就地升級而不是又 append 一份。
export function isCodexTrackerHook(command?: unknown): boolean {
  return isTrackerHookCommand(command, CODEX_TRACKER_SCRIPT);
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
): { updated: CodexHooksFile; stopChanged: boolean; sessionEndChanged: boolean; anyChanged: boolean; indexes: CodexGroupIndexes } {
  if (!file || typeof file !== "object" || Array.isArray(file)) invalid("must contain a JSON object");
  if (file.hooks !== undefined && (!file.hooks || typeof file.hooks !== "object" || Array.isArray(file.hooks))) {
    invalid("hooks must be an object");
  }

  const stop = upsertCodexGroups(readGroups(file, CODEX_EVENTS.stop), command);
  const sessionEnd = upsertCodexGroups(readGroups(file, CODEX_EVENTS.sessionEnd), command);
  const anyChanged = stop.changed || sessionEnd.changed;
  const updated = anyChanged
    ? { ...file, hooks: { ...file.hooks, [CODEX_EVENTS.stop]: stop.groups, [CODEX_EVENTS.sessionEnd]: sessionEnd.groups } }
    : file;

  return {
    updated,
    stopChanged: stop.changed,
    sessionEndChanged: sessionEnd.changed,
    anyChanged,
    indexes: findCodexTrackerIndexes(updated),
  };
}

// hooks.json 中 tracker hook 的群組索引與群組內索引，信任 key 需要兩者；找不到回 undefined。
export function findCodexTrackerIndexes(file: CodexHooksFile): CodexGroupIndexes {
  const find = (event: string): CodexHookLocation | undefined => {
    const groups = file.hooks?.[event];
    if (!Array.isArray(groups)) return undefined;
    for (const [group, entry] of groups.entries()) {
      if (!Array.isArray(entry?.hooks)) continue;
      const hook = entry.hooks.findIndex((candidate) => isCodexTrackerHook(candidate?.command));
      if (hook !== -1) return { group, hook };
    }
    return undefined;
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
    const at = indexes[event];
    if (at !== undefined) wanted.set(`${hooksPath}:${TRUST_EVENT_KEYS[event]}:${at.group}:${at.hook}`, event);
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

const CODEX_TRUST_MESSAGE =
  "Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.";

const CODEX_DISABLED_MESSAGE = "Codex: hooks installed but disabled in Codex";

const TRUST_LABELS: Record<CodexTrustState, string> = {
  recorded: "trusted",
  awaiting: "awaiting trust",
  disabled: "disabled in Codex",
};

const TRUST_HINT = "open /hooks in Codex";

// 兩條 hook 的信任是分開記的，實際上很容易只信任其中一條（Eric 本機就是這樣）。
// 籠統一句「awaiting trust」會讓人以為兩條都要重做，所以混合狀態逐 hook 講。
// setup／update 與 status 共用這個函式，兩邊的措辭才不會各自漂移。
export function formatCodexTrustLine(
  states: { stop?: CodexTrustState; sessionEnd?: CodexTrustState },
  options: { forStatus: boolean },
): string {
  const entries = ([["Stop", "stop"], ["SessionEnd", "sessionEnd"]] as const).flatMap(([label, event]) => {
    const state = states[event];
    return state === undefined ? [] : [{ label, state }];
  });
  const values = entries.map((entry) => entry.state);
  const uniform = values.length > 0 && values.every((state) => state === values[0]) ? values[0] : null;
  const detail = entries.map((entry) => `${entry.label} ${TRUST_LABELS[entry.state]}`).join(", ");
  // 已停用是使用者的明示意圖，不該再被要求去信任
  const hint = values.includes("awaiting");

  if (options.forStatus) {
    if (uniform === "recorded") return "Codex hooks: installed, trust recorded";
    if (uniform === "awaiting") return `Codex hooks: installed, awaiting trust (${TRUST_HINT})`;
    if (uniform === "disabled") return "Codex hooks: installed, disabled in Codex";
    return `Codex hooks: installed, ${detail}${hint ? ` (${TRUST_HINT})` : ""}`;
  }
  if (uniform === "awaiting") return CODEX_TRUST_MESSAGE;
  if (uniform === "disabled") return CODEX_DISABLED_MESSAGE;
  return `Codex: hooks installed (${detail}).${hint ? " Open Codex and run /hooks once to trust the remaining ccusage-tracker hook." : ""}`;
}

// 唯讀掃描 config.toml 頂層的 notify 陣列。只用來提示使用者自行移除重複觸發的
// 舊設定 —— 本工具永不編輯 Codex 的 TOML。
//
// 「整行以 [ 開頭就算進入 table」會同時錯兩邊：`[[servers]]` 與 `[tui] # 註解`
// 不被當成 table（提示多印），無尾逗號的陣列續行 `[3, 4]` 與多行字串裡的 `[tui]`
// 卻被當成 table（提示漏印）。因此改為追蹤字串狀態與陣列深度，只有在深度 0、
// 不在字串內時，整行是 table 標頭才算頂層結束。
const TABLE_HEADER = /^\[\[?[^\]]*\]\]?\s*(#.*)?$/;
const STRING_DELIMITERS = ['"""', "'''", '"', "'"] as const;

interface ScanState {
  inString: string | null;
  depth: number;
}

// 逐字元掃一行，回傳行尾的字串與陣列深度狀態。註解之後的字元全部略過；
// 單行字串（"…" / '…'）不跨行，行尾一律關閉，壞掉的 TOML 不會污染後續狀態。
function scanLine(line: string, state: ScanState): ScanState {
  let inString = state.inString;
  let depth = state.depth;
  for (let at = 0; at < line.length; at++) {
    if (inString !== null) {
      if (line.startsWith(inString, at)) {
        at += inString.length - 1;
        inString = null;
      } else if (inString === '"' && line[at] === "\\") {
        at += 1; // 基本字串的逸出字元，下一個字元不算結束符
      }
      continue;
    }
    if (line[at] === "#") break;
    const opened = STRING_DELIMITERS.find((delimiter) => line.startsWith(delimiter, at));
    if (opened !== undefined) {
      inString = opened;
      at += opened.length - 1;
      continue;
    }
    if (line[at] === "[") depth += 1;
    else if (line[at] === "]") depth -= 1;
  }
  const spansLines = inString === '"""' || inString === "'''";
  return { inString: spansLines ? inString : null, depth };
}

export function hasTrackerNotify(configToml: string): boolean {
  let state: ScanState = { inString: null, depth: 0 };
  let collected: string | null = null;

  for (const line of configToml.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (collected === null && state.inString === null && state.depth === 0) {
      if (TABLE_HEADER.test(trimmed)) return false; // 進入第一個 table，頂層結束
      if (/^notify\s*=/.test(trimmed)) collected = "";
    }
    state = scanLine(line, state);
    if (collected !== null) {
      // 跨行的 notify 值累積到深度回到 0 才判斷
      collected += trimmed;
      if (state.inString === null && state.depth <= 0) break;
    }
  }
  return collected !== null && /[/\\]ccusage-tracker[/\\]codex-sync\.mjs/.test(collected);
}
