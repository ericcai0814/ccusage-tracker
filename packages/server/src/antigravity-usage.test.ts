import { afterAll, beforeAll, describe, expect, it, setDefaultTimeout } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Database } from "bun:sqlite";
import { createApp } from "./app";
import { createDatabase } from "./db";
import { queryUsageRecords } from "./queries";

// agent-sync.mjs 由 Node 在隔離 HOME 執行；collector 是合成的 ccusage，ingest 是掛在 loopback 上的真實 app。
// spawn 一律用非同步版本：同步 spawn 會卡住本程序的 event loop，loopback server 就回不了請求。

setDefaultTimeout(20000);

const node = Bun.which("node")!;
const script = join(import.meta.dir, "hook-scripts/agent-sync.mjs");
const TEAM_KEY = "agy-fixture-team-key";
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
const compact = today.replaceAll("-", "");
const row = { date: today, inputTokens: 100, outputTokens: 30, cacheCreationTokens: 5, cacheReadTokens: 20,
  totalTokens: 165, totalCost: 0.000187, modelsUsed: ["gemini-3-pro"], modelBreakdowns: [] };

let db: Database;
let server: ReturnType<typeof Bun.serve>;
let offline = false;
let posted: unknown[] = [];

beforeAll(() => {
  process.env.TEAM_KEY = TEAM_KEY;
  db = createDatabase(":memory:");
  const app = createApp(db);
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (new URL(request.url).pathname === "/api/ingest") {
        const body = await request.clone().json();
        posted = [...posted, body];
        if (offline) return new Response("offline", { status: 503 });
      }
      return app.fetch(request);
    },
  });
});

afterAll(() => {
  server.stop(true);
  db.close();
  delete process.env.TEAM_KEY;
});

interface RunResult { status: number | null; stdout: string; stderr: string; ms: number }

