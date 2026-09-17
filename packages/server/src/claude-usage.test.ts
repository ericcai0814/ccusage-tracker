import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync, spawn } from "node:child_process";

const node = Bun.which("node")!;
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
const totals = { inputTokens: 200, outputTokens: 20, cacheCreationTokens: 30, cacheReadTokens: 40, totalCost: 0.12 };
function fixture(publishedCollector?: string) {
  const home = mkdtempSync(join(tmpdir(), "tracker claude "));
  const dir = join(home, ".config/ccusage-tracker");
  const bin = join(home, "bin");
  mkdirSync(dir, { recursive: true }); mkdirSync(bin);
  writeFileSync(join(bin, "ccusage"), `#!${node}\nimport fs from 'node:fs';
if (process.argv.includes('--version')) { console.log(fs.existsSync(process.env.HOME + '/version') ? fs.readFileSync(process.env.HOME + '/version','utf8') : '18.0.10'); process.exit(0); }
fs.appendFileSync(process.env.HOME + '/args.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
console.log(fs.readFileSync(process.env.HOME + '/output.json', 'utf8'));\n`, { mode: 0o755 });
  if (publishedCollector) {
    // Opt-in published-package check; all logs/config and HTTP stay isolated.
    writeFileSync(join(bin, "ccusage"), `#!${node}\nimport { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const r = spawnSync(${JSON.stringify(node)}, [${JSON.stringify(publishedCollector)}, ...args, ...(args.includes('--version') ? [] : ['--offline'])], { stdio: 'inherit' });
process.exit(r.status ?? 1);\n`, { mode: 0o755 });
  }
  writeFileSync(join(home, "mock.mjs"), `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
const originalWrite = fs.writeFileSync;
if(process.env.SLOW_LOCK) { fs.writeFileSync = (file, ...args) => { if(String(file).endsWith('/worker.lock')) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250); return originalWrite(file,...args); }; syncBuiltinESMExports(); }
globalThis.fetch = async (url, options) => { fs.appendFileSync(process.env.HOME + '/requests.jsonl', options.body + '\\n'); return {status:200}; };\n`);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ server_url: "http://127.0.0.1:12345", team_key: "fixture", member_name: "test" }));
  const set = (data: unknown) => writeFileSync(join(home, "output.json"), JSON.stringify(data));
  set({ daily: [{ date: today, ...totals, modelsUsed: ["claude-sonnet"] }], totals });
  const run = () => spawnSync(node, ["--import", join(home, "mock.mjs"), join(import.meta.dir, "hook-scripts/session-end.mjs"), "--mode=worker"], {
    cwd: home, env: { HOME: home, CODEX_HOME: join(home, "codex"), CLAUDE_CONFIG_DIR: join(home, "claude"), PATH: bin, TZ: "Asia/Taipei" }, encoding: "utf8", timeout: 10000,
  });
  const runAsync = () => new Promise<number | null>((resolve) => {
    const child = spawn(node, ["--import", join(home, "mock.mjs"), join(import.meta.dir, "hook-scripts/session-end.mjs"), "--mode=worker"], {
      cwd: home, env: { HOME: home, CODEX_HOME: join(home, "codex"), CLAUDE_CONFIG_DIR: join(home, "claude"), PATH: bin, TZ: "Asia/Taipei", SLOW_LOCK: "1" }, stdio: "ignore",
    });
    child.on("close", resolve);
  });
  const requests = () => existsSync(join(home, "requests.jsonl")) ? readFileSync(join(home, "requests.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : [];
  return { home, dir, set, run, runAsync, requests, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

describe("Claude reporter runtime source and replay safety", () => {
  it("preserves the legacy command and flags for adjacent 18.0.9", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.home, "version"), "18.0.9");
      expect(f.run().status).toBe(0);
      expect(f.requests()).toHaveLength(1);
      expect(f.requests()[0]).toMatchObject({ session_id: "daily", input_tokens: 200 });
      expect(JSON.parse(readFileSync(join(f.home, "args.jsonl"), "utf8"))).toEqual(["daily", "--json", "--since", today.replaceAll("-", "")]);
    } finally { f.cleanup(); }
  });

  it.skipIf(!process.env.CCTRACKER_TEST_LEGACY_COLLECTOR)("reports actual published 18.0.9 Claude logs", () => {
    const f = fixture(process.env.CCTRACKER_TEST_LEGACY_COLLECTOR);
    try {
      const env = { HOME: f.home, CODEX_HOME: join(f.home, "codex"), CLAUDE_CONFIG_DIR: join(f.home, "claude"), PATH: join(f.home, "bin"), TZ: "Asia/Taipei" };
      const version = spawnSync(join(f.home, "bin/ccusage"), ["--version"], { cwd: f.home, env, encoding: "utf8", timeout: 10000 });
      expect(version.status).toBe(0);
      expect(version.stdout.trim().replace(/^ccusage /, "")).toBe("18.0.9");
      const project = join(f.home, "claude/projects/fixture");
      mkdirSync(project, { recursive: true });
      writeFileSync(join(project, "session.jsonl"), JSON.stringify({ type: "assistant", timestamp: new Date().toISOString(),
        sessionId: "fixture", requestId: "request-fixture", costUSD: 0.001,
        message: { id: "message-fixture", type: "message", role: "assistant", model: "claude-sonnet-4-20250514", content: [],
          usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 30, cache_read_input_tokens: 40 } } }) + "\n");
      expect(f.run().status).toBe(0);
      expect(f.requests()).toEqual([{ member_name: "test", date: today, session_id: "daily", input_tokens: 100,
        output_tokens: 20, cache_creation_tokens: 30, cache_read_tokens: 40, total_cost_usd: 0.001, models: ["claude-sonnet-4-20250514"] }]);
      expect(existsSync(join(f.dir, "last-error.txt"))).toBe(false);
    } finally { f.cleanup(); }
  });

  it("accepts a schema-compatible 20.0.21 patch fixture (synthetic) with explicit Claude selection", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.home, "version"), "ccusage 20.0.21");
      expect(f.run().status).toBe(0);
      expect(f.requests()).toHaveLength(1);
      expect(f.requests()[0]).toMatchObject({ session_id: "daily", input_tokens: 200 });
      expect(JSON.parse(readFileSync(join(f.home, "args.jsonl"), "utf8"))).toEqual(["claude", "daily", "--json", "--since",
        today.replaceAll("-", ""), "--until", today.replaceAll("-", ""), "--timezone", "Asia/Taipei"]);
    } finally { f.cleanup(); }
  });

  for (const data of [
    { daily: [{ date: today, ...totals, modelsUsed: [] }], totals, type: "daily", data: [], summary: {} },
    { daily: [{ date: today, inputTokens: 600, outputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 400, costUSD: 0.25, models: { "gpt-5": {} } }], totals: {} },
    { daily: [{ date: today, ...totals, inputTokens: -1, modelsUsed: [] }], totals },
    [],
    "invalid JSON",
  ]) it("still rejects unknown/malformed data on the synthetic 20.0.21 Claude path", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.home, "version"), "20.0.21");
      if (typeof data === "string") writeFileSync(join(f.home, "output.json"), data);
      else f.set(data);
      expect(f.run().status).toBe(0);
      expect(f.requests()).toEqual([]);
      expect(existsSync(join(f.dir, "last-error.txt"))).toBe(true);
      expect(JSON.parse(readFileSync(join(f.home, "args.jsonl"), "utf8")).slice(0, 2)).toEqual(["claude", "daily"]);
    } finally { f.cleanup(); }
  });

  it("rejects unknown major 99 without invoking a daily collector", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.home, "version"), "99.0.0");
      expect(f.run().status).toBe(0);
      expect(f.requests()).toEqual([]);
      expect(existsSync(join(f.home, "args.jsonl"))).toBe(false);
      expect(existsSync(join(f.dir, "last-error.txt"))).toBe(true);
    } finally { f.cleanup(); }
  });

  it("does not replay stale daily buffer after a newer snapshot succeeds", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "buffer.jsonl"), JSON.stringify({ member_name: "test", date: today, session_id: "daily", input_tokens: 100,
        output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, total_cost_usd: 0, models: [], _buffered_at: new Date().toISOString() }) + "\n");
      expect(f.run().status).toBe(0);
      expect(f.requests().map((r) => r.input_tokens)).toEqual([200]);
      expect(existsSync(join(f.dir, "buffer.jsonl"))).toBe(false);
    } finally { f.cleanup(); }
  });

  for (const data of [
    { totals },
    { type: "daily", data: [], summary: {}, totals },
    { daily: [{ date: today, ...totals, inputTokens: -1, modelsUsed: [] }], totals: { ...totals, inputTokens: -1 } },
    { daily: [{ date: "2026-02-30", ...totals, modelsUsed: [] }], totals },
  ]) it("rejects unknown or invalid collector data without an upload", () => {
    const f = fixture();
    try {
      f.set(data);
      expect(f.run().status).toBe(0);
      expect(f.requests()).toEqual([]);
      expect(existsSync(join(f.dir, "last-error.txt"))).toBe(true);
    } finally { f.cleanup(); }
  });

  it("treats the actual legacy empty-array output as no data", () => {
    const f = fixture();
    try {
      f.set([]);
      expect(f.run().status).toBe(0);
      expect(f.requests()).toEqual([]);
      expect(existsSync(join(f.dir, "last-error.txt"))).toBe(false);
    } finally { f.cleanup(); }
  });

  it("coalesces all buffered daily duplicates before replay", () => {
    const f = fixture();
    try {
      const old = { member_name: "test", date: "2026-09-15", session_id: "daily", input_tokens: 100,
        output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, total_cost_usd: 0, models: [], _buffered_at: new Date().toISOString() };
      writeFileSync(join(f.dir, "buffer.jsonl"), JSON.stringify(old) + "\n" + JSON.stringify({ ...old, input_tokens: 150 }) + "\n");
      expect(f.run().status).toBe(0);
      expect(f.requests().map((r) => r.input_tokens)).toEqual([200, 150]);
    } finally { f.cleanup(); }
  });

  it("serializes simultaneous workers even when lock creation is slow", async () => {
    const f = fixture();
    try {
      expect(await Promise.all([f.runAsync(), f.runAsync()])).toEqual([0, 0]);
      expect(f.requests()).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  it("uses the verified Claude-only20 command and reads its published row schema", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.home, "version"), "ccusage 20.0.20");
      f.set({ daily: [{ date: today, inputTokens: 100, outputTokens: 20, cacheCreationTokens: 30,
        cacheReadTokens: 40, totalCost: 0.001, totalTokens: 190, modelsUsed: ["claude-sonnet-4-20250514"] }], totals: {} });
      expect(f.run().status).toBe(0);
      expect(f.requests()).toEqual([{ member_name: "test", date: today, session_id: "daily", input_tokens: 100,
        output_tokens: 20, cache_creation_tokens: 30, cache_read_tokens: 40, total_cost_usd: 0.001, models: ["claude-sonnet-4-20250514"] }]);
      expect(JSON.parse(readFileSync(join(f.home, "args.jsonl"), "utf8")).slice(0, 2)).toEqual(["claude", "daily"]);
    } finally { f.cleanup(); }
  });

  it("cannot acquire a fresh lock while another acquisition holds the guard", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "worker.lock.reclaim"), "other acquisition");
      expect(f.run().status).toBe(0);
      expect(f.requests()).toEqual([]);
      expect(existsSync(join(f.dir, "worker.lock"))).toBe(false);
      expect(readFileSync(join(f.dir, "worker.lock.reclaim"), "utf8")).toBe("other acquisition");
    } finally { f.cleanup(); }
  });
});
