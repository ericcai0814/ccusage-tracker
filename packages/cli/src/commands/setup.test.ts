import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setupCommand, type SetupDeps } from "./setup";
import { applyTrackerHooks, installFiles, type InstallResult, type InstallTargets } from "../hooks";
import { applyCodexHooks, getCodexHooksPath } from "../codex-hooks";
import type { TrackerScripts } from "../scripts";

// 檔案系統層的斷言（hooks.json 真的長出 tracker 群組、config.toml 位元組不變）
// 在 update.test.ts 的 Node CLI harness：bun 在 process 啟動時快取 os.homedir()，
// 這裡改不了 $HOME，所以本檔主要驗注入的依賴與輸出契約。唯一的例外在檔尾的
// symlink 案：它把 installHook 換成真實交易，但路徑全部由測試指定，不經過 homedir()。
interface MockState {
  logs: string[];
  warns: string[];
  exitCode: number | null;
  writtenConfig: unknown;
  targets: InstallTargets | null;
  installedCollector: string[];
  probes: number;
}

interface MockOptions {
  claude?: boolean;
  codex?: boolean;
  codexScript?: boolean;
  collector?: (string | null)[];
  configToml?: string | null;
  codexChanged?: boolean;
  codexStopChanged?: boolean;
  codexSessionEndChanged?: boolean;
  writtenThrough?: { link: string; real: string }[];
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
    probes: 0,
    prompt: async () => prompts[promptIndex++] ?? "",
    writeConfig: (config) => { deps.writtenConfig = config; },
    installHook: (scripts: TrackerScripts, targets: InstallTargets): InstallResult => {
      deps.targets = targets;
      const codexWired = targets.codex && scripts.codexSync !== undefined;
      const stopChanged = codexWired && (options.codexStopChanged ?? options.codexChanged ?? true);
      const sessionEndChanged = codexWired && (options.codexSessionEndChanged ?? options.codexChanged ?? true);
      return {
        sessionEndChanged: targets.claude,
        sessionStartChanged: targets.claude,
        stopChanged: targets.claude,
        claudeChanged: targets.claude,
        // codexChanged 必須與真實 installHook 一樣由兩個事件推導，否則部分更新的案例會被遮住
        codexStopChanged: stopChanged,
        codexSessionEndChanged: sessionEndChanged,
        codexChanged: stopChanged || sessionEndChanged,
        codexWired,
        codexIndexes: codexWired ? { stop: { group: 0, hook: 0 }, sessionEnd: { group: 0, hook: 0 } } : {},
        writtenThrough: options.writtenThrough ?? [],
        backedUp: false,
      };
    },
    fetchHookScript: async (_server, scriptName) =>
      scriptName === "codex-sync.mjs" && options.codexScript === false ? null : "// mock hook script",
    checkServer: async () => true,
    detectClaude: () => options.claude ?? true,
    detectCodex: () => options.codex ?? true,
    probeCollector: () => {
      deps.probes += 1;
      return collector[Math.min(probeIndex++, collector.length - 1)];
    },
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

  it("server 對 codex-sync.mjs 回 404 且未偵測到 Codex：只印 not detected，不印相容訊息", async () => {
    const deps = createMockDeps(answers, { codex: false, codexScript: false });
    await setupCommand(deps);

    expect(output(deps)).toContain("Codex: not detected");
    expect(output(deps)).not.toContain("does not provide Codex support");
  });

  it("hooks.state 有 enabled = false：結果行說已停用，不再要求去信任", async () => {
    // 使用者信任後主動關掉，不是還沒信任 —— status.ts 判得對，這裡要一致。
    const hooksPath = getCodexHooksPath();
    const deps = createMockDeps(answers, {
      configToml: `[hooks.state."${hooksPath}:stop:0:0"]\nenabled = false\n` +
        `[hooks.state."${hooksPath}:session_end:0:0"]\nenabled = false\n`,
    });
    await setupCommand(deps);

    expect(output(deps)).toContain("Codex: hooks installed but disabled in Codex");
    expect(output(deps)).not.toContain("/hooks");
  });

  // Eric 本機的真實狀態：Stop 信任了、SessionEnd 沒有。只說「awaiting trust」
  // 會讓人以為兩條都要重做，訊息必須指名還缺哪一條。
  it("Stop 已信任、SessionEnd 還沒：結果行逐 hook 說明", async () => {
    const hooksPath = getCodexHooksPath();
    const deps = createMockDeps(answers, {
      codexChanged: false,
      configToml: `[hooks.state."${hooksPath}:stop:0:0"]\ntrusted_hash = "sha256:a"\n`,
    });
    await setupCommand(deps);

    expect(output(deps)).toContain(
      "Codex: hooks installed (Stop trusted, SessionEnd awaiting trust). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook."
    );
  });

  // Codex 複審 round 2 [low]：原本只要任一 Codex hook 有變動，就把兩條的 recorded
  // 全部降成 awaiting。只補裝 SessionEnd 時，已信任且未變動的 Stop 被誤報成待信任。
  it("Stop 未變動且已信任、只補裝 SessionEnd：只要求信任 SessionEnd", async () => {
    const hooksPath = getCodexHooksPath();
    const deps = createMockDeps(answers, {
      codexStopChanged: false,
      codexSessionEndChanged: true,
      configToml: `[hooks.state."${hooksPath}:stop:0:0"]\ntrusted_hash = "sha256:a"\n`,
    });
    await setupCommand(deps);

    expect(output(deps)).toContain(
      "Codex: hooks installed (Stop trusted, SessionEnd awaiting trust). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook."
    );
  });

