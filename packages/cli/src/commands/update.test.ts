import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// 偵測看的是 PATH 與家目錄，所以 PATH 必須完全由 fixture 決定：沿用開發者真實的
// PATH 會讓本機有 claude／codex 的人測到假的綠燈。
const nodeBin = Bun.which("node")!;
const trackerHook = (command: unknown) => typeof command === "string" && command.includes("codex-sync.mjs");

// Exercise the published Node entry point; never use the user's config or collectors.
let buildDir: string;
let home: string;
let configDir: string;
let server: ReturnType<typeof Bun.serve> | undefined;
let serverPort = 43127;
let httpPreload: string | undefined;
let replies: Record<string, { status?: number; body: string }>;
const script = "// fixture downloaded script\nconsole.log('codex fixture synced');\n";

beforeAll(async () => {
  buildDir = mkdtempSync(join(tmpdir(), "tracker-cli-build-"));
  const result = await Bun.build({ entrypoints: [join(import.meta.dir, "../index.ts")], outdir: buildDir, target: "node" });
  expect(result.success).toBe(true);
});
afterAll(() => rmSync(buildDir, { recursive: true, force: true }));
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "tracker home spaces "));
  configDir = join(home, ".config", "ccusage-tracker");
  mkdirSync(configDir, { recursive: true });
  mkdirSync(join(home, "bin"));
  writeFileSync(join(home, "bin", "ccusage"), "#!/bin/sh\necho 'ccusage 20.0.20'\n", { mode: 0o755 });
  replies = {
    "/scripts/session-start.mjs": { body: script },
    "/scripts/session-end.mjs": { body: script },
    "/scripts/codex-sync.mjs": { body: script },
    "/api/health": { body: '{"ok":true,"version":"test"}' },
  };
  try {
    server = Bun.serve({
    hostname: "127.0.0.1", port: 0,
    fetch(request) {
      const reply = replies[new URL(request.url).pathname];
      return new Response(reply?.body ?? "missing", { status: reply?.status ?? (reply ? 200 : 404) });
    },
    });
    serverPort = server.port!;
    httpPreload = undefined;
  } catch {
    // Restricted execution environments disallow listen(2); keep Node execution
    // real while replacing only the HTTP boundary with local response fixtures.
    httpPreload = join(home, "mock-http.mjs");
    writeFileSync(httpPreload, `import { readFileSync } from "node:fs";
globalThis.fetch = async (input) => {
 const url = new URL(input);
 if (url.origin !== "http://127.0.0.1:${serverPort}") throw new Error("unexpected external request");
 const replies = JSON.parse(readFileSync(${JSON.stringify(join(home, "http-replies.json"))}, "utf8"));
 const reply = replies[url.pathname];
 return new Response(reply?.body ?? "missing", {status: reply?.status ?? (reply ? 200 : 404)});
};
`);
  }
});
afterEach(() => {
  server?.stop(true);
  server = undefined;
  rmSync(home, { recursive: true, force: true });
});

