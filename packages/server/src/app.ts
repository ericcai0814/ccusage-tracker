import { Hono } from "hono";
import { createDatabase } from "./db";
import admin from "./routes/admin";
import ingest from "./routes/ingest";
import report from "./routes/report";
import dashboard from "./routes/dashboard";
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

  app.route("/api/admin", admin);
  app.route("/api/ingest", ingest);
  app.route("/api/report", report);
  app.route("", dashboard);

  return app;
}

export default createApp();
