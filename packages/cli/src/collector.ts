import { spawnSync } from "node:child_process";

// 已驗證可供 Claude 與 Codex 共用的收集器版本。Codex 的 `ccusage codex daily`
// 只在 major 20 存在，所以 setup／update 只認主版本 20，不做精確 patch 白名單。
export const COLLECTOR_VERSION = "20.0.20";
export const COLLECTOR_INSTALL_COMMAND = `npm install -g ccusage@${COLLECTOR_VERSION}`;
const SKIP_ENV = "CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL";
const INSTALL_TIMEOUT_MS = 180000;

export type CollectorStatus = "ok" | "installed" | "install_failed" | "unsupported_major" | "skipped";

export interface CollectorResult {
  status: CollectorStatus;
  version?: string;
}

export interface CollectorDeps {
  probe: () => string | null;
  install: (command: string) => boolean;
  log: (msg: string) => void;
  warn: (msg: string) => void;
}

// 與 status.ts 的 probeCcusage 同理：bin 以 node 執行，Bun global 不存在；
// 指令合成單一字串避免 DEP0190；shell: true 以相容 Windows 的 ccusage.cmd。
function defaultProbe(): string | null {
  try {
    const result = spawnSync("ccusage --version", { encoding: "utf8", shell: true, timeout: 10000 });
    if (result.status !== 0 || !result.stdout) return null;
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

// stdio 繼承：全域安裝可能要求權限或花上分鐘，使用者需要看到 npm 自己的進度。
function defaultInstall(command: string): boolean {
  try {
    return spawnSync(command, { shell: true, stdio: "inherit", timeout: INSTALL_TIMEOUT_MS }).status === 0;
  } catch {
    return false;
  }
}

export const defaultCollectorDeps: Pick<CollectorDeps, "probe" | "install"> = {
  probe: defaultProbe,
  install: defaultInstall,
};

// `ccusage --version` 有的版本印 "20.0.20"，有的印 "ccusage 20.0.20"；
// 顯示時去掉前綴，避免 "Collector: ccusage ccusage 20.0.20" 這種疊字。
function displayVersion(version: string): string {
  return version.trim().replace(/^ccusage\s+/, "");
}

function majorVersion(version: string): string | null {
  const match = /^(?:ccusage\s+)?(\d+)\.\d+\.\d+/.exec(version.trim());
  return match ? match[1] : null;
}

// setup 與 update 共用的收集器步驟。安裝失敗只警告 —— hook 已經裝好了，
// 缺收集器是 status 顯示得出來的狀態，不該讓整個安裝回報失敗。
export function ensureCollector(deps: CollectorDeps): CollectorResult {
  const version = deps.probe();

  if (version !== null) {
    if (majorVersion(version) === "20") {
      deps.log(`Collector: ccusage ${displayVersion(version)} (Claude and Codex ready)`);
      return { status: "ok", version };
    }
    deps.warn(`Collector: ccusage ${displayVersion(version)} reports usage for Claude, but Codex requires ${COLLECTOR_VERSION}. Install it yourself with: ${COLLECTOR_INSTALL_COMMAND}`);
    return { status: "unsupported_major", version };
  }

  if (process.env[SKIP_ENV] === "1") {
    deps.log(`Collector: not installed; skipping automatic install (${SKIP_ENV}=1). Install it with: ${COLLECTOR_INSTALL_COMMAND}`);
    return { status: "skipped" };
  }

  deps.log(`Collector: ccusage not found. Running: ${COLLECTOR_INSTALL_COMMAND}`);
  // 一律重新探測，不看 npm 的 exit code：npm 可能非零退出卻已把 bin 放好，
  // 也可能宣稱成功但 bin 不在 PATH 上。能不能跑起來才是判準。
  deps.install(COLLECTOR_INSTALL_COMMAND);
  const reprobed = deps.probe();
  if (reprobed === null) {
    deps.warn(`Collector: automatic install did not succeed. Install it yourself with: ${COLLECTOR_INSTALL_COMMAND}`);
    return { status: "install_failed" };
  }
  deps.log(`Collector: ccusage ${displayVersion(reprobed)} installed.`);
  return { status: "installed", version: reprobed };
}