function configure(): string {
  const raw = `{\n "server_url": "http://127.0.0.1:${serverPort}",\n "member_name":"Fixture", "team_key":"fixture-team", "extra": true\n}\n`;
  writeFileSync(join(configDir, "config.json"), raw);
  return raw;
}
function codexHooks(): { hooks?: Record<string, { hooks: { type?: string; command?: string; timeout?: number }[] }[]> } {
  return JSON.parse(readFileSync(join(home, "codex", "hooks.json"), "utf8"));
}
// timeoutMs 交給 spawn 自己在逾時後 SIGKILL：驗「不會卡在 FIFO」的案例必須有硬上限，
// 否則測試自己會跟著永久阻塞。被殺掉的子程序回 code null，與自行結束的 1 可以分辨。
function cli(args: string[], input = "", preload?: string, timeoutMs?: number): Promise<{ code: number | null; output: string }> {
  writeFileSync(join(home, "http-replies.json"), JSON.stringify(replies));
  return new Promise((resolve, reject) => {
    const child = spawn(nodeBin, [...(httpPreload ? ["--import", httpPreload] : []), ...(preload ? ["--import", preload] : []), join(buildDir, "index.js"), ...args], {
      ...(timeoutMs === undefined ? {} : { timeout: timeoutMs, killSignal: "SIGKILL" as const }),
      env: {
        ...process.env,
        HOME: home,
        CODEX_HOME: join(home, "codex"),
        // PATH 只放 fixture 的 bin：偵測結果完全由測試決定。node 以絕對路徑啟動、
        // 子程序用 process.execPath，shell: true 走 /bin/sh，都不需要 PATH。
        PATH: join(home, "bin"),
        NODE_OPTIONS: "",
        // 測試絕不真的跑 npm install -g。
        CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL: "1",
      },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (data) => { output += data; });
    child.stderr.on("data", (data) => { output += data; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, output }));
    child.stdin.end(input);
  });
}
function existingInstall() {
  mkdirSync(join(home, ".claude"));
  const settings = {
    model: "opus", arbitrary: { keep: true },
    hooks: { SessionEnd: [{ matcher: "*", customMatcherField: { keep: true }, hooks: [
      { type: "command", command: "node /old/.config/ccusage-tracker/session-end.mjs" },
      { type: "command", command: "echo third-party", timeout: 7, async: true },
      { type: "command", command: "echo ccusage-tracker-audit", custom: 9 },
    ] }] },
  };
  const raw = JSON.stringify(settings, null, 4) + "\n";
  writeFileSync(join(home, ".claude", "settings.json"), raw);
  for (const name of ["session-start.mjs", "session-end.mjs", "codex-sync.mjs"]) {
    writeFileSync(join(configDir, name), "// previous " + name);
  }
  return { raw, settings };
}

