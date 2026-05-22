import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";

export interface SessionMetrics {
  session_id: string;
  session_name: string;
  project: string;
  branch: string;
  turns: number;
  user_messages: number;
  assistant_messages: number;
  user_avg_chars: number;
  tool_calls: Record<string, number>;
  tool_call_total: number;
  tool_errors: number;
  started_at: string;
  ended_at: string;
  duration_minutes: number;
  has_commit: boolean;
  files_read: number;
  files_written: number;
  files_edited: number;
  skills_invoked: string[];
  hook_blocks: number;
  approx_tokens: number;
}

type TranscriptEvent = {
  type?: string;
  userType?: string;
  sessionId?: string;
  slug?: string;
  cwd?: string;
  gitBranch?: string;
  timestamp?: string;
  message?: {
    content?: unknown;
  };
};

type ContentItem = {
  type?: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: unknown;
  is_error?: boolean;
};

function parseLines(content: string): TranscriptEvent[] {
  const events: TranscriptEvent[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as TranscriptEvent);
    } catch {
      // Skip malformed lines silently — transcripts can have truncation
    }
  }
  return events;
}

function isExternalUser(e: TranscriptEvent): boolean {
  return e.type === "user" && e.userType === "external";
}

function textLengthOfUserContent(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (Array.isArray(content)) {
    let total = 0;
    for (const item of content as ContentItem[]) {
      if (item?.type === "text" && typeof item.text === "string") {
        total += item.text.length;
      }
    }
    return total;
  }
  return 0;
}

function estimateContentTokens(content: unknown): number {
  if (typeof content === "string") return content.length;
  if (!Array.isArray(content)) return 0;
  let total = 0;
  for (const item of content as ContentItem[]) {
    if (!item || typeof item !== "object") {
      total += 50;
      continue;
    }
    if (item.type === "text" && typeof item.text === "string") {
      total += item.text.length;
    } else if (item.type === "tool_use") {
      total += JSON.stringify(item.input ?? {}).length + 50;
    } else if (item.type === "tool_result") {
      const inner = item.content ?? "";
      let innerSize = 0;
      if (typeof inner === "string") {
        innerSize = inner.length;
      } else if (Array.isArray(inner)) {
        for (const c of inner as ContentItem[]) {
          if (typeof c?.text === "string") innerSize += c.text.length;
        }
      }
      total += innerSize + 20;
    } else {
      total += 50;
    }
  }
  return total;
}

function firstNonEmpty<T>(events: TranscriptEvent[], picker: (e: TranscriptEvent) => T | undefined): T | "" {
  for (const e of events) {
    const v = picker(e);
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return "";
}

export function extractSessionMetrics(transcriptPath: string): SessionMetrics | null {
  if (!existsSync(transcriptPath)) return null;
  let raw: string;
  try {
    raw = readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }

  const events = parseLines(raw);
  if (events.length === 0) return null;

  const externalUserEvents = events.filter(isExternalUser);
  const userEvents = events.filter((e) => e.type === "user");
  const assistantEvents = events.filter((e) => e.type === "assistant");

  // user_avg_chars: average text length across external user messages
  let userAvgChars = 0;
  if (externalUserEvents.length > 0) {
    const lens = externalUserEvents.map((e) => textLengthOfUserContent(e.message?.content));
    userAvgChars = Math.floor(lens.reduce((a, b) => a + b, 0) / externalUserEvents.length);
  }

  // tool_calls: group_by name on assistant tool_use blocks
  const toolCalls: Record<string, number> = {};
  let toolCallTotal = 0;
  let filesRead = 0;
  let filesWritten = 0;
  let filesEdited = 0;
  let hasCommit = false;
  const skillsInvokedSet = new Set<string>();

  for (const e of assistantEvents) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content as ContentItem[]) {
      if (item?.type !== "tool_use" || typeof item.name !== "string") continue;
      toolCalls[item.name] = (toolCalls[item.name] ?? 0) + 1;
      toolCallTotal += 1;
      if (item.name === "Read") filesRead += 1;
      else if (item.name === "Write") filesWritten += 1;
      else if (item.name === "Edit") filesEdited += 1;
      else if (item.name === "Bash") {
        const cmd = (item.input?.command as string | undefined) ?? "";
        if (/git commit/.test(cmd)) hasCommit = true;
      } else if (item.name === "Skill") {
        const skill = item.input?.skill as string | undefined;
        if (skill) skillsInvokedSet.add(skill);
      }
    }
  }

  // tool_errors: tool_result with is_error: true (lives inside user-type events)
  let toolErrors = 0;
  for (const e of userEvents) {
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    for (const item of content as ContentItem[]) {
      if (item?.type === "tool_result" && item.is_error === true) toolErrors += 1;
    }
  }

  // started_at / ended_at / duration
  const timestamps = events
    .map((e) => e.timestamp)
    .filter((t): t is string => typeof t === "string" && t.length > 0)
    .sort();
  const startedAt = timestamps[0] ?? "";
  const endedAt = timestamps[timestamps.length - 1] ?? "";
  let durationMinutes = 0;
  if (startedAt && endedAt) {
    const startMs = Date.parse(startedAt);
    const endMs = Date.parse(endedAt);
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      durationMinutes = Math.floor((endMs - startMs) / 60_000);
    }
  }

  // approx_tokens: sum of estimated content sizes across user+assistant events, divided by 4
  let charSum = 0;
  for (const e of [...userEvents, ...assistantEvents]) {
    charSum += estimateContentTokens(e.message?.content);
  }
  const approxTokens = Math.floor(charSum / 4);

  // project = basename of first cwd seen
  const cwd = firstNonEmpty(events, (e) => e.cwd);
  const project = cwd ? basename(cwd) : "";

  return {
    session_id: firstNonEmpty(events, (e) => e.sessionId),
    session_name: firstNonEmpty(events, (e) => e.slug),
    project,
    branch: firstNonEmpty(events, (e) => e.gitBranch),
    turns: externalUserEvents.length,
    user_messages: userEvents.length,
    assistant_messages: assistantEvents.length,
    user_avg_chars: userAvgChars,
    tool_calls: toolCalls,
    tool_call_total: toolCallTotal,
    tool_errors: toolErrors,
    started_at: startedAt,
    ended_at: endedAt,
    duration_minutes: durationMinutes,
    has_commit: hasCommit,
    files_read: filesRead,
    files_written: filesWritten,
    files_edited: filesEdited,
    skills_invoked: [...skillsInvokedSet].sort(),
    hook_blocks: 0,
    approx_tokens: approxTokens,
  };
}
