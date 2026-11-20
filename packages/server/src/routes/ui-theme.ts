// POC C「終端機」共用樣式：shadcn 語意 token ＋ 元件 anatomy，值換成墨綠中性 ramp。
// 注入時一律走 dangerouslySetInnerHTML：JSX 會把引號與 > 轉義，字串直接放進 <style> 會讓
// font-family 與子選擇器整條失效（舊版整頁掉回襯線字就是這個原因）。
// 注意：這份字串會原樣出現在 HTML 裡，測試會掃整頁的負向字串，註解只寫英文。

// 資料色：同一組值給 CSS 的 --chart-1/2 與 dashboard 的 SOURCE_COLOR
export const DATA_COLOR = {
  claude: "#e59a52",
  codex: "#63a0c6",
  other: "#8b9490",
} as const;

export const FONT_LINKS = [
  "https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&family=Geist+Mono:wght@400;500&display=swap",
];

// lucide 圖示做成 CSS mask：dashboard 測試取「第一個 <svg>」當趨勢圖，圖前不能有 inline svg
const lucide = (paths: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='black' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'>${paths}</svg>`
  )}")`;

const ICON = {
  terminal: lucide(`<path d='m7 11 2-2-2-2'/><path d='M11 13h4'/><rect width='18' height='18' x='3' y='3' rx='2' ry='2'/>`),
  arrowRight: lucide(`<path d='M5 12h14'/><path d='m12 5 7 7-7 7'/>`),
  arrowLeft: lucide(`<path d='m12 19-7-7 7-7'/><path d='M19 12H5'/>`),
  calendar: lucide(`<rect width='18' height='18' x='3' y='4' rx='2'/><path d='M16 2v4'/><path d='M8 2v4'/><path d='M3 10h18'/>`),
};

