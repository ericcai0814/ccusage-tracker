import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { antigravityStatusLines, codexCollectorLine, codexHooksLine, uploadAgeLine, uploadFailureHint } from "./status";

// last-error.txt 現在有兩種來源：ccusage 取數失敗，以及整體 deadline 被觸發。
// 兩者的下一步完全不同 —— 對 deadline 逾時叫人去量 ccusage 會把診斷帶偏，
// 那正是 #4 修掉的那種「診斷資訊本身在誤導」的問題。
describe("uploadFailureHint", () => {
  it("ccusage 取數失敗 → 指向量測 ccusage 耗時", () => {
    const hint = uploadFailureHint("ccusage 逾時被中止（>25s），當日用量未上報");
    expect(hint).toContain("time ccusage daily");
  });

  it("deadline 被觸發 → 不叫人去量 ccusage（多半不是它造成的）", () => {
    const hint = uploadFailureHint("40s 內未完成上報，程序被強制結束");
    expect(hint).not.toContain("time ccusage daily");
    // 指向 status 自己輸出的 Server 一行（大小寫需與該行標籤一致，使用者要照著找）
    expect(hint).toContain("Server");
  });
});

// 上報改成背景 worker 之後，「沒有錯誤痕跡」不再等於「有送出去」——
// worker 可能根本沒被啟動（spawn 被擋、機器立刻關機），那條路徑不寫任何錯誤。
// 這行是唯一能分辨「一切正常」與「整條鏈默默停擺」的資訊。
describe("uploadAgeLine", () => {
  const now = Date.parse("2026-08-19T12:00:00.000Z");

  it("剛上報成功 → 顯示時間與經過分鐘", () => {
    const line = uploadAgeLine(now - 3 * 60_000, now);
    expect(line).toContain("3 分鐘前");
    expect(line).not.toContain("停擺");
  });

  it("超過 24 小時 → 明講可能已停擺", () => {
    const line = uploadAgeLine(now - 30 * 3600_000, now);
    expect(line).toContain("停擺");
  });

  it("從未成功 → 不報警，剛裝好本來就是這樣", () => {
    const line = uploadAgeLine(null, now);
    expect(line).toContain("尚無成功紀錄");
    expect(line).not.toContain("停擺");
  });
});

