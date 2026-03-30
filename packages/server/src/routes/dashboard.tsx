import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { dashboardAuth } from "../middleware/dashboard-auth";
import { aggregateUsage, type UsageSummary } from "../queries";
import { validatePeriod, getDateRange, VALID_PERIODS } from "../utils/date-range";
import type { AppEnv } from "../app";

const dashboard = new Hono<AppEnv>();

dashboard.use("*", dashboardAuth());

function formatNumber(n: number): string {
  return n.toLocaleString("en-US");
}

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

const Layout: FC<{ title: string; children: any }> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f5f5f5; color: #333; padding: 2rem; }
        .container { max-width: 960px; margin: 0 auto; }
        h1 { margin-bottom: 1.5rem; font-size: 1.5rem; }
        .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 1rem; margin-bottom: 2rem; }
        .card { background: #fff; border-radius: 8px; padding: 1.25rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .card-label { font-size: 0.75rem; text-transform: uppercase; color: #888; letter-spacing: 0.05em; }
        .card-value { font-size: 1.75rem; font-weight: 700; margin-top: 0.25rem; }
        .period-nav { display: flex; gap: 0.5rem; margin-bottom: 1.5rem; }
        .period-nav a { padding: 0.4rem 1rem; border-radius: 6px; text-decoration: none; color: #555; background: #e8e8e8; font-size: 0.85rem; }
        .period-nav a.active { background: #333; color: #fff; }
        table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        th, td { padding: 0.75rem 1rem; text-align: right; }
        th { background: #fafafa; font-size: 0.75rem; text-transform: uppercase; color: #888; border-bottom: 1px solid #eee; }
        th:first-child, td:first-child { text-align: left; }
        td { border-bottom: 1px solid #f0f0f0; font-variant-numeric: tabular-nums; }
        tr:last-child td { border-bottom: none; }
        .total-row { font-weight: 700; background: #fafafa; }
        .empty { text-align: center; padding: 3rem; color: #999; }
      `}</style>
    </head>
    <body>
      <div class="container">{children}</div>
    </body>
  </html>
);

const SummaryCards: FC<{ totalCost: number; totalTokens: number; activeMembers: number }> = ({
  totalCost,
  totalTokens,
  activeMembers,
}) => (
  <div class="cards">
    <div class="card">
      <div class="card-label">Total Cost</div>
      <div class="card-value">{formatCost(totalCost)}</div>
    </div>
    <div class="card">
      <div class="card-label">Total Tokens</div>
      <div class="card-value">{formatNumber(totalTokens)}</div>
    </div>
    <div class="card">
      <div class="card-label">Active Members</div>
      <div class="card-value">{activeMembers}</div>
    </div>
  </div>
);

const MemberTable: FC<{ members: UsageSummary[] }> = ({ members }) => {
  if (members.length === 0) {
    return <div class="empty">No usage data for this period.</div>;
  }

  const totals = members.reduce(
    (acc, m) => ({
      input_tokens: acc.input_tokens + m.input_tokens,
      output_tokens: acc.output_tokens + m.output_tokens,
      cache_creation_tokens: acc.cache_creation_tokens + m.cache_creation_tokens,
      cache_read_tokens: acc.cache_read_tokens + m.cache_read_tokens,
      total_cost_usd: acc.total_cost_usd + m.total_cost_usd,
    }),
    { input_tokens: 0, output_tokens: 0, cache_creation_tokens: 0, cache_read_tokens: 0, total_cost_usd: 0 }
  );

  return (
    <table>
      <thead>
        <tr>
          <th>Member</th>
          <th>Input</th>
          <th>Output</th>
          <th>Cache Create</th>
          <th>Cache Read</th>
          <th>Cost</th>
        </tr>
      </thead>
      <tbody>
        {members.map((m) => (
          <tr>
            <td>{m.member_name}</td>
            <td>{formatNumber(m.input_tokens)}</td>
            <td>{formatNumber(m.output_tokens)}</td>
            <td>{formatNumber(m.cache_creation_tokens)}</td>
            <td>{formatNumber(m.cache_read_tokens)}</td>
            <td>{formatCost(m.total_cost_usd)}</td>
          </tr>
        ))}
        <tr class="total-row">
          <td>Total</td>
          <td>{formatNumber(totals.input_tokens)}</td>
          <td>{formatNumber(totals.output_tokens)}</td>
          <td>{formatNumber(totals.cache_creation_tokens)}</td>
          <td>{formatNumber(totals.cache_read_tokens)}</td>
          <td>{formatCost(totals.total_cost_usd)}</td>
        </tr>
      </tbody>
    </table>
  );
};

dashboard.get("/", (c) => {
  const db = c.get("db");
  const period = validatePeriod(c.req.query("period"));
  const { from, to } = getDateRange(period);

  const members = aggregateUsage(db, { from, to });

  const totalCost = members.reduce((sum, m) => sum + m.total_cost_usd, 0);
  const totalTokens = members.reduce(
    (sum, m) => sum + m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens,
    0
  );

  return c.html(
    <Layout title="ccusage-tracker Dashboard">
      <h1>ccusage-tracker</h1>
      <div class="period-nav">
        {VALID_PERIODS.map((p) => (
          <a href={`/?period=${encodeURIComponent(p)}`} class={p === period ? "active" : ""}>
            {p.charAt(0).toUpperCase() + p.slice(1)}
          </a>
        ))}
      </div>
      <SummaryCards totalCost={totalCost} totalTokens={totalTokens} activeMembers={members.length} />
      <MemberTable members={members} />
    </Layout>
  );
});

export default dashboard;
