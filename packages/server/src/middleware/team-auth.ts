import type { MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";
import type { AppEnv } from "../app";

export function teamAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const teamKey = process.env.TEAM_KEY;
    if (!teamKey) {
      return c.json({ error: "team key not configured" }, 500);
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const providedKey = authHeader.slice(7);

    const a = Buffer.from(teamKey);
    const b = Buffer.from(providedKey);
    const maxLen = Math.max(a.length, b.length);
    const aPadded = Buffer.concat([a, Buffer.alloc(maxLen - a.length)]);
    const bPadded = Buffer.concat([b, Buffer.alloc(maxLen - b.length)]);
    const lengthsMatch = a.length === b.length;
    const valuesMatch = timingSafeEqual(aPadded, bPadded);
    if (!lengthsMatch || !valuesMatch) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  };
}
