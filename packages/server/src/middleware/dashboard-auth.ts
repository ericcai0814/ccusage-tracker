import type { MiddlewareHandler } from "hono";
import { basicAuth } from "hono/basic-auth";
import type { AppEnv } from "../app";

export function dashboardAuth(): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const password = process.env.DASHBOARD_PASSWORD;
    if (!password) {
      return next();
    }

    const auth = basicAuth({ username: "admin", password });
    return auth(c, next);
  };
}
