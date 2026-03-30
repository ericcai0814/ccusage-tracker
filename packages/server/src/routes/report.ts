import { Hono } from "hono";
import { memberAuth, type MemberAuthEnv } from "../middleware/member-auth";
import { queryUsageRecords, aggregateUsage } from "../queries";

const report = new Hono<MemberAuthEnv>();

report.use("*", memberAuth());

function getDateRange(period: string): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split("T")[0];

  switch (period) {
    case "today":
      return { from: to, to };
    case "week": {
      const dayOfWeek = now.getDay();
      const mondayOffset = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      const monday = new Date(now);
      monday.setDate(now.getDate() - mondayOffset);
      return { from: monday.toISOString().split("T")[0], to };
    }
    case "month":
    default: {
      const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: firstOfMonth.toISOString().split("T")[0], to };
    }
  }
}

report.get("/daily", (c) => {
  const db = c.get("db");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const memberName = c.req.query("member");

  let memberId: string | undefined;
  if (memberName) {
    const allMembers = db.query("SELECT id FROM members WHERE name = ?").get(memberName) as { id: string } | null;
    if (!allMembers) {
      return c.json({ error: "member not found" }, 404);
    }
    memberId = allMembers.id;
  }

  const defaultRange = getDateRange("month");
  const records = queryUsageRecords(db, {
    from: from || defaultRange.from,
    to: to || defaultRange.to,
    memberId,
  });

  return c.json({ records });
});

report.get("/summary", (c) => {
  const db = c.get("db");
  const period = c.req.query("period") || "month";
  const { from, to } = getDateRange(period);

  const summary = aggregateUsage(db, { from, to });

  const totalCost = summary.reduce((sum, s) => sum + s.total_cost_usd, 0);
  const totalTokens = summary.reduce(
    (sum, s) => sum + s.input_tokens + s.output_tokens + s.cache_creation_tokens + s.cache_read_tokens,
    0
  );

  return c.json({
    period,
    from,
    to,
    total_cost_usd: totalCost,
    total_tokens: totalTokens,
    active_members: summary.length,
    members: summary,
  });
});

export default report;
