import { readConfig, getConfigPath } from "../config";
import { isHookInstalled } from "../hooks";
import {
  detectCodex,
  findCodexTrackerIndexes,
  formatCodexTrustLine,
  getCodexHooksPath,
  readCodexTrustState,
  type CodexHooksFile,
} from "../codex-hooks";
import { ANTIGRAVITY, detectAntigravity, getAgentSyncScriptPath } from "../agent-sources";
import { readAntigravityHookState, type AntigravityHookState } from "../antigravity-hooks";
import { COLLECTOR_INSTALL_COMMAND, hasAntigravityReader, parseCollectorVersion } from "../collector";
import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";

export async function statusCommand(): Promise<void> {
  const configPath = getConfigPath();
  const config = readConfig();

  console.log("ccusage-tracker status\n");

  // Config file
  if (existsSync(configPath)) {
    console.log(`Config: ${configPath} (exists)`);
  } else {
    console.log(`Config: ${configPath} (not found)`);
    console.log("\nRun `tracker setup` to configure.");
    return;
  }

  if (config) {
    console.log(`  Member: ${config.member_name}`);
    console.log(`  Server: ${config.server_url}`);
    console.log("  Team Key: configured");
  } else {
    console.log("Configuration is invalid. Run `tracker setup` to repair it.");
    process.exitCode = 1;
    return;
  }

  // Hook
  const hookInstalled = isHookInstalled();
  console.log(`\nHook: ${hookInstalled ? "installed" : "not installed"}`);

  // Server connectivity
  if (config) {
    try {
      const res = await fetch(`${config.server_url}/api/health`, {
        signal: AbortSignal.timeout(5000),
      });
      const body = (await res.json()) as { ok?: boolean; version?: string };
      if (body.ok) {
        console.log(`Server: reachable (v${body.version || "unknown"})`);
      } else {
        console.log("Server: responded but not healthy");
      }
    } catch {
      console.log("Server: unreachable");
    }
  }

  // Buffer
  const bufferPath = join(dirname(configPath), "buffer.jsonl");
  if (existsSync(bufferPath)) {
    const content = readFileSync(bufferPath, "utf-8").trim();
    const lineCount = content ? content.split("\n").length : 0;
    console.log(`Buffer: ${lineCount} pending entr${lineCount === 1 ? "y" : "ies"} (${bufferPath})`);
  } else {
    console.log("Buffer: none");
  }

  // 上報健康度。
  // 這裡是本工具最容易誤導人的地方：config / hook / server / buffer 全綠，
  // 不代表用量有送出去 —— ccusage 取數失敗時拿不到 payload，連 buffer 都寫不進，
  // 故障完全無聲。last-error.txt 就是為了讓這種失效在這裡現形。
  const configDir = dirname(configPath);

  const lastErrorPath = join(configDir, "last-error.txt");
  if (existsSync(lastErrorPath)) {
    const reason = readFileSync(lastErrorPath, "utf-8").trim();
    console.log(`\nUpload error: ${reason}`);
    console.log(uploadFailureHint(reason));
  } else {
    console.log("\nUpload error: none recorded");
  }

  // 上報已改成背景 worker（見 session-end.mjs），hook 只負責把它丟出去。
  // 因此「沒有失敗痕跡」不再等於「有送出去」—— worker 可能根本沒被啟動。
  // last-upload.txt 是唯一能分辨這兩件事的訊號。
  const lastUploadPath = join(configDir, "last-upload.txt");
  let lastUploadTs: number | null = null;
  if (existsSync(lastUploadPath)) {
    const parsed = parseInt(readFileSync(lastUploadPath, "utf-8").trim(), 10);
    if (!isNaN(parsed)) lastUploadTs = parsed;
  }
  console.log(uploadAgeLine(lastUploadTs, Date.now()));

  // last-flush.txt 在 throttle 通過時就寫入，代表「上次 hook 跑起來」而非「上次送達成功」
  const lastFlushPath = join(configDir, "last-flush.txt");
  if (existsSync(lastFlushPath)) {
    const ts = parseInt(readFileSync(lastFlushPath, "utf-8").trim(), 10);
    if (!isNaN(ts)) {
      const ageMin = Math.floor((Date.now() - ts) / 60000);
      console.log(`Last hook run: ${new Date(ts).toISOString()} (${ageMin} 分鐘前)`);
    }
  }

  // ccusage
  // 必須用 node:child_process 而非 Bun.spawnSync：bin 的 shebang 是 node、build 也是
  // --target node，Bun global 不存在會拋 ReferenceError 被 catch 吞掉，於是一律誤報
  // 「沒裝」—— 對照 session-end.mjs 同樣以 node 執行、同樣用 node:child_process。
  const probe = probeCcusage();
  console.log(probe ? `ccusage: installed (${probe})` : `ccusage: not found (install with: ${COLLECTOR_INSTALL_COMMAND})`);
  printCodexStatus(configDir, probe);
  const lines = antigravityStatusLines({
    detected: detectAntigravity(),
    scriptInstalled: existsSync(getAgentSyncScriptPath()),
    hookState: readAntigravityHookState(),
    probe,
    bufferEntries: countLines(join(configDir, `${ANTIGRAVITY.statePrefix}-buffer.jsonl`)),
    uploadError: readTextFile(join(configDir, `${ANTIGRAVITY.statePrefix}-last-error.txt`))?.trim() || null,
    lastUpload: readTimestamp(join(configDir, `${ANTIGRAVITY.statePrefix}-last-upload.txt`)),
  });
  console.log("\n" + lines.join("\n"));
}

