import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { dashboardAuth } from "../middleware/dashboard-auth";
import {
  aggregateUsage,
  aggregateUsageByDateAndSource,
  aggregateModelPresence,
  sumClaudeTurns,
  type UsageSummary,
  type DailySourceUsage,
  type ModelPresence,
  type UsageSource,
} from "../queries";
import { getMonthlyBudgetUsd } from "../settings";
import { validatePeriod, getDateRange, VALID_PERIODS, type Period } from "../utils/date-range";
import type { AppEnv } from "../app";

const dashboard = new Hono<AppEnv>();

dashboard.use("*", dashboardAuth());

// total_cost_usd 是 SQLite 的 REAL，兩筆極大值相加就會溢位成 Infinity；資料庫也可能被
// 直接改寫繞過 admin API 的範圍檢查。算不出可信的數字時寧可顯示破折號，不要印 NaN。
const NOT_AVAILABLE = "—";

// 「可表示」的夾值，不是「可繪製」的夾值：真實金額不可能超過 Number.MAX_VALUE，
// 壓到它不會扭曲任何一筆真的資料。夾值只用來擋 NaN 與溢位的 Infinity。
function finiteCost(n: number): number {
  // NaN 先擋掉（NaN <= 0 是 false，會漏過去）；+Infinity 交給 Math.min 壓到可表示上限
  if (Number.isNaN(n) || n <= 0) return 0;
  return Math.min(n, Number.MAX_VALUE);
}

// 相對於某個上限的比例。先算比值再夾到 [0,1]，不先截斷金額 ——
// 截斷金額會把比例一起洗掉（3e12 與 1e12 都夾成 1e12 就變成 50%／50%）。
function ratioPct(value: number, max: number): number {
  const limit = finiteCost(max);
  if (!(limit > 0)) return 0;
  const ratio = finiteCost(value) / limit;
  return Math.min(1, Math.max(0, ratio)) * 100;
}

// 一組值各自的佔比。總和可能溢位，所以先全部除以最大值再相加：分子分母同時縮放，
// 比例不變，而正規化後的總和最多等於項目數，不會溢位。
function sharePercents(values: number[]): number[] {
  const clean = values.map(finiteCost);
  const max = Math.max(...clean, 0);
  if (!(max > 0)) return clean.map(() => 0);
  const scaled = clean.map((v) => v / max);
  const total = scaled.reduce((sum, v) => sum + v, 0);
  if (!(total > 0)) return clean.map(() => 0);
  return scaled.map((v) => Math.min(1, Math.max(0, v / total)) * 100);
}

function formatNumber(n: number): string {
  return Number.isFinite(n) ? n.toLocaleString("en-US") : NOT_AVAILABLE;
}

// 有限不等於可讀：1e308 印出來是三百多位數，塞爆版面又講不出任何事情。
// 超過這個量級的金額一律當作壞資料顯示破折號。
const MAX_DISPLAY_USD = 1e15;

function isDisplayableCost(n: number): boolean {
  return Number.isFinite(n) && Math.abs(n) < MAX_DISPLAY_USD;
}

