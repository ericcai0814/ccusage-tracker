import type { MiddlewareHandler } from "hono";
import { timingSafeEqual } from "node:crypto";
import type { AppEnv } from "../app";

export function adminAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const adminKey = process.env.ADMIN_API_KEY;
    if (!adminKey) {
      return c.json({ error: "admin API key not configured" }, 500);
    }

    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const providedKey = authHeader.slice(7);

    const a = Buffer.from(adminKey);
    const b = Buffer.from(providedKey);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return c.json({ error: "unauthorized" }, 401);
    }

    await next();
  };
}
