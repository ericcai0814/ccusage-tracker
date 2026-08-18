import { readConfig, getConfigPath } from "../config";
import { isHookInstalled } from "../hooks";
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
    console.log(`  Team Key: ${config.team_key.slice(0, 15)}...`);
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
    console.log(`\nLast upload: FAILED - ${reason}`);
    console.log(uploadFailureHint(reason));
  } else {
    console.log("\nLast upload: no recorded failure");
  }

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
  console.log(probe ? `ccusage: installed (${probe})` : "ccusage: not found (install with: npx ccusage@latest)");
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
