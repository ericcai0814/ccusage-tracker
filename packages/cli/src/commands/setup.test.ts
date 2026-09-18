import { describe, expect, it } from "bun:test";
import { setupCommand, type SetupDeps } from "./setup";
import type { InstallResult, InstallTargets } from "../hooks";
import type { TrackerScripts } from "../scripts";

// 檔案系統層的斷言（hooks.json 真的長出 tracker 群組、config.toml 位元組不變）
// 在 update.test.ts 的 Node CLI harness：bun 在 process 啟動時快取 os.homedir()，
// 這裡改不了 $HOME，所以本檔只驗注入的依賴與輸出契約。
interface MockState {
  logs: string[];
  warns: string[];
  exitCode: number | null;
  writtenConfig: unknown;
  targets: InstallTargets | null;
  installedCollector: string[];
}

interface MockOptions {
  claude?: boolean;
  codex?: boolean;
  codexScript?: boolean;
  collector?: (string | null)[];
  configToml?: string | null;
}

function createMockDeps(prompts: string[], options: MockOptions = {}): SetupDeps & MockState {
  let promptIndex = 0;
  let probeIndex = 0;
  const collector = options.collector ?? ["20.0.20"];

  const deps: SetupDeps & MockState = {
    logs: [],
    warns: [],
    exitCode: null,
    writtenConfig: null,
    targets: null,
    installedCollector: [],
    prompt: async () => prompts[promptIndex++] ?? "",
    writeConfig: (config) => { deps.writtenConfig = config; },
    installHook: (scripts: TrackerScripts, targets: InstallTargets): InstallResult => {
      deps.targets = targets;
      const codexWired = targets.codex && scripts.codexSync !== undefined;
      return {
        sessionEndChanged: targets.claude,
        sessionStartChanged: targets.claude,
        stopChanged: targets.claude,
        claudeChanged: targets.claude,
        codexStopChanged: codexWired,
        codexSessionEndChanged: codexWired,
        codexChanged: codexWired,
        codexWired,
        codexIndexes: codexWired ? { stop: 0, sessionEnd: 0 } : {},
        backedUp: false,
      };
    },
    fetchHookScript: async (_server, scriptName) =>
      scriptName === "codex-sync.mjs" && options.codexScript === false ? null : "// mock hook script",
    checkServer: async () => true,
    detectClaude: () => options.claude ?? true,
    detectCodex: () => options.codex ?? true,
    probeCollector: () => collector[Math.min(probeIndex++, collector.length - 1)],
    installCollector: (command) => { deps.installedCollector.push(command); return true; },
    readCodexConfig: () => options.configToml ?? null,
    log: (msg) => deps.logs.push(msg),
    warn: (msg) => deps.warns.push(msg),
    exit: (code) => { deps.exitCode = code; },
  };

  return deps;
}

const answers = ["Eric", "https://example.com", "sk-test-123"];
const output = (deps: MockState) => deps.logs.concat(deps.warns).join("\n");

