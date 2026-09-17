import { readConfig } from "../config";
import { installHook } from "../hooks";
import { CODEX_COMPATIBILITY_MESSAGE, downloadScripts } from "../scripts";

export async function updateCommand(): Promise<void> {
  const config = readConfig();
  if (!config) {
    console.error("Missing or invalid configuration. Run `tracker setup` first.");
    process.exitCode = 1;
    return;
  }
  try {
    const scripts = await downloadScripts(config.server_url);
    const result = installHook(scripts);
    console.log("Tracker scripts and Claude hooks updated." + (result.backedUp ? " Changed files backed up." : ""));
    if (scripts.codexSync === undefined) console.warn(CODEX_COMPATIBILITY_MESSAGE);
    else console.log("Codex support installed. Run `tracker sync codex` to report usage.");
  } catch (error) {
    console.error("Update failed: " + (error as Error).message);
    process.exitCode = 1;
  }
}
