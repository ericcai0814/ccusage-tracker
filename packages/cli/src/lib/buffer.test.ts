import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { replayBuffer, appendToBuffer } from "./buffer";

const FIXED_NOW = new Date("2026-05-22T18:00:00.000Z");

describe("replayBuffer", () => {
  let tempDir: string;
  let bufferPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ccusage-buffer-"));
    bufferPath = join(tempDir, "buffer.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns zeros when buffer file does not exist", async () => {
    const post = vi.fn();
    const result = await replayBuffer({ bufferPath, postIngest: post, now: () => FIXED_NOW });
    expect(result).toEqual({ retried: 0, succeeded: 0, remaining: 0, expired: 0 });
    expect(post).not.toHaveBeenCalled();
  });

  it("retries entries within 7-day window and removes successfully-sent ones", async () => {
    writeFileSync(bufferPath, [
      JSON.stringify({ x: 1, _buffered_at: "2026-05-22T10:00:00.000Z" }),
      JSON.stringify({ x: 2, _buffered_at: "2026-05-20T10:00:00.000Z" }),
    ].join("\n"));

    const post = vi.fn().mockResolvedValue({ ok: true });
    const result = await replayBuffer({ bufferPath, postIngest: post, now: () => FIXED_NOW });

    expect(result.retried).toBe(2);
    expect(result.succeeded).toBe(2);
    expect(result.remaining).toBe(0);
    expect(existsSync(bufferPath)).toBe(false);
  });

  it("drops entries older than 7 days without sending", async () => {
    writeFileSync(bufferPath, [
      JSON.stringify({ x: 1, _buffered_at: "2026-05-15T09:00:00.000Z" }), // > 7 days old
      JSON.stringify({ x: 2, _buffered_at: "2026-05-22T10:00:00.000Z" }), // recent
    ].join("\n"));

    const post = vi.fn().mockResolvedValue({ ok: true });
    const result = await replayBuffer({ bufferPath, postIngest: post, now: () => FIXED_NOW });

    expect(result.expired).toBe(1);
    expect(result.retried).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("drops entries with missing _buffered_at", async () => {
    writeFileSync(bufferPath, JSON.stringify({ x: 1 }));

    const post = vi.fn().mockResolvedValue({ ok: true });
    const result = await replayBuffer({ bufferPath, postIngest: post, now: () => FIXED_NOW });

    expect(result.expired).toBe(1);
    expect(result.retried).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it("retains entries when POST returns ok:false", async () => {
    writeFileSync(bufferPath, JSON.stringify({ x: 1, _buffered_at: "2026-05-22T10:00:00.000Z" }));

    const post = vi.fn().mockResolvedValue({ ok: false });
    const result = await replayBuffer({ bufferPath, postIngest: post, now: () => FIXED_NOW });

    expect(result.retried).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(result.remaining).toBe(1);
    expect(existsSync(bufferPath)).toBe(true);
    const lines = readFileSync(bufferPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(1);
  });

  it("retains entries when POST throws", async () => {
    writeFileSync(bufferPath, JSON.stringify({ x: 1, _buffered_at: "2026-05-22T10:00:00.000Z" }));

    const post = vi.fn().mockRejectedValue(new Error("network"));
    const result = await replayBuffer({ bufferPath, postIngest: post, now: () => FIXED_NOW });

    expect(result.remaining).toBe(1);
  });

  it("stops processing when total time budget is exceeded; remaining entries kept untouched", async () => {
    writeFileSync(bufferPath, [
      JSON.stringify({ x: 1, _buffered_at: "2026-05-22T10:00:00.000Z" }),
      JSON.stringify({ x: 2, _buffered_at: "2026-05-22T10:00:00.000Z" }),
      JSON.stringify({ x: 3, _buffered_at: "2026-05-22T10:00:00.000Z" }),
    ].join("\n"));

    // Each now() call advances 10 seconds. Budget is 15s, so first 2 entries
    // get processed (elapsed 0s, 10s), third entry (elapsed 20s) is skipped.
    let tick = 0;
    const advanceMs = 10_000;
    const start = FIXED_NOW.getTime();
    const now = () => new Date(start + tick++ * advanceMs);

    const post = vi.fn().mockResolvedValue({ ok: true });
    const result = await replayBuffer({
      bufferPath,
      postIngest: post,
      now,
      timeBudgetMs: 15_000,
    });

    expect(result.retried).toBe(2);
    expect(result.remaining).toBe(1);
    expect(post).toHaveBeenCalledTimes(2);
  });
});

describe("appendToBuffer", () => {
  let tempDir: string;
  let bufferPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ccusage-buffer-append-"));
    bufferPath = join(tempDir, "buffer.jsonl");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("appends payload with _buffered_at stamp", () => {
    appendToBuffer({ x: 42 }, { bufferPath, now: () => FIXED_NOW });

    const content = readFileSync(bufferPath, "utf-8").trim();
    const entry = JSON.parse(content);
    expect(entry.x).toBe(42);
    expect(entry._buffered_at).toBe(FIXED_NOW.toISOString());
  });

  it("appends multiple entries each on a new line", () => {
    appendToBuffer({ a: 1 }, { bufferPath, now: () => FIXED_NOW });
    appendToBuffer({ b: 2 }, { bufferPath, now: () => FIXED_NOW });

    const lines = readFileSync(bufferPath, "utf-8").trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).a).toBe(1);
    expect(JSON.parse(lines[1]).b).toBe(2);
  });

  it("creates parent directory if missing", () => {
    const nestedPath = join(tempDir, "deep", "nested", "buffer.jsonl");
    appendToBuffer({ x: 1 }, { bufferPath: nestedPath, now: () => FIXED_NOW });
    expect(existsSync(nestedPath)).toBe(true);
  });
});
