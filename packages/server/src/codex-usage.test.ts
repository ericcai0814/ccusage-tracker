import { describe, expect, it } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const node = Bun.which("node")!;
const script = join(import.meta.dir, "hook-scripts/codex-sync.mjs");
const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei" }).format(new Date());
const row = { date: today, inputTokens: 600, cacheReadTokens: 400, cacheCreationTokens: 0, outputTokens: 200,
  reasoningOutputTokens: 50, totalTokens: 1200, costUSD: 0.25, models: { "gpt-5": {} } };

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "tracker codex "));
  const dir = join(home, ".config/ccusage-tracker");
  const bin = join(home, "bin space");
  mkdirSync(dir, { recursive: true });
  mkdirSync(bin);
  const collector = join(bin, "ccusage");
  writeFileSync(collector, `#!${node}\nimport fs from 'node:fs';
const f = JSON.parse(fs.readFileSync(process.env.HOME + '/fixture.json', 'utf8'));
fs.appendFileSync(process.env.HOME + '/collector-args.jsonl', JSON.stringify(process.argv.slice(2)) + '\\n');
if(process.argv.includes('--version')) { console.log(f.version ?? '20.0.20'); process.exit(0); }
if(f.delay) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, f.delay);
if(f.fail) { console.error('PRIVATE COLLECTOR CONTENT'); process.exit(1); }
console.log(f.raw ?? JSON.stringify(f.result));\n`, { mode: 0o755 });
  writeFileSync(join(home, "mock.mjs"), `import fs from 'node:fs'; import { syncBuiltinESMExports } from 'node:module';
fs.appendFileSync(process.env.HOME + '/argv.jsonl', JSON.stringify(process.argv.slice(1)) + '\\n');
if(process.env.REPLACE_STALE_OWNER) {
 const originalRead = fs.readFileSync; let replaced = false;
 fs.readFileSync = (file,...args) => { const result = originalRead(file,...args);
  if(!replaced && String(file).endsWith('/codex-worker.lock')) { replaced=true; fs.writeFileSync(file,process.env.REPLACE_STALE_OWNER + ' ' + Date.now()); }
  return result;
 }; syncBuiltinESMExports();
}
globalThis.fetch = async (url, options) => {
fs.appendFileSync(process.env.HOME + '/requests.jsonl', JSON.stringify({url, body: JSON.parse(options.body)}) + '\\n');
return { status: fs.existsSync(process.env.HOME + '/offline') ? 503 : 200 };
};\n`);
  writeFileSync(join(dir, "config.json"), JSON.stringify({ server_url: "http://127.0.0.1:12345", team_key: "fixture-only", member_name: "test" }));
  const set = (result: unknown, other: Record<string, unknown> = {}) => writeFileSync(join(home, "fixture.json"), JSON.stringify({ result, ...other }));
  set({ daily: [row], totals: {} });
  const run = (args: string[] = [], extra: Record<string, string> = {}, input?: string) => spawnSync(node, ["--import", join(home, "mock.mjs"), script, ...args], {
    env: { HOME: home, CODEX_HOME: join(home, "codex"), CLAUDE_CONFIG_DIR: join(home, "claude"), PATH: bin, TZ: "Asia/Taipei", ...extra },
    cwd: home, encoding: "utf8", timeout: 10000, ...(input === undefined ? {} : { input }),
  });
  const requests = () => existsSync(join(home, "requests.jsonl")) ? readFileSync(join(home, "requests.jsonl"), "utf8").trim().split("\n").map((s) => JSON.parse(s)) : [];
  const read = (name: string) => existsSync(join(home, name)) ? readFileSync(join(home, name), "utf8") : "";
  // worker 是 detached 的，所以判斷「有沒有啟動」要等它留下痕跡，而不是看父程序。
  const settle = async (deadlineMs = 4000) => {
    const deadline = Date.now() + deadlineMs;
    while ((!existsSync(join(dir, "codex-last-upload.txt")) || existsSync(join(dir, "codex-worker.lock"))) && Date.now() < deadline) {
      await Bun.sleep(30);
    }
  };
  // 反證「沒有啟動 worker」必須等一段時間：detached worker 要先把 node 開起來，
  // 立刻斷言等於每次都通過，測不到真正的回歸。
  const quiet = () => Bun.sleep(700);
  const workerEnv = { NODE_OPTIONS: '--import "' + join(home, "mock.mjs") + '"' };
  return { home, dir, collector, set, run, requests, read, settle, quiet, workerEnv, cleanup: () => rmSync(home, { recursive: true, force: true }) };
}

