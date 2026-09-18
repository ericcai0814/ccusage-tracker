import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyCodexHooks,
  detectCodex,
  getCodexHome,
  getCodexHookCommand,
  getCodexHooksPath,
  hasTrackerNotify,
  readCodexTrustState,
  type CodexHooksFile,
} from "./codex-hooks";

// getCodexHome 讀 CODEX_HOME 是唯一能在測試內安全改寫的入口：bun 的 os.homedir()
// 在 process 啟動時就快取 $HOME（見 hooks.test.ts 的相同註記），所以每個需要
// 隔離的案例都明確設定 CODEX_HOME，不依賴 fallback 路徑。
const originalCodexHome = process.env.CODEX_HOME;
const originalPath = process.env.PATH;
const temporaries: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "codex hooks "));
  temporaries.push(dir);
  return dir;
}

afterEach(() => {
  if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = originalCodexHome;
  process.env.PATH = originalPath;
  while (temporaries.length) rmSync(temporaries.pop()!, { recursive: true, force: true });
});

const command = getCodexHookCommand();

function thirdParty(name: string) {
  return { hooks: [{ type: "command", command: `echo ${name}`, timeout: 7 }], note: name };
}

describe("Codex hook 路徑與命令", () => {
  it("getCodexHome 尊重 CODEX_HOME，getCodexHooksPath 指向其下的 hooks.json", () => {
    const dir = scratch();
    process.env.CODEX_HOME = dir;

    expect(getCodexHome()).toBe(dir);
    expect(getCodexHooksPath()).toBe(join(dir, "hooks.json"));
  });

  it("CODEX_HOME 未設定時退回 ~/.codex", () => {
    delete process.env.CODEX_HOME;

    expect(getCodexHome()).toMatch(/[/\\]\.codex$/);
  });

  it("getCodexHookCommand 以 node 執行 codex-sync.mjs，路徑有雙引號且帶 --hook", () => {
    expect(command).toMatch(/^node ".*[/\\]ccusage-tracker[/\\]codex-sync\.mjs" --hook$/);
  });
});

describe("applyCodexHooks", () => {
  it("空檔：append 不含 matcher 鍵的 Stop 與 SessionEnd 群組", () => {
    const result = applyCodexHooks({}, command);

    expect(result.anyChanged).toBe(true);
    expect(result.stopChanged).toBe(true);
    expect(result.sessionEndChanged).toBe(true);
    expect(result.updated).toEqual({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command, timeout: 45 }] }],
        SessionEnd: [{ hooks: [{ type: "command", command, timeout: 45 }] }],
      },
    });
    for (const event of ["Stop", "SessionEnd"] as const) {
      expect(Object.keys(result.updated.hooks![event]![0])).toEqual(["hooks"]);
    }
  });

  it("無 hooks 鍵但有其他頂層鍵：其他鍵原樣保留", () => {
    const result = applyCodexHooks({ experimental: { enabled: true } }, command);

    expect(result.updated.experimental).toEqual({ enabled: true });
    expect(result.updated.hooks!.Stop).toHaveLength(1);
  });

  it("三個第三方 Stop 群組在前：索引 0 至 2 位元組不變，tracker 落在索引 3", () => {
    const groups = [thirdParty("a"), thirdParty("b"), thirdParty("c")];
    const file: CodexHooksFile = { hooks: { Stop: groups, SessionStart: [thirdParty("start")] } };
    const before = JSON.stringify(file);

    const result = applyCodexHooks(file, command);

    expect(JSON.stringify(file)).toBe(before);
    const stop = result.updated.hooks!.Stop!;
    expect(stop).toHaveLength(4);
    expect(JSON.stringify(stop.slice(0, 3))).toBe(JSON.stringify(groups));
    expect(stop[3]).toEqual({ hooks: [{ type: "command", command, timeout: 45 }] });
    // 其他事件不被觸碰
    expect(result.updated.hooks!.SessionStart).toEqual([thirdParty("start")]);
  });

  it("重跑：anyChanged 為 false 且回傳同一物件參考（不觸發重寫、不作廢信任）", () => {
    const first = applyCodexHooks({ hooks: { Stop: [thirdParty("a")] } }, command);
    const second = applyCodexHooks(first.updated, command);

    expect(second.anyChanged).toBe(false);
    expect(second.stopChanged).toBe(false);
    expect(second.sessionEndChanged).toBe(false);
    expect(second.updated).toBe(first.updated);
  });

  it("索引 1 的舊 tracker command：原索引就地替換，其餘索引不動", () => {
    const stale = { hooks: [{ type: "command", command: command.replace(" --hook", ""), timeout: 10 }] };
    const file: CodexHooksFile = { hooks: { Stop: [thirdParty("a"), stale, thirdParty("c")] } };

    const result = applyCodexHooks(file, command);

    const stop = result.updated.hooks!.Stop!;
    expect(stop).toHaveLength(3);
    expect(stop[0]).toEqual(thirdParty("a"));
    expect(stop[1]).toEqual({ hooks: [{ type: "command", command, timeout: 45 }] });
    expect(stop[2]).toEqual(thirdParty("c"));
    expect(result.stopChanged).toBe(true);
  });

  it("tracker 群組內混有第三方 hook：只換掉 tracker 那一條，第三方保留", () => {
    const mixed = {
      hooks: [
        { type: "command", command: "echo keep-me" },
        { type: "command", command: command.replace(" --hook", " --notify") },
      ],
    };
    const result = applyCodexHooks({ hooks: { SessionEnd: [mixed] } }, command);

    expect(result.updated.hooks!.SessionEnd).toEqual([
      { hooks: [{ type: "command", command: "echo keep-me" }, { type: "command", command, timeout: 45 }] },
    ]);
  });

  it("非物件 JSON 或 hooks 不是物件：拋錯且不回傳部分結果", () => {
    for (const invalid of [null, [], "text", 7]) {
      expect(() => applyCodexHooks(invalid as unknown as CodexHooksFile, command)).toThrow(/hooks\.json/);
    }
    for (const hooks of [[], "text", 7]) {
      expect(() => applyCodexHooks({ hooks } as unknown as CodexHooksFile, command)).toThrow(/hooks\.json/);
    }
    for (const stop of ["text", [null], [{ hooks: "text" }], [{ hooks: [null] }]]) {
      expect(() => applyCodexHooks({ hooks: { Stop: stop } } as unknown as CodexHooksFile, command)).toThrow(/hooks\.json/);
    }
  });
});

