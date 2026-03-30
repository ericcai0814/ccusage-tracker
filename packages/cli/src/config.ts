import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface TrackerConfig {
  server_url: string;
  api_key: string;
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
    return JSON.parse(readFileSync(path, "utf-8")) as TrackerConfig;
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
