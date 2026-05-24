import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getHookCommand,
  getStartHookCommand,
  installHook,
  isHookInstalled,
} from "./hooks";

describe("getHookCommand / getStartHookCommand", () => {
  it("returns a platform-independent command string with no bash or absolute path", () => {
    const end = getHookCommand();
    expect(end).toBe("tracker hook session-end");
    expect(end).not.toContain("bash");
    expect(end).not.toMatch(/^\/|^[A-Z]:\\/);
    expect(end).not.toContain(".sh");
  });

  it("returns a session-start command of the same shape", () => {
    const start = getStartHookCommand();
    expect(start).toBe("tracker hook session-start");
    expect(start).not.toContain("bash");
  });
});

describe("installHook (fresh install)", () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ccusage-hooks-"));
    settingsPath = join(tempDir, "settings.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates a new settings.json when none exists, no backup", () => {
    const result = installHook(settingsPath);
    expect(result.installed).toBe(true);
    expect(result.backedUp).toBe(false);
    expect(result.migratedLegacy).toBe(false);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toBe("tracker hook session-end");
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("tracker hook session-start");
  });

  it("creates a .backup before patching an existing settings.json", () => {
    writeFileSync(settingsPath, JSON.stringify({ hooks: {} }));
    const result = installHook(settingsPath);

    expect(result.installed).toBe(true);
    expect(result.backedUp).toBe(true);
    expect(result.migratedLegacy).toBe(false);
    expect(existsSync(settingsPath + ".backup")).toBe(true);
  });

  it("preserves unrelated hooks", () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        UserPromptSubmit: [{ matcher: "", hooks: [{ type: "command", command: "echo unrelated" }] }],
      },
    }));
    installHook(settingsPath);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.UserPromptSubmit[0].hooks[0].command).toBe("echo unrelated");
    expect(settings.hooks.SessionEnd).toBeDefined();
    expect(settings.hooks.SessionStart).toBeDefined();
  });

  it("is idempotent: second install does not duplicate entries", () => {
    installHook(settingsPath);
    const result = installHook(settingsPath);
    expect(result.installed).toBe(false);
    expect(result.backedUp).toBe(false);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks.SessionStart).toHaveLength(1);
  });

  it("isHookInstalled returns true after install, false before", () => {
    expect(isHookInstalled(settingsPath)).toBe(false);
    installHook(settingsPath);
    expect(isHookInstalled(settingsPath)).toBe(true);
  });
});

describe("installHook legacy migration (task 4.3)", () => {
  let tempDir: string;
  let settingsPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ccusage-hooks-mig-"));
    settingsPath = join(tempDir, "settings.json");
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("rewrites bash ccusage-tracker session-end command to new CLI command", () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: "bash /Users/alice/.config/ccusage-tracker/session-end.sh" }] }],
      },
    }));

    const result = installHook(settingsPath);

    expect(result.migratedLegacy).toBe(true);
    expect(result.backedUp).toBe(true);
    expect(existsSync(settingsPath + ".backup-pre-cli-migration")).toBe(true);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toBe("tracker hook session-end");
  });

  it("rewrites bash ccusage-tracker session-start command to new CLI command", () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "bash /Users/alice/.config/ccusage-tracker/session-start.sh" }] }],
      },
    }));

    installHook(settingsPath);
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionStart[0].hooks[0].command).toBe("tracker hook session-start");
  });

  it("leaves bash hook for unrelated tools untouched (no ccusage-tracker substring)", () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: "bash /Users/alice/.config/other-tool/hook.sh" }] }],
      },
    }));

    const result = installHook(settingsPath);
    expect(result.migratedLegacy).toBe(false);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toBe("bash /Users/alice/.config/other-tool/hook.sh");
    // New entry appended alongside (idempotent dedupe doesn't apply since it's a different command)
    expect(settings.hooks.SessionEnd.some((m: { hooks: { command: string }[] }) =>
      m.hooks.some((h) => h.command === "tracker hook session-end")
    )).toBe(true);
  });

  it("leaves node-style hooks untouched", () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: "node /Users/alice/some-other-hook.mjs" }] }],
      },
    }));

    const result = installHook(settingsPath);
    expect(result.migratedLegacy).toBe(false);

    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    expect(settings.hooks.SessionEnd[0].hooks[0].command).toBe("node /Users/alice/some-other-hook.mjs");
  });

  it("no-op when settings.json already has the new CLI command", () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: "tracker hook session-end" }] }],
        SessionStart: [{ matcher: "", hooks: [{ type: "command", command: "tracker hook session-start" }] }],
      },
    }));

    const result = installHook(settingsPath);
    expect(result.installed).toBe(false);
    expect(result.backedUp).toBe(false);
    expect(result.migratedLegacy).toBe(false);
    expect(existsSync(settingsPath + ".backup")).toBe(false);
    expect(existsSync(settingsPath + ".backup-pre-cli-migration")).toBe(false);
  });
});
