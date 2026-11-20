import { describe, expect, it, beforeEach, afterEach, setSystemTime } from "bun:test";
import { createApp } from "../app";
import { createDatabase } from "../db";
import { insertMember, hashApiKey, insertUsageRecord, insertSessionMetrics } from "../queries";
import { formatChange } from "./dashboard";
import type { Database } from "bun:sqlite";

describe("formatChange", () => {
  it("shows a positive percentage with a plus sign", () => {
    expect(formatChange(112, 100, "percent", "month")).toBe("+12% vs 上月同期");
  });

  it("shows a negative percentage with a real minus sign", () => {
    expect(formatChange(92, 100, "percent", "month")).toBe("−8% vs 上月同期");
    expect(formatChange(92, 100, "percent", "month")).not.toContain("-");
  });

  it("rounds to whole percent and treats a rounded zero as flat", () => {
    expect(formatChange(100.4, 100, "percent", "week")).toBe("持平 vs 上週同期");
    expect(formatChange(99.6, 100, "percent", "week")).toBe("持平 vs 上週同期");
    expect(formatChange(112.6, 100, "percent", "today")).toBe("+13% vs 昨天");
  });

  it("shows member count difference in people", () => {
    expect(formatChange(4, 3, "count", "month")).toBe("+1 人 vs 上月同期");
    expect(formatChange(1, 3, "count", "month")).toBe("−2 人 vs 上月同期");
    expect(formatChange(3, 3, "count", "month")).toBe("持平 vs 上月同期");
  });

  it("shows no-data text when the previous period is zero", () => {
    expect(formatChange(50, 0, "percent", "month")).toBe("上月同期無資料");
    expect(formatChange(2, 0, "count", "week")).toBe("上週同期無資料");
    expect(formatChange(0, 0, "percent", "today")).toBe("昨天無資料");
  });

  it("shows no-data text instead of NaN or Infinity for non-finite inputs", () => {
    const cases: Array<[number, number]> = [
      [Infinity, 100],
      [100, Infinity],
      [NaN, 100],
      [100, NaN],
      [-Infinity, 100],
      // 兩邊都有限，但變化量相除後溢位
      [Number.MAX_VALUE, Number.MIN_VALUE],
      // 單筆或兩期皆超出可顯示上限（主數字已顯示破折號）時，比較也必須退回無資料，不能印持平或 −100%
      [1e308, 1e308],
      [100, 1e308],
      [1e308, 100],
      [-10, 100],
    ];
    for (const [cur, prev] of cases) {
      const text = formatChange(cur, prev, "percent", "month");
      expect(text).toBe("上月同期無資料");
      expect(text).not.toMatch(/NaN|Infinity|∞/);
    }
  });
});

// 時間釘在月中：本期 06-01→06-15，上一期 05-01→05-15，fixture 都放在窗口中段
const FIXED_NOW = new Date("2026-06-15T12:00:00Z");

