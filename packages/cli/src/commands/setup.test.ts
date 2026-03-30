import { describe, expect, it } from "bun:test";
import { setupCommand, type SetupDeps } from "./setup";

interface MockState {
  logs: string[];
  warns: string[];
  exitCode: number | null;
  writtenConfig: unknown;
}

function createMockDeps(prompts: string[]): SetupDeps & MockState {
  let promptIndex = 0;

  const deps: SetupDeps & MockState = {
    logs: [],
    warns: [],
    exitCode: null,
    writtenConfig: null,
    prompt: async () => prompts[promptIndex++] ?? "",
    writeConfig: (config) => { deps.writtenConfig = config; },
    installHook: () => ({ installed: true, backedUp: false }),
    checkServer: async () => true,
    checkCcusage: () => true,
    log: (msg) => deps.logs.push(msg),
    warn: (msg) => deps.warns.push(msg),
    exit: (code) => { deps.exitCode = code; },
  };

  return deps;
}

describe("setup command", () => {
  it("should prompt for name, server URL, and API key", async () => {
    const prompts: string[] = [];
    const deps = createMockDeps(["Eric", "https://example.com", "sk-test-123"]);
    const originalPrompt = deps.prompt;
    deps.prompt = async (question: string) => {
      prompts.push(question);
      return originalPrompt(question);
    };

    await setupCommand(deps);

    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain("name");
    expect(prompts[1]).toContain("Server URL");
    expect(prompts[2]).toContain("API Key");
  });

  it("should exit with code 1 if name is empty", async () => {
    const deps = createMockDeps(["", "https://example.com", "sk-test"]);
    await setupCommand(deps);

    expect(deps.exitCode).toBe(1);
    expect(deps.warns.some((w) => w.includes("Name"))).toBe(true);
  });

  it("should exit with code 1 if server URL is empty", async () => {
    const deps = createMockDeps(["Eric", "", "sk-test"]);
    await setupCommand(deps);

    expect(deps.exitCode).toBe(1);
    expect(deps.warns.some((w) => w.includes("Server URL"))).toBe(true);
  });

  it("should exit with code 1 if API key is empty", async () => {
    const deps = createMockDeps(["Eric", "https://example.com", ""]);
    await setupCommand(deps);

    expect(deps.exitCode).toBe(1);
    expect(deps.warns.some((w) => w.includes("API Key"))).toBe(true);
  });

  it("should write config with trimmed server URL", async () => {
    const deps = createMockDeps(["Eric", "https://example.com///", "sk-test-123"]);
    await setupCommand(deps);

    expect(deps.writtenConfig).toEqual({
      server_url: "https://example.com",
      api_key: "sk-test-123",
      member_name: "Eric",
    });
  });

  it("should log setup complete on success", async () => {
    const deps = createMockDeps(["Eric", "https://example.com", "sk-test-123"]);
    await setupCommand(deps);

    expect(deps.logs.some((l) => l.includes("Setup complete"))).toBe(true);
    expect(deps.exitCode).toBeNull();
  });
});
