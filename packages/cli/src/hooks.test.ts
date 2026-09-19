import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  applyTrackerHooks,
  buildHookCommand,
  detectClaude,
  getHookCommand,
  getStartHookCommand,
  getStopHookCommand,
  installFiles,
} from "./hooks";
import { getCodexHookCommand } from "./codex-hooks";

// 注意：installHook 會寫入真實 ~/.claude/settings.json 與 ~/.config（bun 的 os.homedir()
// 在 process 啟動時就快取 $HOME，無法在測試內安全覆寫）。因此合併邏輯只測純函式
// applyTrackerHooks；需要碰檔案系統的交易層改測 installFiles，路徑全部由測試給定的
// 暫存目錄決定，不經過 homedir()。

const startCmd = getStartHookCommand();
const endCmd = getHookCommand();
const stopCmd = getStopHookCommand();

function matcher(
  command: string,
  opts: { timeout?: number; matcher?: string } = {}
) {
  const hook: { type: string; command: string; timeout?: number } = { type: "command", command };
  if (opts.timeout !== undefined) hook.timeout = opts.timeout;
  return { matcher: opts.matcher ?? "*", hooks: [hook] };
}

function shellArgsForHookCommand(command: string): string[] {
  const probe = command.replace(
    "node ",
    "node -e 'console.log(JSON.stringify(process.argv.slice(1)))' -- "
  );
  const result = Bun.spawnSync(["sh", "-c", probe]);
  expect(result.exitCode).toBe(0);
  return JSON.parse(result.stdout.toString().trim()) as string[];
}

describe("hook 命令", () => {
  it("getStartHookCommand 以 node 執行 session-start.mjs，且腳本路徑有雙引號", () => {
    expect(startCmd).toContain("node ");
    expect(startCmd).toContain("session-start.mjs");
    expect(startCmd).not.toContain("--mode");
    expect(startCmd).toMatch(/^node ".*session-start\.mjs"$/);
  });

  it("getHookCommand 帶 --mode=session-end，且腳本路徑有雙引號", () => {
    expect(endCmd).toContain("session-end.mjs");
    expect(endCmd).toContain("--mode=session-end");
    expect(endCmd).toMatch(/^node ".*session-end\.mjs" --mode=session-end$/);
  });

  it("getStopHookCommand 帶 --mode=stop 且共用 session-end.mjs，且腳本路徑有雙引號", () => {
    expect(stopCmd).toContain("session-end.mjs");
    expect(stopCmd).toContain("--mode=stop");
    expect(stopCmd).toMatch(/^node ".*session-end\.mjs" --mode=stop$/);
  });

  it("含空格腳本路徑經 shell word-split 後仍保留為單一 node 參數", () => {
    const scriptPath = "/Users/Gill Chiang/.config/ccusage-tracker/session-end.mjs";
    const command = buildHookCommand(scriptPath, "stop");

    expect(command).toBe(`node "${scriptPath}" --mode=stop`);
    expect(shellArgsForHookCommand(command)).toEqual([scriptPath, "--mode=stop"]);
  });

  it("Windows 風格含空格腳本路徑會被雙引號包住", () => {
    const scriptPath = String.raw`C:\Users\Gill Chiang\.config\ccusage-tracker\session-start.mjs`;

    expect(buildHookCommand(scriptPath)).toBe(`node "${scriptPath}"`);
  });

  it("三條命令彼此不同", () => {
    expect(startCmd).not.toBe(endCmd);
    expect(endCmd).not.toBe(stopCmd);
    expect(startCmd).not.toBe(stopCmd);
  });
});

