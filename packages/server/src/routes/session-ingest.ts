import { Hono } from "hono";
import { teamAuth } from "../middleware/team-auth";
import { findOrCreateMember, insertSessionMetrics, type SessionMetricsPayload } from "../queries";
import type { AppEnv } from "../app";

function isValidNonNegativeInt(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && Number.isInteger(v);
}

function isPlainObject(v: unknown): v is Record<string, number> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((item) => typeof item === "string");
}

const sessionIngest = new Hono<AppEnv>();

sessionIngest.use("*", teamAuth());

sessionIngest.post("/", async (c) => {
  const body = await c.req.json<Partial<SessionMetricsPayload & { has_commit?: boolean }>>();

  const errors: string[] = [];

  if (!body.member_name || typeof body.member_name !== "string") {
    errors.push("member_name is required and must be a string");
  }
  if (!body.session_id || typeof body.session_id !== "string") {
    errors.push("session_id is required and must be a string");
  }
  if (!body.started_at || typeof body.started_at !== "string") {
    errors.push("started_at is required and must be a string");
  }
  if (!body.ended_at || typeof body.ended_at !== "string") {
    errors.push("ended_at is required and must be a string");
  }

  const intFields = [
    "duration_minutes", "turns", "user_messages", "assistant_messages",
    "user_avg_chars", "tool_call_total", "tool_errors", "hook_blocks",
    "files_read", "files_written", "files_edited",
  ] as const;

  for (const field of intFields) {
    const val = body[field as keyof typeof body];
    if (val !== undefined && !isValidNonNegativeInt(val)) {
      errors.push(`${field} must be a non-negative integer`);
    }
  }

  if (body.tool_calls !== undefined && !isPlainObject(body.tool_calls)) {
    errors.push("tool_calls must be an object");
  }

  if (body.skills_invoked !== undefined && !isStringArray(body.skills_invoked)) {
    errors.push("skills_invoked must be an array of strings");
  }

  if (errors.length > 0) {
    return c.json({ error: "validation failed", details: errors }, 400);
  }

  const db = c.get("db");
  const member = findOrCreateMember(db, body.member_name!);

  const payload: SessionMetricsPayload = {
    member_name: body.member_name!,
    session_id: body.session_id!,
    session_name: body.session_name,
    project: body.project,
    branch: body.branch,
    started_at: body.started_at!,
    ended_at: body.ended_at!,
    duration_minutes: body.duration_minutes,
    turns: body.turns,
    user_messages: body.user_messages,
    assistant_messages: body.assistant_messages,
    user_avg_chars: body.user_avg_chars,
    tool_calls: body.tool_calls,
    tool_call_total: body.tool_call_total,
    tool_errors: body.tool_errors,
    skills_invoked: body.skills_invoked,
    hook_blocks: body.hook_blocks,
    files_read: body.files_read,
    files_written: body.files_written,
    files_edited: body.files_edited,
    has_commit: body.has_commit,
  };

  insertSessionMetrics(db, member.id, payload);

  return c.json({ ok: true });
});

export default sessionIngest;
