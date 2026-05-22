import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uninstallCommand } from "./uninstall";

describe("uninstallCommand", () => {
  let tempDir: string;
  let settingsPath: string;
  let configDir: string;
  let logs: string[];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "ccusage-uninstall-"));
    settingsPath = join(tempDir, "settings.json");
    configDir = join(tempDir, ".config", "ccusage-tracker");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "config.json"), JSON.stringify({ x: 1 }));
    logs = [];
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("removes only ccusage-tracker hook entries, leaves other hooks intact", async () => {
    writeFileSync(settingsPath, JSON.stringify({
      hooks: {
        SessionEnd: [
          { matcher: "", hooks: [{ type: "command", command: "tracker hook session-end" }] },
          { matcher: "", hooks: [{ type: "command", command: "echo unrelated" }] },
        ],
        SessionStart: [
          { matcher: "", hooks: [{ type: "command", command: "tracker hook session-start" }] },
        ],
        UserPromptSubmit: [
          { matcher: "", hooks: [{ type: "command", command: "node /some/other/hook.js" }] },
        ],
      },
    }));

    await uninstallCommand(
      { yes: true },
      { settingsPath, configDir, log: (m) => logs.push(m), prompt: async () => "y" },
    );

    const after = JSON.parse(readFileSync(settingsPath, "utf-8"));
    // Our SessionEnd entry gone, unrelated kept
    const endCmds = after.hooks.SessionEnd.flatMap((m: { hooks: { command: string }[] }) => m.hooks.map((h) => h.command));
    expect(endCmds).toEqual(["echo unrelated"]);
    // Our SessionStart entry gone, no matchers left
    expect(after.hooks.SessionStart).toEqual([]);
    // Unrelated UserPromptSubmit untouched
    expect(after.hooks.UserPromptSubmit[0].hooks[0].command).toBe("node /some/other/hook.js");
  });

  it("deletes config directory when --yes is passed", async () => {
    expect(existsSync(configDir)).toBe(true);
    await uninstallCommand(
      { yes: true },
      { settingsPath, configDir, log: (m) => logs.push(m), prompt: async () => "" },
    );
    expect(existsSync(configDir)).toBe(false);
  });

  it("keeps config directory when prompt answer is not y/yes", async () => {
    await uninstallCommand(
      { yes: false },
      { settingsPath, configDir, log: (m) => logs.push(m), prompt: async () => "n" },
    );
    expect(existsSync(configDir)).toBe(true);
    expect(logs.some((l) => l.includes("Kept"))).toBe(true);
  });

  it("does not error when settings.json is missing", async () => {
    // No settings.json written
    await expect(
      uninstallCommand(
        { yes: true },
        { settingsPath, configDir, log: (m) => logs.push(m), prompt: async () => "" },
      )
    ).resolves.toBeUndefined();
    expect(logs.some((l) => l.includes("No Claude settings.json"))).toBe(true);
  });

  it("does not error when config directory is missing", async () => {
    rmSync(configDir, { recursive: true, force: true });
    writeFileSync(settingsPath, JSON.stringify({ hooks: {} }));

    await expect(
      uninstallCommand(
        { yes: true },
        { settingsPath, configDir, log: (m) => logs.push(m), prompt: async () => "" },
      )
    ).resolves.toBeUndefined();
  });
});