describe("applyTrackerHooks", () => {
  it("空 settings：三條 hook 都被 install", () => {
    const r = applyTrackerHooks({});

    expect(r.sessionStartChanged).toBe(true);
    expect(r.sessionEndChanged).toBe(true);
    expect(r.stopChanged).toBe(true);
    expect(r.anyChanged).toBe(true);
    expect(r.updated.hooks?.SessionStart).toHaveLength(1);
    expect(r.updated.hooks?.SessionEnd).toHaveLength(1);
    expect(r.updated.hooks?.Stop).toHaveLength(1);
    expect(r.updated.hooks?.Stop?.[0].hooks[0].command).toContain("--mode=stop");
    expect(r.updated.hooks?.Stop?.[0].hooks[0].timeout).toBe(45);
    expect(r.updated.hooks?.SessionEnd?.[0].hooks[0].timeout).toBe(45);
  });

  it("冪等：三條都正確時 noop，回傳同一物件參考", () => {
    const existing = {
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: startCmd }] }],
        SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: endCmd, timeout: 45 }] }],
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: stopCmd, timeout: 45 }] }],
      },
    };
    const r = applyTrackerHooks(existing);

    expect(r.sessionStartChanged).toBe(false);
    expect(r.sessionEndChanged).toBe(false);
    expect(r.stopChanged).toBe(false);
    expect(r.anyChanged).toBe(false);
    expect(r.updated).toBe(existing);
  });

  it("matcher \"\" 與 \"*\" 視為等價：命令對、只是 matcher 不同 → noop（不觸發 spurious 重寫）", () => {
    // Claude Code 對 SessionEnd 把 "" 跟 "*" 都視為 match-all，兩者語意等價。
    // 設計選擇：保守 — 不動 user 的 matcher 字面值，只在等價時當 noop。
    // 避免 0.1.1 設下的 matcher: "" 觸發每次 setup 都寫一次 settings.json。
    const existing = {
      hooks: {
        SessionEnd: [{ matcher: "", hooks: [{ type: "command", command: endCmd, timeout: 45 }] }],
        // SessionStart / Stop 缺失，下面只斷言 SessionEnd 不被視為 changed
      },
    };
    const r = applyTrackerHooks(existing);
    expect(r.sessionEndChanged).toBe(false);
    // matcher 字面值不變
    expect(r.updated.hooks?.SessionEnd?.[0].matcher).toBe("");
  });

  it("Migration：偵測到舊命令（無 --mode、無 timeout）→ 原地替換為新命令", () => {
    const legacyEndCmd = "node /home/u/.config/ccusage-tracker/session-end.mjs"; // 舊版無 --mode
    const legacy = {
      hooks: {
        SessionStart: [matcher(startCmd)],
        SessionEnd: [matcher(legacyEndCmd)],
      },
    };
    const r = applyTrackerHooks(legacy);

    expect(r.sessionEndChanged).toBe(true);
    expect(r.stopChanged).toBe(true);
    expect(r.updated.hooks?.SessionEnd).toHaveLength(1); // 替換不重複
    expect(r.updated.hooks?.SessionEnd?.[0].hooks[0].command).toBe(endCmd);
    expect(r.updated.hooks?.SessionEnd?.[0].hooks[0].timeout).toBe(45);
    expect(r.updated.hooks?.Stop).toHaveLength(1);
  });

  it("Migration：既有無引號 tracker command 會被替換成有引號 canonical command", () => {
    const unquotedStartCmd = startCmd.replace('node "', "node ").replace('"', "");
    const unquotedEndCmd = endCmd.replace('node "', "node ").replace('"', "");
    const unquotedStopCmd = stopCmd.replace('node "', "node ").replace('"', "");
    const legacy = {
      hooks: {
        SessionStart: [matcher(unquotedStartCmd)],
        SessionEnd: [matcher(unquotedEndCmd, { timeout: 45 })],
        Stop: [matcher(unquotedStopCmd, { timeout: 45 })],
      },
    };
    const r = applyTrackerHooks(legacy);

    expect(r.sessionStartChanged).toBe(true);
    expect(r.sessionEndChanged).toBe(true);
    expect(r.stopChanged).toBe(true);
    expect(r.updated.hooks?.SessionStart?.[0].hooks[0].command).toBe(startCmd);
    expect(r.updated.hooks?.SessionEnd?.[0].hooks[0].command).toBe(endCmd);
    expect(r.updated.hooks?.Stop?.[0].hooks[0].command).toBe(stopCmd);
  });

  it("修復路徑：只有 SessionEnd 舊安裝 → SessionStart + Stop 補上，SessionEnd 升級", () => {
    const legacyEndCmd = "node /home/u/.config/ccusage-tracker/session-end.mjs";
    const legacy = { hooks: { SessionEnd: [matcher(legacyEndCmd)] } };
    const r = applyTrackerHooks(legacy);

    expect(r.sessionStartChanged).toBe(true);
    expect(r.sessionEndChanged).toBe(true);
    expect(r.stopChanged).toBe(true);
    expect(r.updated.hooks?.SessionStart).toHaveLength(1);
    expect(r.updated.hooks?.SessionEnd).toHaveLength(1); // 升級為新命令
    expect(r.updated.hooks?.Stop).toHaveLength(1);
  });

  it("保留既有 settings 的其他欄位與第三方 hook entry", () => {
    const settings = {
      model: "opus",
      hooks: {
        PreToolUse: [matcher("/some/other/hook")],
        SessionEnd: [matcher("bash /existing/session-end-parse.sh")],
        Stop: [matcher("/other/stop-hook")],
      },
    };
    const r = applyTrackerHooks(settings);

    expect(r.updated.model).toBe("opus");
    expect(r.updated.hooks?.PreToolUse).toHaveLength(1);
    expect(r.updated.hooks?.SessionEnd).toHaveLength(2);
    expect(r.updated.hooks?.Stop).toHaveLength(2);
  });

  it("E-1 regression：tracker hook 與第三方 hook bundled 在同 matcher 內，第三方 hook 必須保留", () => {
    // 用戶手動把第三方 hook 加進了 tracker matcher 的同個 hooks 陣列
    const legacyEndCmd = "node /home/u/.config/ccusage-tracker/session-end.mjs";
    const settings = {
      hooks: {
        SessionEnd: [
          {
            matcher: "*",
            hooks: [
              { type: "command", command: legacyEndCmd }, // tracker（舊）
              { type: "command", command: "node my-custom-tool.js" }, // 第三方
            ],
          },
        ],
      },
    };
    const r = applyTrackerHooks(settings);

    // 第三方 hook 必須出現在結果中（在自己的 matcher entry 內）
    const allCommands = r.updated.hooks?.SessionEnd?.flatMap((m) => m.hooks.map((h) => h.command)) ?? [];
    expect(allCommands).toContain("node my-custom-tool.js");
    expect(allCommands).toContain(endCmd); // 我們的新命令也在
    // 舊命令必須被清掉
    expect(allCommands).not.toContain(legacyEndCmd);
  });

  it("E-4 regression：殘留 duplicate tracker matcher 必須被清成單一份", () => {
    const legacyEndCmd = "node /home/u/.config/ccusage-tracker/session-end.mjs";
    const settings = {
      hooks: {
        SessionEnd: [
          matcher(legacyEndCmd, { matcher: "" }),
          matcher(endCmd, { matcher: "*", timeout: 45 }),
        ],
      },
    };
    const r = applyTrackerHooks(settings);

    expect(r.updated.hooks?.SessionEnd).toHaveLength(1);
    expect(r.updated.hooks?.SessionEnd?.[0].hooks[0].command).toBe(endCmd);
  });

  it("不變動原始輸入物件（immutability）", () => {
    const settings = { hooks: { SessionEnd: [matcher(endCmd, { timeout: 45, matcher: "*" })] } };
    applyTrackerHooks(settings);

    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks).not.toHaveProperty("SessionStart");
    expect(settings.hooks).not.toHaveProperty("Stop");
  });
});