export const THEME_CSS = `
  :root {
    color-scheme: dark;
    /* ink-green neutral ramp; surfaces stay near grey, color is for data only */
    --background: #0b0e0d;
    --foreground: #e6ebe8;
    --card: #101413;
    --card-foreground: #e6ebe8;
    --popover: #141917;
    --popover-foreground: #e6ebe8;
    --muted: #1a201e;
    --muted-foreground: #828c87;
    --secondary-foreground: #a6afab;
    --border: rgba(230, 235, 232, 0.08);
    --border-strong: rgba(230, 235, 232, 0.14);
    --input: rgba(230, 235, 232, 0.12);
    --ring: #a6afab;
    --primary: #e6ebe8;
    --primary-foreground: #0b0e0d;
    --accent: #1a201e;
    --accent-foreground: #e6ebe8;
    --destructive: #e5484d;
    --warning: #e0b041;
    --positive: #4cc38a;
    --radius: 12px;
    --radius-sm: 6px;
    --radius-md: 8px;
    --chart-1: ${DATA_COLOR.claude};
    --chart-2: ${DATA_COLOR.codex};
    --chart-3: ${DATA_COLOR.other};
    --chart-4: #6b7571;
    --chart-5: #3a423f;
    --bar-lead: #d3dad6;
    --bar-rest: #6b7571;
    --ease: cubic-bezier(0.22, 1, 0.36, 1);
    --font-sans: 'Geist', ui-sans-serif, -apple-system, 'Segoe UI', 'PingFang TC', 'Noto Sans TC', sans-serif;
    --font-mono: 'Geist Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  }

  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; }
  }

  * { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: var(--font-sans);
    font-size: 14px;
    line-height: 20px;
    background: var(--background);
    color: var(--foreground);
    min-height: 100vh;
    -webkit-font-smoothing: antialiased;
  }

  a { color: inherit; }

  :focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; border-radius: var(--radius-sm); }

  .mono, .num { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }

  .container { max-width: 1280px; margin: 0 auto; padding: 0 32px 48px; }

  .icon {
    display: inline-block; width: 16px; height: 16px; flex-shrink: 0;
    background: currentColor;
    -webkit-mask: var(--icon) center / 16px 16px no-repeat; mask: var(--icon) center / 16px 16px no-repeat;
  }
  .icon-terminal { --icon: ${ICON.terminal}; }
  .icon-arrow-right { --icon: ${ICON.arrowRight}; }
  .icon-arrow-left { --icon: ${ICON.arrowLeft}; }
  .icon-calendar { --icon: ${ICON.calendar}; }

  /* Top bar */
  .topbar {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    height: 56px; border-bottom: 1px solid var(--border); margin-bottom: 32px;
  }
  .wordmark { white-space: nowrap; display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 500; color: var(--foreground); text-decoration: none; }
  .wordmark .icon { color: var(--foreground); }
  .wordmark .wordmark-sub { font-family: var(--font-mono); font-size: 12px; font-weight: 400; color: var(--muted-foreground); }

  .report-nav { display: flex; align-items: center; gap: 4px; font-size: 13px; white-space: nowrap; }
  .report-nav a, .report-nav .nav-current {
    display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px;
    border-radius: var(--radius-md); text-decoration: none; color: var(--secondary-foreground);
    transition: color 150ms var(--ease), background-color 150ms var(--ease);
  }
  .report-nav a:hover { color: var(--foreground); background: var(--muted); }
  .report-nav .nav-current { color: var(--foreground); background: var(--muted); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05); }
  .report-nav .nav-sep { display: none; }

  /* Page head */
  .page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; margin-bottom: 24px; }
  .page-title { font-size: 28px; line-height: 32px; font-weight: 500; letter-spacing: -0.01em; }
  .page-meta { display: flex; align-items: center; gap: 8px; margin-top: 8px; font-family: var(--font-mono); font-size: 12px; line-height: 16px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }

  /* Card (shadcn anatomy) */
  .card, .panel {
    background: var(--card); color: var(--card-foreground);
    border: 1px solid var(--border); border-radius: var(--radius);
    padding: 20px; min-width: 0;
  }
  .card-header, .panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-bottom: 16px; }
  .card-title, .panel-title { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--foreground); }
  .card-description, .panel-note { font-family: var(--font-mono); font-size: 12px; line-height: 16px; color: var(--muted-foreground); }

  .separator { height: 1px; background: var(--border); border: 0; }

  /* Badge */
  .badge {
    display: inline-flex; align-items: center; gap: 4px; height: 20px; padding: 0 6px;
    border: 1px solid var(--border-strong); border-radius: 4px;
    font-family: var(--font-mono); font-size: 11px; line-height: 16px; color: var(--secondary-foreground);
  }

  /* Button */
  .button {
    display: inline-flex; align-items: center; gap: 8px; height: 32px; padding: 0 12px;
    border-radius: var(--radius-md); font-size: 13px; font-weight: 500; text-decoration: none;
    background: var(--primary); color: var(--primary-foreground);
    transition: background-color 150ms var(--ease), transform 120ms var(--ease);
  }
  .button:active { transform: scale(0.98); }
  .button-ghost { background: transparent; color: var(--secondary-foreground); }
  .button-ghost:hover { background: var(--muted); color: var(--foreground); }

  /* Table */
  .table-wrapper { overflow-x: auto; -webkit-overflow-scrolling: touch; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th {
    height: 36px; padding: 0 12px; text-align: right; white-space: nowrap;
    font-size: 12px; font-weight: 400; color: var(--muted-foreground);
    border-bottom: 1px solid var(--border);
  }
  th:first-child, td:first-child { text-align: left; padding-left: 0; }
  th:last-child, td:last-child { padding-right: 0; }
  td {
    height: 40px; padding: 0 12px; text-align: right; white-space: nowrap;
    font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--secondary-foreground);
    border-bottom: 1px solid var(--border);
  }
  td:first-child { font-family: var(--font-sans); color: var(--foreground); }
  tbody tr { transition: background-color 120ms var(--ease); }
  tbody tr:hover td { background: rgba(230, 235, 232, 0.025); }
  tbody tr:last-child td { border-bottom: none; }

  .empty, .panel-empty, .empty-state {
    padding: 40px 0; text-align: center; font-family: var(--font-mono); font-size: 12px; color: var(--muted-foreground);
  }
  .empty { border: 1px dashed var(--border-strong); border-radius: var(--radius); }

  .footer {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    margin-top: 48px; padding-top: 16px; border-top: 1px solid var(--border);
    font-family: var(--font-mono); font-size: 12px; color: var(--muted-foreground);
  }

  @media (max-width: 768px) {
    .container { padding: 0 16px 32px; }
    .topbar { margin-bottom: 24px; }
    .wordmark .wordmark-sub { display: none; }
    .wordmark { font-size: 14px; }
    .report-nav a, .report-nav .nav-current { padding: 0 8px; }
    .page-head { flex-direction: column; align-items: flex-start; gap: 16px; }
    .page-title { font-size: 24px; line-height: 28px; }
    .card, .panel { padding: 16px; }
    .footer { flex-direction: column; align-items: flex-start; }
  }
`;

