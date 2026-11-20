import type { FC } from "hono/jsx";
import type { DailySourceUsage, UsageSource } from "../queries";
import { SOURCE_ORDER, sourceInfo } from "../sources";
import { NOT_AVAILABLE, finiteCost, ratioPct, sharePercents, isDisplayableCost, formatCost, SOURCE_COLOR, SOURCE_LABEL } from "./dashboard-format";

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

export const TrendChart: FC<{ rows: DailySourceUsage[] }> = ({ rows }) => {
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
  const leadColor = series[lead]?.color ?? sourceInfo(SOURCE_ORDER[0]).color;
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
