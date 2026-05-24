import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_BUDGET_MS = 15_000;

export type IngestPoster = (body: string) => Promise<{ ok: boolean }>;

export interface BufferDeps {
  bufferPath: string;
  postIngest: IngestPoster;
  now: () => Date;
  timeBudgetMs: number;
  expiryMs: number;
}

export interface ReplayResult {
  retried: number;
  succeeded: number;
  remaining: number;
  expired: number;
}

interface BufferEntry {
  _buffered_at?: string;
  [k: string]: unknown;
}

function readLines(path: string): string[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf-8").trim();
  if (!raw) return [];
  return raw.split("\n").filter((l) => l.length > 0);
}

function writeLines(path: string, lines: string[]): void {
  if (lines.length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return;
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, lines.join("\n") + "\n");
}

function parseEntry(line: string): BufferEntry | null {
  try {
    return JSON.parse(line) as BufferEntry;
  } catch {
    return null;
  }
}

function isExpired(entry: BufferEntry, nowMs: number, expiryMs: number): boolean {
  const at = entry._buffered_at;
  if (typeof at !== "string" || !at) return true;
  const t = Date.parse(at);
  if (!Number.isFinite(t)) return true;
  return nowMs - t > expiryMs;
}

export async function replayBuffer(overrides: Partial<BufferDeps> & Pick<BufferDeps, "bufferPath" | "postIngest">): Promise<ReplayResult> {
  const deps: BufferDeps = {
    now: () => new Date(),
    timeBudgetMs: DEFAULT_BUDGET_MS,
    expiryMs: SEVEN_DAYS_MS,
    ...overrides,
  };

  const lines = readLines(deps.bufferPath);
  if (lines.length === 0) {
    return { retried: 0, succeeded: 0, remaining: 0, expired: 0 };
  }

  let startMs: number | null = null;
  const remaining: string[] = [];
  let retried = 0;
  let succeeded = 0;
  let expired = 0;

  for (const line of lines) {
    const nowMs = deps.now().getTime();
    if (startMs === null) startMs = nowMs;
    const elapsedMs = nowMs - startMs;
    if (elapsedMs >= deps.timeBudgetMs) {
      // Out of time — keep this and the rest as-is
      remaining.push(line);
      continue;
    }

    const entry = parseEntry(line);
    if (!entry) {
      expired += 1;
      continue;
    }

    if (isExpired(entry, nowMs, deps.expiryMs)) {
      expired += 1;
      continue;
    }

    retried += 1;
    try {
      const res = await deps.postIngest(line);
      if (res.ok) {
        succeeded += 1;
      } else {
        remaining.push(line);
      }
    } catch {
      remaining.push(line);
    }
  }

  writeLines(deps.bufferPath, remaining);

  return { retried, succeeded, remaining: remaining.length, expired };
}

export interface AppendDeps {
  bufferPath: string;
  now: () => Date;
}

export function appendToBuffer(payload: unknown, deps: AppendDeps): void {
  const stamped = { ...(payload as object), _buffered_at: deps.now().toISOString() };
  mkdirSync(dirname(deps.bufferPath), { recursive: true });
  appendFileSync(deps.bufferPath, JSON.stringify(stamped) + "\n");
}