describe("Node CLI update", () => {
  it("is noninteractive, preserves config/data/TOML and third-party fields, backs up changes and is repeatable", async () => {
    const config = configure();
    const old = existingInstall();
    const preserved = ["buffer.jsonl", "codex-buffer.jsonl", "sessions.json", "last-upload.txt"];
    for (const name of preserved) writeFileSync(join(configDir, name), `preserve ${name}\n`);
    mkdirSync(join(home, "codex"));
    const toml = '# existing integration\nnotify = ["custom", "notify"]\n';
    writeFileSync(join(home, "codex", "config.toml"), toml);
    const codexThirdParty = {
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo codex-third-party", timeout: 3 }], note: "keep" }],
        SessionStart: [{ hooks: [{ type: "command", command: "echo codex-start" }] }],
      },
    };
    const codexRaw = JSON.stringify(codexThirdParty, null, 4) + "\n";
    writeFileSync(join(home, "codex", "hooks.json"), codexRaw);
    const first = await cli(["update"]);
    expect(first.code).toBe(0);
    expect(first.output).toContain("updated");
    expect(readFileSync(join(configDir, "config.json"), "utf8")).toBe(config);
    for (const name of preserved) expect(readFileSync(join(configDir, name), "utf8")).toBe(`preserve ${name}\n`);
    expect(readFileSync(join(home, "codex", "config.toml"), "utf8")).toBe(toml);
    const installed = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(installed.arbitrary).toEqual(old.settings.arbitrary);
    expect(installed.hooks.SessionEnd[0].customMatcherField).toEqual({ keep: true });
    expect(installed.hooks.SessionEnd[0].hooks).toEqual(old.settings.hooks.SessionEnd[0].hooks.slice(1));
    expect(installed.hooks.SessionEnd).toHaveLength(2);
    expect(readFileSync(join(home, ".claude", "settings.json.backup"), "utf8")).toBe(old.raw);
    expect(readFileSync(join(configDir, "session-end.mjs.backup"), "utf8")).toBe("// previous session-end.mjs");
    // Codex：第三方群組位元組不變留在索引 0，tracker 只 append 到尾端
    const hooks = codexHooks();
    expect(JSON.stringify(hooks.hooks!.Stop![0])).toBe(JSON.stringify(codexThirdParty.hooks.Stop[0]));
    expect(hooks.hooks!.Stop).toHaveLength(2);
    expect(hooks.hooks!.SessionStart).toEqual(codexThirdParty.hooks.SessionStart);
    for (const event of ["Stop", "SessionEnd"] as const) {
      const tracker = hooks.hooks![event]!.filter((group) => group.hooks.some((hook) => trackerHook(hook.command)));
      expect(tracker).toHaveLength(1);
      expect(tracker[0]).toEqual({ hooks: [{ type: "command", command: tracker[0].hooks[0].command, timeout: 45 }] });
      expect(tracker[0].hooks[0].command).toContain("--hook");
      expect(tracker[0].hooks[0].command).toMatch(/^node ".*codex-sync\.mjs" --hook$/);
    }
    expect(readFileSync(join(home, "codex", "hooks.json.backup"), "utf8")).toBe(codexRaw);
    expect(first.output).toContain("/hooks");

  const installedRaw = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    const codexInstalledRaw = readFileSync(join(home, "codex", "hooks.json"), "utf8");
    const second = await cli(["update"]);
    expect(second.code).toBe(0);
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(installedRaw);
    expect(readFileSync(join(home, "codex", "hooks.json"), "utf8")).toBe(codexInstalledRaw);
    expect(readFileSync(join(home, "codex", "config.toml"), "utf8")).toBe(toml);
    expect(readFileSync(join(home, ".claude", "settings.json.backup"), "utf8")).toBe(old.raw);
    expect(readFileSync(join(home, "codex", "hooks.json.backup"), "utf8")).toBe(codexRaw);
    expect(readdirSync(configDir).filter((name) => name.endsWith(".tmp") || name.endsWith(".rollback"))).toEqual([]);
    expect(readdirSync(join(home, "codex")).filter((name) => name.endsWith(".tmp") || name.endsWith(".rollback"))).toEqual([]);
    // 完成訊息不再叫使用者自己跑 sync codex
    expect(second.output).not.toContain("Run `tracker sync codex`");
  });

  it("creates missing Claude settings directory and keeps Codex manual sync available", async () => {
    configure();
    // ~/.claude 還不存在，但 claude 在 PATH 上 —— 偵測得到就該把設定檔建出來
    writeFileSync(join(home, "bin", "claude"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const result = await cli(["update"]);
    expect(result.code).toBe(0);
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(true);
    const synced = await cli(["sync", "codex"]);
    expect(synced.code).toBe(0);
    expect(synced.output).toContain("codex fixture synced");
  });

  it("preserves unrelated empty hook matchers and their additional settings", async () => {
    configure();
    mkdirSync(join(home, ".claude"));
    const emptyMatcher = { matcher: "preserved-placeholder", hooks: [], custom: { enabled: false } };
    writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ hooks: { SessionEnd: [emptyMatcher] } }));
    expect((await cli(["update"])).code).toBe(0);
    const installed = JSON.parse(readFileSync(join(home, ".claude", "settings.json"), "utf8"));
    expect(installed.hooks.SessionEnd[0]).toEqual(emptyMatcher);
    expect(installed.hooks.SessionEnd).toHaveLength(2);
  });

  it("rejects missing and structurally invalid config with setup guidance", async () => {
    for (const value of [null, "invalid json", "{}", '{"server_url":"file:///tmp/x","team_key":"x","member_name":"x"}', '{"server_url":"http://127.0.0.1","team_key":2,"member_name":"x"}']) {
      if (value !== null) writeFileSync(join(configDir, "config.json"), value);
      const result = await cli(["update"]);
      expect(result.code).not.toBe(0);
      expect(result.output).toContain("tracker setup");
      expect(existsSync(join(configDir, "session-end.mjs"))).toBe(false);
    }
  });

  it("does not mutate a working installation when any required download or syntax validation fails", async () => {
    configure();
    const old = existingInstall();
    for (const reply of [{ status: 503, body: "temporarily unavailable" }, { body: "<html>not JavaScript</html>" }, { body: "" }]) {
      replies["/scripts/session-start.mjs"] = reply;
      const result = await cli(["update"]);
      expect(result.code).not.toBe(0);
      expect(result.output).not.toContain("Update complete");
      expect(readFileSync(join(configDir, "session-end.mjs"), "utf8")).toBe("// previous session-end.mjs");
      expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(old.raw);
    }
  });

  it("only treats Codex 404/410 as compatibility and preserves its prior script", async () => {
    configure();
    existingInstall();
    // 相容訊息只在偵測到 Codex 時才印，所以這個 fixture 必須有 $CODEX_HOME；
    // 「404 但沒有 Codex」的相反情況在 setup.test.ts。
    mkdirSync(join(home, "codex"));
    for (const status of [500, 403, 404, 410]) {
      replies["/scripts/codex-sync.mjs"] = { status, body: "missing" };
      const result = await cli(["update"]);
      expect(result.code).toBe(status === 404 || status === 410 ? 0 : 1);
      expect(readFileSync(join(configDir, "codex-sync.mjs"), "utf8")).toBe("// previous codex-sync.mjs");
      if (status < 500 && status !== 403) expect(result.output).toContain("server");
      // hook 指向不存在的腳本比沒有 hook 更糟：這條路徑一律不寫 hooks.json
      expect(existsSync(join(home, "codex", "hooks.json"))).toBe(false);
    }
  });

  it("rolls back scripts, settings and previous backups when a later filesystem install step fails", async () => {
    const config = configure();
    const old = existingInstall();
    writeFileSync(join(configDir, "session-end.mjs.backup"), "older backup");
    const preload = join(home, "fail-install.mjs");
    writeFileSync(preload, `import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\nconst original = fs.renameSync;\nlet failed = false;\nfs.renameSync = function(from, to) {\n if (!failed && to === ${JSON.stringify(join(home, ".claude", "settings.json"))}) { failed = true; throw new Error('fixture install failure'); }\n return original(from, to);\n};\nsyncBuiltinESMExports();\n`);
    const result = await cli(["update"], "", preload);
    expect(result.code).not.toBe(0);
    expect(result.output).toContain("fixture install failure");
    expect(readFileSync(join(configDir, "config.json"), "utf8")).toBe(config);
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(old.raw);
    expect(existsSync(join(home, ".claude", "settings.json.backup"))).toBe(false);
    expect(readFileSync(join(configDir, "session-end.mjs.backup"), "utf8")).toBe("older backup");
    for (const name of ["session-start.mjs", "session-end.mjs", "codex-sync.mjs"]) {
      expect(readFileSync(join(configDir, name), "utf8")).toBe("// previous " + name);
    }
    expect(readdirSync(configDir).filter((name) => name.endsWith(".tmp") || name.endsWith(".rollback"))).toEqual([]);
  });

  it("設定檔是 dotfiles 的 symlink：寫穿真實檔案、symlink 保留、backup 在真實檔案旁", async () => {
    configure();
    const dotfiles = join(home, "dotfiles");
    mkdirSync(join(dotfiles, "claude"), { recursive: true });
    mkdirSync(join(dotfiles, "codex"), { recursive: true });
    const realSettings = join(dotfiles, "claude", "settings.json");
    const realHooks = join(dotfiles, "codex", "hooks.json");
    const settingsRaw = JSON.stringify({ model: "opus" }, null, 4) + "\n";
    const hooksRaw = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo codex-third-party" }] }] } }, null, 4) + "\n";
    writeFileSync(realSettings, settingsRaw);
    writeFileSync(realHooks, hooksRaw);
    mkdirSync(join(home, ".claude"));
    mkdirSync(join(home, "codex"));
    symlinkSync(realSettings, join(home, ".claude", "settings.json"));
    symlinkSync(realHooks, join(home, "codex", "hooks.json"));

    const first = await cli(["update"]);

    expect(first.code).toBe(0);
    // symlink 本身不動：unlink 它等於毀掉使用者的 dotfiles 管理
    expect(lstatSync(join(home, ".claude", "settings.json")).isSymbolicLink()).toBe(true);
    expect(lstatSync(join(home, "codex", "hooks.json")).isSymbolicLink()).toBe(true);
    const settings = JSON.parse(readFileSync(realSettings, "utf8"));
    expect(settings.model).toBe("opus");
    expect(settings.hooks.Stop[0].hooks[0].command).toContain("session-end.mjs");
    expect(settings.hooks.SessionStart[0].hooks[0].command).toContain("session-start.mjs");
    const hooks = JSON.parse(readFileSync(realHooks, "utf8"));
    expect(hooks.hooks.Stop[0].hooks[0].command).toBe("echo codex-third-party");
    expect(hooks.hooks.Stop[1].hooks[0].command).toMatch(/^node ".*codex-sync\.mjs" --hook$/);
    // backup 跟著真實檔案走，symlink 那側不產生 .backup
    expect(readFileSync(`${realSettings}.backup`, "utf8")).toBe(settingsRaw);
    expect(readFileSync(`${realHooks}.backup`, "utf8")).toBe(hooksRaw);
    expect(existsSync(join(home, ".claude", "settings.json.backup"))).toBe(false);
    expect(existsSync(join(home, "codex", "hooks.json.backup"))).toBe(false);
    // 寫到 HOME 以外的檔案必須講出來，否則使用者不知道 dotfiles 被改了。
    // 目標用 realpathSync 取：macOS 的 /var 本身是 → /private/var 的 symlink。
    expect(first.output).toContain(`Wrote through symlink: ${join(home, ".claude", "settings.json")} -> ${realpathSync(realSettings)}`);
    expect(first.output).toContain(`Wrote through symlink: ${join(home, "codex", "hooks.json")} -> ${realpathSync(realHooks)}`);

    const installedSettings = readFileSync(realSettings, "utf8");
    const installedHooks = readFileSync(realHooks, "utf8");
    const second = await cli(["update"]);

    expect(second.code).toBe(0);
    expect(readFileSync(realSettings, "utf8")).toBe(installedSettings);
    expect(readFileSync(realHooks, "utf8")).toBe(installedHooks);
    // 第二次沒有任何檔案被寫，就不該再宣稱寫穿了誰
    expect(second.output).not.toContain("Wrote through symlink");
    expect(readdirSync(join(dotfiles, "claude")).filter((name) => name.endsWith(".tmp") || name.endsWith(".rollback"))).toEqual([]);
    expect(readdirSync(join(dotfiles, "codex")).filter((name) => name.endsWith(".tmp") || name.endsWith(".rollback"))).toEqual([]);
  });

  // Codex 補審 [med]：CLI 入口在檔案型態檢查之前就 readFileSync，於是指向 FIFO 的
  // symlink 會讓 setup／update 永久卡住（open(2) 等 writer），指向目錄或 socket 則被
  // 誤報成 JSON 錯誤。既有拒絕測試直接呼叫 installFiles，繞過了這個入口。
  it.skipIf(process.platform === "win32")("hooks.json 指向 FIFO、目錄或 socket：讀取前就拒絕，不卡住也不報 JSON 錯誤", async () => {
    configure();
    const old = existingInstall();
    mkdirSync(join(home, "codex"));
    const hooksLink = join(home, "codex", "hooks.json");
    const fifo = join(home, "codex", "target.fifo");
    const directory = join(home, "codex", "target-dir");
    const socket = join(home, "codex", "target.sock");
    execFileSync("mkfifo", [fifo]);
    mkdirSync(directory);
    const listener = createServer();
    await new Promise<void>((resolve) => listener.listen(socket, resolve));

    try {
      for (const target of [fifo, directory, socket]) {
        symlinkSync(target, hooksLink);
        const started = Date.now();

        const result = await cli(["update"], "", undefined, 2000);

        rmSync(hooksLink);
        // code 1（而非 SIGKILL 的 null）證明 CLI 自己結束了，沒有停在 FIFO 的 open 上
        expect(result.code).toBe(1);
        expect(Date.now() - started).toBeLessThan(2000);
        expect(result.output).toContain("Refusing to replace non-regular file");
        expect(result.output).toContain(target);
        expect(result.output).not.toContain("JSON");
        expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(old.raw);
        expect(readFileSync(join(configDir, "session-end.mjs"), "utf8")).toBe("// previous session-end.mjs");
      }
    } finally {
      await new Promise<void>((resolve) => listener.close(() => resolve()));
    }
  });

  it("斷鏈 symlink 且 readlink 也失敗：仍以非一般檔案訊息拒絕，只是不帶目標路徑", async () => {
    configure();
    existingInstall();
    mkdirSync(join(home, "codex"));
    const hooksLink = join(home, "codex", "hooks.json");
    const missing = join(home, "codex", "gone.json");
    symlinkSync(missing, hooksLink);
    // 解析失敗後才去讀 link 目標；目標在這兩步之間被移除時 readlink 也會失敗，
    // 那時必須退回不帶目標的訊息，而不是換一個看不懂的錯誤。
    const preload = join(home, "fail-readlink.mjs");
    writeFileSync(preload, `import fs from 'node:fs';\nimport { syncBuiltinESMExports } from 'node:module';\nconst original = fs.readlinkSync;\nfs.readlinkSync = function(path, ...rest) {\n if (String(path) === ${JSON.stringify(hooksLink)}) throw new Error('fixture readlink failure');\n return original(path, ...rest);\n};\nsyncBuiltinESMExports();\n`);

    const result = await cli(["update"], "", preload);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("Refusing to replace non-regular file");
    expect(result.output).toContain(hooksLink);
    expect(result.output).not.toContain("symlink target:");
    expect(result.output).not.toContain("fixture readlink failure");
  });

  it("rejects malformed Claude settings without mutating scripts", async () => {
    configure();
    existingInstall();
    for (const malformed of [null, { hooks: [] }, { hooks: { Stop: "invalid" } }, { hooks: { SessionEnd: [{ hooks: [null] }] } }]) {
      const raw = JSON.stringify(malformed);
      writeFileSync(join(home, ".claude", "settings.json"), raw);
      const result = await cli(["update"]);
      expect(result.code).not.toBe(0);
      expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(raw);
      expect(readFileSync(join(configDir, "session-end.mjs"), "utf8")).toBe("// previous session-end.mjs");
    }
  });
});

