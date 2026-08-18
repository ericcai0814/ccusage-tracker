import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// CLI 用 bun 開發、卻以 node 發布執行（bin shebang 是 #!/usr/bin/env node，
// build 是 --target node）。測試在 bun 下跑，Bun global 存在，所以 Bun.* 的誤用
// 在測試裡完全看不出來 —— 只有使用者裝了才會炸。
//
// 實際發生過：status.ts / setup.ts 用 Bun.spawnSync 偵測 ccusage，在 node 下拋
// ReferenceError 被 try/catch 吞掉，於是所有 npx 使用者都被告知「ccusage 沒裝」，
// 診斷時被帶往完全錯誤的方向。這條測試守住的是那個界線，不是個別呼叫。
function collectSourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = join(dir, e.name);
    if (e.isDirectory()) return collectSourceFiles(full);
    if (!e.name.endsWith(".ts") || e.name.endsWith(".test.ts")) return [];
    return [full];
  });
}

// 註解裡本來就會提到 Bun.spawnSync（說明為何不能用），掃描前先剝掉，
// 否則解釋這條規則的註解自己會觸發這條規則。
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("node 執行相容性", () => {
  it("發布的原始碼不得使用 Bun 全域 API", () => {
    const offenders = collectSourceFiles(import.meta.dir)
      .map((f) => ({
        file: f,
        hits: [...stripComments(readFileSync(f, "utf-8")).matchAll(/\bBun\.\w+/g)].map((m) => m[0]),
      }))
      .filter((r) => r.hits.length > 0)
      .map((r) => `${r.file}: ${r.hits.join(", ")}`);

    expect(offenders).toEqual([]);
  });

  it("bin 入口宣告以 node 執行", async () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8"));
    expect(pkg.bin.tracker).toBe("dist/index.js");
    expect(pkg.scripts.build).toContain("--target node");
  });
});
