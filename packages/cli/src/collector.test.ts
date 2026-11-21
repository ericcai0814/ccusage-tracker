import { afterEach, describe, expect, it } from "bun:test";
import { COLLECTOR_INSTALL_COMMAND, compareCollectorVersion, ensureCollector, parseCollectorVersion, type CollectorDeps } from "./collector";

const originalSkip = process.env.CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL;

afterEach(() => {
  if (originalSkip === undefined) delete process.env.CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL;
  else process.env.CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL = originalSkip;
});

interface Recorder extends CollectorDeps {
  logs: string[];
  warns: string[];
  installed: string[];
  probes: number;
}

// installCollector 一律注入：測試絕不能真的跑 npm install -g。
function deps(versions: (string | null)[], succeeds = true): Recorder {
  const state: Recorder = {
    logs: [],
    warns: [],
    installed: [],
    probes: 0,
    probe: () => versions[Math.min(state.probes++, versions.length - 1)],
    install: (command) => {
      state.installed.push(command);
      return succeeds;
    },
    log: (msg) => state.logs.push(msg),
    warn: (msg) => state.warns.push(msg),
  };
  return state;
}

describe("ensureCollector", () => {
  it("已安裝且主版本為 20 → ok，不安裝、不警告", () => {
    const d = deps(["20.0.20"]);

    expect(ensureCollector(d)).toEqual({ status: "ok", version: "20.0.20" });
    expect(d.installed).toEqual([]);
    expect(d.warns).toEqual([]);
  });

  it("版本字串帶 ccusage 前綴也視為主版本 20，且顯示時不疊字", () => {
    const d = deps(["ccusage 20.1.3"]);

    expect(ensureCollector(d)).toEqual({ status: "ok", version: "ccusage 20.1.3" });
    expect(d.installed).toEqual([]);
    expect(d.logs.join("\n")).toContain("Collector: ccusage 20.1.3");
    expect(d.logs.join("\n")).not.toContain("ccusage ccusage");
  });

  it("探測失敗 → 先印出將執行的指令，再安裝並重新探測", () => {
    const d = deps([null, "20.0.20"]);

    expect(ensureCollector(d)).toEqual({ status: "installed", version: "20.0.20" });
    expect(d.installed).toEqual([COLLECTOR_INSTALL_COMMAND]);
    expect(COLLECTOR_INSTALL_COMMAND).toBe("npm install -g ccusage@20.0.51");
    expect(d.logs.some((line) => line.includes("npm install -g ccusage@20.0.51"))).toBe(true);
    expect(d.probes).toBe(2);
  });

  it("安裝失敗 → install_failed，警告含同一道指令（呼叫端不因此改 exit code）", () => {
    const d = deps([null, null], false);

    expect(ensureCollector(d)).toEqual({ status: "install_failed" });
    expect(d.installed).toEqual([COLLECTOR_INSTALL_COMMAND]);
    expect(d.warns.some((line) => line.includes("npm install -g ccusage@20.0.51"))).toBe(true);
  });

  it("安裝回報成功但重新探測仍失敗 → install_failed", () => {
    const d = deps([null, null]);

    expect(ensureCollector(d).status).toBe("install_failed");
  });

  it("安裝回報成功但重新探測到非 20 主版本 → unsupported_major，警告含 20.0.51", () => {
    // PATH 上另一個 prefix／專案內的舊 ccusage 先命中時會踩到：npm 裝好了，
    // 但跑起來的還是舊的。裝完的版本要再驗一次，否則 setup 宣告完成、
    // 實際 sync codex 才以「Unsupported ccusage command family」失敗。
    const d = deps([null, "18.0.9"]);

    expect(ensureCollector(d)).toEqual({ status: "unsupported_major", version: "18.0.9" });
    expect(d.installed).toEqual([COLLECTOR_INSTALL_COMMAND]);
    expect(d.probes).toBe(2);
    const warning = d.warns.join("\n");
    expect(warning).toContain("20.0.51");
    expect(warning).toContain("Codex");
  });

  it("已安裝但主版本不是 20 → unsupported_major，只警告不替換", () => {
    const d = deps(["18.0.9"]);

    expect(ensureCollector(d)).toEqual({ status: "unsupported_major", version: "18.0.9" });
    expect(d.installed).toEqual([]);
    const warning = d.warns.join("\n");
    expect(warning).toContain("20.0.51");
    expect(warning).toContain("Codex");
  });

  it("CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1 且缺 collector → skipped，印指令但不安裝", () => {
    process.env.CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL = "1";
    const d = deps([null]);

    expect(ensureCollector(d)).toEqual({ status: "skipped" });
    expect(d.installed).toEqual([]);
    expect(d.probes).toBe(1);
    expect((d.logs.join("\n") + d.warns.join("\n"))).toContain("npm install -g ccusage@20.0.51");
  });

  it("CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL 非 1 → 照常安裝", () => {
    process.env.CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL = "0";
    const d = deps([null, "20.0.20"]);

    expect(ensureCollector(d).status).toBe("installed");
    expect(d.installed).toEqual([COLLECTOR_INSTALL_COMMAND]);
  });

  it("缺 collector → 執行 npm install -g ccusage@20.0.51", () => {
    const d = deps([null, "20.0.51"]);

    expect(ensureCollector(d)).toEqual({ status: "installed", version: "20.0.51" });
    expect(d.installed).toEqual(["npm install -g ccusage@20.0.51"]);
  });

  it("20.0.20 且偵測到 Antigravity → 只警告，不替換使用者的安裝", () => {
    const d = deps(["ccusage 20.0.20"]);

    expect(ensureCollector(d, true)).toEqual({ status: "no_antigravity_reader", version: "ccusage 20.0.20" });
    expect(d.installed).toEqual([]);
    const warning = d.warns.join("\n");
    expect(warning).toContain("Antigravity");
    expect(warning).toContain("npm install -g ccusage@20.0.51");
  });

  it("20.0.20 但沒偵測到 Antigravity → 不動作、不警告", () => {
    const d = deps(["20.0.20"]);

    expect(ensureCollector(d, false)).toEqual({ status: "ok", version: "20.0.20" });
    expect(d.installed).toEqual([]);
    expect(d.warns).toEqual([]);
  });

  it("20.1.0 → 不動作（比較整個版本號，不只看 patch）", () => {
    const d = deps(["20.1.0"]);

    expect(ensureCollector(d, true)).toEqual({ status: "ok", version: "20.1.0" });
    expect(d.installed).toEqual([]);
    expect(d.warns).toEqual([]);
  });

  it("安裝後探測到 20.0.20 且偵測到 Antigravity → 套用同一道檢查", () => {
    const d = deps([null, "20.0.20"]);

    expect(ensureCollector(d, true).status).toBe("no_antigravity_reader");
    expect(d.warns.join("\n")).toContain("Antigravity");
  });

  it("18.0.9 的警告點名 Codex 與 Antigravity 需要 20.0.51", () => {
    const d = deps(["18.0.9"]);

    expect(ensureCollector(d, true).status).toBe("unsupported_major");
    const warning = d.warns.join("\n");
    expect(warning).toContain("Antigravity");
    expect(warning).toContain("20.0.51");
  });
});

describe("parseCollectorVersion / compareCollectorVersion", () => {
  it("去掉 ccusage 前綴後解析三段版本號，其他格式回 null", () => {
    expect(parseCollectorVersion("ccusage 20.0.51")).toEqual([20, 0, 51]);
    expect(parseCollectorVersion(" 20.1.0\n")).toEqual([20, 1, 0]);
    expect(parseCollectorVersion("20.0")).toBeNull();
    expect(parseCollectorVersion("v20.0.1")).toBeNull();
    expect(parseCollectorVersion("not a version")).toBeNull();
  });

  it("以語意版本比較", () => {
    expect(compareCollectorVersion([20, 0, 20], [20, 0, 21])).toBeLessThan(0);
    expect(compareCollectorVersion([20, 0, 21], [20, 0, 21])).toBe(0);
    expect(compareCollectorVersion([20, 1, 0], [20, 0, 51])).toBeGreaterThan(0);
    expect(compareCollectorVersion([21, 0, 0], [20, 99, 99])).toBeGreaterThan(0);
    expect(compareCollectorVersion([20, 0, 9], [20, 0, 10])).toBeLessThan(0);
  });
});
