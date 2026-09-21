import { Hono } from "hono";
import { nanoid } from "nanoid";
import { adminAuth } from "../middleware/admin-auth";
import { insertMember, listMembers, hashApiKey } from "../queries";
import { listSettings, setSetting, getMonthlyBudgetUsd, MONTHLY_BUDGET_KEY } from "../settings";
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

// 預算會被拿去算百分比與月底推估。沒有上下限的話，1e308 之類的合法有限值會讓
// 儀表板算出 Infinity；小於 1 美元的預算也一樣。0 保留為「清除」。
const MIN_BUDGET_USD = 1;
const MAX_BUDGET_USD = 1_000_000_000;

function isValidBudget(value: unknown): value is number {
  if (typeof value !== "number" || !Number.isFinite(value)) return false;
  if (value === 0) return true;
  if (value < MIN_BUDGET_USD || value > MAX_BUDGET_USD) return false;
  // 這個區間內 toString() 不會用指數表示法，小數位可以直接數
  const decimals = value.toString().split(".")[1] ?? "";
  return decimals.length <= 2;
}

admin.get("/settings", (c) => {
  const db = c.get("db");
  return c.json({ ...listSettings(db), [MONTHLY_BUDGET_KEY]: getMonthlyBudgetUsd(db) });
});

admin.put("/settings/monthly_budget_usd", async (c) => {
  let body: { value?: unknown };
  try {
    body = await c.req.json<{ value?: unknown }>();
  } catch {
    return c.json({ error: "invalid JSON body" }, 400);
  }

  const value = body?.value;
  if (!isValidBudget(value)) {
    return c.json(
      { error: `value must be 0 (clears the budget) or a number between ${MIN_BUDGET_USD} and ${MAX_BUDGET_USD} with at most 2 decimal places` },
      400
    );
  }

  setSetting(c.get("db"), MONTHLY_BUDGET_KEY, String(value));
  return c.json({ [MONTHLY_BUDGET_KEY]: value });
});

export default admin;