function fixture() {
  posted = [];
  offline = false;
  db.run("DELETE FROM usage_records");
  const home = mkdtempSync(join(tmpdir(), "tracker agy "));
  const dir = join(home, ".config/ccusage-tracker");
  const bin = join(home, "bin space");
  mkdirSync(dir, { recursive: true });
  mkdirSync(bin);
  const collector = join(bin, "ccusage");
  writeFileSync(collector, `#!${node}\nimport fs from 'node:fs';
const f = JSON.parse(fs.readFileSync(process.env.HOME + '/fixture.json', 'utf8'));
fs.appendFileSync(process.env.HOME + '/collector-args.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
if(process.argv.includes('--version')) { console.log(f.version ?? 'ccusage 20.0.51'); process.exit(0); }
if(f.delay) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, f.delay);
if(f.fail) { console.error('PRIVATE COLLECTOR CONTENT'); process.exit(1); }
console.log(f.raw ?? JSON.stringify(f.result));\n`, { mode: 0o755 });
  // 記錄每個 node 程序的 argv，並可模擬 spawn 失敗；不攔 fetch，請求真的送到 loopback。
  writeFileSync(join(home, "probe.mjs"), `import fs from 'node:fs'; import cp from 'node:child_process'; import { syncBuiltinESMExports } from 'node:module';
fs.appendFileSync(process.env.HOME + '/argv.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
if(process.env.FAIL_SPAWN) { cp.spawn = () => { throw new Error('PRIVATE SPAWN FAILURE'); }; syncBuiltinESMExports(); }\n`);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ server_url: `http://127.0.0.1:${server.port}`, team_key: TEAM_KEY, member_name: "agy tester" }));
  const set = (result: unknown, other: Record<string, unknown> = {}) =>
    writeFileSync(join(home, "fixture.json"), JSON.stringify({ result, ...other }));
  set({ daily: [row], totals: {} });
  const env = (extra: Record<string, string> = {}) => ({
    HOME: home, PATH: bin, TZ: "Asia/Taipei", NODE_OPTIONS: `--import "${join(home, "probe.mjs")}"`, ...extra,
  });
  const start = (args: string[], extra: Record<string, string> = {}, input?: string, keepStdinOpen = false) => {
    const proc = Bun.spawn([node, script, ...args], {
      env: env(extra), cwd: home, stdout: "pipe", stderr: "pipe",
      stdin: input === undefined ? (keepStdinOpen ? "pipe" : "ignore") : "pipe",
    });
    if (input !== undefined && proc.stdin) {
      proc.stdin.write(input);
      if (!keepStdinOpen) proc.stdin.end();
    }
    return proc;
  };
  const run = async (args: string[] = ["antigravity"], extra: Record<string, string> = {}, input?: string, keepStdinOpen = false): Promise<RunResult> => {
    const began = Date.now();
    const proc = start(args, extra, input, keepStdinOpen);
    const killer = setTimeout(() => proc.kill(), 15000);
    const [stdout, stderr, status] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    clearTimeout(killer);
    return { status, stdout, stderr, ms: Date.now() - began };
  };
  const read = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "");
  const lines = (name: string) => read(join(home, name)).trim().split("\n").filter(Boolean).map((s) => JSON.parse(s));
  const collectorCalls = () => lines("collector-args.jsonl") as string[][];
  const workerArgv = () => (lines("argv.jsonl") as string[][]).filter((argv) => argv.includes("--worker"));
  const agyFiles = () => readdirSync(dir).filter((name) => name.startsWith("antigravity-"));
  // detached worker 的痕跡要等；反證「沒有啟動」則要等夠久，否則每次都假通過。
  const settle = async (deadlineMs = 6000) => {
    const deadline = Date.now() + deadlineMs;
    while ((!existsSync(join(dir, "antigravity-last-upload.txt")) || existsSync(join(dir, "antigravity-worker.lock"))) && Date.now() < deadline) {
      await Bun.sleep(30);
    }
  };
  const quiet = () => Bun.sleep(800);
  return { home, dir, bin, collector, set, start, run, read, collectorCalls, workerArgv, agyFiles, settle, quiet,
    cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

const canonical = (output: number, extra: Record<string, unknown> = {}) => ({
  member_name: "agy tester", date: today, session_id: "antigravity-daily", input_tokens: 100, output_tokens: output,
  cache_creation_tokens: 5, cache_read_tokens: 20, total_cost_usd: 0.000187, models: ["gemini-3-pro"], ...extra,
});

describe("Antigravity reporter: canonical snapshots", () => {
  for (const [tokens, expected] of [
    [{ inputTokens: 100, outputTokens: 30, cacheCreationTokens: 5, cacheReadTokens: 20, totalTokens: 165 }, 40],
    [{ inputTokens: 200, outputTokens: 50, cacheCreationTokens: 0, cacheReadTokens: 0, totalTokens: 250 }, 50],
  ] as const) {
    it(`adds the reasoning remainder once: totalTokens ${tokens.totalTokens} posts output ${expected}`, async () => {
      const f = fixture();
      try {
        f.set({ daily: [{ ...row, ...tokens }], totals: {} });
        const r = await f.run();
        expect(r.status).toBe(0);
        expect(r.stdout).toContain("Antigravity usage synced.");
        expect(posted).toEqual([{ ...canonical(expected), input_tokens: tokens.inputTokens,
          cache_creation_tokens: tokens.cacheCreationTokens, cache_read_tokens: tokens.cacheReadTokens }]);
        const records = queryUsageRecords(db, {});
        expect(records.map((rec) => [rec.session_id, rec.output_tokens])).toEqual([["antigravity-daily", expected]]);
        expect(existsSync(join(f.dir, "antigravity-last-upload.txt"))).toBe(true);
        expect(existsSync(join(f.dir, "antigravity-last-error.txt"))).toBe(false);
      } finally { f.cleanup(); }
    });
  }

  it("sends only the specified fields in the request body", async () => {
    const f = fixture();
    try {
      f.set({ daily: [{ ...row, extraField: "PRIVATE", modelBreakdowns: [{ modelName: "gemini-3-pro", cost: 1 }] }],
        totals: { totalCost: 0.000187, private: "PRIVATE" } });
      expect((await f.run()).status).toBe(0);
      expect(posted).toHaveLength(1);
      expect(Object.keys(posted[0] as object).sort()).toEqual(["cache_creation_tokens", "cache_read_tokens", "date",
        "input_tokens", "member_name", "models", "output_tokens", "session_id", "total_cost_usd"]);
      expect(JSON.stringify(posted)).not.toContain("PRIVATE");
    } finally { f.cleanup(); }
  });

  it("sends negative zero cost as 0", async () => {
    const f = fixture();
    try {
      f.set({ daily: [row], totals: {} }, { raw: JSON.stringify({ daily: [{ ...row, totalCost: 0 }], totals: {} }).replace('"totalCost":0', '"totalCost":-0') });
      expect((await f.run()).status).toBe(0);
      expect((posted[0] as { total_cost_usd: number }).total_cost_usd).toBe(0);
    } finally { f.cleanup(); }
  });

  it("sanitizes unmapped display names instead of rejecting the row", async () => {
    const f = fixture();
    try {
      f.set({ daily: [{ ...row, modelsUsed: ["Kimi K3 (Preview)", "gemini-3-pro", "gemini-3-pro", "()"] }], totals: {} });
      expect((await f.run()).status).toBe(0);
      expect(posted).toEqual([canonical(40, { models: ["Kimi-K3-Preview", "gemini-3-pro"] })]);
    } finally { f.cleanup(); }
  });

  it("calls --version and then the explicit antigravity daily command, never unified daily", async () => {
    const f = fixture();
    try {
      expect((await f.run()).status).toBe(0);
      expect(f.collectorCalls()).toEqual([
        ["--version"],
        ["antigravity", "daily", "--json", "--since", compact, "--until", compact, "--timezone", "Asia/Taipei"],
      ]);
      expect(f.collectorCalls().some((args) => args[0] === "daily")).toBe(false);
    } finally { f.cleanup(); }
  });

  for (const version of ["ccusage 20.0.20", "21.0.0", "18.0.9", "not a version"]) {
    it(`rejects collector version ${version} with install guidance and without running antigravity`, async () => {
      const f = fixture();
      try {
        f.set({ daily: [row], totals: {} }, { version });
        const r = await f.run();
        expect(r.status).toBe(1);
        expect(r.stderr).toContain("ccusage@20.0.51");
        expect(f.read(join(f.dir, "antigravity-last-error.txt"))).toContain("ccusage@20.0.51");
        expect(f.collectorCalls()).toEqual([["--version"]]);
        expect(posted).toEqual([]);
      } finally { f.cleanup(); }
    });
  }

  for (const version of ["20.0.21", "ccusage 20.0.51", "20.1.0"]) {
    it(`accepts collector version ${version}`, async () => {
      const f = fixture();
      try {
        f.set({ daily: [row], totals: {} }, { version });
        expect((await f.run()).status).toBe(0);
        expect(posted).toHaveLength(1);
      } finally { f.cleanup(); }
    });
  }

  it("fails with install guidance when the collector is missing", async () => {
    const f = fixture();
    try {
      rmSync(f.collector);
      const r = await f.run();
      expect(r.status).toBe(1);
      expect(f.read(join(f.dir, "antigravity-last-error.txt"))).toContain("ccusage@20.0.51");
      expect(posted).toEqual([]);
    } finally { f.cleanup(); }
  });

  for (const [name, result, extra] of [
    ["malformed JSON", {}, { raw: "PRIVATE NOT JSON" }],
    ["unknown top-level schema", { daily: [row], totals: {}, type: "daily", data: [], summary: {} }, {}],
    ["missing totals", { daily: [row] }, {}],
    ["more than one row", { daily: [row, { ...row, date: "2020-01-01" }], totals: {} }, {}],
    ["another day", { daily: [{ ...row, date: "2020-01-01" }], totals: {} }, {}],
    ["invalid date", { daily: [{ ...row, date: "2026-02-30" }], totals: {} }, {}],
    ["negative tokens", { daily: [{ ...row, inputTokens: -1 }], totals: {} }, {}],
    ["fractional tokens", { daily: [{ ...row, outputTokens: 1.5 }], totals: {} }, {}],
    ["missing token field", { daily: [{ ...row, cacheReadTokens: undefined }], totals: {} }, {}],
    ["totalTokens below the bucket sum", { daily: [{ ...row, totalTokens: 150 }], totals: {} }, {}],
    ["negative cost", { daily: [{ ...row, totalCost: -1 }], totals: {} }, {}],
    ["non-finite cost", { daily: [{ ...row, totalCost: null }], totals: {} }, {}],
    ["modelsUsed not an array", { daily: [{ ...row, modelsUsed: "PRIVATE gemini" }], totals: {} }, {}],
    ["modelsUsed with a non-string", { daily: [{ ...row, modelsUsed: ["gemini-3-pro", 7] }], totals: {} }, {}],
    ["collector error", {}, { fail: true }],
  ] as const) {
    it(`fails visibly without collector content for ${name}`, async () => {
      const f = fixture();
      try {
        f.set(result, extra);
        const r = await f.run();
        expect(r.status).toBe(1);
        expect(posted).toEqual([]);
        const error = f.read(join(f.dir, "antigravity-last-error.txt"));
        expect(error.length).toBeGreaterThan(10);
        expect(error + r.stderr + r.stdout).not.toContain("PRIVATE");
        expect(f.collectorCalls().map((args) => args.slice(0, 2))).toEqual([["--version"], ["antigravity", "daily"]]);
      } finally { f.cleanup(); }
    });
  }

  it("reports no usage for an empty daily array without posting a zero snapshot", async () => {
    const f = fixture();
    try {
      f.set({ daily: [], totals: {} });
      const r = await f.run();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("No Antigravity usage for today.");
      expect(posted).toEqual([]);
      expect(existsSync(join(f.dir, "antigravity-last-upload.txt"))).toBe(false);
    } finally { f.cleanup(); }
  });

  it("names unpriced models after posting the snapshot", async () => {
    const f = fixture();
    try {
      f.set({ daily: [row], totals: { unpricedModels: ["antigravity-model-77"] } });
      const r = await f.run();
      expect(r.status).toBe(0);
      expect(posted).toHaveLength(1);
      expect(r.stdout).toMatch(/antigravity-model-77.*cost estimate/);
    } finally { f.cleanup(); }
  });

  it("rejects an unknown source and an unknown flag", async () => {
    const f = fixture();
    try {
      for (const args of [["gemini"], ["--bogus"], []]) {
        const r = await f.run(args);
        expect(r.status).toBe(1);
      }
      expect(posted).toEqual([]);
    } finally { f.cleanup(); }
  });
});

describe("Antigravity reporter: isolated state", () => {
  it("replaces a buffered offline snapshot with the newer one before replaying", async () => {
    const f = fixture();
    try {
      f.set({ daily: [{ ...row, outputTokens: 100, totalTokens: 225 }], totals: {} });
      offline = true;
      const first = await f.run();
      expect(first.status).toBe(1);
      expect(existsSync(join(f.dir, "antigravity-buffer.jsonl"))).toBe(true);
      offline = false;
      posted = [];
      f.set({ daily: [{ ...row, outputTokens: 200, totalTokens: 325 }], totals: {} });
      expect((await f.run()).status).toBe(0);
      expect(posted.map((p) => (p as { output_tokens: number }).output_tokens)).toEqual([200]);
      expect(queryUsageRecords(db, {}).map((rec) => rec.output_tokens)).toEqual([200]);
      expect(existsSync(join(f.dir, "antigravity-buffer.jsonl"))).toBe(false);
    } finally { f.cleanup(); }
  });

  it("leaves every Claude and Codex file byte-identical when the Antigravity upload fails", async () => {
    const f = fixture();
    try {
      const others: Record<string, string> = {
        "buffer.jsonl": '{"pending":"claude"}\n', "codex-buffer.jsonl": '{"pending":"codex"}\n', "worker.lock": "1 2",
        "codex-worker.lock": "3 4", "last-error.txt": "claude error", "codex-last-error.txt": "codex error",
        "last-upload.txt": "5", "codex-last-upload.txt": "6", "last-flush.txt": "7", "codex-last-flush.txt": "8",
      };
      for (const [name, content] of Object.entries(others)) writeFileSync(join(f.dir, name), content);
      offline = true;
      expect((await f.run()).status).toBe(1);
      for (const [name, content] of Object.entries(others)) expect(readFileSync(join(f.dir, name), "utf8")).toBe(content);
      expect(existsSync(join(f.dir, "antigravity-buffer.jsonl"))).toBe(true);
      expect(f.read(join(f.dir, "antigravity-last-error.txt")).length).toBeGreaterThan(10);
    } finally { f.cleanup(); }
  });

  it("lets only one of two concurrent workers take the lock", async () => {
    const f = fixture();
    try {
      const pending = JSON.stringify({ ...canonical(40), date: "2026-01-02" }) + "\n";
      writeFileSync(join(f.dir, "antigravity-buffer.jsonl"), pending);
      f.set({ daily: [row], totals: {} }, { delay: 1500 });
      const holder = f.start(["--worker", "antigravity"]);
      const deadline = Date.now() + 4000;
      while (!existsSync(join(f.dir, "antigravity-worker.lock")) && Date.now() < deadline) await Bun.sleep(20);
      expect(existsSync(join(f.dir, "antigravity-worker.lock"))).toBe(true);
      const second = await f.run(["--worker", "antigravity"]);
      expect(second.stdout + second.stderr).toBe("");
      expect(readFileSync(join(f.dir, "antigravity-buffer.jsonl"), "utf8")).toBe(pending);
      expect(readFileSync(join(f.dir, "antigravity-worker.lock"), "utf8").startsWith(holder.pid + " ")).toBe(true);
      await holder.exited;
      expect(f.collectorCalls().filter((args) => args[0] === "antigravity")).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  it("reclaims a stale lock and keeps a malformed buffer intact", async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "antigravity-worker.lock"), "9999999 1");
      writeFileSync(join(f.dir, "antigravity-buffer.jsonl"), "PRIVATE BROKEN BUFFER");
      const r = await f.run();
      expect(r.status).toBe(1);
      expect(r.stderr).not.toContain("PRIVATE");
      expect(readFileSync(join(f.dir, "antigravity-buffer.jsonl"), "utf8")).toBe("PRIVATE BROKEN BUFFER");
      expect(existsSync(join(f.dir, "antigravity-worker.lock"))).toBe(false);
      expect(posted).toEqual([]);
    } finally { f.cleanup(); }
  });
});

