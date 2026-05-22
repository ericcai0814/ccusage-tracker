import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionEndCommand } from "./session-end";

const FIXED_NOW = new Date("2026-05-22T10:00:00.000Z");

function writeConfig(configDir: string, cfg: Record<string, unknown>): void {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, "config.json"), JSON.stringify(cfg));
}

describe("sessionEndCommand", () => {
  let configDir: string;
  let bufferPath: string;
  let prevDebug: string | undefined;

  beforeEach(() => {
    configDir = mkdtempSync(join(tmpdir(), "ccusage-sessionend-"));
    bufferPath = join(configDir, "buffer.jsonl");
    prevDebug = process.env.CCUSAGE_TRACKER_DEBUG;
    delete process.env.CCUSAGE_TRACKER_DEBUG;
  });

  afterEach(() => {
    rmSync(configDir, { recursive: true, force: true });
    if (prevDebug !== undefined) process.env.CCUSAGE_TRACKER_DEBUG = prevDebug;
    else delete process.env.CCUSAGE_TRACKER_DEBUG;
  });

  function makeFetch(response: { status?: number; throws?: Error }): typeof fetch {
    return vi.fn().mockImplementation(async () => {
      if (response.throws) throw response.throws;
      return new Response("{}", { status: response.status ?? 200 });
    }) as unknown as typeof fetch;
  }

  it("exits without action when config file is missing", async () => {
    const fetchFn = vi.fn() as unknown as typeof fetch;
    await sessionEndCommand({
      readStdin: async () => "",
      configDir,
      fetch: fetchFn,
      now: () => FIXED_NOW,
      runCcusageDaily: vi.fn(),
      replayBuffer: vi.fn(),
      appendToBuffer: vi.fn(),
      extractSessionMetrics: vi.fn(),
    });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("posts daily totals to /api/ingest on 200 OK", async () => {
    writeConfig(configDir, { server_url: "https://srv.test", team_key: "t1", member_name: "alice" });
    const fetchFn = makeFetch({ status: 200 });
    const appendToBuffer = vi.fn();

    const t0 = Date.now();
    await sessionEndCommand({
      readStdin: async () => "",
      configDir,
      fetch: fetchFn,
      now: () => FIXED_NOW,
      runCcusageDaily: vi.fn().mockResolvedValue({
        inputTokens: 10, outputTokens: 20, cacheCreationTokens: 5, cacheReadTokens: 2, totalCost: 0.01,
      }),
      replayBuffer: vi.fn().mockResolvedValue({ retried: 0, succeeded: 0, remaining: 0, expired: 0 }),
      appendToBuffer,
      extractSessionMetrics: vi.fn(),
    });
    const elapsedMs = Date.now() - t0;

    expect(fetchFn).toHaveBeenCalled();
    const call = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("https://srv.test/api/ingest");
    expect(call[1].method).toBe("POST");
    const body = JSON.parse(call[1].body);
    expect(body).toMatchObject({
      member_name: "alice",
      session_id: "daily",
      input_tokens: 10,
      output_tokens: 20,
      cache_creation_tokens: 5,
      cache_read_tokens: 2,
      total_cost_usd: 0.01,
      models: [],
    });
    expect(appendToBuffer).not.toHaveBeenCalled();
    // Common case: returns well under 1 second
    expect(elapsedMs).toBeLessThan(1000);
  });

  it("buffers payload when server returns 500", async () => {
    writeConfig(configDir, { server_url: "https://srv.test", team_key: "t1", member_name: "alice" });
    const fetchFn = makeFetch({ status: 500 });
    const appendToBuffer = vi.fn();

    await sessionEndCommand({
      readStdin: async () => "",
      configDir,
      fetch: fetchFn,
      now: () => FIXED_NOW,
      runCcusageDaily: vi.fn().mockResolvedValue({
        inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0,
      }),
      replayBuffer: vi.fn().mockResolvedValue({ retried: 0, succeeded: 0, remaining: 0, expired: 0 }),
      appendToBuffer,
      extractSessionMetrics: vi.fn(),
    });

    expect(appendToBuffer).toHaveBeenCalledTimes(1);
    const buffered = (appendToBuffer as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(buffered).toMatchObject({ member_name: "alice", session_id: "daily" });
  });

  it("buffers payload when fetch throws (network/timeout)", async () => {
    writeConfig(configDir, { server_url: "https://srv.test", team_key: "t1", member_name: "alice" });
    const fetchFn = makeFetch({ throws: Object.assign(new Error("timeout"), { name: "TimeoutError" }) });
    const appendToBuffer = vi.fn();

    await sessionEndCommand({
      readStdin: async () => "",
      configDir,
      fetch: fetchFn,
      now: () => FIXED_NOW,
      runCcusageDaily: vi.fn().mockResolvedValue({
        inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0,
      }),
      replayBuffer: vi.fn().mockResolvedValue({ retried: 0, succeeded: 0, remaining: 0, expired: 0 }),
      appendToBuffer,
      extractSessionMetrics: vi.fn(),
    });

    expect(appendToBuffer).toHaveBeenCalledTimes(1);
  });

  it("skips daily POST when ccusage returns null (not installed)", async () => {
    writeConfig(configDir, { server_url: "https://srv.test", team_key: "t1", member_name: "alice" });
    const fetchFn = makeFetch({ status: 200 });

    await sessionEndCommand({
      readStdin: async () => "",
      configDir,
      fetch: fetchFn,
      now: () => FIXED_NOW,
      runCcusageDaily: vi.fn().mockResolvedValue(null),
      replayBuffer: vi.fn().mockResolvedValue({ retried: 0, succeeded: 0, remaining: 0, expired: 0 }),
      appendToBuffer: vi.fn(),
      extractSessionMetrics: vi.fn(),
    });

    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("sends session metrics POST to /api/ingest/session when transcript_path present", async () => {
    writeConfig(configDir, { server_url: "https://srv.test", team_key: "t1", member_name: "alice" });
    const fetchFn = makeFetch({ status: 200 });

    await sessionEndCommand({
      readStdin: async () => JSON.stringify({ session_id: "sess-1", transcript_path: "/tmp/whatever.jsonl" }),
      configDir,
      fetch: fetchFn,
      now: () => FIXED_NOW,
      runCcusageDaily: vi.fn().mockResolvedValue({
        inputTokens: 1, outputTokens: 1, cacheCreationTokens: 0, cacheReadTokens: 0, totalCost: 0,
      }),
      replayBuffer: vi.fn().mockResolvedValue({ retried: 0, succeeded: 0, remaining: 0, expired: 0 }),
      appendToBuffer: vi.fn(),
      extractSessionMetrics: vi.fn().mockReturnValue({
        session_id: "sess-1",
        session_name: "x",
        project: "ccusage-tracker",
        branch: "main",
        turns: 1,
        user_messages: 1,
        assistant_messages: 1,
        user_avg_chars: 5,
        tool_calls: {},
        tool_call_total: 0,
        tool_errors: 0,
        started_at: "",
        ended_at: "",
        duration_minutes: 0,
        has_commit: false,
        files_read: 0,
        files_written: 0,
        files_edited: 0,
        skills_invoked: [],
        hook_blocks: 0,
        approx_tokens: 20000,
      }),
    });

    // First call is daily ingest; second is session metrics
    const calls = (fetchFn as unknown as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBe(2);
    const sessionCall = calls.find((c) => c[0] === "https://srv.test/api/ingest/session");
    expect(sessionCall).toBeDefined();
    const sessionBody = JSON.parse(sessionCall![1].body);
    expect(sessionBody.member_name).toBe("alice");
    expect(sessionBody.context_estimate_pct).toBe(10); // 20000/200000 = 10%
    expect(sessionBody.approx_tokens).toBeUndefined();
  });

  it("suppresses stack traces unless CCUSAGE_TRACKER_DEBUG=1", async () => {
    writeConfig(configDir, { server_url: "https://srv.test", team_key: "t1", member_name: "alice" });
    const errors: string[] = [];
    const originalError = console.error;
    console.error = ((...args: unknown[]) => { errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(" ")); }) as typeof console.error;

    try {
      // Force a throw inside runSessionEnd by making readStdin throw
      await sessionEndCommand({
        readStdin: async () => { throw new Error("boom"); },
        configDir,
        fetch: vi.fn() as unknown as typeof fetch,
        now: () => FIXED_NOW,
        runCcusageDaily: vi.fn(),
        replayBuffer: vi.fn(),
        appendToBuffer: vi.fn(),
        extractSessionMetrics: vi.fn(),
      });
      expect(errors).toHaveLength(0);

      process.env.CCUSAGE_TRACKER_DEBUG = "1";
      await sessionEndCommand({
        readStdin: async () => { throw new Error("boom2"); },
        configDir,
        fetch: vi.fn() as unknown as typeof fetch,
        now: () => FIXED_NOW,
        runCcusageDaily: vi.fn(),
        replayBuffer: vi.fn(),
        appendToBuffer: vi.fn(),
        extractSessionMetrics: vi.fn(),
      });
      expect(errors.join("\n")).toContain("boom2");
    } finally {
      console.error = originalError;
    }
  });
});
