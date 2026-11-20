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

// 各自四捨五入會讓整數百分比加總變成 99% 或 101%（三個等份就是 33+33+33）。
// 最大餘數法：先取整數部分，再把剩下的名額按小數部分由大到小補回去，加總保證是 100。
function roundSharesTo100(shares: number[]): number[] {
  const floors = shares.map((v) => Math.floor(v));
  const used = floors.reduce((sum, v) => sum + v, 0);
  const remainder = Math.round(shares.reduce((sum, v) => sum + v, 0)) - used;
  if (remainder <= 0) return floors;

  const bump = new Set(
    shares
      .map((v, i) => ({ i, frac: v - Math.floor(v) }))
      .sort((a, b) => b.frac - a.frac || a.i - b.i)
      .slice(0, remainder)
      .map((o) => o.i)
  );
  return floors.map((v, i) => (bump.has(i) ? v + 1 : v));
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

// 回報狀態點：顏色之外還有形狀（實心／空心）與文字替代，不靠顏色單獨傳達
const STATUS_LABEL = { fresh: "24 小時內有回報", stale: "超過 24 小時未回報" } as const;

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
const SOURCE_COLOR = (source: UsageSource): string => sourceInfo(source).color;
const SOURCE_LABEL = (source: UsageSource): string => sourceInfo(source).label;
const PROVIDER_LABEL = (source: UsageSource): string => sourceInfo(source).provider;

// 成員排行是同一個量的排序，用單色序列而不是分類色
// 第一名用 ramp 最亮的一階，其餘退成同一階中性灰：顏色留給來源，不給排名
const RANK_COLORS = { first: "var(--bar-lead)", rest: "var(--bar-rest)" };

const RANK_LIMIT = 10;

function rankColor(index: number): string {
  return index === 0 ? RANK_COLORS.first : RANK_COLORS.rest;
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

interface TrendSeries {
  source: UsageSource;
  name: string;
  color: string;
  values: number[];
}

function buildTrendSeries(rows: DailySourceUsage[]): { dates: string[]; series: TrendSeries[] } {
  const dates = [...new Set(rows.map((r) => r.date))].sort();
  const sources: UsageSource[] = SOURCE_ORDER.filter((s) =>
    rows.some((r) => r.source === s)
  );

  const series = sources.map((source) => ({
    source,
    name: SOURCE_LABEL(source),
    color: SOURCE_COLOR(source),
    values: dates.map((date) => rows.find((r) => r.date === date && r.source === source)?.total_cost_usd ?? 0),
  }));

  return { dates, series };
}

// 期間總額只拿來決定誰是主線、以及圖例旁的數字；佔比用 sharePercents，溢位也不會比錯
function seriesTotals(series: TrendSeries[]): number[] {
  return series.map((s) => s.values.reduce((sum, v) => sum + finiteCost(v), 0));
}

function dominantIndex(series: TrendSeries[]): number {
  const shares = sharePercents(seriesTotals(series));
  return shares.reduce((best, v, i) => (v > shares[best] ? i : best), 0);
}

const TrendLegend: FC<{ series: TrendSeries[] }> = ({ series }) => {
  const totals = seriesTotals(series);
  const lead = dominantIndex(series);
  return (
    <div class="trend-legend">
      {series.map((s, i) => (
        <span>
          <span class={i === lead ? "key" : "key quiet"} style={`background: ${s.color}`} aria-hidden="true" />
          {s.name}
          <span class="legend-amt">{formatCost(totals[i])}</span>
        </span>
      ))}
    </div>
  );
};

// 十字線只是加分項：script 不執行時，每個點的 <title> 仍然讀得到數字。
// 手機寬度（<=768px）末端標籤已隱藏，將橫軸壓縮到 420×260，拿掉右側留白並把趨勢圖高度拉到約 200px。
const TREND_SCRIPT = `(function(){
  var root=document.querySelector('[data-trend]');
  if(!root)return;
  var svg=root.querySelector('svg'),hit=root.querySelector('.trend-hit');
  var xh=root.querySelector('.trend-crosshair'),out=root.querySelector('.trend-readout');
  if(!svg||!hit||!xh||!out)return;
  var vw=Number(root.getAttribute('data-vw'))||0;
  var dots=[].slice.call(root.querySelectorAll('.trend-dot'));
  if(!vw||!dots.length)return;
  if(window.innerWidth<=768){
    var mw=420,span=mw-12,origSpan=vw-80;
    var mx=function(v){return(4+(Number(v)-4)*(span/origSpan)).toFixed(1);};
    svg.setAttribute('viewBox','0 0 '+mw+' 260');
    vw=mw;
    [].forEach.call(svg.querySelectorAll('.trend-grid,.trend-axis'),function(el){el.setAttribute('x2',String(mw-8));});
    [].forEach.call(svg.querySelectorAll('.trend-xtick'),function(el){el.setAttribute('x',mx(el.getAttribute('x')));});
    dots.forEach(function(el){el.setAttribute('cx',mx(el.getAttribute('cx')));});
    [].forEach.call(svg.querySelectorAll('.trend-line,.trend-area'),function(el){
      var d=el.getAttribute('d')||'';
      el.setAttribute('d',d.replace(/(-?\\d+(?:\\.\\d+)?),(-?\\d+(?:\\.\\d+)?)/g,function(_,x,y){return mx(x)+','+y;}));
    });
    hit.setAttribute('width',String(span));
  }
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

// 單調三次曲線（Fritsch–Carlson）：平滑但不會在兩個點之間衝過頭、掉到 $0 以下。
// 輸入是已經算好的像素座標，不碰金額，所以 1e308 這類資料不會在這裡溢位。
function smoothPath(points: Array<[number, number]>): string {
  const n = points.length;
  if (n === 0) return "";
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "0");
  if (n === 1) return `M${fmt(points[0][0])},${fmt(points[0][1])}`;

  const slopes: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = points[i + 1][0] - points[i][0];
    slopes.push(dx > 0 ? (points[i + 1][1] - points[i][1]) / dx : 0);
  }
  const tangents = points.map((_, i) => {
    if (i === 0) return slopes[0];
    if (i === n - 1) return slopes[n - 2];
    const a = slopes[i - 1];
    const b = slopes[i];
    // 方向相反或任一段持平 → 切線 0，順便擋掉 0 當分母
    if (a * b <= 0) return 0;
    const h0 = points[i][0] - points[i - 1][0];
    const h1 = points[i + 1][0] - points[i][0];
    return (3 * (h0 + h1)) / ((2 * h1 + h0) / a + (h1 + 2 * h0) / b);
  });

  let d = `M${fmt(points[0][0])},${fmt(points[0][1])}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[i + 1];
    const h = (x1 - x0) / 3;
    d += ` C${fmt(x0 + h)},${fmt(y0 + tangents[i] * h)} ${fmt(x1 - h)},${fmt(y1 - tangents[i + 1] * h)} ${fmt(x1)},${fmt(y1)}`;
  }
  return d;
}

