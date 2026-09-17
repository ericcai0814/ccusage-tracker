import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
function cli(args: string[], input = "", preload?: string): Promise<{ code: number | null; output: string }> {
  writeFileSync(join(home, "http-replies.json"), JSON.stringify(replies));
  return new Promise((resolve, reject) => {
    const child = spawn("node", [...(httpPreload ? ["--import", httpPreload] : []), ...(preload ? ["--import", preload] : []), join(buildDir, "index.js"), ...args], {
      env: { ...process.env, HOME: home, CODEX_HOME: join(home, "codex"), PATH: `${join(home, "bin")}:${process.env.PATH}`, NODE_OPTIONS: "" },
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
  const installedRaw = readFileSync(join(home, ".claude", "settings.json"), "utf8");
    const second = await cli(["update"]);
    expect(second.code).toBe(0);
    expect(readFileSync(join(home, ".claude", "settings.json"), "utf8")).toBe(installedRaw);
    expect(readFileSync(join(home, ".claude", "settings.json.backup"), "utf8")).toBe(old.raw);
    expect(readdirSync(configDir).filter((name) => name.endsWith(".tmp") || name.endsWith(".rollback"))).toEqual([]);
  });

  it("creates missing Claude settings directory and offers Codex manual sync", async () => {
    configure();
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
    for (const status of [500, 403, 404, 410]) {
      replies["/scripts/codex-sync.mjs"] = { status, body: "missing" };
      const result = await cli(["update"]);
      expect(result.code).toBe(status === 404 || status === 410 ? 0 : 1);
      expect(readFileSync(join(configDir, "codex-sync.mjs"), "utf8")).toBe("// previous codex-sync.mjs");
      if (status < 500 && status !== 403) expect(result.output).toContain("server");
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
  it("setup downloads Codex support and works without an existing Claude directory", async () => {
    const result = await cli(["setup"], `Fixture\nhttp://127.0.0.1:${serverPort}\nfixture-team\n`);
    expect(result.code).toBe(0);
    expect(readFileSync(join(configDir, "codex-sync.mjs"), "utf8")).toBe(script);
    expect(result.output).toContain("tracker sync codex");
  });
  it("setup remains usable for Codex-only users without a Claude CLI", async () => {
    writeFileSync(join(home, "bin", "claude"), "#!/bin/sh\nexit 127\n", { mode: 0o755 });
    expect(existsSync(join(home, ".claude"))).toBe(false);
    const result = await cli(["setup"], `Fixture\nhttp://127.0.0.1:${serverPort}\nfixture-team\n`);
    expect(result.code).toBe(0);
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
