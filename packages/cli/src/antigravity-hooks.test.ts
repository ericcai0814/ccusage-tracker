import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AGENT_SOURCES, detectAntigravity, resolveAgentSource } from "./agent-sources";
import {
  ANTIGRAVITY_HOOK_KEY,
  applyAntigravityHook,
  formatAntigravityResultLine,
  getAntigravityHookCommand,
  getAntigravityHooksPath,
  readAntigravityHookState,
} from "./antigravity-hooks";

// bun 在 process 啟動時就快取 os.homedir()，所以偵測與路徑函式都接受注入的 home。
const originalPath = process.env.PATH;
const temporaries: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "agy hooks "));
  temporaries.push(dir);
  return dir;
}

afterEach(() => {
  process.env.PATH = originalPath;
  while (temporaries.length) rmSync(temporaries.pop()!, { recursive: true, force: true });
});

function emptyPath(): void {
  process.env.PATH = scratch();
}

describe("CLI agent source table", () => {
  it("describes Antigravity with its alias, roots and PATH commands", () => {
    expect(AGENT_SOURCES.map((s) => [s.id, s.aliases, s.label, s.statePrefix, s.scriptName, s.minCollector])).toEqual([
      ["antigravity", ["agy"], "Antigravity", "antigravity", "agent-sync.mjs", "20.0.21"],
    ]);
    expect(AGENT_SOURCES[0].pathCommands).toEqual(["agy", "antigravity"]);
    expect(AGENT_SOURCES[0].dataRoots).toEqual([".gemini/antigravity", ".gemini/antigravity-cli", ".gemini/antigravity-ide",
      ".gemini/antigravity-backup", ".gemini/antigravity-acp", ".config/antigravity"]);
  });

  it("resolves the id and the alias, and nothing else", () => {
    expect(resolveAgentSource("antigravity")?.id).toBe("antigravity");
    expect(resolveAgentSource("agy")?.id).toBe("antigravity");
    expect(resolveAgentSource("gemini")).toBeNull();
    expect(resolveAgentSource("codex")).toBeNull();
  });
});

describe("Antigravity detection", () => {
  for (const root of [".gemini/antigravity", ".gemini/antigravity-cli", ".gemini/antigravity-ide",
    ".gemini/antigravity-backup", ".gemini/antigravity-acp", ".config/antigravity"]) {
    it(`detects ${root}/conversations`, () => {
      emptyPath();
      const home = scratch();
      mkdirSync(join(home, root, "conversations"), { recursive: true });
      expect(detectAntigravity(home)).toBe(true);
    });
  }

  for (const command of ["agy", "antigravity"]) {
    it(`detects ${command} on PATH without any conversation data`, () => {
      const bin = scratch();
      writeFileSync(join(bin, command), "#!/bin/sh\n", { mode: 0o755 });
      process.env.PATH = bin;
      expect(detectAntigravity(scratch())).toBe(true);
    });
  }

  it("does not count a leftover ~/.gemini/antigravity/bin directory", () => {
    emptyPath();
    const home = scratch();
    mkdirSync(join(home, ".gemini/antigravity/bin"), { recursive: true });
    writeFileSync(join(home, ".gemini/antigravity/bin/webm_encoder"), "");
    expect(detectAntigravity(home)).toBe(false);
  });

  it("does not count a conversations file that is not a directory", () => {
    emptyPath();
    const home = scratch();
    mkdirSync(join(home, ".gemini/antigravity-cli"), { recursive: true });
    writeFileSync(join(home, ".gemini/antigravity-cli/conversations"), "");
    expect(detectAntigravity(home)).toBe(false);
  });
});

describe("Antigravity hook paths and command", () => {
  it("uses the global hooks file and a quoted script path", () => {
    const home = "/Users/a b";
    expect(getAntigravityHooksPath(home)).toBe("/Users/a b/.gemini/config/hooks.json");
    expect(getAntigravityHookCommand(home)).toBe('node "/Users/a b/.config/ccusage-tracker/agent-sync.mjs" --hook antigravity');
  });
});

