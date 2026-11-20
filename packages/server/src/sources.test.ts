import { describe, expect, it } from "bun:test";
import { Database } from "bun:sqlite";
import { SOURCES, OTHER_SOURCE, buildSourceCaseSql, createSourceTable, resolveSource } from "./sources";

const SESSION_IDS = ["daily", "codex-daily", "antigravity-daily", "manual", null] as const;

function attributeInSql(caseSql: string, sessionIds: readonly (string | null)[]): string[] {
  const db = new Database(":memory:");
  try {
    db.run("CREATE TABLE t (pos INTEGER, session_id TEXT)");
    sessionIds.forEach((id, pos) => db.run("INSERT INTO t (pos, session_id) VALUES (?, ?)", [pos, id]));
    const rows = db.query(`SELECT ${caseSql} AS source FROM t ORDER BY pos`).all() as { source: string }[];
    return rows.map((r) => r.source);
  } finally {
    db.close();
  }
}

describe("server source table", () => {
  it("lists claude, codex and antigravity in table order with their labels, providers and colors", () => {
    expect(SOURCES.map((s) => [s.id, s.sessionId, s.label, s.provider, s.color])).toEqual([
      ["claude", "daily", "Claude Code", "Anthropic", "#3987e5"],
      ["codex", "codex-daily", "Codex", "OpenAI", "#d95926"],
      ["antigravity", "antigravity-daily", "Antigravity", "Google", "#f0b800"],
    ]);
    expect([OTHER_SOURCE.id, OTHER_SOURCE.label, OTHER_SOURCE.provider, OTHER_SOURCE.color]).toEqual([
      "other",
      "其他",
      "其他",
      "#8a8a8a",
    ]);
  });

  it("attributes known and unknown session ids the same way in SQL and in code", () => {
    const expected = ["claude", "codex", "antigravity", "other", "other"];
    const resolved: string[] = SESSION_IDS.map((id) => resolveSource(id));
    expect(attributeInSql(buildSourceCaseSql(), SESSION_IDS)).toEqual(expected);
    expect(resolved).toEqual(expected);
  });

  it("attributes a source added to the table without any other code change", () => {
    const table = createSourceTable([
      ...SOURCES,
      { id: "gemini", sessionId: "gemini-daily", label: "Gemini", provider: "Google", color: "#123456" },
    ]);
    const ids = [...SESSION_IDS, "gemini-daily"];
    const expected = ["claude", "codex", "antigravity", "other", "other", "gemini"];

    expect(attributeInSql(buildSourceCaseSql(table), ids)).toEqual(expected);
    expect(ids.map((id) => resolveSource(id, table))).toEqual(expected);
  });

  it("refuses a table whose session id could break out of the SQL literal", () => {
    for (const sessionId of ["daily'; DROP TABLE t; --", "Daily", "codex_daily", ""]) {
      expect(() =>
        createSourceTable([{ id: "bad", sessionId, label: "Bad", provider: "Bad", color: "#000000" }])
      ).toThrow();
    }
  });
});
