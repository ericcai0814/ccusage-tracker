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
import { SOURCE_ORDER, sourceInfo } from "../sources";
import { getMonthlyBudgetUsd } from "../settings";
import { validatePeriod, getDateRange, getPreviousDateRange, VALID_PERIODS, type Period } from "../utils/date-range";
import type { AppEnv } from "../app";
import { THEME_CSS, DASHBOARD_CSS, FONT_LINKS } from "./ui-theme";
import {
  NOT_AVAILABLE,
  finiteCost,
  ratioPct,
  sharePercents,
  roundSharesTo100,
  formatNumber,
  MAX_DISPLAY_USD,
  isDisplayableCost,
  formatCost,
  formatUsdRounded,
  SOURCE_COLOR,
  SOURCE_LABEL,
} from "./dashboard-format";
import { TrendChart } from "./dashboard-charts";

const dashboard = new Hono<AppEnv>();

dashboard.use("*", dashboardAuth());

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

// 回報狀態的過期門檻：判斷與狀態文字都從這裡推，改門檻時兩邊不會對不上
const STALE_AFTER_HOURS = 24;
const STALE_AFTER_MS = STALE_AFTER_HOURS * 60 * 60 * 1000;

function isStale(isoString: string | null): boolean {
  if (!isoString) return true;
  const now = Date.now();
  const then = new Date(isoString + "Z").getTime();
  return now - then > STALE_AFTER_MS;
}

// 回報狀態點：顏色之外還有形狀（實心／空心）與文字替代，不靠顏色單獨傳達
const STATUS_LABEL = {
  fresh: `${STALE_AFTER_HOURS} 小時內有回報`,
  stale: `超過 ${STALE_AFTER_HOURS} 小時未回報`,
} as const;

const ReportDot: FC<{ lastSeenAt: string | null }> = ({ lastSeenAt }) => {
  const state = isStale(lastSeenAt) ? "stale" : "fresh";
  return <span class={`status-dot ${state}`} role="img" aria-label={STATUS_LABEL[state]} title={STATUS_LABEL[state]} />;
};

// KPI「比上一期」。花費變多不一定是壞事，所以只給方向符號、不給紅綠。
const PREVIOUS_LABEL: Record<Period, string> = { today: "昨天", week: "上週同期", month: "上月同期" };

// 用真的減號（U+2212），toLocaleString 對負數只會吐 ASCII 連字號
const MINUS = "\u2212";

// 上一期為 0、任一邊超出可顯示範圍或不是有限值、或算出來的變化量不是有限值 → 一律「無資料」，不印 NaN／Infinity。
// 方向以四捨五入後的值判斷：-0.4% 捨入成 0 要顯示持平，不能印成「−0%」。
export function formatChange(current: number, previous: number, kind: "percent" | "count", period: Period): string {
  const label = PREVIOUS_LABEL[period];
  const noData = `${label}無資料`;
  if (!isDisplayableCost(current) || !isDisplayableCost(previous) || current < 0 || !(previous > 0)) return noData;

  const raw = kind === "percent" ? ((current - previous) / previous) * 100 : current - previous;
  if (!Number.isFinite(raw) || Math.abs(raw) >= MAX_DISPLAY_USD) return noData;

  const rounded = Math.round(raw);
  if (rounded === 0) return `持平 vs ${label}`;
  const sign = rounded > 0 ? "+" : MINUS;
  const magnitude = Math.abs(rounded).toLocaleString("en-US");
  return kind === "percent" ? `${sign}${magnitude}% vs ${label}` : `${sign}${magnitude} 人 vs ${label}`;
}


const Layout: FC<{ title: string; children: any }> = ({ title, children }) => (
  <html lang="zh-Hant">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>{title}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      {FONT_LINKS.map((href) => (
        <link rel="stylesheet" href={href} />
      ))}
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS + DASHBOARD_CSS }} />
    </head>
    <body>
      <div class="container">
        {children}
        <footer class="footer">
          <span>ccusage-tracker · powered by ccusage</span>
          <span>Claude Code · Codex</span>
        </footer>
      </div>
    </body>
  </html>
);

// 名稱、資料色、供應商與順序都來自 sources.ts 的來源表。S29 的紅色只做 chrome，不當資料色。
const PROVIDER_LABEL = (source: UsageSource): string => sourceInfo(source).provider;

// 成員排行是同一個量的排序，用單色序列而不是分類色
// 第一名用 ramp 最亮的一階，其餘退成同一階中性灰：顏色留給來源，不給排名
const RANK_COLORS = { first: "var(--bar-lead)", rest: "var(--bar-rest)" };

const RANK_LIMIT = 10;

function rankColor(index: number): string {
  return index === 0 ? RANK_COLORS.first : RANK_COLORS.rest;
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
          <span>{status.icon}</span>
        </span>
        <span class="budget-text">{status.text}</span>
      </div>
    )}
  </div>
);

