import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractSessionMetrics } from "./transcript-metrics";

function fixturePath(dir: string, events: object[]): string {
  const p = join(dir, "transcript.jsonl");
  writeFileSync(p, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
}

describe("extractSessionMetrics", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ccusage-transcript-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns null when transcript file does not exist", () => {
    expect(extractSessionMetrics(join(tempDir, "nope.jsonl"))).toBeNull();
  });

  it("returns null when transcript is empty", () => {
    const p = fixturePath(tempDir, []);
    expect(extractSessionMetrics(p)).toBeNull();
  });

  it("computes core counts and metadata from a synthetic transcript", () => {
    const p = fixturePath(tempDir, [
      {
        type: "user",
        userType: "external",
        sessionId: "abc-123",
        slug: "test-session",
        cwd: "/Users/eric/project/ccusage-tracker",
        gitBranch: "main",
        timestamp: "2026-05-22T10:00:00.000Z",
        message: { content: [{ type: "text", text: "hello world" }] },
      },
      {
        type: "assistant",
        timestamp: "2026-05-22T10:00:05.000Z",
        message: {
          content: [
            { type: "text", text: "ok" },
            { type: "tool_use", name: "Read", input: { path: "foo.ts" } },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-05-22T10:00:06.000Z",
        message: {
          content: [{ type: "tool_result", content: "file contents", is_error: false }],
        },
      },
      {
        type: "assistant",
        timestamp: "2026-05-22T10:05:00.000Z",
        message: {
          content: [
            { type: "tool_use", name: "Write", input: { path: "bar.ts", content: "x" } },
            { type: "tool_use", name: "Bash", input: { command: "git commit -m 'feat: x'" } },
            { type: "tool_use", name: "Skill", input: { skill: "tdd" } },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-05-22T10:05:10.000Z",
        message: {
          content: [{ type: "tool_result", content: "boom", is_error: true }],
        },
      },
    ]);

    const m = extractSessionMetrics(p);

    expect(m).not.toBeNull();
    expect(m!.session_id).toBe("abc-123");
    expect(m!.session_name).toBe("test-session");
    expect(m!.project).toBe("ccusage-tracker");
    expect(m!.branch).toBe("main");
    expect(m!.turns).toBe(1);
    expect(m!.user_messages).toBe(3);
    expect(m!.assistant_messages).toBe(2);
    expect(m!.tool_calls).toEqual({ Read: 1, Write: 1, Bash: 1, Skill: 1 });
    expect(m!.tool_call_total).toBe(4);
    expect(m!.tool_errors).toBe(1);
    expect(m!.has_commit).toBe(true);
    expect(m!.files_read).toBe(1);
    expect(m!.files_written).toBe(1);
    expect(m!.files_edited).toBe(0);
    expect(m!.skills_invoked).toEqual(["tdd"]);
    expect(m!.started_at).toBe("2026-05-22T10:00:00.000Z");
    expect(m!.ended_at).toBe("2026-05-22T10:05:10.000Z");
    expect(m!.duration_minutes).toBe(5);
    expect(m!.hook_blocks).toBe(0);
    expect(m!.user_avg_chars).toBe("hello world".length);
    expect(m!.approx_tokens).toBeGreaterThan(0);
  });

  it("privacy: output JSON does not leak conversation content or tool inputs", () => {
    const secretText = "SECRET_USER_QUERY_TOKEN";
    const secretCommand = "SECRET_COMMAND_STRING";
    const secretToolResult = "SECRET_TOOL_OUTPUT";

    const p = fixturePath(tempDir, [
      {
        type: "user",
        userType: "external",
        sessionId: "s1",
        timestamp: "2026-05-22T10:00:00Z",
        message: { content: [{ type: "text", text: secretText }] },
      },
      {
        type: "assistant",
        timestamp: "2026-05-22T10:00:05Z",
        message: {
          content: [
            { type: "tool_use", name: "Bash", input: { command: secretCommand } },
          ],
        },
      },
      {
        type: "user",
        timestamp: "2026-05-22T10:00:06Z",
        message: { content: [{ type: "tool_result", content: secretToolResult, is_error: false }] },
      },
    ]);

    const m = extractSessionMetrics(p);
    const serialized = JSON.stringify(m);

    expect(serialized).not.toContain(secretText);
    expect(serialized).not.toContain(secretCommand);
    expect(serialized).not.toContain(secretToolResult);
  });

  it("skips malformed JSON lines without throwing", () => {
    const p = join(tempDir, "transcript.jsonl");
    writeFileSync(p, [
      JSON.stringify({ type: "user", userType: "external", sessionId: "ok", message: { content: [{ type: "text", text: "hi" }] } }),
      "not valid json {{{",
      JSON.stringify({ type: "assistant", message: { content: [] } }),
    ].join("\n"));

    const m = extractSessionMetrics(p);
    expect(m).not.toBeNull();
    expect(m!.session_id).toBe("ok");
    expect(m!.assistant_messages).toBe(1);
  });

  it("handles transcripts with no timestamps", () => {
    const p = fixturePath(tempDir, [
      { type: "user", userType: "external", sessionId: "x", message: { content: [{ type: "text", text: "hi" }] } },
    ]);
    const m = extractSessionMetrics(p);
    expect(m!.duration_minutes).toBe(0);
    expect(m!.started_at).toBe("");
    expect(m!.ended_at).toBe("");
  });
});
