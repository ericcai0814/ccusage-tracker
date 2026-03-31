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

const STYLES = `
  @import url('https://fonts.googleapis.com/css2?family=Teko:wght@400;500;600;700&family=Michroma&family=Share+Tech+Mono&display=swap');

  :root {
    --bg-primary: #050505;
    --bg-secondary: #020202;
    --bg-card: #0a0a0a;
    --brand-primary: #dc2626;
    --brand-glow: rgba(220, 38, 38, 0.7);
    --brand-glow-soft: rgba(220, 38, 38, 0.15);
    --brand-glow-faint: rgba(220, 38, 38, 0.05);
    --text-primary: #ffffff;
    --text-secondary: #888888;
    --text-dim: #555555;
    --border-glow: rgba(220, 38, 38, 0.3);
    --border-dim: rgba(255, 255, 255, 0.06);
    --neon-shadow: 0 0 15px var(--brand-glow);
    --neon-shadow-lg: 0 0 30px var(--brand-glow), 0 0 60px rgba(220, 38, 38, 0.3);
    --font-display: 'Teko', sans-serif;
    --font-body: 'Michroma', sans-serif;
    --font-mono: 'Share Tech Mono', monospace;
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font-body);
    background: var(--bg-primary);
    color: var(--text-primary);
    min-height: 100vh;
    position: relative;
    overflow-x: hidden;
  }

  /* CRT scanline overlay */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0, 0, 0, 0.15) 2px,
      rgba(0, 0, 0, 0.15) 4px
    );
    pointer-events: none;
    z-index: 9999;
  }

  /* Carbon fiber texture */
  body::after {
    content: '';
    position: fixed;
    inset: 0;
    background-image:
      radial-gradient(circle at 1px 1px, rgba(255,255,255,0.015) 1px, transparent 0);
    background-size: 4px 4px;
    pointer-events: none;
    z-index: 1;
  }

  .container {
    max-width: 1080px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    position: relative;
    z-index: 2;
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 2.5rem;
    padding-bottom: 1.5rem;
    border-bottom: 1px solid var(--border-glow);
    position: relative;
  }

  .header::after {
    content: '';
    position: absolute;
    bottom: -1px;
    left: 0;
    width: 120px;
    height: 1px;
    background: var(--brand-primary);
    box-shadow: var(--neon-shadow);
  }

  .logo {
    font-family: var(--font-display);
    font-size: 2.25rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--text-primary);
    line-height: 1;
  }

  .logo span {
    color: var(--brand-primary);
    text-shadow: var(--neon-shadow);
  }

  .sys-tag {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--text-dim);
    letter-spacing: 0.15em;
    text-transform: uppercase;
    border: 1px solid var(--border-dim);
    padding: 0.25rem 0.6rem;
  }

  /* Period nav */
  .period-nav {
    display: flex;
    gap: 0;
    margin-bottom: 2rem;
    border: 1px solid var(--border-dim);
    width: fit-content;
  }

  .period-nav a {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    padding: 0.6rem 1.25rem;
    text-decoration: none;
    color: var(--text-dim);
    border-right: 1px solid var(--border-dim);
    transition: all 0.2s ease;
    position: relative;
    min-height: 44px;
    display: flex;
    align-items: center;
  }

  .period-nav a:last-child { border-right: none; }

  .period-nav a:hover {
    color: var(--text-primary);
    background: var(--brand-glow-faint);
  }

  .period-nav a:focus-visible {
    outline: 2px solid var(--brand-primary);
    outline-offset: -2px;
    z-index: 1;
  }

  .period-nav a.active {
    color: var(--brand-primary);
    background: var(--brand-glow-soft);
    text-shadow: 0 0 8px var(--brand-glow);
  }

  .period-nav a.active::after {
    content: '';
    position: absolute;
    bottom: 0;
    left: 0;
    right: 0;
    height: 2px;
    background: var(--brand-primary);
    box-shadow: var(--neon-shadow);
  }

  /* Summary cards */
  .cards {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    margin-bottom: 2.5rem;
    background: var(--border-dim);
    border: 1px solid var(--border-glow);
    position: relative;
  }

  .cards::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, var(--brand-primary), transparent 60%);
    box-shadow: var(--neon-shadow);
  }

  .card {
    background: var(--bg-card);
    padding: 1.5rem;
    position: relative;
    overflow: hidden;
  }

  .card::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: linear-gradient(135deg, var(--brand-glow-faint), transparent 40%);
    pointer-events: none;
  }

  .card-label {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    text-transform: uppercase;
    color: var(--text-dim);
    letter-spacing: 0.2em;
    margin-bottom: 0.75rem;
  }

  .card-value {
    font-family: var(--font-display);
    font-size: 2.5rem;
    font-weight: 600;
    line-height: 1;
    color: var(--text-primary);
    position: relative;
  }

  .card:first-child .card-value {
    color: var(--brand-primary);
    text-shadow: 0 0 20px var(--brand-glow);
  }

  .card-unit {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    margin-top: 0.35rem;
  }

  /* Table */
  .table-wrapper {
    border: 1px solid var(--border-glow);
    position: relative;
    overflow-x: auto;
    -webkit-overflow-scrolling: touch;
  }

  .table-wrapper::before {
    content: '';
    position: absolute;
    top: -1px;
    right: 0;
    left: 50%;
    height: 1px;
    background: linear-gradient(90deg, transparent, var(--brand-primary));
    box-shadow: var(--neon-shadow);
  }

  table {
    width: 100%;
    border-collapse: collapse;
    background: var(--bg-card);
    min-width: 640px;
  }

  th {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-dim);
    padding: 1rem 1.25rem;
    text-align: right;
    border-bottom: 1px solid var(--border-glow);
    background: var(--bg-secondary);
    white-space: nowrap;
  }

  th:first-child { text-align: left; }

  td {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    padding: 0.85rem 1.25rem;
    text-align: right;
    border-bottom: 1px solid var(--border-dim);
    color: var(--text-secondary);
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.03em;
    white-space: nowrap;
  }

  td:first-child {
    text-align: left;
    font-family: var(--font-body);
    font-size: 0.65rem;
    color: var(--text-primary);
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  td:last-child {
    color: var(--brand-primary);
  }

  tr:hover td {
    background: var(--brand-glow-faint);
  }

  tr:last-child td { border-bottom: none; }

  .total-row td {
    font-weight: 700;
    border-top: 1px solid var(--border-glow);
    border-bottom: none;
    background: var(--bg-secondary);
    color: var(--text-primary);
    padding-top: 1rem;
    padding-bottom: 1rem;
  }

  .total-row td:first-child {
    color: var(--brand-primary);
    text-shadow: 0 0 10px var(--brand-glow);
  }

  .total-row td:last-child {
    color: var(--brand-primary);
    text-shadow: 0 0 10px var(--brand-glow);
    font-size: 0.8rem;
  }

  /* Empty state */
  .empty {
    text-align: center;
    padding: 4rem 2rem;
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    border: 1px solid var(--border-dim);
    background: var(--bg-card);
  }

  /* Footer */
  .footer {
    margin-top: 3rem;
    padding-top: 1.5rem;
    border-top: 1px solid var(--border-dim);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .footer-text {
    font-family: var(--font-mono);
    font-size: 0.5rem;
    color: var(--text-dim);
    letter-spacing: 0.15em;
    text-transform: uppercase;
  }

  .footer-pulse {
    width: 6px;
    height: 6px;
    background: var(--brand-primary);
    box-shadow: var(--neon-shadow);
    animation: pulse 2s ease-in-out infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; box-shadow: var(--neon-shadow); }
    50% { opacity: 0.4; box-shadow: 0 0 5px var(--brand-glow); }
  }

  /* Responsive */
  @media (max-width: 768px) {
    .container { padding: 1.25rem 1rem; }
    .header { flex-direction: column; align-items: flex-start; gap: 0.75rem; }
    .logo { font-size: 1.75rem; }
    .cards { grid-template-columns: 1fr; }
    .card-value { font-size: 2rem; }
    .period-nav { width: 100%; }
    .period-nav a { flex: 1; justify-content: center; font-size: 0.6rem; padding: 0.6rem 0.5rem; }
    .footer { flex-direction: column; gap: 1rem; }
  }
`;