describe("Node CLI Codex entry points", () => {
  it("setup downloads Codex support and still saves config when no tool is detected", async () => {
    const result = await cli(["setup"], `Fixture\nhttp://127.0.0.1:${serverPort}\nfixture-team\n`);
    expect(result.code).toBe(0);
    expect(readFileSync(join(configDir, "codex-sync.mjs"), "utf8")).toBe(script);
    expect(existsSync(join(configDir, "config.json"))).toBe(true);
    expect(result.output).toContain("No supported tool detected");
    expect(result.output).toContain("tracker update");
    // sync codex 已降為手動補送，不再是安裝流程要求的下一步
    expect(result.output).not.toContain("Run `tracker sync codex`");
    expect(existsSync(join(home, "codex", "hooks.json"))).toBe(false);
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
  });
  it("setup remains usable for Codex-only users without a Claude CLI", async () => {
    mkdirSync(join(home, "codex"));
    expect(existsSync(join(home, ".claude"))).toBe(false);
    const result = await cli(["setup"], `Fixture\nhttp://127.0.0.1:${serverPort}\nfixture-team\n`);
    expect(result.code).toBe(0);
    expect(result.output).toContain("Claude Code: not detected");
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
    expect(codexHooks().hooks!.Stop).toHaveLength(1);
    expect((await cli(["sync", "codex"])).code).toBe(0);
  });
  it("setup reports failed installation instead of claiming success", async () => {
    replies["/scripts/codex-sync.mjs"] = { status: 503, body: "temporarily unavailable" };
    const result = await cli(["setup"], `Fixture\nhttp://127.0.0.1:${serverPort}\nfixture-team\n`);
    expect(result.code).not.toBe(0);
    expect(result.output).not.toContain("Setup complete");
    expect(result.output).toContain("tracker update");
    expect(existsSync(join(configDir, "session-end.mjs"))).toBe(false);
  });
  it("sync reports missing support and preserves the collector's failure exit status", async () => {
    configure();
    const missing = await cli(["sync", "codex"]);
    expect(missing.code).not.toBe(0);
    expect(missing.output).toContain("update");
    writeFileSync(join(configDir, "codex-sync.mjs"), "console.error('fixture collector unavailable'); process.exitCode = 7;\n");
    const failed = await cli(["sync", "codex"]);
    expect(failed.code).toBe(7);
    expect(failed.output).toContain("fixture collector unavailable");
  });
  it("status distinguishes Codex support, reader, pending entries, errors and successful upload", async () => {
    configure();
    mkdirSync(join(home, "codex"));
    writeFileSync(join(configDir, "codex-sync.mjs"), script);
    writeFileSync(join(configDir, "codex-buffer.jsonl"), '{}\n{}\n');
    writeFileSync(join(configDir, "codex-last-error.txt"), 'fixture offline');
    writeFileSync(join(configDir, "codex-last-upload.txt"), String(Date.now()));
    const status = await cli(["status"]);
    expect(status.code).toBe(0);
    expect(status.output).toContain("Codex script: installed");
    expect(status.output).toContain("Codex collector: installed (ccusage 20.0.20)");
    expect(status.output).toContain("Codex buffer: 2 pending entries");
    expect(status.output).toContain("Codex upload error: fixture offline");
    expect(status.output).toContain("Codex last successful upload:");
    expect(status.output).not.toContain("fixture-team");
  });
  it("status diagnoses unsupported or missing Codex collector with its verified install command", async () => {
    configure();
    mkdirSync(join(home, "codex"));
    for (const versionCommand of ["echo 18.0.10", "exit 127"]) {
      writeFileSync(join(home, "bin", "ccusage"), `#!/bin/sh\n${versionCommand}\n`, { mode: 0o755 });
      const status = await cli(["status"]);
      expect(status.code).toBe(0);
      expect(status.output).toContain("Codex collector: unavailable");
      expect(status.output).toContain("npm install -g ccusage@20.0.20");
      expect(status.output).not.toContain("Node >=22");
    }
  });
});

