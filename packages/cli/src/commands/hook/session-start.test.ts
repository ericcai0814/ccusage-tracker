import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sessionStartCommand } from "./session-start";

describe("sessionStartCommand", () => {
  let tempDir: string;
  let sessionsDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ccusage-sstart-"));
    sessionsDir = join(tempDir, "sessions");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes model to sessions dir when both session_id and model are present", async () => {
    await sessionStartCommand({
      readStdin: async () => JSON.stringify({ session_id: "abc123", model: "claude-opus-4-7" }),
      sessionsDir,
    });

    const filePath = join(sessionsDir, "abc123");
    expect(existsSync(filePath)).toBe(true);
    expect(readFileSync(filePath, "utf-8")).toBe("claude-opus-4-7");
  });

  it("does not write when model is missing", async () => {
    await sessionStartCommand({
      readStdin: async () => JSON.stringify({ session_id: "abc123" }),
      sessionsDir,
    });

    expect(existsSync(sessionsDir) ? readdirSync(sessionsDir) : []).toEqual([]);
  });

  it("does not write when session_id is missing", async () => {
    await sessionStartCommand({
      readStdin: async () => JSON.stringify({ model: "claude-opus-4-7" }),
      sessionsDir,
    });

    expect(existsSync(sessionsDir) ? readdirSync(sessionsDir) : []).toEqual([]);
  });

  it("does not throw on empty stdin", async () => {
    await expect(
      sessionStartCommand({
        readStdin: async () => "",
        sessionsDir,
      })
    ).resolves.toBeUndefined();
  });

  it("does not throw on malformed JSON", async () => {
    await expect(
      sessionStartCommand({
        readStdin: async () => "not json",
        sessionsDir,
      })
    ).resolves.toBeUndefined();
  });
});
