import { describe, expect, it } from "bun:test";
import {
  applyTrackerHooks,
  getHookCommand,
  getStartHookCommand,
  getStopHookCommand,
} from "./hooks";

// 注意：installHook 會寫入真實 ~/.claude/settings.json 與 ~/.config（bun 的 os.homedir()
// 在 process 啟動時就快取 $HOME，無法在測試內安全覆寫）。因此這裡只測試抽出的純合併
// 邏輯 applyTrackerHooks，完全不碰檔案系統。

const startCmd = getStartHookCommand();
const endCmd = getHookCommand();
const stopCmd = getStopHookCommand();

function matcher(command: string, opts: { timeout?: number; matcher?: string } = {}) {
  const hook: { type: string; command: string; timeout?: number } = { type: "command", command };
  if (opts.timeout) hook.timeout = opts.timeout;
  return { matcher: opts.matcher ?? "", hooks: [hook] };
}

describe("hook 命令", () => {
  it("getStartHookCommand 以 node 執行 session-start.mjs", () => {
    expect(startCmd).toContain("node ");
    expect(startCmd).toContain("session-start.mjs");
    expect(startCmd).not.toContain("--mode");
  });

  it("getHookCommand 帶 --mode=session-end", () => {
    expect(endCmd).toContain("session-end.mjs");
    expect(endCmd).toContain("--mode=session-end");
  });

  it("getStopHookCommand 帶 --mode=stop 且共用 session-end.mjs", () => {
    expect(stopCmd).toContain("session-end.mjs");
    expect(stopCmd).toContain("--mode=stop");
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
    expect(r.updated.hooks?.SessionStart).toHaveLength(1);
    expect(r.updated.hooks?.SessionEnd).toHaveLength(1);
    expect(r.updated.hooks?.Stop).toHaveLength(1);
    expect(r.updated.hooks?.Stop?.[0].hooks[0].command).toContain("--mode=stop");
    expect(r.updated.hooks?.Stop?.[0].hooks[0].timeout).toBe(25);
    expect(r.updated.hooks?.SessionEnd?.[0].hooks[0].timeout).toBe(25);
  });

  it("冪等：三條都正確時 noop，回傳同一物件參考", () => {
    const existing = {
      hooks: {
        SessionStart: [{ matcher: "*", hooks: [{ type: "command", command: startCmd }] }],
        SessionEnd: [{ matcher: "*", hooks: [{ type: "command", command: endCmd, timeout: 25 }] }],
        Stop: [{ matcher: "*", hooks: [{ type: "command", command: stopCmd, timeout: 25 }] }],
      },
    };
    const r = applyTrackerHooks(existing);

    expect(r.sessionStartChanged).toBe(false);
    expect(r.sessionEndChanged).toBe(false);
    expect(r.stopChanged).toBe(false);
    expect(r.updated).toBe(existing);
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
    expect(r.updated.hooks?.SessionEnd?.[0].hooks[0].timeout).toBe(25);
    expect(r.updated.hooks?.Stop).toHaveLength(1);
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
    // 第三方 SessionEnd 保留、tracker 新增
    expect(r.updated.hooks?.SessionEnd).toHaveLength(2);
    // 第三方 Stop 保留、tracker 新增
    expect(r.updated.hooks?.Stop).toHaveLength(2);
    expect(r.sessionStartChanged).toBe(true);
    expect(r.sessionEndChanged).toBe(true);
    expect(r.stopChanged).toBe(true);
  });

  it("不變動原始輸入物件（immutability）", () => {
    const settings = { hooks: { SessionEnd: [matcher(endCmd, { timeout: 25, matcher: "*" })] } };
    applyTrackerHooks(settings);

    // 原 SessionEnd 仍只有 1 筆、未新增 SessionStart / Stop
    expect(settings.hooks.SessionEnd).toHaveLength(1);
    expect(settings.hooks).not.toHaveProperty("SessionStart");
    expect(settings.hooks).not.toHaveProperty("Stop");
  });
});