describe("Node CLI Codex hook wiring", () => {
  const trustToml = (event: string, index: number) =>
    `[hooks.state."${join(home, "codex", "hooks.json")}:${event}:${index}:0"]\ntrusted_hash = "sha256:fixture"\n`;

  it("setup 接上 Codex hooks，且不碰 config.toml", async () => {
    mkdirSync(join(home, "codex"));
    const toml = 'model = "gpt-5"\n\n[tui]\ntheme = "dark"\n';
    writeFileSync(join(home, "codex", "config.toml"), toml);

    const result = await cli(["setup"], `Fixture\nhttp://127.0.0.1:${serverPort}\nfixture-team\n`);

    expect(result.code).toBe(0);
    expect(result.output).toContain("Open Codex and run /hooks once to trust");
    expect(readFileSync(join(home, "codex", "config.toml"), "utf8")).toBe(toml);
    const hooks = codexHooks();
    for (const event of ["Stop", "SessionEnd"] as const) {
      expect(hooks.hooks![event]).toHaveLength(1);
      // Codex 的 Stop 不支援 matcher，群組只能有 hooks 鍵
      expect(Object.keys(hooks.hooks![event]![0])).toEqual(["hooks"]);
      expect(hooks.hooks![event]![0].hooks[0].command).toMatch(/^node ".*codex-sync\.mjs" --hook$/);
    }
    // Claude 未偵測到，settings.json 不該被建出來
    expect(existsSync(join(home, ".claude", "settings.json"))).toBe(false);
  });

  it("兩個工具都沒偵測到：update 回非零並提示先安裝工具", async () => {
    configure();

    const result = await cli(["update"]);

    expect(result.code).not.toBe(0);
    expect(result.output).toContain("No supported tool detected");
    expect(result.output).toContain("tracker update");
    expect(result.output).not.toContain("Update complete");
    expect(existsSync(join(home, "codex", "hooks.json"))).toBe(false);
  });

  it("兩個工具都沒偵測到：不探測也不安裝收集器", async () => {
    configure();
    const calls = join(home, "ccusage-calls.log");
    writeFileSync(join(home, "bin", "ccusage"), `#!/bin/sh\necho called >> ${JSON.stringify(calls)}\necho 'ccusage 20.0.20'\n`, { mode: 0o755 });

    const result = await cli(["update"]);

    expect(result.code).not.toBe(0);
    expect(existsSync(calls)).toBe(false);
    expect(result.output).not.toContain("Collector:");
  });

  it("hooks.json 非法：整筆交易不寫任何檔，回非零並要求修復", async () => {
    configure();
    const old = existingInstall();
    mkdirSync(join(home, "codex"));
    for (const malformed of ['{"hooks": []}', '{"hooks": {"Stop": "invalid"}}', "not json", "[]"]) {
      writeFileSync(join(home, "codex", "hooks.json"), malformed);

      const result = await cli(["update"]);

      expect(result.code).not.toBe(0);
      expect(result.output).toContain("hooks.json");
      expect(result.output).toContain("repair");
      expect(readFileSync(join(home, "codex", "hooks.json"), "utf8")).toBe(malformed);
      expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(old.raw);
      expect(readFileSync(join(configDir, "session-end.mjs"), "utf8")).toBe("// previous session-end.mjs");
      expect(existsSync(join(home, "codex", "hooks.json.backup"))).toBe(false);
    }
  });

  it("使用者仍留著手動設定的 tracker notify：提示自行移除，TOML 位元組不變", async () => {
    configure();
    mkdirSync(join(home, "codex"));
    const toml = `notify = ["node", "${join(home, ".config", "ccusage-tracker", "codex-sync.mjs")}", "--notify"]\n`;
    writeFileSync(join(home, "codex", "config.toml"), toml);

    const result = await cli(["update"]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("Remove the ccusage-tracker `notify` entry");
    expect(readFileSync(join(home, "codex", "config.toml"), "utf8")).toBe(toml);
  });

  it("status 分辨 Codex hook 的 awaiting trust、trust recorded、disabled 與未偵測", async () => {
    configure();
    expect((await cli(["status"])).output).toContain("Codex: not detected");

    mkdirSync(join(home, "codex"));
    expect((await cli(["update"])).code).toBe(0);
    expect((await cli(["status"])).output).toContain("Codex hooks: installed, awaiting trust (open /hooks in Codex)");

    writeFileSync(join(home, "codex", "config.toml"), trustToml("stop", 0) + trustToml("session_end", 0));
    expect((await cli(["status"])).output).toContain("Codex hooks: installed, trust recorded");

    writeFileSync(join(home, "codex", "config.toml"), trustToml("stop", 0) + "enabled = false\n" + trustToml("session_end", 0));
    // 只有 Stop 被停用、SessionEnd 仍信任：要指名是哪一條，不能籠統說整組停用
    expect((await cli(["status"])).output).toContain("Codex hooks: installed, Stop disabled in Codex, SessionEnd trusted");
  });

  it("Stop 已信任、SessionEnd 還沒：update 與 status 都指名還缺哪一條", async () => {
    configure();
    mkdirSync(join(home, "codex"));
    expect((await cli(["update"])).code).toBe(0);
    writeFileSync(join(home, "codex", "config.toml"), trustToml("stop", 0));

    const second = await cli(["update"]);

    expect(second.code).toBe(0);
    expect(second.output).toContain(
      "Codex: hooks installed (Stop trusted, SessionEnd awaiting trust). Open Codex and run /hooks once to trust the remaining ccusage-tracker hook."
    );
    expect((await cli(["status"])).output).toContain(
      "Codex hooks: installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)"
    );
  });

  it("重跑 update：已信任且未變更時回報 already up to date，不再要求信任", async () => {
    configure();
    mkdirSync(join(home, "codex"));
    expect((await cli(["update"])).code).toBe(0);
    writeFileSync(join(home, "codex", "config.toml"), trustToml("stop", 0) + trustToml("session_end", 0));

    const second = await cli(["update"]);

    expect(second.code).toBe(0);
    expect(second.output).toContain("Codex: hooks already up to date (trust recorded)");
    expect(second.output).not.toContain("Open Codex and run /hooks once");
  });

  it("說明文字把 sync codex 標為手動補送／除錯用途", async () => {
    const result = await cli([]);

    expect(result.code).toBe(0);
    expect(result.output).toContain("Report Codex usage now (manual fallback / debugging)");
    expect(result.output).not.toContain("Report Codex daily usage now");
  });
});
