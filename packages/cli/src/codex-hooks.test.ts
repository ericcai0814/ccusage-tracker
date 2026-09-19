import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  applyCodexHooks,
  detectCodex,
  findCodexTrackerIndexes,
  formatCodexTrustLine,
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

// Codex 補審 [med]：只檢查命令「含有」腳本路徑時，`sha256sum "<script>"` 這種第三方
// 命令會被整組替換成上報 hook，原有功能與額外欄位一併消失。辨識改為整條命令的形狀比對。
describe("isCodexTrackerHook 只認標準命令形狀", () => {
  const script = "/Users/x/.config/ccusage-tracker/codex-sync.mjs";

  it("第三方命令只是引用腳本路徑：群組位元組不變留在原索引，tracker append 在尾端", () => {
    for (const thirdPartyCommand of [
      `sha256sum "${script}"`,
      `node "${script}" --hook && echo done`,
      `cat ${script} | wc -l`,
    ]) {
      const group = { hooks: [{ type: "command", command: thirdPartyCommand, timeout: 3 }], note: "keep" };

      const result = applyCodexHooks({ hooks: { Stop: [group] } }, command);

      const stop = result.updated.hooks!.Stop!;
      expect(stop).toHaveLength(2);
      expect(JSON.stringify(stop[0])).toBe(JSON.stringify(group));
      expect(stop[1]).toEqual({ hooks: [{ type: "command", command, timeout: 45 }] });
    }
  });

  it("引號外有 shell 運算子（含無空白黏在參數後）：群組原樣保留，tracker append 在尾端", () => {
    for (const thirdPartyCommand of [
      `node "${script}" --hook&&false`,
      `node "${script}" --hook;rm -rf /tmp/x`,
      `node "${script}" --hook|tee /tmp/x`,
      `node "${script}" --hook>/tmp/x`,
      `node "${script}" $(whoami)`,
    ]) {
      const group = { hooks: [{ type: "command", command: thirdPartyCommand, timeout: 3 }], note: "keep" };

      const result = applyCodexHooks({ hooks: { Stop: [group] } }, command);

      const stop = result.updated.hooks!.Stop!;
      expect(stop).toHaveLength(2);
      expect(JSON.stringify(stop[0])).toBe(JSON.stringify(group));
      expect(stop[1]).toEqual({ hooks: [{ type: "command", command, timeout: 45 }] });
    }
  });

  // 腳本路徑必須是單一 token：重組空白會讓「把 tracker 路徑當參數傳給別的腳本」
  // 被誤收並整條刪掉（詳見 hooks.test.ts 的同名 describe）。
  it("未加引號且含空白的路徑、或路徑前另有一支腳本：視為第三方", () => {
    for (const thirdPartyCommand of [
      `node /Users/Gill Chiang/.config/ccusage-tracker/codex-sync.mjs --hook`,
      `node /opt/lint.js config/ccusage-tracker/codex-sync.mjs`,
    ]) {
      const result = applyCodexHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: thirdPartyCommand }] }] } }, command);

      expect(result.updated.hooks!.Stop).toHaveLength(2);
      expect(result.updated.hooks!.Stop![0].hooks[0].command).toBe(thirdPartyCommand);
    }
  });

  // 審查閘 round 4：Codex 實測出的繞過形狀原文。共通點是字串長得像 tracker 路徑，
  // 但 shell 實際執行的是別的檔案 —— 認錯就會把第三方 hook 整條刪掉。
  it("shell 會改寫字面意義的字元：反斜線、%VAR%、引號內的 $() 與反引號皆為第三方", () => {
    const bypasses = [
      'node "/tmp/ccusage-tracker/codex-sync.mjs --hook',                       // 未閉合引號
      'node "/tmp/ccusage-tracker/codex-sync.mjs" --hook\necho keep',           // 引號外換行
      "node /tmp/ccusage-tracker\\codex-sync.mjs --hook",                        // POSIX 會把 \c 當跳脫
      "node C:/%TARGET%/ccusage-tracker/codex-sync.mjs --hook",                 // cmd.exe 變數展開
      "node C:/ccusage-tracker^/codex-sync.mjs --hook",                         // cmd.exe 跳脫字元
      'node "/tmp/$(printf keep)/ccusage-tracker/codex-sync.mjs" --hook',       // 雙引號內仍會展開
      'node "/tmp/`printf keep`/ccusage-tracker/codex-sync.mjs" --hook',        // 同上，反引號
    ];

    for (const thirdPartyCommand of bypasses) {
      const group = { hooks: [{ type: "command", command: thirdPartyCommand }], note: "keep" };

      const result = applyCodexHooks({ hooks: { Stop: [group] } }, command);

      expect([thirdPartyCommand, result.updated.hooks!.Stop!.length]).toEqual([thirdPartyCommand, 2]);
      expect(JSON.stringify(result.updated.hooks!.Stop![0])).toBe(JSON.stringify(group));
    }
  });

  it("codex-sync.mjs 只接受 node 直譯器：bash 跑 .mjs 視為第三方", () => {
    const thirdPartyCommand = `bash ${script}`;
    const result = applyCodexHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: thirdPartyCommand }] }] } }, command);

    expect(result.updated.hooks!.Stop).toHaveLength(2);
    expect(result.updated.hooks!.Stop![0].hooks[0].command).toBe(thirdPartyCommand);
  });

  it("標準形狀仍被辨識並就地替換：帶引號、不帶引號、帶引號 node 絕對路徑、--notify", () => {
    for (const existing of [
      `node "${script}" --hook`,
      `node ${script} --hook`,
      `"/usr/local/bin/node" "${script}"`,
      `node "${script}" --notify`,
      `node "C:/Users/x/.config/ccusage-tracker/codex-sync.mjs" --hook`,
      `node "/Users/Gill Chiang/.config/ccusage-tracker/codex-sync.mjs" --hook`,
    ]) {
      const result = applyCodexHooks({ hooks: { Stop: [{ hooks: [{ type: "command", command: existing, timeout: 3 }] }] } }, command);

      expect(result.updated.hooks!.Stop).toEqual([{ hooks: [{ type: "command", command, timeout: 45 }] }]);
    }
  });
});