const KpiCard: FC<{ zh: string; en: string; value: string; unit: string; delta: string; children?: any }> = ({
  zh,
  en,
  value,
  unit,
  delta,
  children,
}) => (
  <div class={children ? "card has-budget" : "card"}>
    <div class="card-main">
      <div class="card-top">
        <div class="kpi-label">{zh}</div>
        <div class="card-label">{en}</div>
      </div>
      <div class="card-value">{value}</div>
      <div class="card-unit">{unit}</div>
      <div class="card-delta">{delta}</div>
    </div>
    {children}
  </div>
);

interface KpiFigures {
  totalCost: number;
  totalTokens: number;
  activeMembers: number;
  claudeTurns: number;
}

const KpiRow: FC<{
  current: KpiFigures;
  previous: KpiFigures;
  period: Period;
  budget: BudgetStatus | null;
}> = ({ current, previous, period, budget }) => (
  <div class={budget ? "cards has-budget" : "cards"}>
    <KpiCard
      zh="總花費（估算）"
      en="Total Cost"
      value={formatCost(current.totalCost)}
      unit="USD，估算值"
      delta={formatChange(current.totalCost, previous.totalCost, "percent", period)}
    >
      {budget ? <BudgetNote status={budget} /> : null}
    </KpiCard>
    <KpiCard
      zh="總 token"
      en="Total Tokens"
      value={formatNumber(current.totalTokens)}
      unit="input＋output＋cache"
      delta={formatChange(current.totalTokens, previous.totalTokens, "percent", period)}
    />
    <KpiCard
      zh="活躍成員"
      en="Active Members"
      value={String(current.activeMembers)}
      unit="本期有回報的人"
      delta={formatChange(current.activeMembers, previous.activeMembers, "count", period)}
    />
    <KpiCard
      zh="Claude 對話回合"
      en="Claude Turns"
      value={formatNumber(current.claudeTurns)}
      unit="只含 Claude Code，Codex 不回報"
      delta={formatChange(current.claudeTurns, previous.claudeTurns, "percent", period)}
    />
  </div>
);

function kpiFigures(members: UsageSummary[], claudeTurns: number): KpiFigures {
  return {
    totalCost: members.reduce((sum, m) => sum + m.total_cost_usd, 0),
    totalTokens: members.reduce(
      (sum, m) => sum + m.input_tokens + m.output_tokens + m.cache_creation_tokens + m.cache_read_tokens,
      0
    ),
    activeMembers: members.length,
    claudeTurns,
  };
}

