import { statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { isOnPath } from "./codex-hooks";

// 由 agent-sync.mjs 上報的工具。工具偵測、`tracker sync <目標>` 與 status 的區塊都讀這張表；
// 接下一個工具時在這裡加一筆，並在 server 的 agent-sync.mjs 與 sources.ts 各加一筆。
export interface AgentSource {
  id: string;
  aliases: readonly string[];
  label: string;
  statePrefix: string;
  scriptName: string;
  // 相對於家目錄；偵測看的是底下的 conversations 目錄，不是根目錄本身。
  dataRoots: readonly string[];
  pathCommands: readonly string[];
  minCollector: string;
}

export const ANTIGRAVITY: AgentSource = {
  id: "antigravity",
  aliases: ["agy"],
  label: "Antigravity",
  statePrefix: "antigravity",
  scriptName: "agent-sync.mjs",
  dataRoots: [
    ".gemini/antigravity",
    ".gemini/antigravity-cli",
    ".gemini/antigravity-ide",
    ".gemini/antigravity-backup",
    ".gemini/antigravity-acp",
    ".config/antigravity",
  ],
  pathCommands: ["agy", "antigravity"],
  minCollector: "20.0.21",
};

export const AGENT_SOURCES: readonly AgentSource[] = [ANTIGRAVITY];

export function resolveAgentSource(name: string): AgentSource | null {
  return AGENT_SOURCES.find((source) => source.id === name || source.aliases.includes(name)) ?? null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

// 有對話資料，或指令在 PATH 上（讓還沒開過對話的新使用者也能先接好 hook）。
// 只有根目錄不算：本機殘留的 ~/.gemini/antigravity/bin 會被誤判為有在用。
// home 可注入：bun 在 process 啟動時就快取 os.homedir()，測試無法改寫 $HOME。
export function detectAgentSource(source: AgentSource, home = homedir()): boolean {
  return (
    source.dataRoots.some((root) => isDirectory(join(home, root, "conversations"))) ||
    source.pathCommands.some((command) => isOnPath(command))
  );
}

export function detectAntigravity(home = homedir()): boolean {
  return detectAgentSource(ANTIGRAVITY, home);
}

export function getAgentSyncScriptPath(home = homedir()): string {
  return join(home, ".config", "ccusage-tracker", "agent-sync.mjs");
}
