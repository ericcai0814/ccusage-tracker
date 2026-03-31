import { Hono } from "hono";
import { teamAuth } from "../middleware/team-auth";
import { queryUsageRecords, aggregateUsage, findMemberByName } from "../queries";
import { validatePeriod, getDateRange } from "../utils/date-range";
import type { AppEnv } from "../app";

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const report = new Hono<AppEnv>();

report.use("*", teamAuth());

report.get("/daily", (c) => {
  const db = c.get("db");
  const from = c.req.query("from");
  const to = c.req.query("to");
  const memberName = c.req.query("member");

  if (from && !DATE_REGEX.test(from)) {
    return c.json({ error: "from must be in YYYY-MM-DD format" }, 400);
  }
  if (to && !DATE_REGEX.test(to)) {
    return c.json({ error: "to must be in YYYY-MM-DD format" }, 400);
  }

  let memberId: string | undefined;
  if (memberName) {
    const member = findMemberByName(db, memberName);
    if (!member) {
      return c.json({ error: "member not found" }, 404);
    }
    memberId = member.id;
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
  const period = validatePeriod(c.req.query("period"));
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