// Codex 未安裝時整個區塊沒有意義：一行講完，不用六行說「都沒有」。
// 不提早結束 statusCommand：後面還有 Antigravity 的區塊。
function printCodexStatus(configDir: string, probe: string | null): void {
  if (!detectCodex()) {
    console.log("\nCodex: not detected");
    return;
  }

  const codexScript = join(configDir, "codex-sync.mjs");
  console.log(`\nCodex script: ${existsSync(codexScript) ? "installed" : "not installed (run tracker update with a Codex-capable server)"}`);
  const hooksPath = getCodexHooksPath();
  console.log(codexHooksLine(readTextFile(hooksPath), readTextFile(join(dirname(hooksPath), "config.toml")), hooksPath));
  console.log(`Codex Node runtime: ${process.versions.node}`);
  console.log(codexCollectorLine(probe));
  const codexLines = countLines(join(configDir, "codex-buffer.jsonl"));
  console.log(`Codex buffer: ${codexLines} pending entr${codexLines === 1 ? "y" : "ies"}`);
  const codexErrorPath = join(configDir, "codex-last-error.txt");
  console.log(`Codex upload error: ${existsSync(codexErrorPath) ? readFileSync(codexErrorPath, "utf8").trim() : "none recorded"}`);
  const codexUpload = readTimestamp(join(configDir, "codex-last-upload.txt"));
  console.log(`Codex last successful upload: ${codexUpload !== null ? new Date(codexUpload).toISOString() : "none recorded (run tracker sync codex)"}`);
}

function countLines(path: string): number {
  return (readTextFile(path) ?? "").trim().split("\n").filter(Boolean).length;
}

function readTimestamp(path: string): number | null {
  const value = Number((readTextFile(path) ?? "").trim());
  return Number.isFinite(value) && value > 0 && !Number.isNaN(new Date(value).getTime()) ? value : null;
}

function displayVersion(probe: string): string {
  return probe.trim().replace(/^ccusage\s+/, "");
}

// Codex 的 `ccusage codex daily` 在整個主版本 20 都存在：只看主版本，不比 patch。
export function codexCollectorLine(probe: string | null): string {
  const version = probe === null ? null : parseCollectorVersion(probe);
  if (probe !== null && version !== null && version[0] === 20) return `Codex collector: installed (ccusage ${displayVersion(probe)})`;
  return `Codex collector: unavailable (${probe ? `unsupported version: ${displayVersion(probe)}` : "ccusage missing"}; install with: ${COLLECTOR_INSTALL_COMMAND})`;
}

export interface AntigravityStatus {
  detected: boolean;
  scriptInstalled: boolean;
  hookState: AntigravityHookState;
  probe: string | null;
  bufferEntries: number;
  uploadError: string | null;
  lastUpload: number | null;
}

const HOOK_STATE_TEXT: Record<AntigravityHookState, string> = {
  installed: "installed",
  disabled: "installed, disabled in Antigravity (Settings > Customizations > Hooks)",
  outdated: "outdated (run tracker update)",
  not_installed: "not installed (run tracker update)",
  invalid: "unreadable (repair ~/.gemini/config/hooks.json, then run tracker update)",
};

function antigravityCollectorText(probe: string | null): string {
  if (probe === null) return `unavailable (ccusage missing; install with: ${COLLECTOR_INSTALL_COMMAND})`;
  if (hasAntigravityReader(probe)) return `installed (ccusage ${displayVersion(probe)})`;
  const version = parseCollectorVersion(probe);
  if (version !== null && version[0] === 20) {
    return `unavailable (ccusage ${displayVersion(probe)} has no Antigravity reader; install with: ${COLLECTOR_INSTALL_COMMAND})`;
  }
  return `unavailable (unsupported version: ${displayVersion(probe)}; install with: ${COLLECTOR_INSTALL_COMMAND})`;
}

