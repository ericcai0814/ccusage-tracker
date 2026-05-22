import { describe, expect, it } from "vitest";
import { setupCommand, type SetupDeps } from "./setup";

interface MockState {
  logs: string[];
  warns: string[];
  exitCode: number | null;
  writtenConfig: unknown;
  installHookCalls: number;
  promptedQuestions: string[];
}

function createMockDeps(prompts: string[]): SetupDeps & MockState {
  let promptIndex = 0;

  const deps: SetupDeps & MockState = {
    logs: [],
    warns: [],
    exitCode: null,
    writtenConfig: null,
    installHookCalls: 0,
    promptedQuestions: [],
    prompt: async (question: string) => {
      deps.promptedQuestions.push(question);
      return prompts[promptIndex++] ?? "";
    },
    writeConfig: (config) => { deps.writtenConfig = config; },
    installHook: () => { deps.installHookCalls += 1; return { installed: true, backedUp: false, migratedLegacy: false }; },
    checkServer: async () => true,
    checkCcusage: () => true,
    log: (msg) => deps.logs.push(msg),
    warn: (msg) => deps.warns.push(msg),
    exit: (code) => { deps.exitCode = code; },
  };

  return deps;
}

describe("setup command (interactive mode)", () => {
  it("prompts for name, server URL, and team key", async () => {
    const deps = createMockDeps(["Eric", "https://example.com", "sk-tracker-123"]);

    await setupCommand(deps);

    expect(deps.promptedQuestions).toHaveLength(3);
    expect(deps.promptedQuestions[0]).toContain("name");
    expect(deps.promptedQuestions[1]).toContain("Server URL");
    expect(deps.promptedQuestions[2]).toContain("Team Key");
  });

  it("exits with code 1 if name is empty", async () => {
    const deps = createMockDeps(["", "https://example.com", "sk-test"]);
    await setupCommand(deps);
    expect(deps.exitCode).toBe(1);
    expect(deps.warns.some((w) => w.includes("Name"))).toBe(true);
  });

  it("exits with code 1 if server URL is empty", async () => {
    const deps = createMockDeps(["Eric", "", "sk-test"]);
    await setupCommand(deps);
    expect(deps.exitCode).toBe(1);
    expect(deps.warns.some((w) => w.includes("Server URL"))).toBe(true);
  });

  it("exits with code 1 if team key is empty", async () => {
    const deps = createMockDeps(["Eric", "https://example.com", ""]);
    await setupCommand(deps);
    expect(deps.exitCode).toBe(1);
    expect(deps.warns.some((w) => w.includes("Team Key"))).toBe(true);
  });

  it("writes config with trimmed server URL and team_key", async () => {
    const deps = createMockDeps(["Eric", "https://example.com///", "sk-tracker-123"]);
    await setupCommand(deps);

    expect(deps.writtenConfig).toEqual({
      server_url: "https://example.com",
      team_key: "sk-tracker-123",
      member_name: "Eric",
    });
  });

  it("logs setup complete on success and invokes installHook once", async () => {
    const deps = createMockDeps(["Eric", "https://example.com", "sk-tracker-123"]);
    await setupCommand(deps);

    expect(deps.logs.some((l) => l.includes("Setup complete"))).toBe(true);
    expect(deps.exitCode).toBeNull();
    expect(deps.installHookCalls).toBe(1);
  });

  it("reports migration when installHook returns migratedLegacy:true", async () => {
    const deps = createMockDeps(["Eric", "https://example.com", "sk-tracker-123"]);
    deps.installHook = () => ({ installed: true, backedUp: true, migratedLegacy: true });
    await setupCommand(deps);
    expect(deps.logs.some((l) => l.includes("Migrated legacy bash hook"))).toBe(true);
  });
});

describe("setup command (flag mode)", () => {
  it("skips all prompts when --name, --server-url, --team-key are all provided", async () => {
    const deps = createMockDeps([]);
    await setupCommand(deps, {
      name: "Alice",
      serverUrl: "https://srv.test",
      teamKey: "sk-tracker-flag",
    });

    expect(deps.promptedQuestions).toHaveLength(0);
    expect(deps.writtenConfig).toEqual({
      server_url: "https://srv.test",
      team_key: "sk-tracker-flag",
      member_name: "Alice",
    });
    expect(deps.exitCode).toBeNull();
  });

  it("falls back to prompt when a flag is missing", async () => {
    const deps = createMockDeps(["Alice"]); // prompt only for name
    await setupCommand(deps, {
      serverUrl: "https://srv.test",
      teamKey: "sk-tracker-flag",
    });

    expect(deps.promptedQuestions).toHaveLength(1);
    expect(deps.promptedQuestions[0]).toContain("name");
    expect(deps.writtenConfig).toMatchObject({
      member_name: "Alice",
      server_url: "https://srv.test",
      team_key: "sk-tracker-flag",
    });
  });

  it("ignores empty-string flag values and prompts instead", async () => {
    const deps = createMockDeps(["Alice", "https://srv.test", "sk-tracker"]);
    await setupCommand(deps, {
      name: "",
      serverUrl: "",
      teamKey: "",
    });

    expect(deps.promptedQuestions).toHaveLength(3);
  });
});
