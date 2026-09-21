import { describe, expect, it, beforeEach, afterEach, setSystemTime } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { insertMember, hashApiKey, insertUsageRecord, insertSessionMetrics } from "../queries";
import { setSetting, MONTHLY_BUDGET_KEY } from "../settings";
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

  it("should show the trend section when data exists", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('class="panel trend"');
    expect(html).toContain("每日成本趨勢");
  });

  it("should not draw any chart mark when no data", async () => {
    const emptyDb = createDatabase(":memory:");
    const emptyApp = createApp(emptyDb);

    const res = await emptyApp.request("/?period=today");
    const html = await res.text();
    expect(html).not.toContain('class="trend-line"');
    expect(html).not.toContain('class="trend-bar"');

    emptyDb.close();
  });

  it("should draw a trend line when multiple days exist", async () => {
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
    expect(html).toContain('class="trend-line"');
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

  it("should show Last Report column with relative time", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Last Report");
    // Member has just ingested data, so should show relative time (not "Never")
    expect(html).not.toContain("Never");
  });

  it("should show stale warning for members with no recent report", async () => {
    // Set last_seen_at to 2 days ago to trigger stale warning
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString().replace("T", " ").slice(0, 19);
    db.run("UPDATE members SET last_seen_at = ? WHERE id = ?", [twoDaysAgo, "m1"]);

    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("stale-warn");
    expect(html).toContain("2d ago");
  });

  it("should show Never with warning for members that never reported", async () => {
    db.run("UPDATE members SET last_seen_at = NULL WHERE id = ?", ["m1"]);

    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Never");
    expect(html).toContain("stale-warn");
  });
});

// 期間全部由 new Date() 推導，月初跑測試會讓「三天」的 fixture 落到範圍外，
// 所以整段把系統時間釘在月中，斷言才是固定的。
const FIXED_NOW = new Date("2026-06-15T12:00:00Z");

