// 用量來源表：DB 沒有 source 欄位，來源只能從 session_id 反推。
// SQL 歸屬、resolveSource 與儀表板的名稱、顏色、供應商、順序都由這張表產生，
// 接新工具時只在這裡加一筆。

export interface SourceEntry<Id extends string = string> {
  id: Id;
  sessionId: string;
  label: string;
  provider: string;
  color: string;
}

// 資料色：#00ffb1 在 --card #101413 與 --muted #1a201e 上 WCAG 對比 >=12:1；與另三色 CIEDE2000 >=25（正常／Machado 2009 紅、綠色盲）。淺綠細線待人眼確認。
export const SOURCES = [
  { id: "claude", sessionId: "daily", label: "Claude Code", provider: "Anthropic", color: "#3987e5" },
  { id: "codex", sessionId: "codex-daily", label: "Codex", provider: "OpenAI", color: "#d95926" },
  { id: "antigravity", sessionId: "antigravity-daily", label: "Antigravity", provider: "Google", color: "#00ffb1" },
] as const satisfies readonly SourceEntry[];

// 手動灌的資料或未知的 session_id 歸到 other，不丟掉。
export const OTHER_SOURCE = { id: "other", sessionId: "", label: "其他", provider: "其他", color: "#8a8a8a" } as const;

export type UsageSource = (typeof SOURCES)[number]["id"] | typeof OTHER_SOURCE.id;

export interface SourceTable {
  entries: readonly SourceEntry[];
}

const SESSION_ID_PATTERN = /^[a-z0-9-]+$/;
const SOURCE_ID_PATTERN = /^[a-z0-9-]+$/;

// SQL 字串只由表內常數組成，所以建表時就把不安全的值擋掉。
export function createSourceTable(entries: readonly SourceEntry[]): SourceTable {
  for (const entry of entries) {
    if (!SESSION_ID_PATTERN.test(entry.sessionId)) {
      throw new Error(`Invalid source session_id: ${JSON.stringify(entry.sessionId)}`);
    }
    if (!SOURCE_ID_PATTERN.test(entry.id) || entry.id === OTHER_SOURCE.id) {
      throw new Error(`Invalid source id: ${JSON.stringify(entry.id)}`);
    }
  }
  return { entries: [...entries] };
}

export const SOURCE_TABLE = createSourceTable(SOURCES);

export function buildSourceCaseSql(table: SourceTable = SOURCE_TABLE): string {
  const whens = table.entries.map((e) => `  WHEN '${e.sessionId}' THEN '${e.id}'`);
  return ["CASE session_id", ...whens, `  ELSE '${OTHER_SOURCE.id}'`, "END"].join("\n");
}

export function resolveSource(sessionId: string | null): UsageSource;
export function resolveSource(sessionId: string | null, table: SourceTable): string;
export function resolveSource(sessionId: string | null, table: SourceTable = SOURCE_TABLE): string {
  return table.entries.find((e) => e.sessionId === sessionId)?.id ?? OTHER_SOURCE.id;
}

// 儀表板用：表格順序後接 other。
export const SOURCE_ORDER: readonly UsageSource[] = [...SOURCES.map((s) => s.id), OTHER_SOURCE.id];

const BY_ID = new Map<string, SourceEntry>([...SOURCES, OTHER_SOURCE].map((s) => [s.id, s]));

export function sourceInfo(source: UsageSource): SourceEntry {
  return BY_ID.get(source) ?? OTHER_SOURCE;
}
