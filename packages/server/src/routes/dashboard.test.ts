import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { insertMember, hashApiKey, insertUsageRecord } from "../queries";
import type { Database } from "bun:sqlite";

describe("Dashboard", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    delete process.env.DASHBOARD_PASSWORD;
    db = createDatabase(":memory:");
    app = createApp(db);

    insertMember(db, "m1", "Eric", hashApiKey("key1"));
    insertUsageRecord(db, "m1", {
      date: new Date().toISOString().split("T")[0],
      session_id: "s1",
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_tokens: 100,
      cache_read_tokens: 200,
      total_cost_usd: 0.05,
      models: ["claude-sonnet-4-6"],
    });
  });

  afterEach(() => {
    db.close();
    delete process.env.DASHBOARD_PASSWORD;
  });

  it("should serve HTML dashboard at GET /", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");

    const html = await res.text();
    expect(html).toContain("ccusage-tracker");
    expect(html).toContain("Eric");
    expect(html).toContain("$0.05");
  });

  it("should show summary cards", async () => {
    const res = await app.request("/");
    const html = await res.text();

    expect(html).toContain("Total Cost");
    expect(html).toContain("Total Tokens");
    expect(html).toContain("Active Members");
  });

  it("should support period query parameter", async () => {
    const res = await app.request("/?period=today");
    expect(res.status).toBe(200);

    const html = await res.text();
    expect(html).toContain("ccusage-tracker");
  });

  it("should show empty state when no data", async () => {
    const emptyDb = createDatabase(":memory:");
    const emptyApp = createApp(emptyDb);

    const res = await emptyApp.request("/?period=today");
    const html = await res.text();
    expect(html).toContain("No usage data");

    emptyDb.close();
  });

  it("should require auth when DASHBOARD_PASSWORD is set", async () => {
    process.env.DASHBOARD_PASSWORD = "secret123";
    const protectedApp = createApp(createDatabase(":memory:"));

    const res = await protectedApp.request("/");
    expect(res.status).toBe(401);
  });

  it("should allow access with correct basic auth", async () => {
    process.env.DASHBOARD_PASSWORD = "secret123";
    const protectedDb = createDatabase(":memory:");
    const protectedApp = createApp(protectedDb);

    const credentials = Buffer.from("admin:secret123").toString("base64");
    const res = await protectedApp.request("/", {
      headers: { Authorization: `Basic ${credentials}` },
    });

    expect(res.status).toBe(200);
    protectedDb.close();
  });
});