export const DASHBOARD_CSS = `
  /* Period keycaps (signature: only where something can be switched) */
  .period-nav { display: flex; gap: 8px; }
  .period-nav a {
    display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px;
    min-width: 56px; height: 52px; padding: 6px 8px 4px;
    text-decoration: none; color: var(--secondary-foreground);
    background: linear-gradient(#1d2321, #161b19);
    border: 1px solid var(--border-strong); border-radius: var(--radius-md);
    box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 2px 0 #050706;
    transition: color 150ms var(--ease), background-color 150ms var(--ease), transform 120ms var(--ease), box-shadow 120ms var(--ease);
  }
  .period-nav a kbd { font-family: var(--font-mono); font-size: 15px; line-height: 16px; font-weight: 500; color: var(--foreground); }
  .period-nav a .key-label { font-family: var(--font-mono); font-size: 11px; line-height: 12px; color: var(--muted-foreground); }
  .period-nav a:hover { color: var(--foreground); border-color: rgba(230, 235, 232, 0.22); }
  .period-nav a:active { transform: translateY(2px); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.06), 0 0 0 #050706; }
  .period-nav a.active {
    background: var(--primary); border-color: var(--primary);
    box-shadow: inset 0 -2px 0 rgba(11, 14, 13, 0.18), 0 2px 0 #050706;
  }
  .period-nav a.active kbd, .period-nav a.active .key-label { color: var(--primary-foreground); }

  /* KPI */
  .cards { display: grid; grid-template-columns: 1.6fr 1fr 1fr 1fr; gap: 12px; margin-bottom: 12px; }
  .card-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
  .kpi-label { font-size: 13px; color: var(--secondary-foreground); }
  .card-label { font-family: var(--font-mono); font-size: 11px; line-height: 16px; color: var(--muted-foreground); white-space: nowrap; }
  .card-value { font-family: var(--font-mono); font-size: 30px; line-height: 32px; font-weight: 500; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; color: var(--foreground); }
  .card-unit { margin-top: 8px; font-size: 12px; line-height: 16px; color: var(--muted-foreground); }

  .budget { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--border); }
  .budget-line { font-family: var(--font-mono); font-size: 12px; line-height: 16px; color: var(--secondary-foreground); font-variant-numeric: tabular-nums; }
  .budget-meter { height: 4px; margin: 8px 0; background: var(--muted); border-radius: 2px; overflow: hidden; }
  .budget-meter-fill { height: 100%; background: var(--primary); }
  .budget-status { display: flex; align-items: center; gap: 8px; margin-top: 12px; font-size: 12px; line-height: 16px; }
  .budget-status .budget-icon {
    display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px;
    border-radius: 4px; font-family: var(--font-mono); font-size: 11px; font-weight: 500;
    background: currentColor;
  }
  .budget-status .budget-icon > span { color: var(--card); }
  .budget-status.ok { color: var(--positive); }
  .budget-status.warning { color: var(--warning); }
  .budget-status.critical { color: var(--destructive); }
  .budget-status .budget-text { color: var(--foreground); }

  /* Trend: the one bright moment */
  .panel.trend { margin-bottom: 12px; padding: 24px; }
  .trend .panel-head { margin-bottom: 8px; }
  .trend .panel-title { font-size: 15px; }
  .trend-legend { display: flex; gap: 24px; flex-wrap: wrap; margin-bottom: 16px; font-size: 13px; color: var(--secondary-foreground); }
  .trend-legend > span { display: inline-flex; align-items: center; gap: 8px; }
  .trend-legend .key { display: inline-block; width: 16px; height: 2px; border-radius: 1px; }
  .trend-legend .key.quiet { height: 1px; }
  .trend-legend .legend-amt { font-family: var(--font-mono); font-variant-numeric: tabular-nums; color: var(--foreground); }

  .trend-chart svg { display: block; width: 100%; height: auto; overflow: visible; }
  .trend-chart text { fill: var(--muted-foreground); font-family: var(--font-mono); font-size: 7.5px; font-variant-numeric: tabular-nums; }
  .trend-chart .trend-ytick { paint-order: stroke; stroke: var(--card); stroke-width: 3px; }
  .trend-chart .trend-grid { stroke: rgba(230, 235, 232, 0.06); stroke-width: 1px; stroke-dasharray: 2 4; }
  .trend-chart .trend-axis { stroke: rgba(230, 235, 232, 0.16); stroke-width: 1px; }
  .trend-chart .trend-line { fill: none; stroke-linejoin: round; stroke-linecap: round; }
  .trend-chart .trend-dot { stroke: var(--card); stroke-width: 2px; opacity: 0; }
  .trend-chart .trend-dot[data-last] { opacity: 1; }
  .trend-chart .trend-end-label { fill: var(--secondary-foreground); }
  .trend-chart .trend-crosshair { stroke: var(--secondary-foreground); stroke-width: 1px; stroke-dasharray: 2 3; opacity: 0; }

  .trend-readout {
    display: flex; align-items: center; height: 32px; margin-top: 12px; padding: 0 12px;
    background: var(--background); border: 1px solid var(--border); border-radius: var(--radius-md);
    font-family: var(--font-mono); font-size: 12px; color: var(--secondary-foreground);
    font-variant-numeric: tabular-nums; white-space: pre; overflow: hidden; text-overflow: ellipsis;
  }
  .trend-readout::before { content: "$ ccusage daily  "; color: var(--muted-foreground); white-space: pre; }

  .trend-bars { display: grid; gap: 12px; }
  .trend-bar-row { display: grid; grid-template-columns: 112px 1fr 96px; gap: 12px; align-items: center; }
  .trend-bar-name { font-size: 13px; color: var(--secondary-foreground); }
  .trend-bar-track { height: 12px; background: var(--muted); border-radius: 2px; overflow: hidden; }
  .trend-bar { height: 100%; border-radius: 2px; }
  .trend-bar-val { font-family: var(--font-mono); font-size: 13px; text-align: right; font-variant-numeric: tabular-nums; }

  /* Ranking + provider */
  .panel-row { display: grid; grid-template-columns: 1.5fr 1fr; gap: 12px; margin-bottom: 12px; }
  .rank-list { display: grid; gap: 4px; }
  .rank-row { display: grid; grid-template-columns: 24px 96px 1fr 112px; gap: 12px; align-items: center; height: 36px; }
  .rank-row.others { grid-template-columns: 24px 96px 1fr 112px; }
  .rank-idx { font-family: var(--font-mono); font-size: 12px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }
  .rank-name { font-size: 13px; color: var(--foreground); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .rank-track { height: 6px; background: var(--muted); border-radius: 2px; overflow: hidden; }
  .rank-fill { height: 100%; border-radius: 2px; }
  .rank-val { text-align: right; font-family: var(--font-mono); font-size: 13px; line-height: 16px; color: var(--foreground); font-variant-numeric: tabular-nums; }
  .rank-sub { display: block; font-size: 11px; line-height: 14px; color: var(--muted-foreground); }

  .stack { display: flex; gap: 2px; height: 8px; border-radius: 2px; overflow: hidden; }
  .stack div { height: 100%; }
  .provider-grid { display: grid; grid-template-columns: 1fr; gap: 0; margin-top: 16px; }
  .provider-grid.has-other { grid-template-columns: 1fr; }
  .provider-box { display: grid; grid-template-columns: 1fr auto; align-items: baseline; gap: 4px 12px; padding: 12px 0; border-top: 1px solid var(--border); }
  .provider-box:first-child { border-top: none; }
  .provider-name { display: flex; align-items: center; gap: 8px; font-size: 13px; color: var(--secondary-foreground); }
  .provider-swatch { width: 8px; height: 8px; border-radius: 2px; flex-shrink: 0; }
  .provider-amt { font-family: var(--font-mono); font-size: 20px; line-height: 24px; font-weight: 500; text-align: right; font-variant-numeric: tabular-nums; }
  .provider-pct { grid-column: 1 / -1; padding-left: 16px; font-family: var(--font-mono); font-size: 12px; line-height: 16px; color: var(--muted-foreground); font-variant-numeric: tabular-nums; }

  .panel.models { margin-bottom: 12px; }
  .panel.models th:nth-child(2), .panel.models td:nth-child(2) { text-align: left; font-family: var(--font-sans); }
  .panel.members-table .panel-head { margin-bottom: 8px; }

  .stale-warn { color: var(--warning); }
  .total-row td { color: var(--foreground); border-top: 1px solid var(--border-strong); font-weight: 500; }

  .share-bar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; min-width: 120px; }
  .share-bar-track { width: 80px; height: 4px; background: var(--muted); border-radius: 2px; overflow: hidden; }
  .share-bar-fill { height: 100%; background: var(--bar-rest); }
  .share-bar-pct { min-width: 3em; text-align: right; font-size: 12px; color: var(--secondary-foreground); }

  @media (max-width: 1024px) {
    .cards { grid-template-columns: 1fr 1fr; }
    .cards .card:first-child, .cards .card:last-child { grid-column: 1 / -1; }
  }

  @media (max-width: 768px) {
    .period-nav { width: 100%; }
    .period-nav a { flex: 1; }
    .card-value { font-size: 22px; line-height: 28px; }
    .card-label { display: none; }
    .panel.trend { padding: 16px; }
    .panel-row { grid-template-columns: 1fr; }
    .rank-row, .rank-row.others { grid-template-columns: 20px 72px 1fr 88px; gap: 8px; }
    .trend-bar-row { grid-template-columns: 88px 1fr 80px; }
    /* chart text is in viewBox units: scale up so it stays >= 11px on a phone */
    .trend-chart text { font-size: 24px; }
    .trend-chart .trend-ytick { stroke-width: 8px; }
    .trend-chart .trend-xtick[data-alt] { display: none; }
    .trend-chart .trend-end-label { display: none; }
    .trend-readout::before { content: "$ "; }
  }
`;

