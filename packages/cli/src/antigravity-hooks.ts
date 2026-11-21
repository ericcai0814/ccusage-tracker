import { readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { getAgentSyncScriptPath } from "./agent-sources";

// Antigravity 的 App、CLI、IDE 共用全域 hooks 檔。頂層 key 是 hook 名稱，
// 值是「事件名 → handler 陣列」；Stop 是簡單事件，handler 直接放在陣列裡、沒有 matcher。
export const ANTIGRAVITY_HOOK_KEY = "ccusage-tracker";

export type AntigravityHooksFile = Record<string, unknown>;

export function getAntigravityHooksPath(home = homedir()): string {
  return join(home, ".gemini", "config", "hooks.json");
}

export function getAntigravityHookCommand(home = homedir()): string {
  return `node "${getAgentSyncScriptPath(home)}" --hook antigravity`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(detail: string): never {
  throw new Error(`Antigravity ${detail}; repair ~/.gemini/config/hooks.json before updating.`);
}

// 比對時忽略 key 順序：使用者或 Antigravity 介面重寫檔案時可能換了順序，內容其實相同。
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

// 不寫 timeout：官方文件只在巢狀 hooks 陣列的欄位表列出它，扁平 handler 能不能用不確定；
// agent-sync.mjs 的 hook 模式 3 秒內就會結束，預設的 30 秒夠用。
function canonicalEntry(command: string, existing: Record<string, unknown> | undefined): Record<string, unknown> {
  const stop = { Stop: [{ type: "command", command }] };
  // 使用者在 Antigravity 介面停用的 hook，update 不擅自打開。
  return existing !== undefined && "enabled" in existing ? { enabled: existing.enabled, ...stop } : stop;
}

// 純函式：只認 ccusage-tracker 這個 key，其他 key 的值與順序都不動。
// 未變更時回傳原物件參考，讓呼叫端可以略過寫檔。
export function applyAntigravityHook(
  file: unknown,
  command = getAntigravityHookCommand(),
): { updated: AntigravityHooksFile; changed: boolean; disabled: boolean } {
  if (!isPlainObject(file)) invalid("hooks.json must contain a JSON object");
  const existing = file[ANTIGRAVITY_HOOK_KEY];
  if (existing !== undefined && !isPlainObject(existing)) invalid(`hooks.json "${ANTIGRAVITY_HOOK_KEY}" entry must be an object`);

  const entry = canonicalEntry(command, existing);
  const disabled = entry.enabled === false;
  if (existing !== undefined && stableJson(existing) === stableJson(entry)) return { updated: file, changed: false, disabled };

  const updated = existing === undefined
    ? { ...file, [ANTIGRAVITY_HOOK_KEY]: entry }
    : Object.fromEntries(Object.entries(file).map(([key, value]) => [key, key === ANTIGRAVITY_HOOK_KEY ? entry : value]));
  return { updated, changed: true, disabled };
}

export type AntigravityHookState = "installed" | "disabled" | "outdated" | "not_installed" | "invalid";

// status 用：讀檔失敗、非 JSON 都回報成狀態，不拋錯。
export function readAntigravityHookState(home = homedir()): AntigravityHookState {
  let raw: string;
  try {
    raw = readFileSync(getAntigravityHooksPath(home), "utf-8");
  } catch {
    return "not_installed";
  }
  let file: unknown;
  try {
    file = JSON.parse(raw);
  } catch {
    return "invalid";
  }
  if (!isPlainObject(file)) return "invalid";
  const entry = file[ANTIGRAVITY_HOOK_KEY];
  if (entry === undefined) return "not_installed";
  if (!isPlainObject(entry)) return "invalid";
  if (entry.enabled === false) return "disabled";
  return stableJson(entry) === stableJson(canonicalEntry(getAntigravityHookCommand(home), entry)) ? "installed" : "outdated";
}

export function formatAntigravityResultLine(result: { wired: boolean; changed: boolean; disabled: boolean }): string {
  if (!result.wired) return "Antigravity: hook not installed (this server does not provide agent-sync.mjs)";
  if (result.disabled) return "Antigravity: hook installed but disabled in Antigravity (Settings > Customizations > Hooks)";
  if (result.changed) return "Antigravity: hook installed (Stop). Restart Antigravity to load it.";
  return "Antigravity: hook already up to date";
}
