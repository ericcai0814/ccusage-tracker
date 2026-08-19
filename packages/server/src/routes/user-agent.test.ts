import { describe, expect, it, beforeEach } from "bun:test";
import { Database } from "bun:sqlite";
import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { listMembers } from "../queries";

// 舊版 bash session-end.sh 用 curl 送、現行 .mjs 用 Node 內建 fetch 送，
// User-Agent 分別是 curl/x.y.z 與 node。記下來就能查出誰還掛著舊腳本，
// 不必請每位成員自己去翻 settings.json（見 #11）。
const TEAM_KEY = "test-team-key";
let counter = 0;

function payload(name: string) {
  return {
    member_name: name,
    date: "2026-08-20",
    session_id: "daily",
    input_tokens: 1,
    output_tokens: 1,
    cache_creation_tokens: 0,
    cache_read_tokens: 0,
    total_cost_usd: 0.01,
    models: [],
  };
}

async function ingest(app: ReturnType<typeof createApp>, name: string, ua?: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${TEAM_KEY}`,
  };
  if (ua !== undefined) headers["User-Agent"] = ua;
  return app.request("/api/ingest", { method: "POST", headers, body: JSON.stringify(payload(name)) });
}

describe("記錄上報端的 User-Agent", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    process.env.TEAM_KEY = TEAM_KEY;
    db = createDatabase(":memory:");
    app = createApp(db);
  });

  it("分得出 curl（舊 bash 腳本）與 node（現行 .mjs）", async () => {
    await ingest(app, "legacy-user", "curl/8.7.1");
    await ingest(app, "current-user", "node");

    const byName = Object.fromEntries(listMembers(db).map((m) => [m.name, m.last_user_agent]));
    expect(byName["legacy-user"]).toBe("curl/8.7.1");
    expect(byName["current-user"]).toBe("node");
  });

  it("沒帶 User-Agent 不影響上報", async () => {
    const res = await ingest(app, "no-ua");
    expect(res.status).toBe(200);
    expect(listMembers(db).find((m) => m.name === "no-ua")?.last_user_agent).toBeNull();
  });

  it("過長的 User-Agent 會截斷（這欄是診斷用，不該讓外部決定長度）", async () => {
    await ingest(app, "long-ua", "x".repeat(500));
    const stored = listMembers(db).find((m) => m.name === "long-ua")?.last_user_agent ?? "";
    expect(stored.length).toBeLessThanOrEqual(120);
  });

  it("每次上報都更新，反映的是最近一次用的腳本", async () => {
    await ingest(app, "upgrader", "curl/8.7.1");
    await ingest(app, "upgrader", "node");
    expect(listMembers(db).find((m) => m.name === "upgrader")?.last_user_agent).toBe("node");
  });

  it("session 指標上報也記錄（Stop hook 只送這個的情況）", async () => {
    await app.request("/api/ingest/session", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${TEAM_KEY}`, "User-Agent": "curl/7.0" },
      body: JSON.stringify({ member_name: "s-only", session_id: "s1", started_at: "2026-08-20T00:00:00Z", ended_at: "2026-08-20T01:00:00Z" }),
    });
    expect(listMembers(db).find((m) => m.name === "s-only")?.last_user_agent).toBe("curl/7.0");
  });

  // 存了但查不到就等於沒存。這條把「上報 → 管理端看得見」整條路釘住。
  it("GET /admin/members 看得到，才查得出誰還在用舊腳本", async () => {
    process.env.ADMIN_API_KEY = "admin-key";
    await ingest(app, "legacy-user", "curl/8.7.1");
    await ingest(app, "current-user", "node");

    const res = await app.request("/api/admin/members", {
      headers: { Authorization: "Bearer admin-key" },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as { name: string; last_user_agent: string | null }[];
    const legacy = rows.filter((r) => (r.last_user_agent ?? "").startsWith("curl/"));
    expect(legacy.map((r) => r.name)).toEqual(["legacy-user"]);
    delete process.env.ADMIN_API_KEY;
  });

  // 這條要測的是「既有資料庫升級」，所以必須用同一個檔案 DB ——
  // 建完 legacy 表卻對另一個 :memory: 斷言的話，測到的只是新庫的 schema，
  // 而正式環境是一個裝著真實資料的既有檔案。
  it("既有資料庫（無此欄位、且有資料）會被 migration 補上且不掉資料", () => {
    const path = join(tmpdir(), `ccusage-migrate-${process.pid}-${counter++}.db`);
    try {
      const legacy = new Database(path);
      legacy.exec(`CREATE TABLE members (
        id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE,
        api_key_hash TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
      legacy.run("INSERT INTO members (id, name, api_key_hash) VALUES ('m1', 'old-member', 'h1')");
      legacy.close();

      const upgraded = createDatabase(path);
      const cols = upgraded.query("SELECT name FROM pragma_table_info('members')").all() as { name: string }[];
      expect(cols.some((c) => c.name === "last_user_agent")).toBe(true);
      expect(cols.some((c) => c.name === "last_seen_at")).toBe(true);

      // 既有資料還在，新欄位對它們是 null
      const rows = listMembers(upgraded);
      expect(rows.map((r) => r.name)).toEqual(["old-member"]);
      expect(rows[0].last_user_agent).toBeNull();
      upgraded.close();
    } finally {
      for (const suffix of ["", "-wal", "-shm"]) {
        try { unlinkSync(path + suffix); } catch { /* 不存在就算了 */ }
      }
    }
  });
});
