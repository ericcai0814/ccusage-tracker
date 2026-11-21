import { spawnSync } from "node:child_process";
import { ANTIGRAVITY } from "./agent-sources";

// 已驗證可供 Claude、Codex 與 Antigravity 共用的收集器版本。Codex 的 `ccusage codex daily`
// 只在 major 20 存在，所以 setup／update 只認主版本 20，不做精確 patch 白名單；
// `ccusage antigravity daily` 從 20.0.21 起才有，這一條用語意版本比較。
export const COLLECTOR_VERSION = "20.0.51";
export const ANTIGRAVITY_MIN_COLLECTOR = ANTIGRAVITY.minCollector;
export const COLLECTOR_INSTALL_COMMAND = `npm install -g ccusage@${COLLECTOR_VERSION}`;
const SKIP_ENV = "CCUSAGE_TRACKER_SKIP_COLLECTOR_INSTALL";
const INSTALL_TIMEOUT_MS = 180000;

export type CollectorStatus =
  | "ok"
  | "installed"
  | "install_failed"
  | "unsupported_major"
  | "no_antigravity_reader"
  | "skipped";

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

export type CollectorVersion = readonly [number, number, number];

// `ccusage --version` 可能帶 `ccusage ` 前綴；其他格式一律視為無法解析。
export function parseCollectorVersion(text: string): CollectorVersion | null {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(text.trim().replace(/^ccusage\s+/, ""));
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareCollectorVersion(a: CollectorVersion, b: CollectorVersion): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
}

// 20.0.21（含）至 21.0.0（不含）才讀得到 Antigravity。
export function hasAntigravityReader(version: string): boolean {
  const parsed = parseCollectorVersion(version);
  return parsed !== null && parsed[0] === 20 && compareCollectorVersion(parsed, parseCollectorVersion(ANTIGRAVITY_MIN_COLLECTOR)!) >= 0;
}

function majorVersion(version: string): string | null {
  const match = /^(?:ccusage\s+)?(\d+)\.\d+\.\d+/.exec(version.trim());
  return match ? match[1] : null;
}

// Claude 仍能上報，只有 Codex 與 Antigravity 需要 20.x —— 所以是警告加指令，不是替換使用者的安裝。
function unsupportedMajor(deps: CollectorDeps, version: string): CollectorResult {
  deps.warn(`Collector: ccusage ${displayVersion(version)} reports usage for Claude, but Codex and Antigravity require ${COLLECTOR_VERSION}. Install it yourself with: ${COLLECTOR_INSTALL_COMMAND}`);
  return { status: "unsupported_major", version };
}

// 主版本 20 的共同判斷：已裝的與剛裝好的版本都走這裡。
// 20.0.21 以下只有偵測到 Antigravity 才需要提示，而且同樣不替換使用者的安裝。
function checkSupported(deps: CollectorDeps, version: string, antigravityDetected: boolean, okStatus: "ok" | "installed"): CollectorResult {
  if (majorVersion(version) !== "20") return unsupportedMajor(deps, version);
  if (antigravityDetected && !hasAntigravityReader(version)) {
    deps.warn(`Collector: ccusage ${displayVersion(version)} reports Claude and Codex usage, but Antigravity requires ccusage ${ANTIGRAVITY_MIN_COLLECTOR} or later. Install it yourself with: ${COLLECTOR_INSTALL_COMMAND}`);
    return { status: "no_antigravity_reader", version };
  }
  const ready = hasAntigravityReader(version) ? "Claude, Codex and Antigravity ready" : "Claude and Codex ready";
  deps.log(okStatus === "ok" ? `Collector: ccusage ${displayVersion(version)} (${ready})` : `Collector: ccusage ${displayVersion(version)} installed.`);
  return { status: okStatus, version };
}

// setup 與 update 共用的收集器步驟（只在至少偵測到一個工具時被呼叫）。安裝失敗
// 只警告 —— hook 已經裝好了，缺收集器是 status 顯示得出來的狀態，不該讓整個安裝
// 回報失敗。
export function ensureCollector(deps: CollectorDeps, antigravityDetected = false): CollectorResult {
  const version = deps.probe();

  if (version !== null) return checkSupported(deps, version, antigravityDetected, "ok");

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
  // 裝完跑起來的未必是剛裝的那一個：PATH 上另一個 prefix 或專案內的舊 ccusage
  // 會先命中。所以安裝後的版本套用同一道版本判斷，不能因為「是我們裝的」就放行。
  return checkSupported(deps, reprobed, antigravityDetected, "installed");
}

export interface DetectedTools {
  claudeDetected: boolean;
  codexDetected: boolean;
  antigravityDetected: boolean;
}

export function anyToolDetected(detected: DetectedTools): boolean {
  return detected.claudeDetected || detected.codexDetected || detected.antigravityDetected;
}

// setup 與 update 共用的收集器流程：沒有任何工具就不探測也不安裝（那一步可能執行
// 一次全域 npm 安裝，而當下沒有工具會用到它）；偵測到 Antigravity 時多一道版本檢查。
export function runCollectorStep(detected: DetectedTools, deps: CollectorDeps): CollectorResult | null {
  if (!anyToolDetected(detected)) return null;
  return ensureCollector(deps, detected.antigravityDetected);
}
