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
    const value: unknown = JSON.parse(readFileSync(path, "utf-8"));
    return isTrackerConfig(value) ? value : null;
  } catch {
    return null;
  }
}

export function isTrackerConfig(value: unknown): value is TrackerConfig {
  if (!value || typeof value !== "object") return false;
  const config = value as Record<string, unknown>;
  if (![config.server_url, config.team_key, config.member_name].every(
    (field) => typeof field === "string" && field.trim().length > 0
  )) return false;
  try {
    const url = new URL(config.server_url as string);
    return (url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function writeConfig(config: TrackerConfig): void {
  const dir = getConfigDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2) + "\n");
}