// 沒偵測到就一行；偵測到則固定六行，順序依規格。
export function antigravityStatusLines(status: AntigravityStatus): string[] {
  if (!status.detected) return ["Antigravity: not detected"];
  return [
    `Antigravity script: ${status.scriptInstalled ? "installed" : "not installed (run tracker update with a server that provides agent-sync.mjs)"}`,
    `Antigravity hook: ${HOOK_STATE_TEXT[status.hookState]}`,
    `Antigravity collector: ${antigravityCollectorText(status.probe)}`,
    `Antigravity buffer: ${status.bufferEntries} pending entr${status.bufferEntries === 1 ? "y" : "ies"}`,
    `Antigravity upload error: ${status.uploadError ?? "none recorded"}`,
    `Antigravity last successful upload: ${status.lastUpload !== null ? new Date(status.lastUpload).toISOString() : "none recorded (run tracker sync antigravity)"}`,
  ];
}

function readTextFile(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

// Codex 會略過尚未信任的 hook，而且信任紀錄是 Codex 內部雜湊，這裡不驗證雜湊值，
// 只回報「有沒有留下紀錄」—— 所以措辭是 trust recorded 而不是 trusted。
export function codexHooksLine(hooksJson: string | null, configToml: string | null, hooksPath: string): string {
  let file: CodexHooksFile | null = null;
  if (hooksJson !== null) {
    try {
      const parsed: unknown = JSON.parse(hooksJson);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) file = parsed as CodexHooksFile;
    } catch { /* 壞掉的 hooks.json 等同沒安裝；修復指引由 update 給 */ }
  }
  const indexes = file ? findCodexTrackerIndexes(file) : {};
  if (indexes.stop === undefined && indexes.sessionEnd === undefined) return "Codex hooks: not installed";

  // 與 setup／update 的 Codex 結果行共用同一個格式化函式，措辭不會兩邊漂移
  return formatCodexTrustLine(readCodexTrustState(configToml ?? "", hooksPath, indexes), { forStatus: true });
}

// 只有「上報確實送達」才會更新 last-upload.txt。缺這一行的話，背景 worker
// 沒被啟動時整份 status 會全綠 —— 那正是這一連串修正一直在對付的無聲失效。
const STALE_UPLOAD_MS = 24 * 60 * 60 * 1000;

export function uploadAgeLine(ts: number | null, now: number): string {
  if (ts === null) {
    return "Last successful upload: 尚無成功紀錄（剛安裝屬正常，跑完一次 session 後再看）";
  }
  const age = now - ts;
  const when = new Date(ts).toISOString();
  if (age >= STALE_UPLOAD_MS) {
    const hours = Math.floor(age / 3600_000);
    return `Last successful upload: ${when} (${hours} 小時前) — 超過 24 小時，上報可能已停擺`;
  }
  return `Last successful upload: ${when} (${Math.floor(age / 60_000)} 分鐘前)`;
}

// last-error.txt 有兩種來源，下一步完全不同：ccusage 取不到數（去量它多久），
// 或整體 deadline 到了被強制結束（ccusage 有跑完，卡的是上報那一段）。
// 一律給同一句建議，等於讓診斷資訊自己把人帶偏。
export function uploadFailureHint(reason: string): string {
  if (reason.includes("ccusage")) {
    return [
      "  用量目前並未上報。請量測 ccusage 耗時，若接近 25s 需再放寬 timeout：",
      "  time ccusage daily --json --since $(date +%Y%m%d)",
    ].join("\n");
  }
  return [
    "  用量目前並未上報。ccusage 有取到數，卡在送出那一段 —— 先看上面的 Server 一行，",
    "  再檢查網路 / VPN / proxy。當日快照是整日累計，下次 hook 跑成就會補齊",
  ].join("\n");
}

// 回傳版本字串；偵測不到回 null。
// 指令與參數合成單一字串再交給 shell，而非傳 args 陣列：後者在 Node 22+ 會噴 DEP0190
// 警告，污染 CLI 輸出。此處指令為常數、無外部輸入，無注入風險。
// shell: true 是為了 Windows —— npm 全域安裝的是 ccusage.cmd，不透過 shell 找不到。
function probeCcusage(): string | null {
  try {
    const r = spawnSync("ccusage --version", { encoding: "utf8", shell: true, timeout: 10000 });
    if (r.status !== 0 || !r.stdout) return null;
    return r.stdout.trim() || "version unknown";
  } catch {
    return null;
  }
}
