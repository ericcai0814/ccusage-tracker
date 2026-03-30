import { Hono } from "hono";
import { memberAuth, type MemberAuthEnv } from "../middleware/member-auth";
import { insertUsageRecord, type IngestPayload } from "../queries";

const ingest = new Hono<MemberAuthEnv>();

ingest.use("*", memberAuth());

ingest.post("/", async (c) => {
  const body = await c.req.json<Partial<IngestPayload>>();

  const errors: string[] = [];

  if (!body.date || typeof body.date !== "string") {
    errors.push("date is required and must be a string");
  }
  if (typeof body.input_tokens !== "number") {
    errors.push("input_tokens is required and must be a number");
  }
  if (typeof body.output_tokens !== "number") {
    errors.push("output_tokens is required and must be a number");
  }
  if (typeof body.cache_creation_tokens !== "number") {
    errors.push("cache_creation_tokens is required and must be a number");
  }
  if (typeof body.cache_read_tokens !== "number") {
    errors.push("cache_read_tokens is required and must be a number");
  }
  if (typeof body.total_cost_usd !== "number") {
    errors.push("total_cost_usd is required and must be a number");
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
