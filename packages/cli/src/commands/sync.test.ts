import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// syncCommand 走 homedir()：一律在子程序以隔離 HOME 執行 CLI 進入點。
const entry = join(import.meta.dir, "../index.ts");
const temporaries: string[] = [];
afterEach(() => {
  while (temporaries.length) rmSync(temporaries.pop()!, { recursive: true, force: true });
});

function fixture(options: { config?: boolean; script?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "agy sync "));
  temporaries.push(home);
  const dir = join(home, ".config/ccusage-tracker");
  mkdirSync(dir, { recursive: true });
  if (options.config !== false) {
    writeFileSync(join(dir, "config.json"), JSON.stringify({ server_url: "http://127.0.0.1:9", team_key: "fixture", member_name: "Fixture" }));
  }
  if (options.script !== false) {
    // 假的 agent-sync.mjs：記錄 argv，回傳固定的 exit code
    writeFileSync(join(dir, "agent-sync.mjs"), `import fs from 'node:fs';
fs.writeFileSync(process.env.HOME + '/argv.json', JSON.stringify(process.argv.slice(2)));
console.log('fixture agy synced');
process.exitCode = 7;\n`);
  }
  const run = (args: string[]) => {
    const result = Bun.spawnSync([process.execPath, entry, ...args], { env: { HOME: home, PATH: join(home, "bin") } });
    return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
  };
  const argv = () => (existsSync(join(home, "argv.json")) ? JSON.parse(readFileSync(join(home, "argv.json"), "utf8")) : null);
  return { home, run, argv };
}

describe("tracker sync antigravity", () => {
  for (const target of ["antigravity", "agy"]) {
    it(`sync ${target} 執行 agent-sync.mjs antigravity 並回傳它的 exit code`, () => {
      const f = fixture();
      const result = f.run(["sync", target]);
      expect(result.code).toBe(7);
      expect(result.stdout).toContain("fixture agy synced");
      expect(f.argv()).toEqual(["antigravity"]);
    });
  }

  it("腳本不存在：印規格字串並 exit 1", () => {
    const f = fixture({ script: false });
    const result = f.run(["sync", "antigravity"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Antigravity script not installed. Run tracker update with a server that provides agent-sync.mjs.");
  });

  it("缺設定：要求先跑 setup", () => {
    const f = fixture({ config: false });
    const result = f.run(["sync", "agy"]);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("tracker setup");
    expect(f.argv()).toBeNull();
  });

  for (const args of [["sync", "gemini"], ["sync"], ["sync", "agy", "extra"]]) {
    it(`${args.join(" ")}：印用法並 exit 1`, () => {
      const f = fixture();
      const result = f.run(args);
      expect(result.code).toBe(1);
      expect(result.stderr).toContain("Usage: tracker sync codex|antigravity");
      expect(f.argv()).toBeNull();
    });
  }

  it("說明文字列出 sync antigravity", () => {
    const f = fixture();
    const result = f.run([]);
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(/sync antigravity\s+Report Antigravity usage now \(manual fallback \/ debugging\)/);
  });
});