function formatCost(n: number): string {
  if (!isDisplayableCost(n)) return NOT_AVAILABLE;
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// 預算相關的金額都是整數量級，兩位小數只會讓卡片變吵
function formatUsdRounded(n: number): string {
  return isDisplayableCost(n) ? `$${Math.round(n).toLocaleString("en-US")}` : NOT_AVAILABLE;
}

function formatRelativeTime(isoString: string | null): string {
  if (!isoString) return "Never";
  const now = Date.now();
  const then = new Date(isoString + "Z").getTime();
  const diffMs = now - then;
  if (diffMs < 0) return "Just now";
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function isStale(isoString: string | null): boolean {
  if (!isoString) return true;
  const now = Date.now();
  const then = new Date(isoString + "Z").getTime();
  return now - then > 24 * 60 * 60 * 1000;
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

  .report-nav {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1.5rem;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .report-nav a {
    color: var(--text-dim);
    text-decoration: none;
    transition: color 0.2s ease;
  }

  .report-nav a:hover {
    color: var(--brand-primary);
    text-shadow: 0 0 8px var(--brand-glow);
  }

  .report-nav .nav-sep { color: var(--border-glow); }
  .report-nav .nav-current { color: var(--brand-primary); text-shadow: 0 0 8px var(--brand-glow); }

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
    grid-template-columns: repeat(4, 1fr);
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

  td:nth-child(6) {
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

  .total-row td:nth-child(6) {
    color: var(--brand-primary);
    text-shadow: 0 0 10px var(--brand-glow);
    font-size: 0.8rem;
  }

  /* Stale warning */
  .stale-warn {
    color: var(--brand-primary);
    text-shadow: 0 0 8px var(--brand-glow);
  }

  /* Share bar */
  .share-bar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 120px;
  }

  .share-bar-track {
    flex: 1;
    height: 6px;
    background: var(--brand-glow-soft);
    position: relative;
    overflow: hidden;
  }

  .share-bar-fill {
    height: 100%;
    background: var(--brand-primary);
    box-shadow: 0 0 8px var(--brand-glow);
    transition: width 0.3s ease;
  }

  .share-bar-pct {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--text-secondary);
    min-width: 3em;
    text-align: right;
  }

  /* Daily chart */
  .daily-chart {
    border: 1px solid var(--border-glow);
    background: var(--bg-card);
    padding: 1.25rem;
    margin-bottom: 2rem;
    position: relative;
  }

  .daily-chart::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 0;
    width: 80px;
    height: 1px;
    background: var(--brand-primary);
    box-shadow: var(--neon-shadow);
  }

  .daily-chart-title {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text-dim);
    margin-bottom: 1rem;
  }

  .daily-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.3rem 0;
  }

  .daily-row + .daily-row {
    border-top: 1px solid var(--border-dim);
  }

  .daily-date {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-secondary);
    min-width: 3.5em;
    flex-shrink: 0;
  }

  .daily-bar-track {
    flex: 1;
    height: 8px;
    background: var(--brand-glow-faint);
    position: relative;
    overflow: hidden;
  }

  .daily-bar {
    height: 100%;
    background: var(--brand-primary);
    box-shadow: 0 0 10px var(--brand-glow);
    transition: width 0.3s ease;
  }

  .daily-cost {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--text-secondary);
    min-width: 4.5em;
    text-align: right;
    flex-shrink: 0;
  }

  .daily-peak {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    color: var(--brand-primary);
    text-shadow: 0 0 8px var(--brand-glow);
    flex-shrink: 0;
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
    .cards { grid-template-columns: repeat(2, 1fr); }
    .card-value { font-size: 2rem; }
    .period-nav { width: 100%; }
    .period-nav a { flex: 1; justify-content: center; font-size: 0.6rem; padding: 0.6rem 0.5rem; }
    .footer { flex-direction: column; gap: 1rem; }
  }

  /* --- Overview v2 --- */

  .kpi-label {
    font-family: var(--font-body);
    font-size: 0.65rem;
    color: var(--text-primary);
    letter-spacing: 0.06em;
    margin-bottom: 0.6rem;
  }

  .panel {
    border: 1px solid var(--border-glow);
    background: var(--bg-card);
    padding: 1.25rem;
    margin-bottom: 2rem;
    position: relative;
    min-width: 0;
  }

  .panel::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 0;
    width: 80px;
    height: 1px;
    background: var(--brand-primary);
    box-shadow: var(--neon-shadow);
  }

  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.75rem;
    flex-wrap: wrap;
    margin-bottom: 1rem;
  }

  .panel-title {
    font-family: var(--font-body);
    font-size: 0.7rem;
    letter-spacing: 0.1em;
    color: var(--brand-primary);
    text-shadow: 0 0 10px var(--brand-glow);
  }

  .panel-note {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    letter-spacing: 0.1em;
    color: var(--text-dim);
    text-transform: uppercase;
  }

  .panel-row {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: 1.25rem;
    margin-bottom: 2rem;
  }

  .panel-row .panel { margin-bottom: 0; }

  .panel-empty {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-dim);
    letter-spacing: 0.1em;
    text-transform: uppercase;
    padding: 2rem 0;
    text-align: center;
  }

  /* Trend chart */
  .trend-legend {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--text-secondary);
    letter-spacing: 0.08em;
  }

  .trend-legend .key {
    display: inline-block;
    width: 14px;
    height: 2px;
    vertical-align: middle;
    margin-right: 0.4rem;
  }

  .trend-chart svg {
    display: block;
    width: 100%;
    height: auto;
    overflow: visible;
  }

  .trend-chart text {
    fill: var(--text-dim);
    font-family: var(--font-mono);
    font-size: 11px;
    font-variant-numeric: tabular-nums;
  }

  .trend-chart .trend-grid { stroke: #1c1c1c; stroke-width: 1; }
  .trend-chart .trend-axis { stroke: #2e2e2e; stroke-width: 1; }
  .trend-chart .trend-line { fill: none; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
  .trend-chart .trend-dot { stroke: var(--bg-card); stroke-width: 2; }
  .trend-chart .trend-end-label { fill: var(--text-secondary); font-family: var(--font-mono); font-size: 11px; }
  .trend-chart .trend-crosshair { stroke: var(--text-secondary); stroke-width: 1; stroke-dasharray: 3 3; opacity: 0; }

  .trend-readout {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--text-secondary);
    letter-spacing: 0.08em;
    margin-top: 0.75rem;
    font-variant-numeric: tabular-nums;
    min-height: 1.2em;
  }

  .trend-bars { display: grid; gap: 0.75rem; }

  .trend-bar-row {
    display: grid;
    grid-template-columns: 7.5em 1fr 5em;
    gap: 0.75rem;
    align-items: center;
  }

  .trend-bar-name {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--text-secondary);
    letter-spacing: 0.08em;
  }

  .trend-bar-track { height: 12px; background: #1a1a1a; }
  .trend-bar { height: 100%; }

  .trend-bar-val {
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-primary);
    text-align: right;
    font-variant-numeric: tabular-nums;
  }

  /* Member ranking */
  .rank-list { display: grid; gap: 0.6rem; }

  .rank-row {
    display: grid;
    grid-template-columns: 6.5em 1fr 6em;
    gap: 0.75rem;
    align-items: center;
  }

  .rank-name {
    font-family: var(--font-body);
    font-size: 0.6rem;
    color: var(--text-primary);
    letter-spacing: 0.06em;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .rank-track { height: 10px; background: #1a1a1a; }
  .rank-fill { height: 100%; }

  .rank-val {
    text-align: right;
    font-family: var(--font-mono);
    font-size: 0.65rem;
    color: var(--text-primary);
    font-variant-numeric: tabular-nums;
  }

  .rank-sub { display: block; font-size: 0.55rem; color: var(--text-dim); }

  /* Provider split */
  .stack { display: flex; gap: 2px; height: 14px; background: var(--bg-secondary); }
  .stack div { height: 100%; }

  .provider-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem; margin-top: 0.85rem; }
  .provider-grid.has-other { grid-template-columns: repeat(3, 1fr); }

  .provider-box { border: 1px solid var(--border-dim); background: var(--bg-secondary); padding: 0.75rem; }

  .provider-name {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--text-secondary);
    letter-spacing: 0.08em;
  }

  .provider-swatch { width: 10px; height: 10px; flex-shrink: 0; }

  .provider-amt {
    font-family: var(--font-display);
    font-size: 1.6rem;
    font-weight: 600;
    line-height: 1.1;
    margin-top: 0.35rem;
    font-variant-numeric: tabular-nums;
  }

  .provider-pct {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--text-dim);
    font-variant-numeric: tabular-nums;
  }

  /* Budget note */
  .budget { margin-top: 0.85rem; }

  .budget-line {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    color: var(--text-secondary);
    letter-spacing: 0.06em;
    font-variant-numeric: tabular-nums;
  }

  .budget-meter { height: 6px; background: #1b2f4b; margin: 0.5rem 0; overflow: hidden; }
  .budget-meter-fill { height: 100%; background: #6da7ec; }

  .budget-status {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.6rem;
    font-family: var(--font-mono);
    font-size: 0.58rem;
    letter-spacing: 0.06em;
    padding: 0.25rem 0.5rem;
    border: 1px solid var(--border-dim);
  }

  .budget-status .budget-icon { font-weight: 700; }
  .budget-status.ok { color: #6da7ec; }
  .budget-status.warning { color: #fab219; }
  .budget-status.critical { color: #d03b3b; }

  @media (max-width: 768px) {
    .panel-row { grid-template-columns: 1fr; }
    .provider-grid, .provider-grid.has-other { grid-template-columns: 1fr; }
    .rank-row { grid-template-columns: 5em 1fr 5.5em; }
    .trend-bar-row { grid-template-columns: 6em 1fr 4.5em; }
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

// 資料色：已在 #0a0a0a 面上驗過 CVD 區辨與對比。S29 的紅色只做 chrome，不當資料色。
const SOURCE_COLOR: Record<UsageSource, string> = {
  claude: "#3987e5",
  codex: "#d95926",
  other: "#8a8a8a",
};

const SOURCE_LABEL: Record<UsageSource, string> = {
  claude: "Claude Code",
  codex: "Codex",
  other: "其他",
};

const PROVIDER_LABEL: Record<UsageSource, string> = {
  claude: "Anthropic",
  codex: "OpenAI",
  other: "其他",
};

// 成員排行是同一個量的排序，用單色序列而不是分類色
const RANK_COLORS = { first: "#6da7ec", top: "#3987e5", rest: "#256abf" };

const RANK_LIMIT = 10;

function rankColor(index: number): string {
  if (index === 0) return RANK_COLORS.first;
  if (index < 3) return RANK_COLORS.top;
  return RANK_COLORS.rest;
}

// 峰值乘 1.15 會得到 $87 這種刻度；改成往上取到 1／2／2.5／5 的整齊級距。
// 級距乘回去可能溢位（峰值 1e308 時 step * ticks 就是 Infinity，刻度連帶算出 NaN），
// 這種時候退成剛好等於峰值：頂部沒有留白，但每個點的相對高度仍然正確。
function niceAxisMax(peak: number, ticks: number): number {
  const top = finiteCost(peak);
  if (top <= 0) return ticks;
  const rough = (top * 1.05) / ticks;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
  const normalized = rough / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10) * magnitude;
  const max = step * ticks;
  return Number.isFinite(max) && max > 0 ? max : top;
}

// 小數位是級距自己需要的位數，不是跟著最大值猜：級距 20 印 $20、級距 0.25 印 $0.25，
// 兩邊都不會出現 $0.3 這種讓刻度看起來不等距的四捨五入。
function axisDecimals(step: number): number {
  for (let digits = 0; digits <= 4; digits++) {
    const scaled = step * Math.pow(10, digits);
    if (Math.abs(scaled - Math.round(scaled)) < 1e-9) return digits;
  }
  return 4;
}

function formatAxisTick(value: number, step: number): string {
  if (!isDisplayableCost(value)) return NOT_AVAILABLE;
  const digits = axisDecimals(step);
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

function formatDateShort(dateStr: string): string {
  const [, month, day] = dateStr.split("-");
  return `${month}/${day}`;
}

interface BudgetStatus {
  budget: number;
  spent: number;
  usedPct: number | null;
  meterPct: number;
  perDay: number;
  projected: number;
  // 推估算不出有限值時為 null，此時不印任何狀態標籤 —— 沒有結論比錯的結論好
  level: "ok" | "warning" | "critical" | null;
  icon: string;
  text: string;
}

// 只有 period=month 且預算 > 0 才算數；其餘一律不顯示任何預算字樣。
function buildBudgetStatus(period: Period, budget: number | null, spent: number, to: string): BudgetStatus | null {
  if (period !== "month" || budget === null || budget <= 0) return null;

  const [year, month, day] = to.split("-").map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const dayOfMonth = Math.max(1, day);
  const perDay = spent / dayOfMonth;
  const projected = perDay * daysInMonth;

  // 比值有限不代表百分比有限：花費 1e308 對預算 1，比值 1e308 是有限的，乘 100 才溢位
  const usedPct = (spent / budget) * 100;
  const level = !Number.isFinite(projected)
    ? null
    : projected > budget * 1.1
      ? "critical"
      : projected > budget
        ? "warning"
        : "ok";
  const over = projected - budget;
  const icon = level === "critical" ? "!" : level === "warning" ? "△" : "✓";
  const text =
    level === "critical"
      ? `照目前速度月底會超出預算 ${formatUsdRounded(over)}`
      : level === "warning"
        ? `照目前速度月底會略超預算 ${formatUsdRounded(over)}`
        : "照目前速度月底會在預算內";

  return {
    budget,
    spent,
    usedPct: Number.isFinite(usedPct) ? Math.round(usedPct) : null,
    meterPct: ratioPct(spent, budget),
    perDay,
    projected,
    level,
    icon,
    text,
  };
}

const BudgetNote: FC<{ status: BudgetStatus }> = ({ status }) => (
  <div class="budget">
    <div class="budget-line">
      已用 {status.usedPct === null ? NOT_AVAILABLE : `${status.usedPct}%`} ／ 預算{" "}
      {formatUsdRounded(status.budget)}
    </div>
    <div
      class="budget-meter"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={status.budget}
      aria-valuenow={Number.isFinite(status.spent) ? Math.round(status.spent) : 0}
      aria-label="本月預算消耗"
    >
      <div class="budget-meter-fill" style={`width: ${status.meterPct.toFixed(1)}%`} />
    </div>
    <div class="budget-line">
      日均 {formatCost(status.perDay)}，月底推估 {formatUsdRounded(status.projected)}
    </div>
    {status.level === null ? null : (
      <div class={`budget-status ${status.level}`}>
        <span class="budget-icon" aria-hidden="true">
          {status.icon}
        </span>
        {status.text}
      </div>
    )}
  </div>
);

const KpiRow: FC<{
  totalCost: number;
  totalTokens: number;
  activeMembers: number;
  claudeTurns: number;
  budget: BudgetStatus | null;
}> = ({ totalCost, totalTokens, activeMembers, claudeTurns, budget }) => (
  <div class="cards">
    <div class="card">
      <div class="card-label">Total Cost</div>
      <div class="kpi-label">總花費（估算）</div>
      <div class="card-value">{formatCost(totalCost)}</div>
      <div class="card-unit">USD Estimated</div>
      {budget ? <BudgetNote status={budget} /> : null}
    </div>
    <div class="card">
      <div class="card-label">Total Tokens</div>
      <div class="kpi-label">總 token</div>
      <div class="card-value">{formatNumber(totalTokens)}</div>
      <div class="card-unit">All Types Combined</div>
    </div>
    <div class="card">
      <div class="card-label">Active Members</div>
      <div class="kpi-label">活躍成員</div>
      <div class="card-value">{activeMembers}</div>
      <div class="card-unit">This Period</div>
    </div>
    <div class="card">
      <div class="card-label">Claude Turns</div>
      <div class="kpi-label">Claude 對話回合</div>
      <div class="card-value">{formatNumber(claudeTurns)}</div>
      <div class="card-unit">只含 Claude Code，Codex 收集器不提供</div>
    </div>
  </div>
);

interface TrendSeries {
  source: UsageSource;
  name: string;
  color: string;
  values: number[];
}

function buildTrendSeries(rows: DailySourceUsage[]): { dates: string[]; series: TrendSeries[] } {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const sources: UsageSource[] = (["claude", "codex", "other"] as const).filter((s) =>
    rows.some((r) => r.source === s)
  );

  const series = sources.map((source) => ({
    source,
    name: SOURCE_LABEL[source],
    color: SOURCE_COLOR[source],
    values: dates.map((date) => rows.find((r) => r.date === date && r.source === source)?.total_cost_usd ?? 0),
  }));

  return { dates, series };
}

const TrendLegend: FC<{ series: TrendSeries[] }> = ({ series }) => (
  <div class="trend-legend">
    {series.map((s) => (
      <span>
        <span class="key" style={`background: ${s.color}`} aria-hidden="true" />
        {s.name}
      </span>
    ))}
  </div>
);

// 十字線只是加分項：script 不執行時，每個點的 <title> 仍然讀得到數字。
const TREND_SCRIPT = `(function(){
  var root=document.querySelector('[data-trend]');
  if(!root)return;
  var svg=root.querySelector('svg'),hit=root.querySelector('.trend-hit');
  var xh=root.querySelector('.trend-crosshair'),out=root.querySelector('.trend-readout');
  if(!svg||!hit||!xh||!out)return;
  var vw=Number(root.getAttribute('data-vw'))||0;
  var dots=[].slice.call(root.querySelectorAll('.trend-dot'));
  if(!vw||!dots.length)return;
  var byDate={},order=[];
  dots.forEach(function(p){
    var d=p.getAttribute('data-date');
    if(!byDate[d]){byDate[d]={x:Number(p.getAttribute('cx')),rows:[]};order.push(d);}
    byDate[d].rows.push(p.getAttribute('data-source')+' '+p.getAttribute('data-cost'));
  });
  var base=out.textContent;
  hit.addEventListener('mousemove',function(ev){
    var r=svg.getBoundingClientRect();
    if(!r.width)return;
    var px=((ev.clientX-r.left)/r.width)*vw,best=order[0],bd=-1;
    order.forEach(function(d){var dist=Math.abs(byDate[d].x-px);if(bd<0||dist<bd){bd=dist;best=d;}});
    xh.setAttribute('x1',byDate[best].x);xh.setAttribute('x2',byDate[best].x);
    xh.style.opacity='1';
    out.textContent=best+' · '+byDate[best].rows.join('  ');
  });
  hit.addEventListener('mouseleave',function(){xh.style.opacity='0';out.textContent=base;});
})();`;

const TrendChart: FC<{ rows: DailySourceUsage[] }> = ({ rows }) => {
  const { dates, series } = buildTrendSeries(rows);

  if (dates.length === 0) {
    return (
      <section class="panel trend">
        <div class="panel-head">
          <h2 class="panel-title">每日成本趨勢</h2>
        </div>
        <div class="panel-empty">[ No trend data for this period ]</div>
      </section>
    );
  }

  // 單日期間畫兩條橫條 —— 一個點的折線沒有趨勢可言
  if (dates.length === 1) {
    const maxCost = Math.max(...series.map((s) => finiteCost(s.values[0])), 0);
    return (
      <section class="panel trend">
        <div class="panel-head">
          <h2 class="panel-title">每日成本趨勢</h2>
          <span class="panel-note">{dates[0]}</span>
        </div>
        <TrendLegend series={series} />
        <div class="trend-bars">
          {series.map((s) => (
            <div class="trend-bar-row">
              <span class="trend-bar-name">{s.name}</span>
              <div class="trend-bar-track">
                <div
                  class="trend-bar"
                  style={`width: ${ratioPct(s.values[0], maxCost).toFixed(1)}%; background: ${s.color}`}
                  title={`${dates[0]} · ${s.name} ${formatCost(s.values[0])}`}
                />
              </div>
              <span class="trend-bar-val">{formatCost(s.values[0])}</span>
            </div>
          ))}
        </div>
      </section>
    );
  }

  const W = 720;
  const H = 260;
  const L = 48;
  const R = 96;
  const T = 14;
  const B = 32;
  const TICKS = 4;

  const peak = Math.max(...series.flatMap((s) => s.values.map(finiteCost)));
  const max = niceAxisMax(peak, TICKS);
  const n = dates.length;
  const x = (i: number) => L + (i / (n - 1)) * (W - L - R);
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  // SVG 屬性只接受有限數字，畫不出來的點一律落在 0 軸上
  const finiteY = (raw: number) => (Number.isFinite(raw) ? raw : y(0));
  // max 一定 >= 每個資料點，所以兩者都落在 [T, H-B] 內，不需要再截斷數值
  const yTick = (v: number) => finiteY(y(v)).toFixed(1);
  const yData = (v: number) => finiteY(y(Math.min(finiteCost(v), max))).toFixed(1);
  const labelStep = Math.max(1, Math.ceil(n / 8));

  return (
    <section class="panel trend trend-chart" data-trend="1" data-vw={W}>
      <div class="panel-head">
        <h2 class="panel-title">每日成本趨勢</h2>
        <TrendLegend series={series} />
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="每日成本折線圖，每個來源一條線">
        {Array.from({ length: TICKS + 1 }, (_, i) => (max / TICKS) * i).map((v) => (
          <g>
            <line class="trend-grid" x1={L} x2={W - R} y1={yTick(v)} y2={yTick(v)} />
            <text x={L - 6} y={(Number(yTick(v)) + 4).toFixed(1)} text-anchor="end">
              {formatAxisTick(v, max / TICKS)}
            </text>
          </g>
        ))}
        <line class="trend-axis" x1={L} x2={W - R} y1={yTick(0)} y2={yTick(0)} />
        {dates.map((date, i) =>
          i % labelStep === 0 || i === n - 1 ? (
            <text x={x(i).toFixed(1)} y={H - 8} text-anchor="middle">
              {formatDateShort(date)}
            </text>
          ) : null
        )}
        {series.map((s) => (
          <g>
            <path
              class="trend-line"
              stroke={s.color}
              d={s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${yData(v)}`).join(" ")}
            />
            {s.values.map((v, i) => (
              <circle
                class="trend-dot"
                cx={x(i).toFixed(1)}
                cy={yData(v)}
                r={i === n - 1 ? 4 : 2.5}
                fill={s.color}
                data-date={dates[i]}
                data-source={s.name}
                data-cost={formatCost(v)}
              >
                <title>{`${dates[i]} · ${s.name} ${formatCost(v)}`}</title>
              </circle>
            ))}
            <text class="trend-end-label" x={(x(n - 1) + 10).toFixed(1)} y={(Number(yData(s.values[n - 1])) + 4).toFixed(1)}>
              {s.name}
            </text>
          </g>
        ))}
        <line class="trend-crosshair" x1="0" x2="0" y1={T} y2={yTick(0)} />
        <rect class="trend-hit" x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" />
      </svg>
      <div class="trend-readout">
        {dates[0]} → {dates[n - 1]}
      </div>
      <script dangerouslySetInnerHTML={{ __html: TREND_SCRIPT }} />
    </section>
  );
};

const MemberRanking: FC<{ members: UsageSummary[] }> = ({ members }) => {
  if (members.length === 0) {
    return (
      <section class="panel ranking">
        <div class="panel-head">
          <h2 class="panel-title">成員排行</h2>
        </div>
        <div class="panel-empty">[ No member activity for this period ]</div>
      </section>
    );
  }

  const ranked = [...members].sort((a, b) => b.total_cost_usd - a.total_cost_usd);
  const shown = ranked.slice(0, RANK_LIMIT);
  const folded = ranked.slice(RANK_LIMIT);
  const maxCost = Math.max(...ranked.map((m) => finiteCost(m.total_cost_usd)), 0);
  const foldedCost = folded.reduce((sum, m) => sum + m.total_cost_usd, 0);

  const tokensOf = (m: UsageSummary) =>
    m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens;

  return (
    <section class="panel ranking">
      <div class="panel-head">
        <h2 class="panel-title">成員排行</h2>
        <span class="panel-note">依花費 · {ranked.length} 人</span>
      </div>
      <div class="rank-list">
        {shown.map((m, i) => (
          <div class="rank-row">
            <span class="rank-name">{m.member_name}</span>
            <div class="rank-track">
              <div
                class="rank-fill"
                style={`width: ${ratioPct(m.total_cost_usd, maxCost).toFixed(1)}%; background: ${rankColor(i)}`}
              />
            </div>
            <span class="rank-val">
              {formatCost(m.total_cost_usd)}
              <span class="rank-sub">{formatNumber(tokensOf(m))}</span>
            </span>
          </div>
        ))}
        {folded.length > 0 ? (
          <div class="rank-row others">
            <span class="rank-name">其他 {folded.length} 人</span>
            <div class="rank-track">
              <div
                class="rank-fill"
                style={`width: ${ratioPct(foldedCost, maxCost).toFixed(1)}%; background: ${RANK_COLORS.rest}`}
              />
            </div>
            <span class="rank-val">
              {formatCost(foldedCost)}
              <span class="rank-sub">{formatNumber(folded.reduce((sum, m) => sum + tokensOf(m), 0))}</span>
            </span>
          </div>
        ) : null}
      </div>
    </section>
  );
};

const ProviderSplit: FC<{ rows: DailySourceUsage[] }> = ({ rows }) => {
  const bySource = (["claude", "codex", "other"] as const).map((source) => ({
    source,
    cost: rows.filter((r) => r.source === source).reduce((sum, r) => sum + r.total_cost_usd, 0),
  }));
  const present = bySource.filter((p) => p.cost > 0);
  const shares = sharePercents(present.map((p) => p.cost));

  if (present.length === 0) {
    return (
      <section class="panel provider">
        <div class="panel-head">
          <h2 class="panel-title">供應商切分</h2>
        </div>
        <div class="panel-empty">[ No provider data for this period ]</div>
      </section>
    );
  }

  const hasOther = present.some((p) => p.source === "other");

  return (
    <section class="panel provider">
      <div class="panel-head">
        <h2 class="panel-title">供應商切分</h2>
        <span class="panel-note">來源即供應商</span>
      </div>
      <div class="stack" role="img" aria-label="各供應商的成本占比">
        {present.map((p, i) => (
          <div style={`width: ${shares[i].toFixed(1)}%; background: ${SOURCE_COLOR[p.source]}`} />
        ))}
      </div>
      <div class={hasOther ? "provider-grid has-other" : "provider-grid"}>
        {present.map((p, i) => (
          <div class="provider-box">
            <div class="provider-name">
              <span class="provider-swatch" style={`background: ${SOURCE_COLOR[p.source]}`} aria-hidden="true" />
              {PROVIDER_LABEL[p.source]}
            </div>
            <div class="provider-amt">{formatCost(p.cost)}</div>
            <div class="provider-pct">
              {Math.round(shares[i])}% · {SOURCE_LABEL[p.source]}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
};

const ModelTable: FC<{ models: ModelPresence[] }> = ({ models }) => (
  <section class="panel models">
    <div class="panel-head">
      <h2 class="panel-title">模型</h2>
      <span class="panel-note">每模型成本留待下一期</span>
    </div>
    {models.length === 0 ? (
      <div class="panel-empty">[ No model data for this period ]</div>
    ) : (
      <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>模型</th>
              <th>來源</th>
              <th>出現天數</th>
              <th>使用人數</th>
            </tr>
          </thead>
          <tbody>
            {models.map((m) => (
              <tr>
                <td>{m.model}</td>
                <td>{SOURCE_LABEL[m.source]}</td>
                <td>{m.days}</td>
                <td>{m.members}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </section>
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

  // 總花費可能溢位成 Infinity，直接相除會得到 NaN；正規化佔比可以保住比例
  const memberShares = sharePercents(members.map((m) => m.total_cost_usd));

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
            <th>Last Report</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m, i) => {
            const sharePct = memberShares[i];
            return (
              <tr>
                <td>{m.member_name}</td>
                <td>{formatNumber(m.input_tokens)}</td>
                <td>{formatNumber(m.output_tokens)}</td>
                <td>{formatNumber(m.cache_creation_tokens)}</td>
                <td>{formatNumber(m.cache_read_tokens)}</td>
                <td>{formatCost(m.total_cost_usd)}</td>
                <td class={isStale(m.last_seen_at) ? "stale-warn" : ""}>
                  {formatRelativeTime(m.last_seen_at)}
                </td>
                <td>
                  <div class="share-bar">
                    <div class="share-bar-track">
                      <div class="share-bar-fill" style={`width: ${sharePct}%`} />
                    </div>
                    <span class="share-bar-pct">{sharePct.toFixed(0)}%</span>
                  </div>
                </td>
              </tr>
            );
          })}
          <tr class="total-row">
            <td>Total</td>
            <td>{formatNumber(totals.input_tokens)}</td>
            <td>{formatNumber(totals.output_tokens)}</td>
            <td>{formatNumber(totals.cache_creation_tokens)}</td>
            <td>{formatNumber(totals.cache_read_tokens)}</td>
            <td>{formatCost(totals.total_cost_usd)}</td>
            <td />
            <td />
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
  const dailyBySource = aggregateUsageByDateAndSource(db, { from, to });
  const models = aggregateModelPresence(db, { from, to });
  const claudeTurns = sumClaudeTurns(db, { from, to });

  const totalCost = members.reduce((sum, m) => sum + m.total_cost_usd, 0);
  const totalTokens = members.reduce(
    (sum, m) => sum + m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens,
    0
  );

  const budget = buildBudgetStatus(period, getMonthlyBudgetUsd(db), totalCost, to);

  return c.html(
    <Layout title="CCUSAGE // TRACKER">
      <nav class="report-nav">
        <span class="nav-current">Dashboard</span>
        <span class="nav-sep">/</span>
        <a href="/api/report/weekly">Weekly Report {"\u2192"}</a>
      </nav>
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
      <main>
        <KpiRow
          totalCost={totalCost}
          totalTokens={totalTokens}
          activeMembers={members.length}
          claudeTurns={claudeTurns}
          budget={budget}
        />
        <TrendChart rows={dailyBySource} />
        <div class="panel-row">
          <MemberRanking members={members} />
          <ProviderSplit rows={dailyBySource} />
        </div>
        <ModelTable models={models} />
      </main>
      <MemberTable members={members} />
    </Layout>
  );
});

export default dashboard;