describe("Dashboard overview", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    delete process.env.DASHBOARD_PASSWORD;
    setSystemTime(FIXED_NOW);
    db = createDatabase(":memory:");
    app = createApp(db);

    insertMember(db, "m1", "Eric", hashApiKey("key1"));
    insertMember(db, "m2", "Amber", hashApiKey("key2"));
    insertMember(db, "m3", "Ben", hashApiKey("key3"));

    // Eric 30／Amber 20／Ben 10，Claude 45 對 Codex 15 剛好 75%／25%，
    // claude-opus-5 橫跨三天兩人
    const rows = [
      { member: "m1", date: "2026-06-10", session_id: "daily", cost: 30, models: ["claude-opus-5"] },
      { member: "m2", date: "2026-06-11", session_id: "daily", cost: 10, models: ["claude-opus-5"] },
      { member: "m2", date: "2026-06-12", session_id: "daily", cost: 5, models: ["claude-opus-5"] },
      { member: "m2", date: "2026-06-11", session_id: "codex-daily", cost: 5, models: ["gpt-5.4"] },
      { member: "m3", date: "2026-06-12", session_id: "codex-daily", cost: 10, models: ["gpt-5.4"] },
    ];
    rows.forEach((r) => {
      insertUsageRecord(db, r.member, {
        member_name: r.member,
        date: r.date,
        session_id: r.session_id,
        input_tokens: 1000,
        output_tokens: 500,
        cache_creation_tokens: 300,
        cache_read_tokens: 200,
        total_cost_usd: r.cost,
        models: r.models,
      });
    });

    insertSessionMetrics(db, "m1", {
      member_name: "Eric",
      session_id: "s-june",
      started_at: "2026-06-11T10:00:00Z",
      ended_at: "2026-06-11T11:00:00Z",
      turns: 42,
    });
  });

  afterEach(() => {
    db.close();
    setSystemTime();
    delete process.env.DASHBOARD_PASSWORD;
  });

  describe("KPI row", () => {
    it("should show four KPI cards with period figures", async () => {
      const html = await (await app.request("/?period=month")).text();

      expect(html).toContain("總花費");
      expect(html).toContain("總 token");
      expect(html).toContain("活躍成員");
      expect(html).toContain("Claude 對話回合");
      expect(html).toContain("$60.00");
      expect(html).toContain("10,000");
      expect(html).toContain("42");
    });

    it("should note that turns cover Claude Code only", async () => {
      const html = await (await app.request("/?period=month")).text();
      expect(html).toContain("只含 Claude Code");
    });
  });

  describe("Trend chart", () => {
    it("should draw one line per source with a legend and end labels", async () => {
      const html = await (await app.request("/?period=month")).text();

      expect(html).toContain("<svg");
      expect(html.match(/class="trend-line"/g)).toHaveLength(2);
      expect(html).toContain("Claude Code");
      expect(html).toContain("Codex");
      expect(html).toContain('class="trend-legend"');
    });

    it("should give every data point a title for hover readout", async () => {
      const html = await (await app.request("/?period=month")).text();
      expect(html).toContain("<title>2026-06-10 · Claude Code $30.00</title>");
      expect(html).toContain("<title>2026-06-12 · Codex $10.00</title>");
    });

    it("should stay complete after every script is removed", async () => {
      const html = await (await app.request("/?period=month")).text();
      const withoutScript = html.replace(/<script[\s\S]*?<\/script>/g, "");

      expect(withoutScript).toContain("<svg");
      expect(withoutScript.match(/class="trend-line"/g)).toHaveLength(2);
      expect(withoutScript).toContain("<title>2026-06-10 · Claude Code $30.00</title>");
      expect(withoutScript).toContain('class="trend-legend"');
    });

    it("should render two bars instead of lines for a single-day period", async () => {
      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-06-15",
        session_id: "daily",
        input_tokens: 10,
        output_tokens: 10,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 4,
        models: ["claude-opus-5"],
      });
      insertUsageRecord(db, "m1", {
        member_name: "Eric",
        date: "2026-06-15",
        session_id: "codex-daily",
        input_tokens: 10,
        output_tokens: 10,
        cache_creation_tokens: 0,
        cache_read_tokens: 0,
        total_cost_usd: 1,
        models: ["gpt-5.4"],
      });

      const html = await (await app.request("/?period=today")).text();

      expect(html).not.toContain('class="trend-line"');
      expect(html.match(/class="trend-bar"/g)).toHaveLength(2);
      expect(html).toContain("Claude Code");
      expect(html).toContain("Codex");
    });
  });

  describe("Member ranking", () => {
    it("should list members by cost descending", async () => {
      const html = await (await app.request("/?period=month")).text();
      const section = html.slice(html.indexOf('class="panel ranking"'), html.indexOf('class="panel provider"'));

      expect(section.indexOf("Eric")).toBeGreaterThan(-1);
      expect(section.indexOf("Eric")).toBeLessThan(section.indexOf("Amber"));
      expect(section.indexOf("Amber")).toBeLessThan(section.indexOf("Ben"));
      expect(section).toContain("$30.00");
      expect(section).toContain("$20.00");
      expect(section).toContain("$10.00");
    });

    it("should size bars proportionally to cost", async () => {
      const html = await (await app.request("/?period=month")).text();
      const section = html.slice(html.indexOf('class="panel ranking"'), html.indexOf('class="panel provider"'));
      const widths = [...section.matchAll(/class="rank-fill" style="width: ([\d.]+)%/g)].map((m) => Number(m[1]));

      expect(widths).toEqual([100, 66.7, 33.3]);
    });

    it("should fold members beyond the tenth into one row", async () => {
      for (let i = 4; i <= 15; i++) {
        insertMember(db, `m${i}`, `Member${i}`, hashApiKey(`key${i}`));
        insertUsageRecord(db, `m${i}`, {
          member_name: `Member${i}`,
          date: "2026-06-13",
          session_id: "daily",
          input_tokens: 1,
          output_tokens: 1,
          cache_creation_tokens: 0,
          cache_read_tokens: 0,
          total_cost_usd: 100 + i,
          models: ["claude-opus-5"],
        });
      }

      const html = await (await app.request("/?period=month")).text();
      const section = html.slice(html.indexOf('class="panel ranking"'), html.indexOf('class="panel provider"'));

      expect(section.match(/class="rank-row"/g)).toHaveLength(10);
      expect(section).toContain("其他 5 人");
    });
  });

  describe("Provider split", () => {
    it("should show Anthropic and OpenAI shares", async () => {
      const html = await (await app.request("/?period=month")).text();
      const section = html.slice(html.indexOf('class="panel provider"'), html.indexOf('class="panel models"'));

      expect(section).toContain("Anthropic");
      expect(section).toContain("OpenAI");
      expect(section).toContain("75%");
      expect(section).toContain("25%");
      expect(section).toContain("$45.00");
      expect(section).toContain("$15.00");
    });
  });

  describe("Model table", () => {
    it("should list distinct days and members per model", async () => {
      const html = await (await app.request("/?period=month")).text();
      const section = html.slice(html.indexOf('class="panel models"'), html.indexOf("</main>"));

      expect(section).toContain("出現天數");
      expect(section).toContain("使用人數");
      expect(section).toContain("claude-opus-5");
      expect(section).toMatch(/claude-opus-5<\/td>\s*<td[^>]*>Claude Code<\/td>\s*<td[^>]*>3<\/td>\s*<td[^>]*>2<\/td>/);
    });

    it("should skip records whose models column is not a JSON array", async () => {
      db.run(
        "INSERT INTO usage_records (member_id, date, session_id, total_cost_usd, models) VALUES ('m1', '2026-06-14', 'daily', 1, 'not-json')"
      );

      const res = await app.request("/?period=month");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("claude-opus-5");
    });
  });

  describe("Member table", () => {
    it("should keep the existing per-member table", async () => {
      const html = await (await app.request("/?period=month")).text();

      expect(html).toContain("Cache Create");
      expect(html).toContain("Cache Read");
      expect(html).toContain("Last Report");
      expect(html).toContain("share-bar");
    });
  });

  describe("Empty database", () => {
    it("should return 200 with an empty state per section", async () => {
      const emptyDb = createDatabase(":memory:");
      const emptyApp = createApp(emptyDb);

      const res = await emptyApp.request("/?period=month");
      expect(res.status).toBe(200);

      const html = await res.text();
      expect(html).toContain("No trend data");
      expect(html).toContain("No member activity");
      expect(html).toContain("No provider data");
      expect(html).toContain("No model data");
      expect(html).toContain("No usage data");

      emptyDb.close();
    });
  });
});

