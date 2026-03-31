import { Hono } from "hono";
import { teamAuth } from "../middleware/team-auth";
import { insertUsageRecord, findOrCreateMember, type IngestPayload } from "../queries";
import type { AppEnv } from "../app";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidTokenCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function isValidCost(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

const ingest = new Hono<AppEnv>();

ingest.use("*", teamAuth());

ingest.post("/", async (c) => {
  const body = await c.req.json<Partial<IngestPayload>>();

  const errors: string[] = [];

  if (!body.member_name || typeof body.member_name !== "string") {
    errors.push("member_name is required and must be a string");
  }
  if (!body.date || !DATE_REGEX.test(body.date)) {
    errors.push("date must be in YYYY-MM-DD format");
  }
  if (!isValidTokenCount(body.input_tokens)) {
    errors.push("input_tokens must be a non-negative finite number");
  }
  if (!isValidTokenCount(body.output_tokens)) {
    errors.push("output_tokens must be a non-negative finite number");
  }
  if (!isValidTokenCount(body.cache_creation_tokens)) {
    errors.push("cache_creation_tokens must be a non-negative finite number");
  }
  if (!isValidTokenCount(body.cache_read_tokens)) {
    errors.push("cache_read_tokens must be a non-negative finite number");
  }
  if (!isValidCost(body.total_cost_usd)) {
    errors.push("total_cost_usd must be a non-negative finite number");
  }
  if (!Array.isArray(body.models)) {
    errors.push("models is required and must be an array");
  }

  if (errors.length > 0) {
    return c.json({ error: "validation failed", details: errors }, 400);
  }

  const db = c.get("db");
  const member = findOrCreateMember(db, body.member_name!);

  const payload: IngestPayload = {
    member_name: body.member_name!,
    date: body.date!,
    session_id: body.session_id ?? null,
    input_tokens: body.input_tokens!,
    output_tokens: body.output_tokens!,
    cache_creation_tokens: body.cache_creation_tokens!,
    cache_read_tokens: body.cache_read_tokens!,
    total_cost_usd: body.total_cost_usd!,
    models: body.models!,
  };

  insertUsageRecord(db, member.id, payload);

  return c.json({ ok: true });
});

export default ingest;
