import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface TrackerConfig {
  server_url: string;
  team_key: string;
  member_name: string;
}

export function getConfigDir(): string {
  return join(homedir(), ".config", "ccusage-tracker");
}

export function getConfigPath(): string {
  return join(getConfigDir(), "config.json");
}

export function readConfig(): TrackerConfig | null {
  const path = getConfigPath();
  if (!existsSync(path)) return null;

  try {
    const raw = JSON.parse(readFileSync(path, "utf-8")) as Record<string, unknown>;
    const teamKey = (raw.team_key as string | undefined) ?? (raw.api_key as string | undefined);
    if (!raw.server_url || !teamKey || !raw.member_name) return null;
    return {
      server_url: String(raw.server_url),
      team_key: teamKey,
      member_name: String(raw.member_name),
    };
  } catch {
    return null;
  }
}

export function writeConfig(config: TrackerConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}