const Layout: FC<{ title: string; children: any }> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <style>{STYLES}</style>
    </head>
    <body>
      <div class="container">
        {children}
        <footer class="footer">
          <div class="footer-text">ccusage-tracker // powered by ccusage</div>
          <div class="footer-pulse" aria-hidden="true" />
        </footer>
      </div>
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
      <div class="card-unit">USD Estimated</div>
    </div>
    <div class="card">
      <div class="card-label">Total Tokens</div>
      <div class="card-value">{formatNumber(totalTokens)}</div>
      <div class="card-unit">All Types Combined</div>
    </div>
    <div class="card">
      <div class="card-label">Active Members</div>
      <div class="card-value">{activeMembers}</div>
      <div class="card-unit">This Period</div>
    </div>
  </div>
);

const MemberTable: FC<{ members: UsageSummary[] }> = ({ members }) => {
  if (members.length === 0) {
    return <div class="empty">[ No usage data for this period ]</div>;
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
    <div class="table-wrapper">
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
    </div>
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
    <Layout title="CCUSAGE // TRACKER">
      <header class="header">
        <h1 class="logo">CC<span>USAGE</span></h1>
        <div class="sys-tag">sys.monitor // v0.1.0</div>
      </header>
      <nav class="period-nav" aria-label="Period selection">
        {VALID_PERIODS.map((p) => (
          <a href={`/?period=${encodeURIComponent(p)}`} class={p === period ? "active" : ""}>
            {p.toUpperCase()}
          </a>
        ))}
      </nav>
      <SummaryCards totalCost={totalCost} totalTokens={totalTokens} activeMembers={members.length} />
      <MemberTable members={members} />
    </Layout>
  );
});

export default dashboard;