// setup／update 現在對「偵測到的每個工具」接線，所以偵測本身必須可測。
// homedir() 在 bun 內被快取（見檔頭註記），detectClaude 因此接受 home 參數。
describe("detectClaude", () => {
  const originalPath = process.env.PATH;
  const temporaries: string[] = [];
  const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), "claude detect "));
    temporaries.push(dir);
    return dir;
  };
  afterEach(() => {
    process.env.PATH = originalPath;
    while (temporaries.length) rmSync(temporaries.pop()!, { recursive: true, force: true });
  });

  it("~/.claude 目錄存在 → true", () => {
    const home = scratch();
    mkdirSync(join(home, ".claude"));
    process.env.PATH = "";

    expect(detectClaude(home)).toBe(true);
  });

  it("目錄不存在且 claude 不在 PATH → false", () => {
    process.env.PATH = "";

    expect(detectClaude(scratch())).toBe(false);
  });

  it("目錄不存在但 claude 在 PATH → true", () => {
    const home = scratch();
    const bin = join(home, "bin space");
    mkdirSync(bin);
    writeFileSync(join(bin, "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    process.env.PATH = bin;

    expect(detectClaude(home)).toBe(true);
  });
});

// tracker hook 的辨識現在也涵蓋 codex-sync.mjs：手動塞進 Claude settings.json 的
// Codex 腳本屬於 tracker 自己的殘留，升級時要被收掉，不能留著重複觸發。
describe("tracker hook 辨識涵蓋 codex-sync.mjs", () => {
  it("Claude SessionEnd 裡的 codex-sync hook 會被視為 tracker hook 收掉", () => {
    const result = applyTrackerHooks({
      hooks: { SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: getCodexHookCommand() }] }] },
    });

    const commands = result.updated.hooks!.SessionEnd!.flatMap((m) => m.hooks.map((h) => h.command));
    expect(commands).toEqual([getHookCommand()]);
  });
});