// Antigravity 的 Stop 每輪都觸發，所以 hook 路徑一律 exit 0、stdout 恆為允許停止的那一行。
describe("Antigravity Stop hook", () => {
  const STOP_LINE = '{"decision":"stop"}\n';
  const payload = JSON.stringify({ conversationId: "c1", lastUserInput: "secret prompt",
    transcriptPath: "~/x/transcript.jsonl", fullyIdle: true });
  const traces = (f: ReturnType<typeof fixture>) => {
    const files = readdirSync(f.dir).map((name) => f.read(join(f.dir, name))).join("\n");
    return files + f.read(join(f.home, "argv.jsonl")) + f.read(join(f.home, "collector-args.jsonl")) + JSON.stringify(posted);
  };

  it("starts exactly one detached worker with only --worker antigravity and prints the stop decision", async () => {
    const f = fixture();
    try {
      f.set({ daily: [row], totals: {} }, { delay: 1500 });
      const r = await f.run(["--hook", "antigravity"], {}, payload);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(STOP_LINE);
      expect(r.stderr).toBe("");
      // hook 先結束，worker 還在跑收集器
      expect(existsSync(join(f.dir, "antigravity-last-upload.txt"))).toBe(false);
      await f.settle();
      expect(f.workerArgv()).toEqual([["--worker", "antigravity"]]);
      expect(posted).toEqual([canonical(40)]);
    } finally { f.cleanup(); }
  });

  it("never stores, forwards or prints the prompt or transcript path", async () => {
    const f = fixture();
    try {
      const r = await f.run(["--hook", "antigravity"], {}, payload);
      await f.settle();
      const all = traces(f) + r.stdout + r.stderr;
      expect(all).not.toContain("secret prompt");
      expect(all).not.toContain("transcript.jsonl");
    } finally { f.cleanup(); }
  });

  it("returns within 3 seconds for oversized stdin and still starts the worker", async () => {
    const f = fixture();
    try {
      const r = await f.run(["--hook", "antigravity"], {}, '{"pad":"' + "P".repeat(70000) + '"}');
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(STOP_LINE);
      expect(r.ms).toBeLessThan(3000);
      await f.settle();
      expect(f.workerArgv()).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  it("returns within 3 seconds when stdin stays open without data", async () => {
    const f = fixture();
    try {
      const r = await f.run(["--hook", "antigravity"], {}, "", true);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(STOP_LINE);
      expect(r.ms).toBeLessThan(3000);
      await f.settle();
      expect(f.workerArgv()).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  it("still allows Antigravity to stop when the worker cannot be started", async () => {
    const f = fixture();
    try {
      const r = await f.run(["--hook", "antigravity"], { FAIL_SPAWN: "1" }, payload);
      expect(r.status).toBe(0);
      expect(r.stdout).toBe(STOP_LINE);
      expect(r.stdout).not.toContain("continue");
      expect(r.stderr).not.toContain("PRIVATE");
      await f.quiet();
      expect(f.workerArgv()).toEqual([]);
    } finally { f.cleanup(); }
  });

  it("exits 0 without a worker for an unknown hook source", async () => {
    const f = fixture();
    try {
      const r = await f.run(["--hook", "gemini"], {}, payload);
      expect(r.status).toBe(0);
      expect(r.stdout).not.toContain("continue");
      await f.quiet();
      expect(f.workerArgv()).toEqual([]);
    } finally { f.cleanup(); }
  });
});

describe("Antigravity trigger throttle and detection", () => {
  const conversations = (f: ReturnType<typeof fixture>, root = ".gemini/antigravity-cli") =>
    mkdirSync(join(f.home, root, "conversations"), { recursive: true });

  it("does not start a second worker when another reporter triggers 2 minutes after the hook", async () => {
    const f = fixture();
    try {
      conversations(f);
      const recent = String(Date.now() - 2 * 60 * 1000);
      writeFileSync(join(f.dir, "antigravity-last-flush.txt"), recent);
      const r = await f.run(["--trigger"]);
      expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
      await f.quiet();
      expect(f.workerArgv()).toEqual([]);
      expect(f.read(join(f.dir, "antigravity-last-flush.txt"))).toBe(recent);
    } finally { f.cleanup(); }
  });

  it("shares one throttle between the hook and the trigger", async () => {
    const f = fixture();
    try {
      conversations(f);
      expect((await f.run(["--hook", "antigravity"], {}, payload())).status).toBe(0);
      expect((await f.run(["--trigger"])).status).toBe(0);
      await f.settle();
      await f.quiet();
      expect(f.workerArgv()).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  it("treats a future timestamp as stale, starts the worker and overwrites it", async () => {
    const f = fixture();
    try {
      const future = Date.now() + 60 * 60 * 1000;
      writeFileSync(join(f.dir, "antigravity-last-flush.txt"), String(future));
      expect((await f.run(["--hook", "antigravity"], {}, payload())).stdout).toBe('{"decision":"stop"}\n');
      await f.settle();
      expect(f.workerArgv()).toHaveLength(1);
      const written = Number(f.read(join(f.dir, "antigravity-last-flush.txt")));
      expect(written).not.toBe(future);
      expect(Math.abs(Date.now() - written)).toBeLessThan(60000);
    } finally { f.cleanup(); }
  });

  it("lets manual sync ignore the throttle and leave the flush file unchanged", async () => {
    const f = fixture();
    try {
      const recent = String(Date.now() - 60 * 1000);
      writeFileSync(join(f.dir, "antigravity-last-flush.txt"), recent);
      const r = await f.run(["antigravity"]);
      expect(r.status).toBe(0);
      expect(posted).toHaveLength(1);
      expect(f.read(join(f.dir, "antigravity-last-flush.txt"))).toBe(recent);
    } finally { f.cleanup(); }
  });

  it("does not create the flush file during manual sync", async () => {
    const f = fixture();
    try {
      expect((await f.run(["antigravity"])).status).toBe(0);
      expect(existsSync(join(f.dir, "antigravity-last-flush.txt"))).toBe(false);
    } finally { f.cleanup(); }
  });

  for (const root of [".gemini/antigravity-cli", ".gemini/antigravity-ide", ".config/antigravity"]) {
    it(`starts one worker when ${root}/conversations exists`, async () => {
      const f = fixture();
      try {
        conversations(f, root);
        const r = await f.run(["--trigger"]);
        expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
        await f.settle();
        expect(f.workerArgv()).toEqual([["--worker", "antigravity"]]);
        expect(posted).toHaveLength(1);
      } finally { f.cleanup(); }
    });
  }

  it("starts a worker when ANTIGRAVITY_DATA_DIR is set", async () => {
    const f = fixture();
    try {
      const r = await f.run(["--trigger"], { ANTIGRAVITY_DATA_DIR: join(f.home, "custom agy") });
      expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
      await f.settle();
      expect(f.workerArgv()).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  for (const [name, prepare] of [
    ["only a leftover bin directory", (f: ReturnType<typeof fixture>) => mkdirSync(join(f.home, ".gemini/antigravity/bin"), { recursive: true })],
    ["no Antigravity directory", () => {}],
    ["an empty ANTIGRAVITY_DATA_DIR", () => {}],
  ] as const) {
    it(`starts nothing and creates no antigravity-* file with ${name}`, async () => {
      const f = fixture();
      try {
        prepare(f);
        const r = await f.run(["--trigger"], name.startsWith("an empty") ? { ANTIGRAVITY_DATA_DIR: "" } : {});
        expect(r).toMatchObject({ status: 0, stdout: "", stderr: "" });
        await f.quiet();
        expect(f.workerArgv()).toEqual([]);
        expect(f.agyFiles()).toEqual([]);
        expect(f.collectorCalls()).toEqual([]);
      } finally { f.cleanup(); }
    });
  }

  function payload() {
    return JSON.stringify({ conversationId: "c2", lastUserInput: "secret prompt", fullyIdle: true });
  }
});
