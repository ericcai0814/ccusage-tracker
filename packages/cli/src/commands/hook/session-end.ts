import { homedir } from "node:os";
import { join } from "node:path";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { runCcusageDaily as defaultRunCcusageDaily } from "../../lib/ccusage";
import { replayBuffer as defaultReplayBuffer, appendToBuffer as defaultAppendToBuffer } from "../../lib/buffer";
import { extractSessionMetrics as defaultExtractSessionMetrics, type SessionMetrics } from "../../lib/transcript-metrics";

interface HookPayload {
  session_id?: string;
  transcript_path?: string;
}

interface RawConfig {
  server_url?: string;
  api_key?: string;
  team_key?: string;
  member_name?: string;
}

const CONTEXT_LIMIT = 200_000;
const REQUEST_TIMEOUT_MS = 10_000;

export interface SessionEndDeps {
  readStdin: () => Promise<string>;
  configDir: string;
  fetch: typeof fetch;
  now: () => Date;
  runCcusageDaily: typeof defaultRunCcusageDaily;
  replayBuffer: typeof defaultReplayBuffer;
  appendToBuffer: typeof defaultAppendToBuffer;
  extractSessionMetrics: typeof defaultExtractSessionMetrics;
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

const defaultDeps: SessionEndDeps = {
  readStdin: defaultReadStdin,
  configDir: join(homedir(), ".config", "ccusage-tracker"),
  fetch: globalThis.fetch.bind(globalThis),
  now: () => new Date(),
  runCcusageDaily: defaultRunCcusageDaily,
  replayBuffer: defaultReplayBuffer,
  appendToBuffer: defaultAppendToBuffer,
  extractSessionMetrics: defaultExtractSessionMetrics,
};

function loadConfig(configDir: string): RawConfig | null {
  const p = join(configDir, "config.json");
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as RawConfig;
  } catch {
    return null;
  }
}

function readSessionModel(configDir: string, sessionId: string): string | null {
  const p = join(configDir, "sessions", sessionId);
  if (!existsSync(p)) return null;
  try {
    const model = readFileSync(p, "utf-8").trim();
    try { unlinkSync(p); } catch { /* best-effort cleanup */ }
    return model || null;
  } catch {
    return null;
  }
}

function formatDateYMD(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}${m}${day}`;
}

function formatDateDash(d: Date): string {
  const y = d.getFullYear().toString().padStart(4, "0");
  const m = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function postJson(
  fetchFn: typeof fetch,
  url: string,
  teamKey: string,
  body: string,
): Promise<{ ok: boolean }> {
  const res = await fetchFn(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${teamKey}`,
    },
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  return { ok: res.ok };
}

export async function sessionEndCommand(overrides?: Partial<SessionEndDeps>): Promise<void> {
  const deps: SessionEndDeps = { ...defaultDeps, ...overrides };

  try {
    await runSessionEnd(deps);
  } catch (err) {
    if (process.env.CCUSAGE_TRACKER_DEBUG === "1") {
      console.error("[ccusage-tracker hook] unexpected error:", err);
    }
    // Always swallow — hook contract requires exit 0.
  }
}

async function runSessionEnd(deps: SessionEndDeps): Promise<void> {
  const raw = (await deps.readStdin()).trim();
  let payload: HookPayload = {};
  if (raw) {
    try { payload = JSON.parse(raw) as HookPayload; } catch { /* ignore */ }
  }

  const cfg = loadConfig(deps.configDir);
  if (!cfg) return;
  const serverUrl = cfg.server_url;
  const teamKey = cfg.team_key ?? cfg.api_key;
  const memberName = cfg.member_name;
  if (!serverUrl || !teamKey || !memberName) return;

  const bufferPath = join(deps.configDir, "buffer.jsonl");
  const ingestUrl = `${serverUrl.replace(/\/+$/, "")}/api/ingest`;
  const sessionIngestUrl = `${serverUrl.replace(/\/+$/, "")}/api/ingest/session`;

  // 1. Replay buffered entries (15s budget, 7d expiry)
  await deps.replayBuffer({
    bufferPath,
    postIngest: (body) => postJson(deps.fetch, ingestUrl, teamKey, body),
    now: deps.now,
  });

  // 2. Daily POST with buffer fallback
  const now = deps.now();
  const totals = await deps.runCcusageDaily(formatDateYMD(now));
  if (totals) {
    const dailyPayload = {
      member_name: memberName,
      date: formatDateDash(now),
      session_id: "daily",
      input_tokens: totals.inputTokens,
      output_tokens: totals.outputTokens,
      cache_creation_tokens: totals.cacheCreationTokens,
      cache_read_tokens: totals.cacheReadTokens,
      total_cost_usd: totals.totalCost,
      models: [],
    };
    const dailyBody = JSON.stringify(dailyPayload);
    let ok = false;
    try {
      const res = await postJson(deps.fetch, ingestUrl, teamKey, dailyBody);
      ok = res.ok;
    } catch {
      ok = false;
    }
    if (!ok) {
      deps.appendToBuffer(dailyPayload, { bufferPath, now: deps.now });
    }
  }

  // 3. Session metrics POST (fire-and-forget — does not block exit)
  if (payload.session_id && payload.transcript_path) {
    const metrics = deps.extractSessionMetrics(payload.transcript_path);
    if (metrics) {
      const sessionModel = readSessionModel(deps.configDir, payload.session_id) ?? "";
      const contextPct = Math.min(100, Math.floor((metrics.approx_tokens * 100) / CONTEXT_LIMIT));
      const { approx_tokens: _omit, ...rest } = metrics;
      void _omit;
      const sessionBody = JSON.stringify({
        ...rest,
        member_name: memberName,
        model: sessionModel,
        context_estimate_pct: contextPct,
      });
      // Fire-and-forget: do not await, swallow rejections so unhandled errors
      // never crash the hook.
      postJson(deps.fetch, sessionIngestUrl, teamKey, sessionBody).catch(() => {});
    }
  }
}