describe("applyAntigravityHook", () => {
  const command = getAntigravityHookCommand("/h");
  const canonical = { Stop: [{ type: "command", command }] };
  const linter = { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: "lint", timeout: 5 }] }] };
  const gate = { enabled: false, Stop: [{ type: "command", command: "gate" }] };

  it("appends the tracker after third-party hooks and keeps their values and order", () => {
    const result = applyAntigravityHook({ "my-linter-hook": linter, "safety-gate": gate }, command);
    expect(result.changed).toBe(true);
    expect(result.disabled).toBe(false);
    expect(Object.keys(result.updated)).toEqual(["my-linter-hook", "safety-gate", ANTIGRAVITY_HOOK_KEY]);
    expect(result.updated["my-linter-hook"]).toEqual(linter);
    expect(result.updated["safety-gate"]).toEqual(gate);
    expect(result.updated[ANTIGRAVITY_HOOK_KEY]).toEqual(canonical);
  });

  it("reports no change and returns the same object when already canonical", () => {
    const file = { "my-linter-hook": linter, [ANTIGRAVITY_HOOK_KEY]: canonical };
    const result = applyAntigravityHook(file, command);
    expect(result.changed).toBe(false);
    expect(result.updated).toBe(file);
  });

  it("treats key order inside the tracker entry as equal", () => {
    const file = { [ANTIGRAVITY_HOOK_KEY]: { Stop: [{ command, type: "command" }] } };
    expect(applyAntigravityHook(file, command).changed).toBe(false);
  });

  for (const [name, stale] of [
    ["an old command", { Stop: [{ type: "command", command: "node /old/agent-sync.mjs" }] }],
    ["an extra PostToolUse event", { Stop: [{ type: "command", command }], PostToolUse: [{ type: "command", command }] }],
    ["a timeout and matcher", { Stop: [{ type: "command", command, timeout: 30, matcher: "*" }] }],
  ] as const) {
    it(`replaces ${name} in place`, () => {
      const result = applyAntigravityHook({ first: linter, [ANTIGRAVITY_HOOK_KEY]: stale, last: gate }, command);
      expect(result.changed).toBe(true);
      expect(Object.keys(result.updated)).toEqual(["first", ANTIGRAVITY_HOOK_KEY, "last"]);
      expect(result.updated[ANTIGRAVITY_HOOK_KEY]).toEqual(canonical);
      expect(result.updated.first).toEqual(linter);
      expect(result.updated.last).toEqual(gate);
      expect(JSON.stringify(result.updated[ANTIGRAVITY_HOOK_KEY])).not.toMatch(/timeout|matcher/);
    });
  }

  it("keeps enabled: false while writing the canonical command", () => {
    const result = applyAntigravityHook({ [ANTIGRAVITY_HOOK_KEY]: { enabled: false, Stop: [{ type: "command", command: "old" }] } }, command);
    expect(result.changed).toBe(true);
    expect(result.disabled).toBe(true);
    expect(result.updated[ANTIGRAVITY_HOOK_KEY]).toEqual({ enabled: false, ...canonical });
    expect(applyAntigravityHook(result.updated, command)).toMatchObject({ changed: false, disabled: true });
  });

  for (const [name, file] of [
    ["an array", []],
    ["null", null],
    ["a string", "hooks"],
    ["a non-object tracker entry", { [ANTIGRAVITY_HOOK_KEY]: "node agent-sync.mjs" }],
    ["an array tracker entry", { [ANTIGRAVITY_HOOK_KEY]: [] }],
  ] as const) {
    it(`asks for a repair when the file is ${name}`, () => {
      expect(() => applyAntigravityHook(file, command)).toThrow(/hooks\.json.*repair/);
    });
  }
});

describe("readAntigravityHookState and result lines", () => {
  function writeHooks(home: string, content: unknown) {
    mkdirSync(join(home, ".gemini/config"), { recursive: true });
    writeFileSync(join(home, ".gemini/config/hooks.json"), typeof content === "string" ? content : JSON.stringify(content));
  }

  it("reads installed, disabled, outdated and missing states", () => {
    const home = scratch();
    expect(readAntigravityHookState(home)).toBe("not_installed");
    writeHooks(home, { other: {} });
    expect(readAntigravityHookState(home)).toBe("not_installed");
    writeHooks(home, { [ANTIGRAVITY_HOOK_KEY]: { Stop: [{ type: "command", command: getAntigravityHookCommand(home) }] } });
    expect(readAntigravityHookState(home)).toBe("installed");
    writeHooks(home, { [ANTIGRAVITY_HOOK_KEY]: { enabled: false, Stop: [{ type: "command", command: getAntigravityHookCommand(home) }] } });
    expect(readAntigravityHookState(home)).toBe("disabled");
    writeHooks(home, { [ANTIGRAVITY_HOOK_KEY]: { Stop: [{ type: "command", command: "old" }] } });
    expect(readAntigravityHookState(home)).toBe("outdated");
    writeHooks(home, "not json");
    expect(readAntigravityHookState(home)).toBe("invalid");
  });

  it("prints the four result lines verbatim", () => {
    expect(formatAntigravityResultLine({ wired: true, changed: true, disabled: false }))
      .toBe("Antigravity: hook installed (Stop). Restart Antigravity to load it.");
    expect(formatAntigravityResultLine({ wired: true, changed: false, disabled: false }))
      .toBe("Antigravity: hook already up to date");
    expect(formatAntigravityResultLine({ wired: true, changed: true, disabled: true }))
      .toBe("Antigravity: hook installed but disabled in Antigravity (Settings > Customizations > Hooks)");
    expect(formatAntigravityResultLine({ wired: false, changed: false, disabled: false }))
      .toBe("Antigravity: hook not installed (this server does not provide agent-sync.mjs)");
  });
});
