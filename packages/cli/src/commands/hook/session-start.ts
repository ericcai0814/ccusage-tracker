import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface SessionStartDeps {
  readStdin: () => Promise<string>;
  sessionsDir: string;
}

interface StartPayload {
  session_id?: string;
  model?: string;
}

function defaultReadStdin(): Promise<string> {
  return new Promise<string>((resolve) => {
    let data = "";
    const finish = () => {
      clearTimeout(timer);
      resolve(data);
    };
    const timer = setTimeout(() => resolve(data), 1000);
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => { data += chunk; });
    process.stdin.on("end", finish);
    process.stdin.on("error", finish);
  });
}

const defaultDeps: SessionStartDeps = {
  readStdin: defaultReadStdin,
  sessionsDir: join(homedir(), ".config", "ccusage-tracker", "sessions"),
};

export async function sessionStartCommand(overrides?: Partial<SessionStartDeps>): Promise<void> {
  const deps = { ...defaultDeps, ...overrides };

  try {
    const raw = (await deps.readStdin()).trim();
    if (!raw) return;

    let payload: StartPayload;
    try {
      payload = JSON.parse(raw) as StartPayload;
    } catch {
      return;
    }

    if (!payload.session_id || !payload.model) return;

    mkdirSync(deps.sessionsDir, { recursive: true });
    writeFileSync(join(deps.sessionsDir, payload.session_id), payload.model);
  } catch {
    // Hook contract: always silent, always exit 0
  }
}
