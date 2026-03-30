import { Hono } from "hono";
import { memberAuth, type MemberAuthEnv } from "../middleware/member-auth";
import { insertUsageRecord, type IngestPayload } from "../queries";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

function isValidTokenCount(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function isValidCost(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

const ingest = new Hono<MemberAuthEnv>();

ingest.use("*", memberAuth());

ingest.post("/", async (c) => {
  const body = await c.req.json<Partial<IngestPayload>>();

  const errors: string[] = [];

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

  const payload: IngestPayload = {
    date: body.date!,
    session_id: body.session_id ?? null,
    input_tokens: body.input_tokens!,
    output_tokens: body.output_tokens!,
    cache_creation_tokens: body.cache_creation_tokens!,
    cache_read_tokens: body.cache_read_tokens!,
    total_cost_usd: body.total_cost_usd!,
    models: body.models!,
  };

  insertUsageRecord(c.get("db"), c.get("memberId"), payload);

  return c.json({ ok: true });
});

export default ingest;
