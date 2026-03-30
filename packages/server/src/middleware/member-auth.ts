import type { MiddlewareHandler } from "hono";
import { hashApiKey, findMemberByApiKeyHash } from "../queries";
import type { AppEnv } from "../app";

export type MemberAuthEnv = AppEnv & {
  Variables: AppEnv["Variables"] & {
    memberId: string;
    memberName: string;
  };
};

export function memberAuth(): MiddlewareHandler<MemberAuthEnv> {
  return async (c, next) => {
    const authHeader = c.req.header("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return c.json({ error: "unauthorized" }, 401);
    }

    const apiKey = authHeader.slice(7);
    const apiKeyHash = hashApiKey(apiKey);
    const db = c.get("db");
    const member = findMemberByApiKeyHash(db, apiKeyHash);

    if (!member) {
      return c.json({ error: "unauthorized" }, 401);
    }

    c.set("memberId", member.id);
    c.set("memberName", member.name);
    await next();
  };
}
