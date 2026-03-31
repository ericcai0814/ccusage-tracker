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
      member_name: "Eric",
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

  it("should show share-bar in member table", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("share-bar");
    expect(html).toContain("Share");
  });

  it("should show daily-chart when data exists", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('class="daily-chart"');
    expect(html).toContain("Daily Usage Trend");
  });

  it("should not show daily-chart element when no data", async () => {
    const emptyDb = createDatabase(":memory:");
    const emptyApp = createApp(emptyDb);

    const res = await emptyApp.request("/?period=today");
    const html = await res.text();
    expect(html).not.toContain('class="daily-chart"');

    emptyDb.close();
  });

  it("should show peak marker when multiple days exist", async () => {
    insertUsageRecord(db, "m1", {
      member_name: "Eric",
      date: (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().split("T")[0];
      })(),
      session_id: "s-yesterday",
      input_tokens: 500,
      output_tokens: 250,
      cache_creation_tokens: 50,
      cache_read_tokens: 100,
      total_cost_usd: 0.10,
      models: ["claude-sonnet-4-6"],
    });

    const res = await app.request("/?period=month");
    const html = await res.text();
    expect(html).toContain("← peak");
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