const MemberRanking: FC<{ members: UsageSummary[] }> = ({ members }) => {
  if (members.length === 0) {
    return (
      <section class="panel ranking">
        <div class="panel-head">
          <h2 class="panel-title">成員排行</h2>
        </div>
        <div class="panel-empty">No member activity for this period</div>
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
        <span class="panel-note">依花費排序 · {ranked.length} 人</span>
      </div>
      <div class="rank-list">
        {shown.map((m, i) => (
          <div class="rank-row">
            <span class="rank-idx">{String(i + 1).padStart(2, "0")}</span>
            <span class="rank-name">
              <ReportDot lastSeenAt={m.last_seen_at} />
              <span class="rank-name-text">{m.member_name}</span>
            </span>
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
            <span class="rank-idx" aria-hidden="true">··</span>
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
  const bySource = SOURCE_ORDER.map((source) => ({
    source,
    cost: rows.filter((r) => r.source === source).reduce((sum, r) => sum + r.total_cost_usd, 0),
  }));
  const present = bySource.filter((p) => p.cost > 0);
  const shares = sharePercents(present.map((p) => p.cost));
  const wholeShares = roundSharesTo100(shares);

  if (present.length === 0) {
    return (
      <section class="panel provider">
        <div class="panel-head">
          <h2 class="panel-title">供應商切分</h2>
        </div>
        <div class="panel-empty">No provider data for this period</div>
      </section>
    );
  }

  return (
    <section class="panel provider">
      <div class="panel-head">
        <h2 class="panel-title">供應商切分</h2>
        <span class="panel-note">來源即供應商 · 本期合計</span>
      </div>
      <div class="stack" role="img" aria-label="各供應商的成本占比">
        {present.map((p, i) => (
          <div style={`width: ${shares[i].toFixed(1)}%; background: ${SOURCE_COLOR(p.source)}`} />
        ))}
      </div>
      <div class="provider-grid">
        {present.map((p, i) => (
          <div class="provider-box">
            <div class="provider-name">
              <span class="provider-swatch" style={`background: ${SOURCE_COLOR(p.source)}`} aria-hidden="true" />
              {PROVIDER_LABEL(p.source)}
            </div>
            <div class="provider-amt">{formatCost(p.cost)}</div>
            <div class="provider-pct">
              {wholeShares[i]}% · {SOURCE_LABEL(p.source)}
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
      <div class="panel-empty">No model data for this period</div>
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
                <td>{SOURCE_LABEL(m.source)}</td>
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
    return <div class="empty">No usage data for this period</div>;
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
  const memberWholeShares = roundSharesTo100(memberShares);

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
                <td>
                  <span class="member-cell">
                    <ReportDot lastSeenAt={m.last_seen_at} />
                    {m.member_name}
                  </span>
                </td>
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
                      <div class="share-bar-fill" style={`width: ${sharePct.toFixed(1)}%`} />
                    </div>
                    <span class="share-bar-pct">{memberWholeShares[i]}%</span>
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

// 鍵帽不是裝飾：D／W／M 真的能切期間。輸入框裡或按著修飾鍵時不攔。
const PERIOD_KEY: Record<Period, string> = { today: "D", week: "W", month: "M" };
const PERIOD_TITLE: Record<Period, string> = { today: "今天", week: "本週", month: "本月" };

const PERIOD_KEY_SCRIPT = `(function(){
  document.addEventListener('keydown',function(ev){
    if(ev.metaKey||ev.ctrlKey||ev.altKey||ev.shiftKey||ev.repeat)return;
    var t=ev.target;
    if(t&&(t.isContentEditable||/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)))return;
    var k=document.querySelector('.period-nav a[data-key="'+String(ev.key).toLowerCase()+'"]');
    if(!k||k.classList.contains('active'))return;
    ev.preventDefault();
    window.location.href=k.getAttribute('href');
  });
})();`;

dashboard.get("/", (c) => {
  const db = c.get("db");
  const period = validatePeriod(c.req.query("period"));
  // 本期與上一期用同一個時間點推，避免跨過午夜時兩邊對不齊
  const now = new Date();
  const { from, to } = getDateRange(period, now);
  const previousRange = getPreviousDateRange(period, now);

  const members = aggregateUsage(db, { from, to });
  const dailyBySource = aggregateUsageByDateAndSource(db, { from, to });
  const models = aggregateModelPresence(db, { from, to });
  const claudeTurns = sumClaudeTurns(db, { from, to });

  const current = kpiFigures(members, claudeTurns);
  const previous = kpiFigures(aggregateUsage(db, previousRange), sumClaudeTurns(db, previousRange));

  const budget = buildBudgetStatus(period, getMonthlyBudgetUsd(db), current.totalCost, to);

  return c.html(
    <Layout title={`${PERIOD_TITLE[period]} · ccusage tracker`}>
      <header class="topbar">
        <a class="wordmark" href="/">
          <span class="icon icon-terminal" aria-hidden="true" />
          ccusage tracker
          <span class="wordmark-sub">Claude Code ＋ Codex</span>
        </a>
        <nav class="report-nav" aria-label="Pages">
          <span class="nav-current" aria-current="page">Dashboard</span>
          <a href="/api/report/weekly">
            Weekly Report
            <span class="icon icon-arrow-right" aria-hidden="true" />
          </a>
        </nav>
      </header>
      <div class="page-head">
        <div>
          <h1 class="page-title">{PERIOD_TITLE[period]}的團隊花費</h1>
          <div class="page-meta">
            <span class="icon icon-calendar" aria-hidden="true" />
            {from === to ? from : `${from} → ${to}`}
          </div>
        </div>
        <nav class="period-nav" aria-label="Period selection">
          {VALID_PERIODS.map((p) => (
            <a
              href={`/?period=${encodeURIComponent(p)}`}
              class={p === period ? "active" : ""}
              aria-current={p === period ? "page" : undefined}
              aria-keyshortcuts={PERIOD_KEY[p]}
              data-key={PERIOD_KEY[p].toLowerCase()}
            >
              <kbd>{PERIOD_KEY[p]}</kbd>
              <span class="key-label">{p}</span>
            </a>
          ))}
        </nav>
      </div>
      <main>
        <KpiRow current={current} previous={previous} period={period} budget={budget} />
        <TrendChart rows={dailyBySource} />
        <div class="panel-row">
          <MemberRanking members={members} />
          <ProviderSplit rows={dailyBySource} />
        </div>
        <ModelTable models={models} />
      </main>
      <section class="panel members-table">
        <div class="panel-head">
          <h2 class="panel-title">成員明細</h2>
          <span class="panel-note">token 單位為個；實心綠點＝24 小時內有回報，空心灰點＝超過 24 小時</span>
        </div>
        <MemberTable members={members} />
      </section>
      <script dangerouslySetInnerHTML={{ __html: PERIOD_KEY_SCRIPT }} />
    </Layout>
  );
});

export default dashboard;
