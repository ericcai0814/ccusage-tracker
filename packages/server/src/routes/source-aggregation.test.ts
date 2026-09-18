import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { Database } from "bun:sqlite";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const TEAM_KEY = "source-test-team-key";

describe("Claude and Codex public reporting API", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;
  let previousTeamKey: string | undefined;

  beforeEach(() => {
    previousTeamKey = process.env.TEAM_KEY;
    process.env.TEAM_KEY = TEAM_KEY;
    db = createDatabase(":memory:");
    app = createApp(db);
  });

  afterEach(() => {
    db.close();
    if (previousTeamKey === undefined) delete process.env.TEAM_KEY;
    else process.env.TEAM_KEY = previousTeamKey;
  });

  it("serves the Codex collector script for setup and update", async () => {
    const response = await app.request("/scripts/codex-sync.mjs");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const published = await response.text();
    expect(published).toBe(await Bun.file(new URL("../hook-scripts/codex-sync.mjs", import.meta.url)).text());
  });

  it("upserts each daily source independently and sums both once in reports", async () => {
    const date = new Date().toISOString().slice(0, 10);
    const headers = { Authorization: `Bearer ${TEAM_KEY}`, "Content-Type": "application/json" };
    const claude = {
      member_name: "Source Tester", date, session_id: "daily",
      input_tokens: 100, output_tokens: 50, cache_creation_tokens: 25,
      cache_read_tokens: 75, total_cost_usd: 0.25, models: ["claude-sonnet-4-6"],
    };
    const codex = {
      member_name: "Source Tester", date, session_id: "codex-daily",
      input_tokens: 600, output_tokens: 200, cache_creation_tokens: 0,
      cache_read_tokens: 400, total_cost_usd: 0.75, models: ["gpt-5"],
    };
    for (const payload of [claude, codex, claude, codex, { ...codex, output_tokens: 300 }]) {
      const response = await app.request("/api/ingest", {
        method: "POST", headers, body: JSON.stringify(payload),
      });
      expect(response.status).toBe(200);
    }
    const daily = await app.request(`/api/report/daily?from=${date}&to=${date}`, { headers });
    expect(daily.status).toBe(200);
    const { records } = await daily.json();
    expect(records).toHaveLength(2);
    expect(records.map((r: { session_id: string }) => r.session_id).sort()).toEqual(["codex-daily", "daily"]);
    const summary = await app.request("/api/report/summary?period=today", { headers });
    expect(summary.status).toBe(200);
    expect(await summary.json()).toMatchObject({
      total_cost_usd: 1, total_tokens: 1550, active_members: 1,
      members: [{ member_name: "Source Tester", input_tokens: 700, output_tokens: 350,
        cache_creation_tokens: 25, cache_read_tokens: 475, total_cost_usd: 1 }],
    });
  });

  it("updates the Node-built CLI then syncs installed Codex scripts into the real API", async () => {
    const home = mkdtempSync(join(tmpdir(), "tracker full chain "));
    try {
      const node = Bun.which("node")!;
      const configDir = join(home, ".config/ccusage-tracker");
      const bin = join(home, "bin");
      const sessions = join(home, ".codex/sessions");
      for (const dir of [configDir, bin, sessions]) mkdirSync(dir, { recursive: true });
      const configBytes = JSON.stringify({ server_url: "http://127.0.0.1:45678", team_key: TEAM_KEY, member_name: "Full Chain" }, null, 4) + "\n\n";
      writeFileSync(join(configDir, "config.json"), configBytes);
      const scripts: Record<string, string> = {};
      for (const name of ["session-start.mjs", "session-end.mjs", "codex-sync.mjs"]) {
        const response = await app.request("/scripts/" + name);
        expect(response.status).toBe(200);
        scripts["/scripts/" + name] = await response.text();
      }
      writeFileSync(join(home, "scripts.json"), JSON.stringify(scripts));
      const mock = join(home, "http-mock.mjs");
      writeFileSync(mock, `import fs from 'node:fs';
const home=process.env.HOME;
const scripts=JSON.parse(fs.readFileSync(home+'/scripts.json','utf8'));
globalThis.fetch=async(url,options={})=>{
 const path=new URL(url).pathname;
 if(options.method==='POST' && path==='/api/ingest') {
   fs.appendFileSync(home+'/posts.jsonl',options.body+'\\n');
   return new Response('{"ok":true}',{status:200});
 }
 return new Response(scripts[path]??'Not found',{status:path in scripts?200:404});
};`);
      const date = new Date().toISOString().slice(0, 10);
      const stamp = new Date().toISOString();
      const usage = { input_tokens: 1000, cached_input_tokens: 400, output_tokens: 200, reasoning_output_tokens: 50, total_tokens: 1200 };
      const events = [
        { type: "session_meta", timestamp: stamp, payload: { id: "11062481-c481-48b6-bbfc-d8048013678f", timestamp: stamp, cwd: home } },
        { type: "turn_context", timestamp: stamp, payload: { model: "gpt-5" } },
        { type: "event_msg", timestamp: stamp, payload: { type: "token_count", info: { total_token_usage: usage, last_token_usage: usage } } },
      ];
      writeFileSync(join(sessions, "rollout-fixture.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
      const observed = { daily: [{ date, inputTokens: 600, cacheReadTokens: 400, cacheCreationTokens: 0,
        outputTokens: 200, reasoningOutputTokens: 50, totalTokens: 1200, costUSD: 0.0028, models: { "gpt-5": {} } }], totals: {} };
      // Normal suite uses a fixed published-schema fixture. An explicit verification
      // run can supply the extracted npm native binary; --offline forbids pricing IO.
      const verifiedCollector = process.env.CCTRACKER_TEST_COLLECTOR;
      writeFileSync(join(bin, "ccusage"), `#!${node}\n` + (verifiedCollector
        ? `import {spawnSync} from 'node:child_process'; const args=process.argv.slice(2); const r=spawnSync(${JSON.stringify(verifiedCollector)},args.includes('--version')?args:[...args,'--offline'],{stdio:'inherit'});process.exit(r.status??1);`
        : `console.log(process.argv.includes('--version')?'20.0.20':${JSON.stringify(JSON.stringify(observed))});`), { mode: 0o755 });
      const build = await Bun.build({ entrypoints: [resolve(import.meta.dir, "../../../cli/src/index.ts")],
        outdir: join(home, "build"), target: "node" });
      expect(build.success).toBe(true);
      const env = { HOME: home, CODEX_HOME: join(home, ".codex"), CLAUDE_CONFIG_DIR: join(home, ".claude"),
        XDG_CONFIG_HOME: join(home, "xdg-config"), XDG_CACHE_HOME: join(home, "xdg-cache"),
        TZ: "UTC", PATH: bin + ":" + dirname(node) + ":/usr/bin:/bin", NODE_OPTIONS: `--import=${JSON.stringify(mock)}` };
      for (const args of [["update"], ["update"], ["sync", "codex"], ["sync", "codex"]]) {
        const result = spawnSync(node, [join(home, "build/index.js"), ...args], { env, cwd: home, encoding: "utf8", timeout: 20000 });
        expect({ status: result.status, stderr: result.stderr }).toEqual({ status: 0, stderr: "" });
      }
      expect(readFileSync(join(configDir, "config.json"), "utf8")).toBe(configBytes);
      expect(existsSync(join(configDir, "codex-last-upload.txt"))).toBe(true);
      const posts = readFileSync(join(home, "posts.jsonl"), "utf8").trim().split("\n");
      expect(posts).toHaveLength(2);
      for (const body of posts) {
        expect(JSON.parse(body)).toEqual({ member_name: "Full Chain", date, session_id: "codex-daily",
          input_tokens: 600, cache_read_tokens: 400, output_tokens: 200, cache_creation_tokens: 0,
          total_cost_usd: 0.0028, models: ["gpt-5"] });
        const response = await app.request("/api/ingest", { method: "POST",
          headers: { Authorization: `Bearer ${TEAM_KEY}`, "Content-Type": "application/json" }, body });
        expect(response.status).toBe(200);
      }
      const report = await app.request("/api/report/summary?period=today", { headers: { Authorization: `Bearer ${TEAM_KEY}` } });
      expect(await report.json()).toMatchObject({ total_tokens: 1200, total_cost_usd: 0.0028, active_members: 1 });
    } finally { rmSync(home, { recursive: true, force: true }); }
  });
});
