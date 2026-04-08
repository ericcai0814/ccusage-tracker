import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { dashboardAuth } from "../middleware/dashboard-auth";
import {
  getWeeklyOverview,
  getMemberComparison,
  getToolHeatmap,
  getAnomalousSessions,
  getSkillUsageSummary,
  getWeeklyCostTrend,
  type WeeklyOverview as WeeklyOverviewData,
  type MemberComparison as MemberComparisonData,
  type ToolHeatmapEntry,
  type AnomalousSession,
  type SkillUsageEntry,
  type DailyCostEntry,
  ANOMALY_THRESHOLDS,
} from "../queries";
import type { AppEnv } from "../app";

const WEEK_REGEX = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;

function getWeekDateRange(weekStr: string): { from: string; to: string; fromDate: string; toDate: string } {
  const [yearStr, weekPart] = weekStr.split("-W");
  const year = parseInt(yearStr, 10);
  const week = parseInt(weekPart, 10);

  const jan4 = new Date(Date.UTC(year, 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday = new Date(jan4);
  monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7);

  const nextMonday = new Date(monday);
  nextMonday.setUTCDate(monday.getUTCDate() + 7);

  const fmt = (d: Date) => d.toISOString().split("T")[0];
  return {
    from: monday.toISOString(),
    to: nextMonday.toISOString(),
    fromDate: fmt(monday),
    toDate: fmt(nextMonday),
  };
}

function getCurrentWeek(): string {
  const now = new Date();
  const jan4 = new Date(Date.UTC(now.getUTCFullYear(), 0, 4));
  const dayOfWeek = jan4.getUTCDay() || 7;
  const monday1 = new Date(jan4);
  monday1.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1);
  const diff = now.getTime() - monday1.getTime();
  const weekNum = Math.floor(diff / (7 * 24 * 60 * 60 * 1000)) + 1;
  return `${now.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function getAnomalyReasons(s: AnomalousSession): string[] {
  const reasons: string[] = [];
  if (s.turns >= ANOMALY_THRESHOLDS.HIGH_TURNS_MIN && s.files_edited + s.files_written === 0) {
    reasons.push("High turns, no output");
  }
  if (s.tool_errors >= ANOMALY_THRESHOLDS.ERROR_HEAVY_MIN) {
    reasons.push("Error-heavy");
  }
  if (s.duration_minutes >= ANOMALY_THRESHOLDS.LONG_DURATION_MIN && s.has_commit === 0) {
    reasons.push("Long, no commit");
  }
  return reasons;
}

const CSS = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif; background: #f8f9fa; color: #1a1a2e; line-height: 1.6; }
  .container { max-width: 900px; margin: 0 auto; padding: 2rem 1.5rem; }
  h1 { font-size: 1.75rem; font-weight: 700; margin-bottom: 0.25rem; }
  .subtitle { color: #6c757d; margin-bottom: 2rem; font-size: 0.95rem; }
  .section { background: #fff; border: 1px solid #e9ecef; border-radius: 8px; padding: 1.5rem; margin-bottom: 1.5rem; }
  .section h2 { font-size: 1.15rem; font-weight: 600; margin-bottom: 1rem; color: #495057; }
  table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
  th { background: #f1f3f5; text-align: left; padding: 0.6rem 0.8rem; font-weight: 600; border-bottom: 2px solid #dee2e6; }
  td { padding: 0.5rem 0.8rem; border-bottom: 1px solid #f1f3f5; }
  tr:nth-child(even) td { background: #f8f9fa; }
  .stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 1rem; }
  .stat-card { text-align: center; padding: 1rem; background: #f8f9fa; border-radius: 6px; }
  .stat-value { font-size: 1.5rem; font-weight: 700; color: #1a1a2e; }
  .stat-label { font-size: 0.8rem; color: #6c757d; margin-top: 0.25rem; }
  .empty-state { color: #adb5bd; text-align: center; padding: 2rem; font-style: italic; }
  .anomaly-tag { display: inline-block; font-size: 0.75rem; padding: 0.15rem 0.5rem; border-radius: 4px; background: #fff3cd; color: #856404; margin-right: 0.25rem; margin-bottom: 0.25rem; }
  .heatmap-cell { text-align: center; font-size: 0.85rem; }
  .anomaly-row td { border-left: 3px solid #ffc107; }
  svg { display: block; margin: 0 auto; }
  .cost-chart { overflow-x: auto; }
  .bar-chart { display: flex; align-items: flex-end; gap: 0.5rem; height: 150px; padding: 0.5rem 0; }
  .bar-item { flex: 1; display: flex; flex-direction: column; align-items: center; min-width: 60px; }
  .bar { background: #4dabf7; border-radius: 3px 3px 0 0; width: 100%; min-height: 2px; transition: height 0.3s; }
  .bar-label { font-size: 0.7rem; color: #6c757d; margin-top: 0.25rem; }
  .bar-value { font-size: 0.75rem; font-weight: 600; margin-bottom: 0.15rem; }
`;

// --- Section Components ---

const OverviewSection: FC<{ data: WeeklyOverviewData }> = ({ data }) => (
  <div class="section">
    <h2>Overview</h2>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-value">{data.total_sessions}</div>
        <div class="stat-label">Sessions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{data.total_duration_hours}h</div>
        <div class="stat-label">Total Hours</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{data.commit_rate}%</div>
        <div class="stat-label">Commit Rate</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{data.avg_turns}</div>
        <div class="stat-label">Avg Turns</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">{data.total_tool_errors}</div>
        <div class="stat-label">Tool Errors</div>
      </div>
    </div>
  </div>
);

const MemberTable: FC<{ members: MemberComparisonData[] }> = ({ members }) => (
  <div class="section">
    <h2>Member Comparison</h2>
    {members.length === 0 ? (
      <p class="empty-state">No member data for this week.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Sessions</th>
            <th>Turns</th>
            <th>Files Edited</th>
            <th>Files Written</th>
            <th>Commits</th>
            <th>Errors</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr>
              <td>{m.member_name}</td>
              <td>{m.sessions}</td>
              <td>{m.total_turns}</td>
              <td>{m.total_files_edited}</td>
              <td>{m.total_files_written}</td>
              <td>{m.commit_sessions}</td>
              <td>{m.total_tool_errors}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const ToolHeatmap: FC<{ entries: ToolHeatmapEntry[] }> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div class="section">
        <h2>Tool Usage Heatmap</h2>
        <p class="empty-state">No tool usage data for this week.</p>
      </div>
    );
  }

  const toolSet = new Set<string>();
  const memberSet = new Set<string>();
  const lookup = new Map<string, number>();
  let maxCount = 0;
  for (const e of entries) {
    toolSet.add(e.tool_name);
    memberSet.add(e.member_name);
    lookup.set(`${e.tool_name}:${e.member_name}`, e.usage_count);
    if (e.usage_count > maxCount) maxCount = e.usage_count;
  }
  const tools = [...toolSet];
  const members = [...memberSet];

  const intensity = (count: number) => {
    if (count === 0) return "transparent";
    const alpha = Math.round((count / maxCount) * 200 + 55);
    return `rgba(77, 171, 247, ${alpha / 255})`;
  };

  return (
    <div class="section">
      <h2>Tool Usage Heatmap</h2>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            {members.map((m) => <th class="heatmap-cell">{m}</th>)}
          </tr>
        </thead>
        <tbody>
          {tools.map((tool) => (
            <tr>
              <td>{tool}</td>
              {members.map((member) => {
                const count = lookup.get(`${tool}:${member}`) ?? 0;
                return (
                  <td class="heatmap-cell" style={`background-color: ${intensity(count)}`}>
                    {count || ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const AnomalySection: FC<{ sessions: AnomalousSession[] }> = ({ sessions }) => (
  <div class="section">
    <h2>Anomalous Sessions</h2>
    {sessions.length === 0 ? (
      <p class="empty-state">No anomalies detected this week.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Session</th>
            <th>Project</th>
            <th>Turns</th>
            <th>Duration</th>
            <th>Edited</th>
            <th>Errors</th>
            <th>Reasons</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr class="anomaly-row">
              <td>{s.member_name}</td>
              <td>{s.session_name || "(unnamed)"}</td>
              <td>{s.project || "-"}</td>
              <td>{s.turns}</td>
              <td>{s.duration_minutes}m</td>
              <td>{s.files_edited}</td>
              <td>{s.tool_errors}</td>
              <td>
                {getAnomalyReasons(s).map((r) => (
                  <span class="anomaly-tag">{r}</span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const SkillSection: FC<{ skills: SkillUsageEntry[] }> = ({ skills }) => (
  <div class="section">
    <h2>Skill Usage</h2>
    {skills.length === 0 ? (
      <p class="empty-state">No skills were used this week.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Skill</th>
            <th>Sessions</th>
            <th>Used By</th>
          </tr>
        </thead>
        <tbody>
          {skills.map((s) => (
            <tr>
              <td>{s.skill_name}</td>
              <td>{s.session_count}</td>
              <td>{s.members}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const CostTrendSection: FC<{ costs: DailyCostEntry[]; fromDate: string }> = ({ costs, fromDate }) => {
  const monday = new Date(fromDate + "T00:00:00Z");
  const days: { date: string; label: string; cost: number }[] = [];
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const costMap = new Map<string, number>();
  for (const c of costs) {
    costMap.set(c.date, c.total_cost_usd);
  }

  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    days.push({
      date: dateStr,
      label: dayNames[i],
      cost: costMap.get(dateStr) ?? 0,
    });
  }

  const maxCost = Math.max(...days.map((d) => d.cost), 0.01);
  const hasCosts = costs.length > 0;

  return (
    <div class="section">
      <h2>Cost Trend</h2>
      {!hasCosts ? (
        <p class="empty-state">No cost data available for this week.</p>
      ) : (
        <div class="cost-chart">
          <div class="bar-chart">
            {days.map((d) => (
              <div class="bar-item">
                <div class="bar-value">${d.cost.toFixed(2)}</div>
                <div class="bar" style={`height: ${(d.cost / maxCost) * 120}px`} />
                <div class="bar-label">{d.label}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

// --- Main Layout ---

const WeeklyReportPage: FC<{
  week: string;
  fromDate: string;
  toDate: string;
  overview: WeeklyOverviewData;
  members: MemberComparisonData[];
  toolHeatmap: ToolHeatmapEntry[];
  anomalies: AnomalousSession[];
  skills: SkillUsageEntry[];
  costs: DailyCostEntry[];
}> = ({ week, fromDate, toDate, overview, members, toolHeatmap, anomalies, skills, costs }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Weekly Report — {week}</title>
      <style>{CSS}</style>
    </head>
    <body>
      <div class="container">
        <h1>Team AI Usage Weekly Report</h1>
        <p class="subtitle">{week} ({fromDate} ~ {toDate})</p>
        {overview.total_sessions === 0 ? (
          <p class="empty-state">No data available for this week.</p>
        ) : (
          <>
            <OverviewSection data={overview} />
            <MemberTable members={members} />
            <ToolHeatmap entries={toolHeatmap} />
            <AnomalySection sessions={anomalies} />
            <SkillSection skills={skills} />
            <CostTrendSection costs={costs} fromDate={fromDate} />
          </>
        )}
      </div>
    </body>
  </html>
);

// --- Route ---

const weeklyReport = new Hono<AppEnv>();

weeklyReport.use("*", dashboardAuth());

weeklyReport.get("/", (c) => {
  const weekParam = c.req.query("week");
  const week = weekParam || getCurrentWeek();

  if (!WEEK_REGEX.test(week)) {
    return c.json({ error: "week must be in YYYY-Www format (e.g., 2026-W15)" }, 400);
  }

  const { from, to, fromDate, toDate } = getWeekDateRange(week);
  const db = c.get("db");

  const overview = getWeeklyOverview(db, from, to);
  const members = getMemberComparison(db, from, to);
  const toolHeatmap = getToolHeatmap(db, from, to);
  const anomalies = getAnomalousSessions(db, from, to);
  const skills = getSkillUsageSummary(db, from, to);
  const costs = getWeeklyCostTrend(db, fromDate, toDate);

  const sundayDate = new Date(toDate + "T00:00:00Z");
  sundayDate.setUTCDate(sundayDate.getUTCDate() - 1);
  const toDateDisplay = sundayDate.toISOString().split("T")[0];

  return c.html(
    <WeeklyReportPage
      week={week}
      fromDate={fromDate}
      toDate={toDateDisplay}
      overview={overview}
      members={members}
      toolHeatmap={toolHeatmap}
      anomalies={anomalies}
      skills={skills}
      costs={costs}
    />
  );
});

export default weeklyReport;
export { getWeekDateRange, getCurrentWeek };
