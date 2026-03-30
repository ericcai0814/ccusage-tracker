import { readConfig, getConfigPath } from "../config";
import { isHookInstalled } from "../hooks";
import { existsSync } from "node:fs";

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
    console.log(`  API Key: ${config.api_key.slice(0, 15)}...`);
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

  // ccusage
  try {
    const result = Bun.spawnSync(["ccusage", "--version"]);
    const version = new TextDecoder().decode(result.stdout).trim();
    console.log(`ccusage: installed (${version || "version unknown"})`);
  } catch {
    console.log("ccusage: not found (install with: npx ccusage@latest)");
  }
}