export const WEEKLY_CSS = `
  .week-badge { font-family: var(--font-mono); }

  .section { margin-bottom: 12px; }
  .section h2 { font-size: 14px; line-height: 20px; font-weight: 500; margin-bottom: 16px; }

  .stat-grid { display: grid; grid-template-columns: repeat(4, 1fr); border: 1px solid var(--border); border-radius: var(--radius-md); margin-bottom: 20px; }
  .stat-card { padding: 16px; border-left: 1px solid var(--border); }
  .stat-card:first-child { border-left: none; }
  .stat-value { font-family: var(--font-mono); font-size: 28px; line-height: 32px; font-weight: 500; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .stat-label { margin-top: 4px; font-size: 13px; color: var(--secondary-foreground); }
  .cost-link {
    display: inline-flex; align-items: center; gap: 4px; margin-top: 8px;
    font-size: 12px; color: var(--muted-foreground); text-decoration: none;
    transition: color 150ms var(--ease);
  }
  .cost-link:hover { color: var(--foreground); }

  .dist-bar { display: flex; gap: 2px; height: 24px; margin-bottom: 12px; border-radius: 4px; overflow: hidden; }
  .dist-seg { display: flex; align-items: center; justify-content: center; min-width: 2px; font-family: var(--font-mono); font-size: 11px; font-variant-numeric: tabular-nums; }
  .dist-quick { background: #5f6965; color: #f3f6f4; }
  .dist-medium { background: #87918d; color: #0b0e0d; }
  .dist-deep { background: #b0b9b5; color: #0b0e0d; }
  .dist-marathon { background: #e1e7e4; color: #0b0e0d; }
  .dist-legend { display: flex; gap: 16px; flex-wrap: wrap; font-size: 12px; color: var(--secondary-foreground); }
  .dist-legend-item { display: flex; align-items: center; gap: 8px; }
  .dist-legend-item .mono { color: var(--muted-foreground); }
  .dist-dot { width: 8px; height: 8px; border-radius: 2px; }

  .highlights { display: grid; gap: 4px; margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
  .highlight-item { font-size: 13px; line-height: 24px; color: var(--secondary-foreground); }
  .highlight-item::before { content: "\\203A  "; font-family: var(--font-mono); color: var(--muted-foreground); white-space: pre; }
  .highlight-value { font-family: var(--font-mono); color: var(--foreground); }

  .section th, .section td { text-align: left; font-family: var(--font-sans); }
  .section th.num, .section td.num { text-align: right; font-family: var(--font-mono); }
  .section td:first-child { color: var(--foreground); }
  .ctx-warn { color: var(--warning); }
  td.ctx-warn { color: var(--warning); }

  .skill-rank { font-family: var(--font-mono); font-size: 12px; color: var(--muted-foreground); }
  .unused { margin-top: 20px; padding-top: 16px; border-top: 1px solid var(--border); }
  .unused-title { margin-bottom: 8px; font-size: 13px; color: var(--secondary-foreground); }
  .unused-list { display: flex; flex-wrap: wrap; gap: 8px; }
  .unused-tag { display: inline-flex; align-items: center; height: 24px; padding: 0 8px; border: 1px solid var(--border-strong); border-radius: var(--radius-sm); font-family: var(--font-mono); font-size: 12px; color: var(--muted-foreground); }

  .report-footer { margin-top: 24px; padding: 16px 20px; border: 1px dashed var(--border-strong); border-radius: var(--radius); font-size: 13px; color: var(--secondary-foreground); }
  .report-footer .footer-title { margin-bottom: 4px; color: var(--foreground); font-weight: 500; }
  .report-footer code { padding: 2px 6px; border-radius: 4px; background: var(--muted); font-family: var(--font-mono); font-size: 12px; color: var(--foreground); }

  @media (max-width: 768px) {
    .stat-grid { grid-template-columns: repeat(2, 1fr); }
    .stat-card:nth-child(3) { border-left: none; }
    .stat-card:nth-child(n + 3) { border-top: 1px solid var(--border); }
    .stat-value { font-size: 24px; line-height: 28px; }
  }
`;