// dotfiles 使用者的 ~/.claude/settings.json 與 $CODEX_HOME/hooks.json 常是 symlink。
// 交易要寫穿到真實檔案並保留 symlink，但不放寬對目錄、斷鏈這類非一般檔案的拒絕。
describe("installFiles 對 symlink 設定檔寫穿真實檔案", () => {
  let scratches: string[] = [];
  // macOS 的 /var 本身是 symlink（→ /private/var），暫存目錄先正規化，
  // 否則「訊息含 symlink 目標」的斷言會被 /private 前綴弄假。
  const scratch = (prefix: string): string => {
    const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
    scratches = [...scratches, dir];
    return dir;
  };
  const leftovers = (dir: string): string[] =>
    readdirSync(dir).filter((name) => name.endsWith(".tmp") || name.endsWith(".rollback"));
  const refusal = (files: { path: string; content: string }[]): string => {
    try {
      installFiles(files);
      return "";
    } catch (error) {
      return (error as Error).message;
    }
  };

  afterEach(() => {
    for (const dir of scratches) rmSync(dir, { recursive: true, force: true });
    scratches = [];
  });

  it("symlink → 一般檔案：內容進真實檔案、symlink 保留、backup 在真實檔案旁", () => {
    const home = scratch("tracker home ");
    const dotfiles = scratch("tracker dotfiles ");
    const real = join(dotfiles, "settings.json");
    const link = join(home, ".claude", "settings.json");
    const script = join(home, ".config", "ccusage-tracker", "session-end.mjs");
    const previous = '{"model":"opus"}\n';
    const next = '{"model":"opus","hooks":{"Stop":[]}}\n';
    writeFileSync(real, previous);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(real, link);

    const installed = installFiles([
      { path: script, content: "// session-end\n" },
      { path: link, content: next },
    ]);

    expect(installed.backedUp).toBe(true);
    // 寫穿的是 settings.json，腳本是一般檔案：只回報前者
    expect(installed.writtenThrough).toEqual([{ link, real }]);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe(next);
    expect(readFileSync(link, "utf8")).toBe(next);
    expect(readFileSync(`${real}.backup`, "utf8")).toBe(previous);
    expect(existsSync(`${link}.backup`)).toBe(false);
    expect(readFileSync(script, "utf8")).toBe("// session-end\n");
    expect(leftovers(dotfiles)).toEqual([]);
    expect(leftovers(dirname(link))).toEqual([]);
    expect(leftovers(dirname(script))).toEqual([]);
  });

  it("symlink → 目錄：整筆交易拒絕，訊息帶出 link 目標，其他檔案不落地", () => {
    const home = scratch("tracker home ");
    const target = scratch("tracker target ");
    const link = join(home, "codex", "hooks.json");
    const script = join(home, ".config", "ccusage-tracker", "codex-sync.mjs");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);

    const message = refusal([
      { path: script, content: "// codex-sync\n" },
      { path: link, content: "{}\n" },
    ]);

    expect(message).toContain("Refusing to replace non-regular file");
    expect(message).toContain(link);
    expect(message).toContain(target);
    // 驗證全部發生在 staging 之前，所以腳本目錄根本沒被建出來
    expect(existsSync(dirname(script))).toBe(false);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readdirSync(target)).toEqual([]);
    expect(leftovers(dirname(link))).toEqual([]);
  });

  // Codex 補審 [med] 的另一半：目標的型態驗證必須全部發生在 staging 之前，否則第二個
  // 檔案被拒時，第一個檔案已經建了目錄、寫了暫存檔與備份暫存檔。
  it("第二個檔案驗證失敗：第一個檔案的目錄都不該被建出來", () => {
    const home = scratch("tracker home ");
    const target = scratch("tracker target ");
    const link = join(home, "codex", "hooks.json");
    const scriptDir = join(home, ".config", "ccusage-tracker");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(target, link);

    const message = refusal([
      { path: join(scriptDir, "codex-sync.mjs"), content: "// codex-sync\n" },
      { path: link, content: "{}\n" },
    ]);

    expect(message).toContain("Refusing to replace non-regular file");
    expect(existsSync(scriptDir)).toBe(false);
  });

  it("第二個檔案驗證失敗：第一個檔案的既有內容與既有 .backup 位元組不變，且無殘留", () => {
    const home = scratch("tracker home ");
    const target = scratch("tracker target ");
    const link = join(home, "codex", "hooks.json");
    const scriptDir = join(home, ".config", "ccusage-tracker");
    const script = join(scriptDir, "codex-sync.mjs");
    mkdirSync(dirname(link), { recursive: true });
    mkdirSync(scriptDir, { recursive: true });
    writeFileSync(script, "// previous\n");
    writeFileSync(`${script}.backup`, "older backup\n");
    symlinkSync(target, link);

    const message = refusal([
      { path: script, content: "// codex-sync\n" },
      { path: link, content: "{}\n" },
    ]);

    expect(message).toContain("Refusing to replace non-regular file");
    expect(readFileSync(script, "utf8")).toBe("// previous\n");
    expect(readFileSync(`${script}.backup`, "utf8")).toBe("older backup\n");
    expect(leftovers(scriptDir)).toEqual([]);
  });

  it("symlink → FIFO（無 writer）：不開啟 FIFO，直接以非一般檔案訊息拒絕", () => {
    const home = scratch("tracker home ");
    const fifoDir = scratch("tracker fifo ");
    const fifo = join(fifoDir, "hooks.fifo");
    const link = join(home, "codex", "hooks.json");
    execFileSync("mkfifo", [fifo]);
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(fifo, link);

    // 沒有 writer 的 FIFO 一旦被 open(2) 讀就會永久阻塞；本測試能回到這一行，
    // 就證明拒絕發生在任何 readFileSync 之前。
    const message = refusal([{ path: link, content: "{}\n" }]);

    expect(message).toContain("Refusing to replace non-regular file");
    expect(message).toContain(link);
    expect(message).toContain(fifo);
    expect(message).not.toContain("JSON");
  });

  it("斷鏈 symlink：整筆交易拒絕，訊息帶出 link 目標，其他檔案不落地", () => {
    const home = scratch("tracker home ");
    const missing = join(scratch("tracker target "), "hooks.json");
    const link = join(home, "codex", "hooks.json");
    const script = join(home, ".config", "ccusage-tracker", "codex-sync.mjs");
    mkdirSync(dirname(link), { recursive: true });
    symlinkSync(missing, link);

    const message = refusal([
      { path: script, content: "// codex-sync\n" },
      { path: link, content: "{}\n" },
    ]);

    expect(message).toContain("Refusing to replace non-regular file");
    expect(message).toContain(link);
    expect(message).toContain(missing);
    expect(existsSync(dirname(script))).toBe(false);
    expect(existsSync(missing)).toBe(false);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(leftovers(dirname(link))).toEqual([]);
  });
});