// Codex 會靜默略過尚未信任的 hook —— 裝好了卻沒在跑，是這個功能最可能的失效方式。
// status 必須把「已安裝」與「已信任」分開講，否則又是一次全綠的無聲失效。
describe("codexHooksLine", () => {
  const hooksPath = "/Users/test/.codex/hooks.json";
  const command = 'node "/Users/test/.config/ccusage-tracker/codex-sync.mjs" --hook';
  const installed = JSON.stringify({
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "echo third-party" }] }, { hooks: [{ type: "command", command }] }],
      SessionEnd: [{ hooks: [{ type: "command", command }] }],
    },
  });
  const section = (event: string, group: number, hook = 0) =>
    `[hooks.state."${hooksPath}:${event}:${group}:${hook}"]`;
  // tracker 的 Stop 群組落在索引 1，SessionEnd 落在索引 0
  const trusted = `${section("stop", 1)}\ntrusted_hash = "sha256:a"\n${section("session_end", 0)}\ntrusted_hash = "sha256:b"\n`;

  it("hooks.state 有對應 key 的 trusted_hash → trust recorded", () => {
    expect(codexHooksLine(installed, trusted, hooksPath)).toBe("Codex hooks: installed, trust recorded");
  });

  it("缺信任紀錄或整份 config.toml 不存在 → awaiting trust，並指出下一步", () => {
    expect(codexHooksLine(installed, null, hooksPath)).toBe("Codex hooks: installed, awaiting trust (open /hooks in Codex)");
    expect(codexHooksLine(installed, `${section("stop", 1)}\ntrusted_hash = "sha256:a"\n`, hooksPath))
      .toContain("awaiting trust");
  });

  it("索引對不上（hook 被搬動過）→ 不冒稱已信任", () => {
    const moved = `${section("stop", 0)}\ntrusted_hash = "sha256:a"\n${section("session_end", 0)}\ntrusted_hash = "sha256:b"\n`;

    expect(codexHooksLine(installed, moved, hooksPath)).toContain("awaiting trust");
  });

  it("兩條都停用 → disabled in Codex", () => {
    const disabled = `${section("stop", 1)}\nenabled = false\n${section("session_end", 0)}\nenabled = false\n`;

    expect(codexHooksLine(installed, disabled, hooksPath)).toBe("Codex hooks: installed, disabled in Codex");
  });

  // 兩條 hook 的信任是分開記的，混合狀態只說一句「awaiting trust」會讓人以為兩條都要重做。
  it("只有一條被信任 → 逐 hook 說明是哪一條", () => {
    const partial = `${section("stop", 1)}\ntrusted_hash = "sha256:a"\n`;

    expect(codexHooksLine(installed, partial, hooksPath))
      .toBe("Codex hooks: installed, Stop trusted, SessionEnd awaiting trust (open /hooks in Codex)");
  });

  it("一條停用一條已信任 → 指名哪一條被停用，且不再要求去信任", () => {
    const mixed = `${section("stop", 1)}\nenabled = false\n${section("session_end", 0)}\ntrusted_hash = "sha256:b"\n`;

    expect(codexHooksLine(installed, mixed, hooksPath))
      .toBe("Codex hooks: installed, Stop disabled in Codex, SessionEnd trusted");
  });

  // Codex 補審 [low]：hook 索引原本寫死 :0，tracker 在混合群組的 hooks[1] 時會讀到隔壁第三方的紀錄。
  it("混合群組：查 :stop:<group>:1，不讀同群組第一條的信任紀錄", () => {
    const mixedFile = JSON.stringify({
      hooks: {
        Stop: [{ hooks: [{ type: "command", command: "echo third-party" }] }, { hooks: [{ type: "command", command: "echo other" }, { type: "command", command }] }],
        SessionEnd: [{ hooks: [{ type: "command", command }] }],
      },
    });
    const neighbour = `${section("stop", 1, 0)}\ntrusted_hash = "sha256:not-ours"\n${section("session_end", 0)}\ntrusted_hash = "sha256:b"\n`;
    const ours = `${section("stop", 1, 1)}\ntrusted_hash = "sha256:ours"\n${section("session_end", 0)}\ntrusted_hash = "sha256:b"\n`;

    expect(codexHooksLine(mixedFile, neighbour, hooksPath))
      .toBe("Codex hooks: installed, Stop awaiting trust, SessionEnd trusted (open /hooks in Codex)");
    expect(codexHooksLine(mixedFile, ours, hooksPath)).toBe("Codex hooks: installed, trust recorded");
  });

  it("沒有 hooks.json、內容非法或沒有 tracker 群組 → not installed", () => {
    expect(codexHooksLine(null, trusted, hooksPath)).toBe("Codex hooks: not installed");
    expect(codexHooksLine("not json", trusted, hooksPath)).toBe("Codex hooks: not installed");
    expect(codexHooksLine("[]", trusted, hooksPath)).toBe("Codex hooks: not installed");
    expect(codexHooksLine(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo x" }] }] } }), trusted, hooksPath))
      .toBe("Codex hooks: not installed");
  });
});

describe("codexCollectorLine", () => {
  it("主版本 20 的任何 patch 都算已安裝", () => {
    expect(codexCollectorLine("ccusage 20.0.51")).toBe("Codex collector: installed (ccusage 20.0.51)");
    expect(codexCollectorLine("20.0.20")).toBe("Codex collector: installed (ccusage 20.0.20)");
    expect(codexCollectorLine("20.1.0")).toBe("Codex collector: installed (ccusage 20.1.0)");
  });

  it("其他主版本或缺 collector → unavailable，附 20.0.51 的安裝指令", () => {
    expect(codexCollectorLine("18.0.10")).toBe("Codex collector: unavailable (unsupported version: 18.0.10; install with: npm install -g ccusage@20.0.51)");
    expect(codexCollectorLine(null)).toBe("Codex collector: unavailable (ccusage missing; install with: npm install -g ccusage@20.0.51)");
  });
});

