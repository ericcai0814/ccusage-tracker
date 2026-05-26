import { describe, expect, it } from "bun:test";
import { applyTrackerHooks, getHookCommand, getStartHookCommand } from "./hooks";

// 注意：installHook 會寫入真實 ~/.claude/settings.json 與 ~/.config（bun 的 os.homedir()
// 在 process 啟動時就快取 $HOME，無法在測試內安全覆寫）。因此這裡只測試抽出的純合併
// 邏輯 applyTrackerHooks，完全不碰檔案系統。

const startCmd = getStartHookCommand();
const endCmd = getHookCommand();

function matcher(command: string) {
  return { matcher: "", hooks: [{ type: "command", command }] };
}

describe("getStartHookCommand", () => {
  it("以 node 執行 session-start.mjs", () => {
    expect(startCmd).toContain("node ");
    expect(startCmd).toContain("session-start.mjs");
  });

  it("與 end hook 命令不同", () => {
    expect(startCmd).not.toBe(endCmd);
  });
});

describe("applyTrackerHooks", () => {
  it("空 settings：安裝 SessionStart + SessionEnd 各一筆", () => {
    const r = applyTrackerHooks({});

    expect(r.sessionStartInstalled).toBe(true);
    expect(r.sessionEndInstalled).toBe(true);
    expect(r.updated.hooks?.SessionStart).toHaveLength(1);
    expect(r.updated.hooks?.SessionEnd).toHaveLength(1);
    expect(r.updated.hooks?.SessionStart?.[0].hooks[0].command).toContain("session-start.mjs");
    expect(r.updated.hooks?.SessionEnd?.[0].hooks[0].command).toContain("session-end.mjs");
  });

  it("冪等：已安裝兩 hook 時不重複 append，且回傳原物件不變", () => {
    const existing = {
      hooks: {
        SessionStart: [matcher(startCmd)],
        SessionEnd: [matcher(endCmd)],
      },
    };
    const r = applyTrackerHooks(existing);

    expect(r.sessionStartInstalled).toBe(false);
    expect(r.sessionEndInstalled).toBe(false);
    expect(r.updated).toBe(existing); // 無變動時回傳同一參考
  });

  it("修復路徑：只有 SessionEnd 的舊安裝會補上 SessionStart、不動 SessionEnd", () => {
    const legacy = {
      hooks: {
        SessionEnd: [matcher(endCmd)],
      },
    };
    const r = applyTrackerHooks(legacy);

    expect(r.sessionStartInstalled).toBe(true);
    expect(r.sessionEndInstalled).toBe(false);
    expect(r.updated.hooks?.SessionStart).toHaveLength(1);
    expect(r.updated.hooks?.SessionEnd).toHaveLength(1); // 未重複
  });

  it("保留既有 settings 的其他欄位與其他 hook 種類", () => {
    const settings = {
      model: "opus",
      hooks: {
        PreToolUse: [matcher("/some/other/hook")],
        SessionEnd: [matcher("bash /existing/session-end-parse.sh")],
      },
    };
    const r = applyTrackerHooks(settings);

    expect(r.updated.model).toBe("opus");
    expect(r.updated.hooks?.PreToolUse).toHaveLength(1);
    // 既有非 tracker 的 SessionEnd hook 保留，tracker 的追加在後
    expect(r.updated.hooks?.SessionEnd).toHaveLength(2);
    expect(r.sessionStartInstalled).toBe(true);
    expect(r.sessionEndInstalled).toBe(true);
  });

  it("不變動原始輸入物件（immutability）", () => {
    const settings = { hooks: { SessionEnd: [matcher(endCmd)] } };
    applyTrackerHooks(settings);

    // 原 SessionEnd 仍只有 1 筆，沒有被就地 mutate
    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks).not.toHaveProperty("SessionStart");
  });
});