// Codex 補審 [med]：辨識規則原本只檢查命令字串「含有」腳本路徑，於是任何引用該路徑的
// 第三方命令（雜湊校驗、包一層的複合命令）都會被整組換成上報 hook，原有功能直接消失。
// 現在整條命令必須符合標準形狀：可選的 node 執行檔、tracker 腳本絕對路徑、只有 tracker
// 自己的參數。其餘一律視為第三方，原樣保留，tracker 另行 append。
describe("tracker hook 辨識只認標準命令形狀", () => {
  const trackerScript = "/Users/x/.config/ccusage-tracker/session-end.mjs";

  const commandsIn = (settings: Parameters<typeof applyTrackerHooks>[0], event: "SessionEnd" | "Stop" | "SessionStart") =>
    applyTrackerHooks(settings).updated.hooks?.[event]?.flatMap((m) => m.hooks.map((h) => h.command)) ?? [];

  it("第三方命令只是引用腳本路徑：原樣保留，tracker 另行 append", () => {
    for (const thirdParty of [
      `sha256sum "${trackerScript}"`,
      `node "${trackerScript}" --mode=stop && echo done`,
      `cat ${trackerScript} | head -1`,
      `bash -c 'node "${trackerScript}" --mode=stop'`,
    ]) {
      const commands = commandsIn({ hooks: { Stop: [matcher(thirdParty)] } }, "Stop");

      expect(commands).toEqual([thirdParty, stopCmd]);
    }
  });

  it("標準形狀的四種寫法仍被辨識並就地升級為 canonical 命令", () => {
    const canonical: [string, string, "SessionEnd" | "Stop" | "SessionStart"][] = [
      // 帶引號 + --mode=session-end（bash/PowerShell 安裝器寫出的形狀）
      [`node "${trackerScript}" --mode=session-end`, endCmd, "SessionEnd"],
      // 不帶引號（家目錄無空白的舊版）
      [`node ${trackerScript} --mode=stop`, stopCmd, "Stop"],
      // 帶引號的 node 絕對路徑
      [`"/usr/local/bin/node" "/Users/x/.config/ccusage-tracker/session-start.mjs"`, startCmd, "SessionStart"],
      // Windows 正斜線磁碟機路徑（setup.ps1 會把反斜線換成正斜線）
      [`node "C:/Users/x/.config/ccusage-tracker/session-end.mjs" --mode=stop`, stopCmd, "Stop"],
    ];

    for (const [existing, expected, event] of canonical) {
      expect(commandsIn({ hooks: { [event]: [matcher(existing)] } }, event)).toEqual([expected]);
    }
  });
});
