import { createInterface } from "node:readline";
import { existsSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getClaudeSettingsPath, getHookCommand, getStartHookCommand } from "../hooks";

interface HookEntry { type: string; command: string }
interface HookMatcher { matcher?: string; hooks: HookEntry[] }
interface ClaudeSettings {
  hooks?: { SessionEnd?: HookMatcher[]; SessionStart?: HookMatcher[]; [k: string]: unknown };
  [k: string]: unknown;
}

export interface UninstallOptions {
  yes?: boolean;
}

export interface UninstallDeps {
  settingsPath: string;
  configDir: string;
  prompt: (question: string) => Promise<string>;
  log: (msg: string) => void;
}

function defaultPrompt(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

const defaultDeps: UninstallDeps = {
  settingsPath: getClaudeSettingsPath(),
  configDir: join(homedir(), ".config", "ccusage-tracker"),
  prompt: defaultPrompt,
  log: (msg) => console.log(msg),
};

function stripOurHooks(matchers: HookMatcher[] | undefined, ourCmds: Set<string>): HookMatcher[] {
  if (!matchers) return [];
  return matchers
    .map((m) => ({ ...m, hooks: (m.hooks ?? []).filter((h) => !ourCmds.has(h.command)) }))
    .filter((m) => m.hooks.length > 0);
}

export async function uninstallCommand(
  options: UninstallOptions = {},
  overrides?: Partial<UninstallDeps>,
): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };
  const ourCmds = new Set([getHookCommand(), getStartHookCommand()]);

  // 1. Remove our hook entries from settings.json (if it exists)
  if (existsSync(deps.settingsPath)) {
    try {
      const settings = JSON.parse(readFileSync(deps.settingsPath, "utf-8")) as ClaudeSettings;
      const next: ClaudeSettings = {
        ...settings,
        hooks: {
          ...settings.hooks,
          SessionEnd: stripOurHooks(settings.hooks?.SessionEnd, ourCmds),
          SessionStart: stripOurHooks(settings.hooks?.SessionStart, ourCmds),
        },
      };
      writeFileSync(deps.settingsPath, JSON.stringify(next, null, 2) + "\n");
      deps.log(`Removed ccusage-tracker hook entries from ${deps.settingsPath}`);
    } catch (err) {
      deps.log(`Warning: could not update settings.json: ${(err as Error).message}`);
    }
  } else {
    deps.log("No Claude settings.json found; skipping hook removal.");
  }

  // 2. Confirm + delete config directory
  if (existsSync(deps.configDir)) {
    let proceed = options.yes ?? false;
    if (!proceed) {
      const ans = await deps.prompt(`Delete ${deps.configDir}? [y/N] `);
      proceed = ans.toLowerCase() === "y" || ans.toLowerCase() === "yes";
    }
    if (proceed) {
      rmSync(deps.configDir, { recursive: true, force: true });
      deps.log(`Deleted ${deps.configDir}`);
    } else {
      deps.log(`Kept ${deps.configDir}`);
    }
  }

  deps.log("\nUninstall complete. Remove the CLI itself with: npm uninstall -g @ericcai/ccusage-tracker-cli");
}