describe("readCodexTrustState", () => {
  const hooksPath = "/Users/test/.codex/hooks.json";
  const section = (event: string, index: number) => `[hooks.state."${hooksPath}:${event}:${index}:0"]`;

  it("區段含 trusted_hash → recorded", () => {
    const toml = `model = "gpt-5"\n\n${section("stop", 3)}\ntrusted_hash = "sha256:abc"\n\n${section("session_end", 0)}\ntrusted_hash = "sha256:def"\n`;

    expect(readCodexTrustState(toml, hooksPath, { stop: 3, sessionEnd: 0 })).toEqual({
      stop: "recorded",
      sessionEnd: "recorded",
    });
  });

  it("區段含 enabled = false → disabled，即使同時有 trusted_hash", () => {
    const toml = `${section("stop", 0)}\ntrusted_hash = "sha256:abc"\nenabled = false\n`;

    expect(readCodexTrustState(toml, hooksPath, { stop: 0 }).stop).toBe("disabled");
  });

  it("缺區段、空字串或索引不符 → awaiting", () => {
    const toml = `${section("stop", 0)}\ntrusted_hash = "sha256:abc"\n`;

    expect(readCodexTrustState(toml, hooksPath, { stop: 1 }).stop).toBe("awaiting");
    expect(readCodexTrustState("", hooksPath, { stop: 0 }).stop).toBe("awaiting");
    expect(readCodexTrustState(toml, "/other/hooks.json", { stop: 0 }).stop).toBe("awaiting");
  });

  it("只認區段標頭到下一個 [ 之前的行，不把別的區段的 trusted_hash 算進來", () => {
    const toml = `${section("stop", 0)}\n\n[other.table]\ntrusted_hash = "sha256:not-ours"\n`;

    expect(readCodexTrustState(toml, hooksPath, { stop: 0 }).stop).toBe("awaiting");
  });

  it("未提供索引的事件不回報狀態", () => {
    expect(readCodexTrustState("", hooksPath, { stop: 0 }).sessionEnd).toBeUndefined();
  });
});

describe("hasTrackerNotify", () => {
  it("頂層 notify 指向 tracker 的 codex-sync.mjs → true", () => {
    const toml = 'notify = ["node", "/Users/x/.config/ccusage-tracker/codex-sync.mjs", "--notify"]\n\n[tui]\nx = 1\n';

    expect(hasTrackerNotify(toml)).toBe(true);
  });

  it("跨行的 notify 陣列也能認出來", () => {
    const toml = 'notify = [\n "node",\n "/Users/x/.config/ccusage-tracker/codex-sync.mjs",\n "--notify"\n]\n';

    expect(hasTrackerNotify(toml)).toBe(true);
  });

  it("notify 之前有跨行的頂層陣列：掃描不中斷，仍認得出 tracker 的 notify", () => {
    // 續行以 `[` 開頭（巢狀陣列）不代表進入 table；只有整行是 [name] 才是 table 標頭。
    const toml = 'pairs = [\n [1, 2],\n [3, 4],\n]\nnotify = ["node", "/Users/x/.config/ccusage-tracker/codex-sync.mjs", "--notify"]\n';

    expect(hasTrackerNotify(toml)).toBe(true);
  });

  it("進入第一個 table 之後的 notify 仍然不算數", () => {
    const toml = '[tui]\ntheme = "dark"\nnotify = ["node", "/Users/x/.config/ccusage-tracker/codex-sync.mjs"]\n';

    expect(hasTrackerNotify(toml)).toBe(false);
  });

  it("第三方 notify 或 table 內的同名鍵 → false（hooks 與 notify 可共存）", () => {
    expect(hasTrackerNotify('notify = ["say", "done"]\n')).toBe(false);
    expect(hasTrackerNotify('[some.table]\nnotify = ["/x/ccusage-tracker/codex-sync.mjs"]\n')).toBe(false);
    expect(hasTrackerNotify("")).toBe(false);
  });
});

describe("detectCodex", () => {
  it("CODEX_HOME 目錄存在 → true", () => {
    const dir = scratch();
    process.env.CODEX_HOME = dir;
    process.env.PATH = "";

    expect(detectCodex()).toBe(true);
  });

  it("目錄不存在且 codex 不在 PATH → false", () => {
    process.env.CODEX_HOME = join(scratch(), "absent");
    process.env.PATH = "";

    expect(detectCodex()).toBe(false);
  });

  it("目錄不存在但 codex 在 PATH → true", () => {
    const dir = scratch();
    const bin = join(dir, "bin space");
    mkdirSync(bin);
    writeFileSync(join(bin, "codex"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env.CODEX_HOME = join(dir, "absent");
    process.env.PATH = bin;

    expect(detectCodex()).toBe(true);
  });
});