describe("readCodexTrustState", () => {
  const hooksPath = "/Users/test/.codex/hooks.json";
  const section = (event: string, group: number, hook = 0) =>
    `[hooks.state."${hooksPath}:${event}:${group}:${hook}"]`;

  it("區段含 trusted_hash → recorded", () => {
    const toml = `model = "gpt-5"\n\n${section("stop", 3)}\ntrusted_hash = "sha256:abc"\n\n${section("session_end", 0)}\ntrusted_hash = "sha256:def"\n`;

    expect(readCodexTrustState(toml, hooksPath, { stop: { group: 3, hook: 0 }, sessionEnd: { group: 0, hook: 0 } })).toEqual({
      stop: "recorded",
      sessionEnd: "recorded",
    });
  });

  it("區段含 enabled = false → disabled，即使同時有 trusted_hash", () => {
    const toml = `${section("stop", 0)}\ntrusted_hash = "sha256:abc"\nenabled = false\n`;

    expect(readCodexTrustState(toml, hooksPath, { stop: { group: 0, hook: 0 } }).stop).toBe("disabled");
  });

  it("缺區段、空字串或索引不符 → awaiting", () => {
    const toml = `${section("stop", 0)}\ntrusted_hash = "sha256:abc"\n`;

    expect(readCodexTrustState(toml, hooksPath, { stop: { group: 1, hook: 0 } }).stop).toBe("awaiting");
    expect(readCodexTrustState("", hooksPath, { stop: { group: 0, hook: 0 } }).stop).toBe("awaiting");
    expect(readCodexTrustState(toml, "/other/hooks.json", { stop: { group: 0, hook: 0 } }).stop).toBe("awaiting");
  });

  it("只認區段標頭到下一個 [ 之前的行，不把別的區段的 trusted_hash 算進來", () => {
    const toml = `${section("stop", 0)}\n\n[other.table]\ntrusted_hash = "sha256:not-ours"\n`;

    expect(readCodexTrustState(toml, hooksPath, { stop: { group: 0, hook: 0 } }).stop).toBe("awaiting");
  });

  it("未提供索引的事件不回報狀態", () => {
    expect(readCodexTrustState("", hooksPath, { stop: { group: 0, hook: 0 } }).sessionEnd).toBeUndefined();
  });

  // Codex 補審 [low]：信任 key 的 hook 索引原本寫死 :0，但安裝支援
  // 「第三方 hook 在前、tracker 在後」的混合群組。tracker 落在 hooks[1] 時，
  // 寫死的 :0 會去讀第三方那一條的信任或停用紀錄。
  it("混合群組：索引取實際的 group 與 hook，不讀同群組第一條的紀錄", () => {
    const tracker = { type: "command", command: getCodexHookCommand() };
    const file: CodexHooksFile = {
      hooks: {
        Stop: [thirdParty("a"), thirdParty("b"), { hooks: [{ type: "command", command: "echo keep" }, tracker] }],
        SessionEnd: [{ hooks: [tracker] }],
      },
    };

    const indexes = findCodexTrackerIndexes(file);

    expect(indexes).toEqual({ stop: { group: 2, hook: 1 }, sessionEnd: { group: 0, hook: 0 } });
    // 第三方那一條（:stop:2:0）有信任紀錄，tracker（:stop:2:1）沒有 → 不得冒稱已信任
    const neighbour = `${section("stop", 2, 0)}\ntrusted_hash = "sha256:not-ours"\n`;
    expect(readCodexTrustState(neighbour, hooksPath, indexes).stop).toBe("awaiting");
    const ours = `${section("stop", 2, 1)}\ntrusted_hash = "sha256:ours"\n`;
    expect(readCodexTrustState(ours, hooksPath, indexes).stop).toBe("recorded");
  });
});