describe("Codex reporter executed by Node in an isolated HOME", () => {
  it("accepts a schema-compatible 20.0.21 patch fixture (synthetic) with explicit Codex selection", () => {
    const f = fixture();
    try {
      f.set({ daily: [row], totals: {} }, { version: "ccusage 20.0.21" });
      expect(f.run().status).toBe(0);
      expect(f.requests().map((r) => r.body)).toEqual([{ member_name: "test", date: today, session_id: "codex-daily",
        input_tokens: 600, output_tokens: 200, cache_creation_tokens: 0, cache_read_tokens: 400, total_cost_usd: 0.25, models: ["gpt-5"] }]);
      expect(readFileSync(join(f.home, "collector-args.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line))).toEqual([
        ["--version"], ["codex", "daily", "--json", "--since", today.replaceAll("-", ""), "--until", today.replaceAll("-", ""), "--timezone", "Asia/Taipei"],
      ]);
    } finally { f.cleanup(); }
  });

  for (const extra of [
    { raw: "invalid JSON" },
    { result: { daily: [row], totals: {}, type: "daily", data: [], summary: {} } },
    { result: { daily: [{ ...row, costUSD: undefined, totalCost: 0.25, modelsUsed: ["claude-sonnet"] }], totals: {} } },
    { result: { daily: [{ ...row, inputTokens: -1 }], totals: {} } },
    { fail: true },
  ]) it("rejects incompatible synthetic 20.0.21 Codex output without falling back to unified daily", () => {
    const f = fixture();
    try {
      f.set({ daily: [row], totals: {} }, { version: "20.0.21", ...extra });
      expect(f.run().status).toBe(1);
      expect(f.requests()).toEqual([]);
      expect(existsSync(join(f.dir, "codex-last-error.txt"))).toBe(true);
      expect(readFileSync(join(f.home, "collector-args.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line).slice(0, 2))).toEqual([["--version"], ["codex", "daily"]]);
    } finally { f.cleanup(); }
  });

  it("reports canonical cache/reasoning tokens with no Claude and paths containing spaces", () => {
    const f = fixture();
    try {
      const result = f.run();
      expect(result.status).toBe(0);
      expect(f.requests().map((r) => r.body)).toEqual([{ member_name: "test", date: today, session_id: "codex-daily",
        input_tokens: 600, output_tokens: 200, cache_creation_tokens: 0, cache_read_tokens: 400, total_cost_usd: 0.25, models: ["gpt-5"] }]);
      expect(existsSync(join(f.dir, "codex-last-upload.txt"))).toBe(true);
      const args = readFileSync(join(f.home, "collector-args.jsonl"), "utf8");
      expect(args).toContain('"--timezone","Asia/Taipei"');
      expect(args).toContain('"codex","daily"');
    } finally { f.cleanup(); }
  });

  it("coalesces stale offline snapshots before sending and leaves Claude files untouched", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "buffer.jsonl"), "Claude pending\n");
      writeFileSync(join(f.dir, "worker.lock"), "Claude lock");
      writeFileSync(join(f.home, "offline"), "yes");
      expect(f.run().status).toBe(1);
      expect(existsSync(join(f.dir, "codex-buffer.jsonl"))).toBe(true);
      rmSync(join(f.home, "offline"));
      f.set({ daily: [{ ...row, inputTokens: 1600, totalTokens: 2200 }], totals: {} });
      expect(f.run().status).toBe(0);
      const sent = f.requests().map((r) => r.body.input_tokens);
      expect(sent.at(-1)).toBe(1600);
      expect(sent.slice(1)).not.toContain(600);
      expect(existsSync(join(f.dir, "codex-buffer.jsonl"))).toBe(false);
      expect(readFileSync(join(f.dir, "buffer.jsonl"), "utf8")).toBe("Claude pending\n");
      expect(readFileSync(join(f.dir, "worker.lock"), "utf8")).toBe("Claude lock");
    } finally { f.cleanup(); }
  });

  for (const [name, result, extra] of [
    ["invalid JSON", {}, { raw: "PRIVATE NOT JSON" }],
    ["unknown unified output", { type: "daily", data: [row], summary: {} }, {}],
    ["negative tokens", { daily: [{ ...row, inputTokens: -1 }], totals: {} }, {}],
    ["fractional tokens", { daily: [{ ...row, outputTokens: 1.5 }], totals: {} }, {}],
    ["missing token field", { daily: [{ ...row, cacheReadTokens: undefined }], totals: {} }, {}],
    ["invalid cache", { daily: [{ ...row, cacheReadTokens: -1 }], totals: {} }, {}],
    ["invalid reasoning", { daily: [{ ...row, reasoningOutputTokens: 201 }], totals: {} }, {}],
    ["invalid cost", { daily: [{ ...row, costUSD: null }], totals: {} }, {}],
    ["invalid date", { daily: [{ ...row, date: "2026-02-30" }], totals: {} }, {}],
    ["wrong day", { daily: [{ ...row, date: "2020-01-01" }], totals: {} }, {}],
    ["unknown version", { daily: [row], totals: {} }, { version: "99.0.0" }],
    ["collector error", {}, { fail: true }],
  ] as const) {
    it(`fails visibly without content for ${name}`, () => {
      const f = fixture();
      try {
        f.set(result, extra);
        const r = f.run();
        expect(r.status).toBe(1);
        expect(f.requests()).toEqual([]);
        const error = readFileSync(join(f.dir, "codex-last-error.txt"), "utf8");
        expect(error.length).toBeGreaterThan(10);
        expect(error + r.stderr + r.stdout).not.toContain("PRIVATE");
      } finally { f.cleanup(); }
    });
  }

  it("does not fabricate zero usage for an empty verified daily array", () => {
    const f = fixture();
    try {
      f.set({ daily: [], totals: {} });
      const r = f.run();
      expect(r.status).toBe(0);
      expect(r.stdout).toContain("No Codex usage");
      expect(f.requests()).toEqual([]);
      expect(existsSync(join(f.dir, "codex-last-upload.txt"))).toBe(false);
    } finally { f.cleanup(); }
  });

  it("diagnoses missing collector and config", () => {
    const f = fixture();
    try {
      rmSync(f.collector);
      expect(f.run().status).toBe(1);
      expect(readFileSync(join(f.dir, "codex-last-error.txt"), "utf8")).toContain("ccusage");
      rmSync(join(f.dir, "config.json"));
      expect(f.run().status).toBe(1);
      expect(f.requests()).toEqual([]);
    } finally { f.cleanup(); }
  });

  it("ignores other notifications without reading configuration or persisting payload", () => {
    const f = fixture();
    try {
      rmSync(join(f.dir, "config.json"));
      const r = f.run(["--notify", JSON.stringify({ type: "other-event", "input-messages": ["PRIVATE PROMPT"] })]);
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).toBe("");
      expect(existsSync(join(f.home, "collector-args.jsonl"))).toBe(false);
      expect(f.requests()).toEqual([]);
    } finally { f.cleanup(); }
  });

  it("does not overwrite an active lock or modify pending data", () => {
    const f = fixture();
    try {
      const lock = process.pid + " " + Date.now();
      writeFileSync(join(f.dir, "codex-worker.lock"), lock);
      writeFileSync(join(f.dir, "codex-buffer.jsonl"), "existing pending data");
      expect(f.run().status).toBe(1);
      expect(readFileSync(join(f.dir, "codex-worker.lock"), "utf8")).toBe(lock);
      expect(readFileSync(join(f.dir, "codex-buffer.jsonl"), "utf8")).toBe("existing pending data");
      expect(f.requests()).toEqual([]);
    } finally { f.cleanup(); }
  });

  it("reclaims stale locks and rejects malformed buffers without destroying them", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "codex-worker.lock"), "9999999 1");
      writeFileSync(join(f.dir, "codex-buffer.jsonl"), "PRIVATE BROKEN BUFFER");
      const r = f.run();
      expect(r.status).toBe(1);
      expect(r.stderr).not.toContain("PRIVATE");
      expect(readFileSync(join(f.dir, "codex-buffer.jsonl"), "utf8")).toBe("PRIVATE BROKEN BUFFER");
      expect(existsSync(join(f.dir, "codex-worker.lock"))).toBe(false);
      expect(f.requests()).toEqual([]);
    } finally { f.cleanup(); }
  });

  it("runs completion notifications in a worker without passing or persisting content", async () => {
    const f = fixture();
    try {
      const r = f.run(["--notify", JSON.stringify({ type: "agent-turn-complete", "input-messages": ["PRIVATE PROMPT"], "last-assistant-message": "PRIVATE ANSWER" })],
        { NODE_OPTIONS: '--import "' + join(f.home, "mock.mjs") + '"' });
      expect(r.status).toBe(0);
      expect(r.stdout + r.stderr).toBe("");
      const deadline = Date.now() + 4000;
      while ((!existsSync(join(f.dir, "codex-last-upload.txt")) || existsSync(join(f.dir, "codex-worker.lock"))) && Date.now() < deadline) await Bun.sleep(30);
      expect(f.requests()).toHaveLength(1);
      expect(JSON.stringify(f.requests()) + readFileSync(join(f.home, "collector-args.jsonl"), "utf8")).not.toContain("PRIVATE");
      expect(existsSync(join(f.dir, "codex-last-error.txt"))).toBe(false);
    } finally { f.cleanup(); }
  });

  it("rechecks stale ownership before recovery so a new owner's lock survives", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "codex-worker.lock"), "9999999 1");
      const r = f.run([], { REPLACE_STALE_OWNER: String(process.pid) });
      expect(r.status).toBe(1);
      expect(f.requests()).toEqual([]);
      expect(readFileSync(join(f.dir, "codex-worker.lock"), "utf8").startsWith(process.pid + " ")).toBe(true);
    } finally { f.cleanup(); }
  });

  it("fails visibly when a recovery guard remains and preserves all pending data", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "codex-worker.lock"), "9999999 1");
      writeFileSync(join(f.dir, "codex-worker.lock.reclaim"), "leftover guard");
      writeFileSync(join(f.dir, "codex-buffer.jsonl"), "pending unchanged");
      expect(f.run().status).toBe(1);
      expect(readFileSync(join(f.dir, "codex-last-error.txt"), "utf8")).toContain("codex-worker.lock.reclaim");
      expect(readFileSync(join(f.dir, "codex-buffer.jsonl"), "utf8")).toBe("pending unchanged");
      expect(f.requests()).toEqual([]);
    } finally { f.cleanup(); }
  });

  it("cannot acquire a fresh lock while another acquisition holds the guard", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "codex-worker.lock.reclaim"), "other acquisition");
      const r = f.run();
      expect(r.status).toBe(1);
      expect(f.requests()).toEqual([]);
      expect(existsSync(join(f.dir, "codex-worker.lock"))).toBe(false);
      expect(readFileSync(join(f.dir, "codex-worker.lock.reclaim"), "utf8")).toBe("other acquisition");
    } finally { f.cleanup(); }
  });
});

