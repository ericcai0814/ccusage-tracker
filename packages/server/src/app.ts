import { Hono, type Context } from "hono";
import { createDatabase } from "./db";
import admin from "./routes/admin";
import ingest from "./routes/ingest";
import sessionIngest from "./routes/session-ingest";
import report from "./routes/report";
import weeklyReport from "./routes/weekly-report";
import dashboard from "./routes/dashboard";
import { generateSetupScript, generateUninstallScript, generateSessionStartScript, generateSessionEndScript, generateSetupPs1Script, generateSessionStartMjsScript, generateSessionEndMjsScript } from "./scripts";
import type { Database } from "bun:sqlite";

export type AppEnv = {
  Variables: {
    db: Database;
  };
};

// 從請求推導 server URL，並用 URL.origin 正規化，杜絕 Host header 注入安裝腳本模板（引號/換行）
function resolveServerUrl(c: Context<AppEnv>): string {
  const proto = c.req.header("X-Forwarded-Proto") || "https";
  const host = c.req.header("Host") || new URL(c.req.url).host;
  const candidate = process.env.SERVER_URL || `${proto}://${host}`;
  try {
    const u = new URL(candidate);
    if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("invalid protocol");
    return u.origin;
  } catch {
    return "https://cctracker.erictree.me";
  }
}

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
    const serverUrl = resolveServerUrl(c);
    const teamKey = process.env.TEAM_KEY || "";
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateSetupScript(serverUrl, teamKey));
  });

  app.get("/uninstall.sh", (c) => {
    const serverUrl = resolveServerUrl(c);
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateUninstallScript(serverUrl));
  });

  app.get("/scripts/session-start.sh", (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateSessionStartScript());
  });

  app.get("/scripts/session-end.sh", (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateSessionEndScript());
  });

  // ── 跨平台 Node.js 版（路線 C）+ Windows 安裝入口 ──
  app.get("/setup.ps1", (c) => {
    const serverUrl = resolveServerUrl(c);
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateSetupPs1Script(serverUrl));
  });

  app.get("/scripts/session-start.mjs", (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateSessionStartMjsScript());
  });

  app.get("/scripts/session-end.mjs", (c) => {
    c.header("Content-Type", "text/plain; charset=utf-8");
    return c.text(generateSessionEndMjsScript());
  });

  app.route("/api/admin", admin);
  app.route("/api/ingest/session", sessionIngest);
  app.route("/api/ingest", ingest);
  app.route("/api/report/weekly", weeklyReport);
  app.route("/api/report", report);
  app.route("", dashboard);

  return app;
}
