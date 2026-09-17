import { afterEach, describe, expect, it } from "bun:test";
import { COLLECTOR_INSTALL_COMMAND, ensureCollector, type CollectorDeps } from "./collector";

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
    expect(COLLECTOR_INSTALL_COMMAND).toBe("npm install -g ccusage@20.0.20");
    expect(d.logs.some((line) => line.includes("npm install -g ccusage@20.0.20"))).toBe(true);
    expect(d.probes).toBe(2);
  });

  it("安裝失敗 → install_failed，警告含同一道指令（呼叫端不因此改 exit code）", () => {
    const d = deps([null, null], false);

    expect(ensureCollector(d)).toEqual({ status: "install_failed" });
    expect(d.installed).toEqual([COLLECTOR_INSTALL_COMMAND]);
    expect(d.warns.some((line) => line.includes("npm install -g ccusage@20.0.20"))).toBe(true);
  });

  it("安裝回報成功但重新探測仍失敗 → install_failed", () => {
    const d = deps([null, null]);

    expect(ensureCollector(d).status).toBe("install_failed");
  });

  it("已安裝但主版本不是 20 → unsupported_major，只警告不替換", () => {
    const d = deps(["18.0.9"]);

    expect(ensureCollector(d)).toEqual({ status: "unsupported_major", version: "18.0.9" });
    expect(d.installed).toEqual([]);
    const warning = d.warns.join("\n");
    expect(warning).toContain("20.0.20");
    expect(warning).toContain("Codex");
  });

  it("CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL=1 且缺 collector → skipped，印指令但不安裝", () => {
    process.env.CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL = "1";
    const d = deps([null]);

    expect(ensureCollector(d)).toEqual({ status: "skipped" });
    expect(d.installed).toEqual([]);
    expect(d.probes).toBe(1);
    expect((d.logs.join("\n") + d.warns.join("\n"))).toContain("npm install -g ccusage@20.0.20");
  });

  it("CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL 非 1 → 照常安裝", () => {
    process.env.CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL = "0";
    const d = deps([null, "20.0.20"]);

    expect(ensureCollector(d).status).toBe("installed");
    expect(d.installed).toEqual([COLLECTOR_INSTALL_COMMAND]);
  });
});