  it("Stop 有變動：即使 config.toml 還留著舊的信任紀錄，也不冒稱已信任", async () => {
    // 信任雜湊算的是 hook 設定身分，內容一改就作廢
    const hooksPath = getCodexHooksPath();
    const deps = createMockDeps(answers, {
      codexStopChanged: true,
      codexSessionEndChanged: false,
      configToml: `[hooks.state."${hooksPath}:stop:0:0"]\ntrusted_hash = "sha256:stale"\n` +
        `[hooks.state."${hooksPath}:session_end:0:0"]\ntrusted_hash = "sha256:b"\n`,
    });
    await setupCommand(deps);

    expect(output(deps)).toContain(
      "Codex: hooks installed (Stop awaiting trust, SessionEnd trusted). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook."
    );
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

  // Codex 補審 [low]：server 回 404／410 時 hooks 根本沒接上，卻同時叫人移除 notify。
  // 使用者照做會關掉當下唯一的自動上報入口。
  it("server 回 404 且仍有 tracker notify：印相容訊息，但不叫人移除 notify", async () => {
    const deps = createMockDeps(answers, {
      codexScript: false,
      configToml: 'notify = ["node", "/Users/x/.config/ccusage-tracker/codex-sync.mjs", "--notify"]\n',
    });
    await setupCommand(deps);

    const text = output(deps);
    expect(text).toContain("does not provide Codex support");
    expect(text).toContain("Codex: hooks not installed");
    expect(text).not.toContain("Remove the ccusage-tracker `notify` entry");
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

  it("兩個工具都沒偵測到：不探測也不安裝收集器", async () => {
    // 沒有 Claude 也沒有 Codex 時，全域安裝的 ccusage 當下沒有任何用途。
    const deps = createMockDeps(answers, { claude: false, codex: false, collector: [null] });
    await setupCommand(deps);

    expect(deps.probes).toBe(0);
    expect(deps.installedCollector).toEqual([]);
    expect(output(deps)).not.toContain("Collector:");
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

// setup 的完整檔案系統路徑在 update.test.ts 的 Node CLI harness（子程序才有真的 HOME）。
// 這裡把注入的 installHook 換成真實的合併 + 交易，只把 homedir() 推導的路徑換成暫存
// 目錄，驗 dotfiles 使用者的 setup 會走完而不是被 symlink 防護中止。
describe("setup 對 symlink 設定檔", () => {
  let scratches: string[] = [];
  const scratch = (): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), "tracker setup home ")));
    scratches = [...scratches, dir];
    return dir;
  };

  afterEach(() => {
    for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
    scratches = [];
  });

  it("settings.json 與 hooks.json 皆為 symlink：setup 完成、symlink 保留、真實檔案含 tracker hook", async () => {
    const home = scratch();
    const dotfiles = join(home, "dotfiles");
    mkdirSync(dotfiles, { recursive: true });
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, "codex"), { recursive: true });
    const realSettings = join(dotfiles, "settings.json");
    const realHooks = join(dotfiles, "hooks.json");
    const settingsRaw = '{"model":"opus"}\n';
    writeFileSync(realSettings, settingsRaw);
    writeFileSync(realHooks, "{}\n");
    const settingsLink = join(home, ".claude", "settings.json");
    const hooksLink = join(home, "codex", "hooks.json");
    symlinkSync(realSettings, settingsLink);
    symlinkSync(realHooks, hooksLink);

    const deps = createMockDeps(answers);
    const recordTargets = deps.installHook;
    deps.installHook = (scripts: TrackerScripts, targets: InstallTargets): InstallResult => {
      const claude = applyTrackerHooks(JSON.parse(readFileSync(settingsLink, "utf8")));
      const codex = applyCodexHooks(JSON.parse(readFileSync(hooksLink, "utf8")));
      const installed = installFiles([
        { path: settingsLink, content: JSON.stringify(claude.updated, null, 2) + "\n" },
        { path: hooksLink, content: JSON.stringify(codex.updated, null, 2) + "\n" },
      ]);
      return { ...recordTargets(scripts, targets), writtenThrough: installed.writtenThrough };
    };

    await setupCommand(deps);

    expect(deps.exitCode).toBeNull();
    expect(deps.logs.some((line) => line.includes("Setup complete"))).toBe(true);
    expect(lstatSync(settingsLink).isSymbolicLink()).toBe(true);
    expect(lstatSync(hooksLink).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(realSettings, "utf8")).hooks.Stop[0].hooks[0].command).toContain("session-end.mjs");
    expect(JSON.parse(readFileSync(realHooks, "utf8")).hooks.Stop[0].hooks[0].command).toContain("codex-sync.mjs");
    expect(readFileSync(`${realSettings}.backup`, "utf8")).toBe(settingsRaw);
    expect(existsSync(`${settingsLink}.backup`)).toBe(false);
    expect(output(deps)).toContain(`Wrote through symlink: ${settingsLink} -> ${realSettings}`);
    expect(output(deps)).toContain(`Wrote through symlink: ${hooksLink} -> ${realHooks}`);
  });
});