describe("antigravityStatusLines", () => {
  const base = {
    detected: true, scriptInstalled: true, hookState: "installed" as const, probe: "ccusage 20.0.51",
    bufferEntries: 0, uploadError: null, lastUpload: Date.parse("2026-11-20T01:02:03.000Z"),
  };

  it("偵測到且全部就緒：依序印六行", () => {
    expect(antigravityStatusLines(base)).toEqual([
      "Antigravity script: installed",
      "Antigravity hook: installed",
      "Antigravity collector: installed (ccusage 20.0.51)",
      "Antigravity buffer: 0 pending entries",
      "Antigravity upload error: none recorded",
      "Antigravity last successful upload: 2026-11-20T01:02:03.000Z",
    ]);
  });

  it("hook 被停用：逐字符合規格", () => {
    expect(antigravityStatusLines({ ...base, hookState: "disabled" })[1])
      .toBe("Antigravity hook: installed, disabled in Antigravity (Settings > Customizations > Hooks)");
  });

  it("collector 為 20.0.20：說明沒有 Antigravity 讀取器並給安裝指令", () => {
    expect(antigravityStatusLines({ ...base, probe: "ccusage 20.0.20" })[2])
      .toBe("Antigravity collector: unavailable (ccusage 20.0.20 has no Antigravity reader; install with: npm install -g ccusage@20.0.51)");
  });

  it("20.1.0 接受、21.0.0 不接受、缺 collector 給安裝指令", () => {
    expect(antigravityStatusLines({ ...base, probe: "20.1.0" })[2]).toBe("Antigravity collector: installed (ccusage 20.1.0)");
    expect(antigravityStatusLines({ ...base, probe: "21.0.0" })[2]).toContain("unavailable");
    expect(antigravityStatusLines({ ...base, probe: null })[2])
      .toBe("Antigravity collector: unavailable (ccusage missing; install with: npm install -g ccusage@20.0.51)");
  });

  it("腳本缺、hook 缺、有待送與錯誤、從未成功", () => {
    const lines = antigravityStatusLines({ ...base, scriptInstalled: false, hookState: "not_installed",
      bufferEntries: 1, uploadError: "fixture offline", lastUpload: null });
    expect(lines[0]).toBe("Antigravity script: not installed (run tracker update with a server that provides agent-sync.mjs)");
    expect(lines[1]).toBe("Antigravity hook: not installed (run tracker update)");
    expect(lines[3]).toBe("Antigravity buffer: 1 pending entry");
    expect(lines[4]).toBe("Antigravity upload error: fixture offline");
    expect(lines[5]).toBe("Antigravity last successful upload: none recorded (run tracker sync antigravity)");
  });

  it("未偵測到：只有一行", () => {
    expect(antigravityStatusLines({ ...base, detected: false })).toEqual(["Antigravity: not detected"]);
  });
});

// statusCommand 走 homedir()：在子程序以隔離 HOME 執行，PATH 只放 fixture。
describe("status 指令的 Codex 與 Antigravity 區塊", () => {
  const temporaries: string[] = [];
  afterEach(() => {
    while (temporaries.length) rmSync(temporaries.pop()!, { recursive: true, force: true });
  });

  function run(prepare: (home: string) => void): string {
    const home = mkdtempSync(join(tmpdir(), "agy status "));
    temporaries.push(home);
    mkdirSync(join(home, ".config/ccusage-tracker"), { recursive: true });
    mkdirSync(join(home, "bin"));
    writeFileSync(join(home, "bin/ccusage"), "#!/bin/sh\necho 'ccusage 20.0.51'\n", { mode: 0o755 });
    writeFileSync(join(home, ".config/ccusage-tracker/config.json"),
      JSON.stringify({ server_url: "http://127.0.0.1:9", team_key: "fixture", member_name: "Fixture" }));
    prepare(home);
    const result = Bun.spawnSync([process.execPath, join(import.meta.dir, "../index.ts"), "status"], {
      env: { HOME: home, CODEX_HOME: join(home, "codex"), PATH: join(home, "bin") },
    });
    expect(result.exitCode).toBe(0);
    return result.stdout.toString();
  }

  it("Codex 未偵測、Antigravity 偵測到：先印 Codex: not detected，再印 Antigravity 六行", () => {
    const out = run((home) => mkdirSync(join(home, ".gemini/antigravity-cli/conversations"), { recursive: true }));
    const lines = out.split("\n");
    const codex = lines.indexOf("Codex: not detected");
    expect(codex).toBeGreaterThan(-1);
    expect(lines.slice(codex + 1).filter((l) => l.startsWith("Antigravity")).map((l) => l.split(":")[0])).toEqual([
      "Antigravity script", "Antigravity hook", "Antigravity collector", "Antigravity buffer",
      "Antigravity upload error", "Antigravity last successful upload",
    ]);
    expect(out).toContain("Antigravity collector: installed (ccusage 20.0.51)");
  });

  it("Codex 為 20.0.51：不再誤報不支援", () => {
    const out = run((home) => mkdirSync(join(home, "codex")));
    expect(out).toContain("Codex collector: installed (ccusage 20.0.51)");
  });

  it("Antigravity 未偵測：只印一行，沒有其他 Antigravity 行", () => {
    const out = run((home) => mkdirSync(join(home, ".gemini/antigravity/bin"), { recursive: true }));
    expect(out.split("\n").filter((l) => l.includes("Antigravity"))).toEqual(["Antigravity: not detected"]);
  });
});