// Eric 本機的真實情境：Stop 已信任、SessionEnd 還沒（兩條 hook 的信任是分開記的）。
// 只說「awaiting trust」會讓人以為兩條都要重做，訊息必須逐 hook 講清楚。
describe("formatCodexTrustLine", () => {
  const combos = {
    recorded: { stop: "recorded", sessionEnd: "recorded" },
    awaiting: { stop: "awaiting", sessionEnd: "awaiting" },
    partial: { stop: "recorded", sessionEnd: "awaiting" },
    disabled: { stop: "disabled", sessionEnd: "recorded" },
  } as const;

  it("status 的四種組合逐字符合規格", () => {
    expect(formatCodexTrustLine(combos.recorded, { forStatus: true })).toBe("Codex hooks: installed, trust recorded");
    expect(formatCodexTrustLine(combos.awaiting, { forStatus: true })).toBe("Codex hooks: installed, awaiting trust (open /hooks in Codex)");
    expect(formatCodexTrustLine(combos.partial, { forStatus: true }))
      .toBe("Codex hooks: installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)");
    expect(formatCodexTrustLine(combos.disabled, { forStatus: true }))
      .toBe("Codex hooks: installed, Stop disabled in Codex, SessionEnd trusted");
  });

  it("setup／update 的四種組合逐字符合規格", () => {
    // 皆 recorded 代表兩條都沒被動過（動過的會先被降成 awaiting），措辭是 trust recorded
    expect(formatCodexTrustLine(combos.recorded, { forStatus: false }))
      .toBe("Codex: hooks already up to date (trust recorded)");
    expect(formatCodexTrustLine(combos.awaiting, { forStatus: false }))
      .toBe("Codex: hooks installed (Stop, SessionEnd). Open Codex and run /hooks once to trust the ccusage-tracker hooks.");
    expect(formatCodexTrustLine(combos.partial, { forStatus: false }))
      .toBe("Codex: hooks installed (Stop trusted, SessionEnd awaiting trust). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook.");
    expect(formatCodexTrustLine(combos.disabled, { forStatus: false }))
      .toBe("Codex: hooks installed (Stop disabled in Codex, SessionEnd trusted).");
  });

  it("兩條皆停用：安裝端與 status 都收斂為單句", () => {
    const allDisabled = { stop: "disabled", sessionEnd: "disabled" } as const;

    expect(formatCodexTrustLine(allDisabled, { forStatus: false })).toBe("Codex: hooks installed but disabled in Codex");
    expect(formatCodexTrustLine(allDisabled, { forStatus: true })).toBe("Codex hooks: installed, disabled in Codex");
  });

  it("已停用的 hook 不再被要求去信任", () => {
    for (const forStatus of [true, false]) {
      expect(formatCodexTrustLine(combos.disabled, { forStatus })).not.toContain("/hooks");
    }
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

  // Codex 補審 [low] 與 subagent F4：頂層掃描原本只認 `^\[[^\]]*\]$`，於是
  // `[[servers]]` 與帶行尾註解的標頭沒被當成 table（提示多印），無尾逗號的
  // `[3, 4]` 續行與多行字串裡的 `[tui]` 卻被當成 table（提示漏印）。
  describe("頂層掃描正確處理陣列、字串與註解", () => {
    const tracker = 'notify = ["node", "/Users/x/.config/ccusage-tracker/codex-sync.mjs", "--notify"]\n';
    const fixtures: [string, string, string][] = [
      // [名稱, notify 之前的頂層內容, notify 之前的 table 內容]
      ["[[array]] 標頭", "", '[[servers]]\nurl = "x"\n'],
      ["帶行尾註解的標頭", "", '[tui] # theme settings\ntheme = "dark"\n'],
      ["無尾逗號的陣列續行", "pairs = [\n [1, 2],\n [3, 4]\n]\n", '[tui]\npairs = [\n [1, 2],\n [3, 4]\n]\n'],
      ["多行字串內含 table 標頭", 'banner = """\n[tui]\n"""\n', '[tui]\nbanner = """\nx\n"""\n'],
      // TOML 的多行基本字串同樣吃反斜線跳脫：\""" 不會提前結束字串
      ["三引號內的跳脫引號", 'banner = """\nquote: \\"""\n[tui]\n"""\n', 'banner = """\n\\"""\nnotify = ["node", "/x/ccusage-tracker/codex-sync.mjs"]\n"""\n[tui]\n'],
      // literal 字串不吃跳脫：結尾的 ''' 照樣結束字串
      ["literal 字串不吃跳脫", "path = '''C:\\Users\\x\\'''\n", "[tui]\npath = '''C:\\Users\\x\\'''\n"],
    ];

    for (const [name, topLevel, insideTable] of fixtures) {
      it(`${name}：notify 在頂層 → true`, () => {
        expect(hasTrackerNotify(topLevel + tracker)).toBe(true);
      });

      it(`${name}：notify 在 table 內 → false`, () => {
        expect(hasTrackerNotify(insideTable + tracker)).toBe(false);
      });
    }
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
