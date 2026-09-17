import { spawnSync } from "node:child_process";

export interface TrackerScripts {
  sessionEnd: string;
  sessionStart: string;
  codexSync?: string;
}

// Only this optional endpoint can be absent on older tracker servers.
export async function fetchHookScript(serverUrl: string, scriptName: string): Promise<string | null> {
  const response = await fetch(`${serverUrl.replace(/\/+$/, "")}/scripts/${scriptName}`, {
    signal: AbortSignal.timeout(10000),
  });
  if (scriptName === "codex-sync.mjs" && [404, 410].includes(response.status)) return null;
  if (!response.ok) throw new Error(`Could not download ${scriptName} (HTTP ${response.status}).`);
  return response.text();
}

export async function downloadScripts(
  serverUrl: string,
  fetchScript = fetchHookScript,
): Promise<TrackerScripts> {
  const [sessionEnd, sessionStart, codexSync] = await Promise.all([
    fetchScript(serverUrl, "session-end.mjs"),
    fetchScript(serverUrl, "session-start.mjs"),
    fetchScript(serverUrl, "codex-sync.mjs"),
  ]);
  if (!sessionEnd?.trim() || !sessionStart?.trim() || codexSync === "") {
    throw new Error("Server returned an empty or missing hook script.");
  }
  return { sessionEnd, sessionStart, ...(codexSync === null ? {} : { codexSync }) };
}

export function validateScripts(scripts: TrackerScripts): void {
  for (const [name, source] of Object.entries(scripts)) {
    if (!source.trim()) throw new Error(`Server returned an empty ${name} script.`);
    // Syntax-check only; downloaded code must not run during installation.
    const check = spawnSync(process.execPath, ["--check", "--input-type=module"], {
      input: source, encoding: "utf8", timeout: 10000,
    });
    if (check.status !== 0) throw new Error(`Invalid JavaScript in ${name}; installation unchanged.`);
  }
}

export const CODEX_COMPATIBILITY_MESSAGE = "This server does not provide Codex support (404/410). Claude hooks can still be updated; any existing Codex script is preserved. Deploy a server version with Codex support, then run `tracker update`.";
