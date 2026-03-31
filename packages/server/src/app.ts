import { Hono } from "hono";
import { createDatabase } from "./db";
import admin from "./routes/admin";
import ingest from "./routes/ingest";
import report from "./routes/report";
import dashboard from "./routes/dashboard";
import { generateSetupScript, generateUninstallScript, generateSessionEndScript } from "./scripts";
import type { Database } from "bun:sqlite";

export type AppEnv = {
  Variables: {
    db: Database;
  };
};

export function createApp(db?: Database): Hono<AppEnv> {
  const database = db ?? createDatabase(process.env.DB_PATH || "data.db");
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    c.set("db", database);
    await next();
  });

  app.get("/api/health", (c) => {
    return c.json({ ok: true, version: "0.1.0" });
  });

  app.get("/setup.sh", (c) => {
    const proto = c.req.header("X-Forwarded-Proto") || "https";
    const host = c.req.header("Host") || new URL(c.req.url).host;
    const serverUrl = process.env.SERVER_URL || `${proto}://${host}`;
    const teamKey = process.env.TEAM_KEY || "";
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateSetupScript(serverUrl, teamKey));
  });

  app.get("/uninstall.sh", (c) => {
    const proto = c.req.header("X-Forwarded-Proto") || "https";
    const host = c.req.header("Host") || new URL(c.req.url).host;
    const serverUrl = process.env.SERVER_URL || `${proto}://${host}`;
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateUninstallScript(serverUrl));
  });

  app.get("/scripts/session-end.sh", (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateSessionEndScript());
  });

  app.route("/api/admin", admin);
  app.route("/api/ingest", ingest);
  app.route("/api/report", report);
  app.route("", dashboard);

  return app;
}
