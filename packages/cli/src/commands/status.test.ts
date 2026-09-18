import { describe, expect, it } from "bun:test";
import { codexHooksLine, uploadAgeLine, uploadFailureHint } from "./status";

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
  const section = (event: string, index: number) => `[hooks.state."${hooksPath}:${event}:${index}:0"]`;
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

  it("hooks.state 標記 enabled = false → disabled in Codex", () => {
    expect(codexHooksLine(installed, `${trusted}enabled = false\n`, hooksPath))
      .toBe("Codex hooks: installed, disabled in Codex");
  });

  it("沒有 hooks.json、內容非法或沒有 tracker 群組 → not installed", () => {
    expect(codexHooksLine(null, trusted, hooksPath)).toBe("Codex hooks: not installed");
    expect(codexHooksLine("not json", trusted, hooksPath)).toBe("Codex hooks: not installed");
    expect(codexHooksLine("[]", trusted, hooksPath)).toBe("Codex hooks: not installed");
    expect(codexHooksLine(JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "echo x" }] }] } }), trusted, hooksPath))
      .toBe("Codex hooks: not installed");
  });
});
