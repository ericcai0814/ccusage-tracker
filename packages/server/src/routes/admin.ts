import { Hono } from "hono";
import { nanoid } from "nanoid";
import { adminAuth } from "../middleware/admin-auth";
import { insertMember, listMembers, hashApiKey } from "../queries";
import type { AppEnv } from "../app";

const admin = new Hono<AppEnv>();

admin.use("*", adminAuth());

admin.post("/members", async (c) => {
  const body = await c.req.json<{ name?: string }>();

  if (!body.name || typeof body.name !== "string" || body.name.trim().length === 0) {
    return c.json({ error: "name is required" }, 400);
  }

  const name = body.name.trim();
  const id = nanoid(12);
  const apiKey = `sk-tracker-${nanoid(32)}`;
  const apiKeyHash = hashApiKey(apiKey);

  try {
    insertMember(c.get("db"), id, name, apiKeyHash);
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes("UNIQUE constraint failed")) {
      return c.json({ error: "member already exists" }, 409);
    }
    throw err;
  }

  return c.json({ id, name, api_key: apiKey }, 201);
});

admin.get("/members", (c) => {
  const members = listMembers(c.get("db"));
  return c.json(members);
});

export default admin;