// Codex hooks 每輪對話都會觸發 Stop，所以這條路徑的預設必須是「安靜地什麼都不做」：
// 任何讀取、解析或驗證失敗都 exit 0 且不留錯誤檔，否則使用者每講一句話就多一行噪音。
describe("Codex hook 進入點", () => {
  const stopPayload = JSON.stringify({
    hook_event_name: "Stop", session_id: "s1", cwd: "/tmp", stop_hook_active: false,
    transcript_path: "/PRIVATE/transcript.jsonl", message: "PRIVATE PROMPT",
  });

  for (const event of ["Stop", "SessionEnd"]) {
    it(`${event} 事件啟動一次背景 worker，且不轉交 payload 內容`, async () => {
      const f = fixture();
      try {
        const r = f.run(["--hook"], f.workerEnv, JSON.stringify({
          hook_event_name: event, session_id: "s1", cwd: "/tmp",
          transcript_path: "/PRIVATE/transcript.jsonl", message: "PRIVATE PROMPT",
        }));
        expect(r.status).toBe(0);
        expect(r.stdout + r.stderr).toBe("");
        await f.settle();
        expect(f.requests()).toHaveLength(1);
        const traces = JSON.stringify(f.requests()) + f.read("collector-args.jsonl") + f.read("argv.jsonl") +
          (existsSync(join(f.dir, "codex-buffer.jsonl")) ? readFileSync(join(f.dir, "codex-buffer.jsonl"), "utf8") : "");
        expect(traces).not.toContain("PRIVATE");
        expect(existsSync(join(f.dir, "codex-last-error.txt"))).toBe(false);
      } finally { f.cleanup(); }
    });
  }

  it("其他事件不啟動 worker，也不讀設定", async () => {
    const f = fixture();
    try {
      rmSync(join(f.dir, "config.json"));
      const r = f.run(["--hook"], f.workerEnv, JSON.stringify({ hook_event_name: "UserPromptSubmit", message: "PRIVATE PROMPT" }));
      expect(r.status).toBe(0);
      await f.quiet();
      expect(r.stdout + r.stderr).toBe("");
      expect(existsSync(join(f.home, "collector-args.jsonl"))).toBe(false);
      expect(f.requests()).toEqual([]);
      expect(existsSync(join(f.dir, "codex-last-error.txt"))).toBe(false);
    } finally { f.cleanup(); }
  });

  for (const [name, input] of [
    ["非 JSON", "not json at all"],
    ["空輸入", ""],
    ["缺 hook_event_name", '{"session_id":"s1"}'],
    ["超過 64 KB", '{"hook_event_name":"Stop","pad":"' + "P".repeat(70000) + '"}'],
  ] as const) {
    it(`${name} → exit 0、不啟動 worker、不寫錯誤檔`, async () => {
      const f = fixture();
      try {
        const r = f.run(["--hook"], f.workerEnv, input);
        expect(r.status).toBe(0);
        expect(r.stdout + r.stderr).toBe("");
        await f.quiet();
        expect(existsSync(join(f.home, "collector-args.jsonl"))).toBe(false);
        expect(existsSync(join(f.dir, "codex-last-error.txt"))).toBe(false);
        expect(f.requests()).toEqual([]);
      } finally { f.cleanup(); }
    });
  }

  it("hook 觸發前先檢查 5 分鐘 throttle：窗內第二次不啟動 worker", async () => {
    const f = fixture();
    try {
      const recent = String(Date.now() - 2 * 60 * 1000);
      writeFileSync(join(f.dir, "codex-last-flush.txt"), recent);

      const r = f.run(["--hook"], f.workerEnv, stopPayload);

      expect(r.status).toBe(0);
      await f.quiet();
      expect(existsSync(join(f.home, "collector-args.jsonl"))).toBe(false);
      expect(f.requests()).toEqual([]);
      // 被 throttle 擋下時不重寫時間戳，否則反覆觸發會把窗口無限延後
      expect(readFileSync(join(f.dir, "codex-last-flush.txt"), "utf8")).toBe(recent);
    } finally { f.cleanup(); }
  });

  it("throttle 過期後再次觸發：先寫時間戳再啟動 worker", async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "codex-last-flush.txt"), String(Date.now() - 6 * 60 * 1000));

      const r = f.run(["--hook"], f.workerEnv, stopPayload);

      expect(r.status).toBe(0);
      await f.settle();
      expect(f.requests()).toHaveLength(1);
      expect(Date.now() - Number(readFileSync(join(f.dir, "codex-last-flush.txt"), "utf8"))).toBeLessThan(60000);
    } finally { f.cleanup(); }
  });

  it("時間戳落在未來不算節流中：照常啟動 worker 並覆寫成現在時間", async () => {
    // 系統時鐘往前跳後校回、或 ~/.config 在兩台不同步的機器間同步，都會留下未來時間。
    // `now - last` 為負恆小於 THROTTLE_MS，舊寫法會無限期擋掉上報且無任何輸出。
    const f = fixture();
    try {
      const future = String(Date.now() + 60 * 60 * 1000);
      writeFileSync(join(f.dir, "codex-last-flush.txt"), future);

      const r = f.run(["--hook"], f.workerEnv, stopPayload);

      expect(r.status).toBe(0);
      await f.settle();
      expect(f.requests()).toHaveLength(1);
      const written = Number(readFileSync(join(f.dir, "codex-last-flush.txt"), "utf8"));
      expect(written).not.toBe(Number(future));
      expect(Date.now() - written).toBeLessThan(60000);
    } finally { f.cleanup(); }
  });

  it("notify 相容路徑套用同一個 throttle（hook 與 notify 同時設定時不會重複上報）", async () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "codex-last-flush.txt"), String(Date.now() - 60 * 1000));

      const r = f.run(["--notify", JSON.stringify({ type: "agent-turn-complete", "input-messages": ["PRIVATE PROMPT"] })], f.workerEnv);

      expect(r.status).toBe(0);
      await f.quiet();
      expect(existsSync(join(f.home, "collector-args.jsonl"))).toBe(false);
      expect(f.requests()).toEqual([]);
    } finally { f.cleanup(); }
  });

  it("手動 sync codex 不受 throttle 限制", () => {
    const f = fixture();
    try {
      writeFileSync(join(f.dir, "codex-last-flush.txt"), String(Date.now()));

      const r = f.run();

      expect(r.status).toBe(0);
      expect(r.stdout).toContain("Codex usage synced.");
      expect(f.requests()).toHaveLength(1);
    } finally { f.cleanup(); }
  });

  it("未知旗標仍然明確失敗，不被當成 hook 靜默吞掉", () => {
    const f = fixture();
    try {
      const r = f.run(["--bogus"]);
      expect(r.status).toBe(1);
      expect(f.requests()).toEqual([]);
    } finally { f.cleanup(); }
  });
});
