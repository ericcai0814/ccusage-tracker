import { readConfig } from "../config";
import { defaultWiringDeps, installHook, wireTools } from "../hooks";
import { defaultCollectorDeps, ensureCollector } from "../collector";
import { downloadScripts } from "../scripts";

export async function updateCommand(): Promise<void> {
  const config = readConfig();
  if (!config) {
    console.error("Missing or invalid configuration. Run `tracker setup` first.");
    process.exitCode = 1;
    return;
  }
  const log = (msg: string) => console.log(msg);
  const warn = (msg: string) => console.warn(msg);
  let detected: { claudeDetected: boolean; codexDetected: boolean };
  try {
    const scripts = await downloadScripts(config.server_url);
    detected = wireTools(scripts, { ...defaultWiringDeps, installHook, log, warn });
  } catch (error) {
    console.error("Update failed: " + (error as Error).message);
    process.exitCode = 1;
    return;
  }

  // 沒有任何受支援的工具時 update 無事可做：回非零，讓腳本化的升級看得見。
  // 指引已由 wireTools 印出，這裡不重複。收集器也不跑 —— 那一步可能執行一次全域
  // npm 安裝，而當下沒有任何工具會用到它。
  if (!detected.claudeDetected && !detected.codexDetected) {
    process.exitCode = 1;
    return;
  }

  // 與 setup 同一段收集器流程；安裝失敗只警告，不改 exit code。
  ensureCollector({ probe: defaultCollectorDeps.probe, install: defaultCollectorDeps.install, log, warn });
  console.log("\nUpdate complete. Tracker scripts and hooks updated.");
}