describe("Dashboard budget note", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  beforeEach(() => {
    delete process.env.DASHBOARD_PASSWORD;
    setSystemTime(FIXED_NOW);
    db = createDatabase(":memory:");
    app = createApp(db);
    insertMember(db, "m1", "Eric", hashApiKey("key1"));
  });

  afterEach(() => {
    db.close();
    setSystemTime();
    delete process.env.DASHBOARD_PASSWORD;
  });

  // 2026-06-15 是第 15 天、6 月有 30 天，所以月底推估剛好是已用金額的兩倍
  function spend(cost: number): void {
    insertUsageRecord(db, "m1", {
      member_name: "Eric",
      date: "2026-06-10",
      session_id: "daily",
      input_tokens: 10,
      output_tokens: 10,
      cache_creation_tokens: 0,
      cache_read_tokens: 0,
      total_cost_usd: cost,
      models: ["claude-opus-5"],
    });
  }

  it("should show budget, used share and projection when on track", async () => {
    spend(750);
    setSetting(db, MONTHLY_BUDGET_KEY, "2000");

    const html = await (await app.request("/?period=month")).text();

    expect(html).toContain("預算");
    expect(html).toContain("已用");
    expect(html).toContain("月底推估");
    expect(html).toContain("$2,000");
    expect(html).toContain("38%");
    expect(html).toContain("$1,500");
    expect(html).not.toContain("budget-status critical");
    expect(html).not.toContain("budget-status warning");
  });

  it("should carry a critical label and symbol when the projection is over budget by more than 10%", async () => {
    spend(600);
    setSetting(db, MONTHLY_BUDGET_KEY, "1000");

    const html = await (await app.request("/?period=month")).text();

    expect(html).toContain("budget-status critical");
    expect(html).toContain("超出預算");
    expect(html).toContain("!");
  });

  it("should carry a warning label when the projection is 0 to 10% over budget", async () => {
    spend(525);
    setSetting(db, MONTHLY_BUDGET_KEY, "1000");

    const html = await (await app.request("/?period=month")).text();

    expect(html).toContain("budget-status warning");
    expect(html).toContain("略超預算");
    expect(html).toContain("△");
  });

  it("should not show budget text when no budget is stored", async () => {
    spend(750);

    const html = await (await app.request("/?period=month")).text();
    expect(html).not.toContain("預算");
  });

  it("should treat a budget of 0 as unset", async () => {
    spend(750);
    setSetting(db, MONTHLY_BUDGET_KEY, "0");

    const html = await (await app.request("/?period=month")).text();
    expect(html).not.toContain("預算");
  });

  it("should not show budget text outside the month period", async () => {
    spend(750);
    setSetting(db, MONTHLY_BUDGET_KEY, "2000");

    const html = await (await app.request("/?period=week")).text();
    expect(html).not.toContain("預算");
  });
});