describe("Dashboard KPI comparison and report status", () => {
  let db: Database;
  let app: ReturnType<typeof createApp>;

  const usage = (member: string, date: string, cost: number) =>
    insertUsageRecord(db, member, {
      member_name: member,
      date,
      session_id: "daily",
      input_tokens: 1000,
      output_tokens: 500,
      cache_creation_tokens: 300,
      cache_read_tokens: 200,
      total_cost_usd: cost,
      models: ["claude-opus-5"],
    });

  beforeEach(() => {
    delete process.env.DASHBOARD_PASSWORD;
    setSystemTime(FIXED_NOW);
    db = createDatabase(":memory:");
    app = createApp(db);

    insertMember(db, "m1", "Eric", hashApiKey("key1"));
    insertMember(db, "m2", "Amber", hashApiKey("key2"));

    // 本期：Eric 40＋Amber 20 = $60，4,000 token，2 人，30 回合
    usage("m1", "2026-06-08", 40);
    usage("m2", "2026-06-09", 20);
    insertSessionMetrics(db, "m1", {
      member_name: "Eric",
      session_id: "s-june",
      started_at: "2026-06-08T10:00:00Z",
      ended_at: "2026-06-08T11:00:00Z",
      turns: 30,
    });

    // 上一期：只有 Eric $40，2,000 token，1 人，60 回合
    usage("m1", "2026-05-08", 40);
    insertSessionMetrics(db, "m1", {
      member_name: "Eric",
      session_id: "s-may",
      started_at: "2026-05-08T10:00:00Z",
      ended_at: "2026-05-08T11:00:00Z",
      turns: 60,
    });
    // 上一期窗口外（上月同一天之後）不算：05-20 不該進比較
    usage("m2", "2026-05-20", 999);

    // last_seen_at 由 SQLite 用真實時鐘寫入，不跟 setSystemTime 走，所以明確設定
    db.run("UPDATE members SET last_seen_at = ? WHERE id = ?", ["2026-06-15 08:00:00", "m1"]);
    db.run("UPDATE members SET last_seen_at = ? WHERE id = ?", ["2026-06-12 18:00:00", "m2"]);
  });

  afterEach(() => {
    db.close();
    setSystemTime();
    delete process.env.DASHBOARD_PASSWORD;
  });

  it("shows each KPI change against the same span last month", async () => {
    const html = await (await app.request("/?period=month")).text();
    expect(html).toContain("+50% vs 上月同期");
    expect(html).toContain("+100% vs 上月同期");
    expect(html).toContain("+1 人 vs 上月同期");
    expect(html).toContain("−50% vs 上月同期");
    expect(html).not.toMatch(/NaN|Infinity|∞/);
  });

  it("compares week against last Monday through the same weekday", async () => {
    // 本週 06-15（週一）→ 06-15 沒有用量；上週同期 06-08 → 06-08：Eric $40、30 回合
    const week = await (await app.request("/?period=week")).text();
    expect(week).toContain("\u2212100% vs 上週同期");
    expect(week).toContain("\u22121 人 vs 上週同期");
    expect(week).not.toContain("預算");
  });

  it("shows no-data text when the previous period is empty", async () => {
    // 昨天 06-14 沒有任何用量
    const today = await (await app.request("/?period=today")).text();
    expect(today).toContain("昨天無資料");
    expect(today).not.toMatch(/NaN|Infinity|∞/);
  });

  it("marks a stale member with a hollow dot and text alternative", async () => {
    const html = await (await app.request("/?period=month")).text();
    const staleDot =
      '<span class="status-dot stale" role="img" aria-label="超過 24 小時未回報" title="超過 24 小時未回報"></span>';
    const freshDot =
      '<span class="status-dot fresh" role="img" aria-label="24 小時內有回報" title="24 小時內有回報"></span>';
    // 排行與明細各一個點
    expect(html.split(staleDot)).toHaveLength(3);
    expect(html.split(freshDot)).toHaveLength(3);
    // 過期的點緊鄰過期的成員，不會標到別人身上
    expect(html).toMatch(new RegExp(`${staleDot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<span class="rank-name-text">Amber</span>`));
    expect(html).toMatch(new RegExp(`${freshDot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<span class="rank-name-text">Eric</span>`));
    // 06-12 18:00 → 06-15 12:00 是 2 天 18 小時；過期的相對時間保留文字、改用 muted
    expect(html).toContain(`<td class="stale-warn">2d ago</td>`);
  });

  it("does not mark a fresh member as stale", async () => {
    db.run("UPDATE members SET last_seen_at = ? WHERE id = ?", ["2026-06-15 08:00:00", "m2"]);
    const html = await (await app.request("/?period=month")).text();
    expect(html).not.toContain('aria-label="超過 24 小時未回報"');
    expect(html).toContain('aria-label="24 小時內有回報"');
  });

  it("marks a member with null last_seen_at with a hollow stale dot and eliminates dots on others/total rows", async () => {
    db.run("UPDATE members SET last_seen_at = NULL WHERE id = ?", ["m2"]);
    for (let i = 3; i <= 12; i++) {
      insertMember(db, `m${i}`, `Member${i}`, hashApiKey(`key${i}`));
      usage(`m${i}`, "2026-06-10", i);
      db.run("UPDATE members SET last_seen_at = ? WHERE id = ?", ["2026-06-15 08:00:00", `m${i}`]);
    }

    const html = await (await app.request("/?period=month")).text();
    const staleDot =
      '<span class="status-dot stale" role="img" aria-label="超過 24 小時未回報" title="超過 24 小時未回報"></span>';
    expect(html).toMatch(
      new RegExp(`${staleDot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}<span class="rank-name-text">Amber</span>`)
    );
    expect(html).toContain('<td class="stale-warn">Never</td>');

    const othersRow = html.match(/<div class="rank-row others">[\s\S]*?<\/div>\s*<\/div>/)?.[0] ?? "";
    expect(othersRow).toContain("其他 2 人");
    expect(othersRow).not.toContain("status-dot");

    const totalRow = html.match(/<tr class="total-row">[\s\S]*?<\/tr>/)?.[0] ?? "";
    expect(totalRow).toContain("Total");
    expect(totalRow).not.toContain("status-dot");
  });
});

describe("Dashboard period keycaps", () => {
  it("renders each keycap as a plain link with aria-keyshortcuts so it works without JavaScript", async () => {
    delete process.env.DASHBOARD_PASSWORD;
    const db = createDatabase(":memory:");
    const app = createApp(db);
    const html = await (await app.request("/?period=month")).text();
    db.close();

    const nav = html.match(/<nav class="period-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
    const links = [...nav.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)];
    expect(links).toHaveLength(3);
    for (const [period, key] of [
      ["today", "D"],
      ["week", "W"],
      ["month", "M"],
    ]) {
      const link = links.find(([, attrs]) => attrs.includes(`href="/?period=${period}"`));
      expect(link).toBeDefined();
      expect(link?.[1]).toContain(`aria-keyshortcuts="${key}"`);
      expect(link?.[2]).toContain(`<kbd>${key}</kbd>`);
    }
  });
});