describe("setup command", () => {
  it("should prompt for name, server URL, and Team Key", async () => {
    const prompts: string[] = [];
    const deps = createMockDeps(answers);
    const originalPrompt = deps.prompt;
    deps.prompt = async (question: string) => {
      prompts.push(question);
      return originalPrompt(question);
    };

    await setupCommand(deps);

    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain("name");
    expect(prompts[1]).toContain("Server URL");
    expect(prompts[2]).toContain("Team Key");
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

  it("should exit with code 1 if Team Key is empty", async () => {
    const deps = createMockDeps(["Eric", "https://example.com", ""]);
    await setupCommand(deps);

    expect(deps.exitCode).toBe(1);
    expect(deps.warns.some((w) => w.includes("Team Key"))).toBe(true);
  });

  it("should write config with trimmed server URL", async () => {
    const deps = createMockDeps(["Eric", "https://example.com///", "sk-test-123"]);
    await setupCommand(deps);

    expect(deps.writtenConfig).toEqual({
      server_url: "https://example.com",
      team_key: "sk-test-123",
      member_name: "Eric",
    });
  });

  it("should log setup complete on success", async () => {
    const deps = createMockDeps(answers);
    await setupCommand(deps);

    expect(deps.logs.some((l) => l.includes("Setup complete"))).toBe(true);
    expect(deps.exitCode).toBeNull();
  });
});

describe("setup 逐工具接線", () => {
  it("兩個工具都偵測到：兩邊都接線，Codex 那行提示跑一次 /hooks", async () => {
    const deps = createMockDeps(answers);
    await setupCommand(deps);

    expect(deps.targets).toEqual({ claude: true, codex: true });
    expect(output(deps)).toContain("Claude Code: hooks installed/updated (SessionStart, SessionEnd, Stop)");
    expect(output(deps)).toContain("Codex: hooks installed (Stop, SessionEnd).");
    expect(output(deps)).toContain("/hooks");
    expect(deps.exitCode).toBeNull();
  });

  it("結果行順序：Config saved → Claude → Codex → Collector → Server → Setup complete", async () => {
    const deps = createMockDeps(answers);
    await setupCommand(deps);

    const lines = deps.logs.join("\n");
    const at = (needle: string) => lines.indexOf(needle);
    expect(at("Config saved")).toBeLessThan(at("Claude Code:"));
    expect(at("Claude Code:")).toBeLessThan(at("Codex:"));
    expect(at("Codex:")).toBeLessThan(at("Collector:"));
    expect(at("Collector:")).toBeLessThan(at("Server is reachable"));
    expect(at("Server is reachable")).toBeLessThan(at("Setup complete"));
  });

  it("Codex 未偵測到：不接 Codex hook，輸出 Codex: not detected", async () => {
    const deps = createMockDeps(answers, { codex: false });
    await setupCommand(deps);

    expect(deps.targets).toEqual({ claude: true, codex: false });
    expect(output(deps)).toContain("Codex: not detected");
    expect(output(deps)).not.toContain("/hooks");
  });

  it("server 對 codex-sync.mjs 回 404：不接 Codex hook，印既有相容訊息", async () => {
    const deps = createMockDeps(answers, { codexScript: false });
    await setupCommand(deps);

    expect(output(deps)).toContain("does not provide Codex support");
    expect(output(deps)).toContain("Codex: hooks not installed");
    expect(output(deps)).not.toContain("Codex: hooks installed (Stop, SessionEnd).");
  });

  it("config.toml 仍留著 tracker 的 notify：提示自行移除，但不編輯 TOML", async () => {
    const deps = createMockDeps(answers, {
      configToml: 'notify = ["node", "/Users/x/.config/ccusage-tracker/codex-sync.mjs", "--notify"]\n',
    });
    await setupCommand(deps);

    const text = output(deps);
    expect(text).toContain("Remove the ccusage-tracker `notify` entry");
    expect(text).toContain("never edits that file");
  });

  it("第三方 notify 不觸發提示（hooks 與 notify 可共存）", async () => {
    const deps = createMockDeps(answers, { configToml: 'notify = ["say", "done"]\n' });
    await setupCommand(deps);

    expect(output(deps)).not.toContain("Remove the ccusage-tracker `notify` entry");
  });

  it("兩個工具都沒偵測到：仍寫入設定、提示裝好後跑 update，且 exit 0", async () => {
    const deps = createMockDeps(answers, { claude: false, codex: false });
    await setupCommand(deps);

    expect(deps.writtenConfig).not.toBeNull();
    expect(output(deps)).toContain("No supported tool detected");
    expect(output(deps)).toContain("tracker update");
    expect(deps.logs.some((l) => l.includes("Setup complete"))).toBe(true);
    expect(deps.exitCode).toBeNull();
  });
});

describe("setup 的收集器步驟", () => {
  it("缺 collector：自動安裝已驗證版本並印出所執行的指令", async () => {
    const deps = createMockDeps(answers, { collector: [null, "20.0.20"] });
    await setupCommand(deps);

    expect(deps.installedCollector).toEqual(["npm install -g ccusage@20.0.20"]);
    expect(output(deps)).toContain("npm install -g ccusage@20.0.20");
    expect(deps.exitCode).toBeNull();
  });

  it("主版本不支援 Codex：只警告不替換，setup 仍完成", async () => {
    const deps = createMockDeps(answers, { collector: ["18.0.9"] });
    await setupCommand(deps);

    expect(deps.installedCollector).toEqual([]);
    expect(output(deps)).toContain("20.0.20");
    expect(deps.logs.some((l) => l.includes("Setup complete"))).toBe(true);
    expect(deps.exitCode).toBeNull();
  });

  it("安裝失敗不改 exit code，只留下可照抄的指令", async () => {
    const deps = createMockDeps(answers, { collector: [null, null] });
    await setupCommand(deps);

    expect(deps.warns.some((w) => w.includes("npm install -g ccusage@20.0.20"))).toBe(true);
    expect(deps.exitCode).toBeNull();
    expect(deps.logs.some((l) => l.includes("Setup complete"))).toBe(true);
  });
});