const TrendChart: FC<{ rows: DailySourceUsage[] }> = ({ rows }) => {
  const { dates, series } = buildTrendSeries(rows);

  if (dates.length === 0) {
    return (
      <section class="panel trend">
        <div class="panel-head">
          <h2 class="panel-title">每日成本趨勢</h2>
        </div>
        <div class="panel-empty">No trend data for this period</div>
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
          <span class="panel-note">{dates[0]} · 單日，以橫條比較</span>
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

  // viewBox 單位；桌面約放大 1.6 倍。線寬用 non-scaling-stroke 固定在像素，字級在 CSS 依寬度調
  const W = 720;
  const H = 260;
  const L = 4;
  const R = 76;
  const T = 18;
  const B = 24;
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
  const lead = dominantIndex(series);
  const leadColor = series[lead]?.color ?? DATA_COLOR.claude;
  // 主線畫在最上層：安靜的那條先畫
  const drawOrder = series.map((s, i) => ({ s, i })).sort((a, b) => (a.i === lead ? 1 : 0) - (b.i === lead ? 1 : 0));
  const rawLabels = dates.map((_, i) => i).filter((i) => i % labelStep === 0 || i === n - 1);
  const shownLabels =
    rawLabels.length >= 3 && n - 1 - rawLabels[rawLabels.length - 2] < Math.ceil(labelStep * 0.6)
      ? [...rawLabels.slice(0, -2), rawLabels[rawLabels.length - 1]]
      : rawLabels;

  return (
    <section class="panel trend trend-chart" data-trend="1" data-vw={W}>
      <div class="panel-head">
        <h2 class="panel-title">每日成本趨勢</h2>
        <span class="panel-note">
          {dates[0]} → {dates[n - 1]} · {n} 天
        </span>
      </div>
      <TrendLegend series={series} />
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="每日成本折線圖，每個來源一條線">
        <defs>
          <linearGradient id="trend-lead-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color={leadColor} stop-opacity="0.14" />
            <stop offset="72%" stop-color={leadColor} stop-opacity="0.02" />
            <stop offset="100%" stop-color={leadColor} stop-opacity="0" />
          </linearGradient>
        </defs>
        {Array.from({ length: TICKS + 1 }, (_, i) => (max / TICKS) * i).map((v) => (
          <line class="trend-grid" x1={L} x2={W - R} y1={yTick(v)} y2={yTick(v)} vector-effect="non-scaling-stroke" />
        ))}
        <line class="trend-axis" x1={L} x2={W - R} y1={yTick(0)} y2={yTick(0)} vector-effect="non-scaling-stroke" />
        {shownLabels.map((i, k) => {
          const isMobileAlt =
            i !== 0 &&
            i !== n - 1 &&
            (k % 2 === 1 || (shownLabels.length % 2 === 0 && k === shownLabels.length - 2));
          return (
            <text
              class="trend-xtick"
              x={x(i).toFixed(1)}
              y={H - 4}
              text-anchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
              data-alt={isMobileAlt ? "1" : undefined}
            >
              {formatDateShort(dates[i])}
            </text>
          );
        })}
        {drawOrder.map(({ s, i: si }) => {
          const isLead = si === lead;
          const pts = s.values.map((v, i) => [x(i), Number(yData(v))] as [number, number]);
          const line = smoothPath(pts);
          return (
            <g>
              {isLead ? (
                <path
                  class="trend-area"
                  fill="url(#trend-lead-fill)"
                  d={`${line} L${x(n - 1).toFixed(1)},${yTick(0)} L${x(0).toFixed(1)},${yTick(0)} Z`}
                />
              ) : null}
              <path
                class="trend-line"
                stroke={s.color}
                stroke-width={isLead ? 2.25 : 1.5}
                vector-effect="non-scaling-stroke"
                d={line}
              />
              {s.values.map((v, i) => (
                <circle
                  class="trend-dot"
                  cx={x(i).toFixed(1)}
                  cy={yData(v)}
                  r={i === n - 1 ? 3 : 2}
                  fill={s.color}
                  data-date={dates[i]}
                  data-source={s.name}
                  data-cost={formatCost(v)}
                  data-last={i === n - 1 ? "1" : undefined}
                >
                  <title>{`${dates[i]} · ${s.name} ${formatCost(v)}`}</title>
                </circle>
              ))}
              <text class="trend-end-label" x={(x(n - 1) + 8).toFixed(1)} y={(Number(yData(s.values[n - 1])) + 3).toFixed(1)}>
                {s.name}
              </text>
            </g>
          );
        })}
        {Array.from({ length: TICKS + 1 }, (_, i) => (max / TICKS) * i).map((v) => (
          <text class="trend-ytick" x={L} y={(Number(yTick(v)) - 5).toFixed(1)} text-anchor="start">
            {formatAxisTick(v, max / TICKS)}
          </text>
        ))}
        <line class="trend-crosshair" x1="0" x2="0" y1={T} y2={yTick(0)} vector-effect="non-scaling-stroke" />
        <rect class="trend-hit" x={L} y={T} width={W - L - R} height={H - T - B} fill="transparent" />
      </svg>
      <div class="trend-readout" aria-live="polite">
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
