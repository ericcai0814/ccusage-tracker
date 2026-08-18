import { readConfig, getConfigPath } from "../config";
import { isHookInstalled } from "../hooks";
import { existsSync, readFileSync } from "node:fs";
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
    console.log(`\nLast upload: FAILED - ${readFileSync(lastErrorPath, "utf-8").trim()}`);
    console.log("  用量目前並未上報。請量測 ccusage 耗時，若接近 25s 需再放寬 timeout：");
    console.log("  time ccusage daily --json --since $(date +%Y%m%d)");
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
  try {
    const result = Bun.spawnSync(["ccusage", "--version"]);
    const version = new TextDecoder().decode(result.stdout).trim();
    console.log(`ccusage: installed (${version || "version unknown"})`);
  } catch {
    console.log("ccusage: not found (install with: npx ccusage@latest)");
  }
}
