import { Hono } from "hono";
import type { FC } from "hono/jsx";
import { dashboardAuth } from "../middleware/dashboard-auth";
import {
  getWeeklyOverview,
  getSessionDistribution,
  getHighlights,
  getProjectActivity,
  getSessionLog,
  getSkillUsageSummary,
  getUnusedSkills,
  type WeeklyOverview as WeeklyOverviewData,
  type SessionDistribution,
  type WeeklyHighlights,
  type ProjectActivityEntry,
  type SessionLogEntry,
  type SkillUsageEntry,
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


const CSS = `
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
    line-height: 1.6;
  }

  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(0,0,0,0.15) 2px, rgba(0,0,0,0.15) 4px);
    pointer-events: none;
    z-index: 9999;
  }

  body::after {
    content: '';
    position: fixed;
    inset: 0;
    background-image: radial-gradient(circle at 1px 1px, rgba(255,255,255,0.015) 1px, transparent 0);
    background-size: 4px 4px;
    pointer-events: none;
    z-index: 1;
  }

  .container {
    max-width: 960px;
    margin: 0 auto;
    padding: 2rem 1.5rem;
    position: relative;
    z-index: 2;
  }

  h1 {
    font-family: var(--font-display);
    font-size: 2.25rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 0.25rem;
  }

  h1 span { color: var(--brand-primary); text-shadow: var(--neon-shadow); }

  .subtitle {
    font-family: var(--font-mono);
    color: var(--text-dim);
    font-size: 0.7rem;
    letter-spacing: 0.12em;
    margin-bottom: 2rem;
  }

  .section {
    background: var(--bg-card);
    border: 1px solid var(--border-dim);
    padding: 1.5rem;
    margin-bottom: 1.5rem;
    position: relative;
    overflow: hidden;
  }

  .section::before {
    content: '';
    position: absolute;
    top: -1px;
    left: 0;
    right: 0;
    height: 1px;
    background: linear-gradient(90deg, var(--brand-primary), transparent 60%);
    box-shadow: var(--neon-shadow);
  }

  .section h2 {
    font-family: var(--font-display);
    font-size: 1.4rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--brand-primary);
    text-shadow: 0 0 8px var(--brand-glow);
    margin-bottom: 1rem;
  }

  table { width: 100%; border-collapse: collapse; font-size: 0.75rem; }

  th {
    font-family: var(--font-mono);
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: var(--text-dim);
    text-align: left;
    padding: 0.6rem 0.8rem;
    border-bottom: 1px solid var(--border-glow);
  }

  td {
    font-family: var(--font-mono);
    padding: 0.5rem 0.8rem;
    border-bottom: 1px solid var(--border-dim);
    color: var(--text-secondary);
  }

  tr:hover td { background: var(--brand-glow-faint); }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 1px;
    background: var(--border-dim);
    border: 1px solid var(--border-glow);
    margin-bottom: 1rem;
  }

  .stat-card {
    background: var(--bg-card);
    text-align: center;
    padding: 1.25rem;
    position: relative;
  }

  .stat-card::before {
    content: '';
    position: absolute;
    top: 0; left: 0; width: 100%; height: 100%;
    background: linear-gradient(135deg, var(--brand-glow-faint), transparent 40%);
    pointer-events: none;
  }

  .stat-value {
    font-family: var(--font-display);
    font-size: 2rem;
    font-weight: 700;
    color: var(--text-primary);
    line-height: 1;
  }

  .stat-label {
    font-family: var(--font-mono);
    font-size: 0.55rem;
    text-transform: uppercase;
    letter-spacing: 0.2em;
    color: var(--text-dim);
    margin-top: 0.5rem;
  }

  .empty-state {
    font-family: var(--font-mono);
    color: var(--text-dim);
    text-align: center;
    padding: 2rem;
    font-size: 0.75rem;
    letter-spacing: 0.1em;
  }

  .dist-bar { display: flex; height: 24px; margin: 0.75rem 0; overflow: hidden; border: 1px solid var(--border-dim); }
  .dist-seg { display: flex; align-items: center; justify-content: center; font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-primary); min-width: 2px; }
  .dist-quick { background: #166534; }
  .dist-medium { background: #1e40af; }
  .dist-deep { background: #7c2d12; }
  .dist-marathon { background: #dc2626; box-shadow: inset 0 0 10px var(--brand-glow); }

  .dist-legend { display: flex; gap: 1rem; font-family: var(--font-mono); font-size: 0.6rem; color: var(--text-secondary); flex-wrap: wrap; }
  .dist-legend-item { display: flex; align-items: center; gap: 0.35rem; }
  .dist-dot { width: 8px; height: 8px; }

  .highlights { margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-dim); }
  .highlight-item { font-family: var(--font-mono); font-size: 0.7rem; color: var(--text-secondary); padding: 0.25rem 0; }
  .highlight-value { color: var(--text-primary); }

  .ctx-warn { color: var(--brand-primary); text-shadow: 0 0 6px var(--brand-glow); }

  .skill-rank { font-family: var(--font-display); font-size: 1.2rem; color: var(--text-dim); margin-right: 0.5rem; }
  .unused-list { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-top: 0.5rem; }
  .unused-tag { font-family: var(--font-mono); font-size: 0.65rem; padding: 0.2rem 0.6rem; border: 1px solid var(--border-dim); color: var(--text-dim); }
`;

// --- Section Components ---

const OverviewSection: FC<{
  data: WeeklyOverviewData;
  distribution: SessionDistribution;
  highlights: WeeklyHighlights;
}> = ({ data, distribution, highlights }) => {
  const total = distribution.quick + distribution.medium + distribution.deep + distribution.marathon;
  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(0)}%` : "0%");

  return (
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
          <div class="stat-value">{data.active_members}</div>
          <div class="stat-label">Active Members</div>
        </div>
      </div>

      {total > 0 && (
        <>
          <div class="dist-bar">
            {distribution.quick > 0 && (
              <div class="dist-seg dist-quick" style={`width: ${pct(distribution.quick)}`}>
                {distribution.quick}
              </div>
            )}
            {distribution.medium > 0 && (
              <div class="dist-seg dist-medium" style={`width: ${pct(distribution.medium)}`}>
                {distribution.medium}
              </div>
            )}
            {distribution.deep > 0 && (
              <div class="dist-seg dist-deep" style={`width: ${pct(distribution.deep)}`}>
                {distribution.deep}
              </div>
            )}
            {distribution.marathon > 0 && (
              <div class="dist-seg dist-marathon" style={`width: ${pct(distribution.marathon)}`}>
                {distribution.marathon}
              </div>
            )}
          </div>
          <div class="dist-legend">
            <div class="dist-legend-item"><div class="dist-dot dist-quick" />&lt;15m Quick</div>
            <div class="dist-legend-item"><div class="dist-dot dist-medium" />15-59m Medium</div>
            <div class="dist-legend-item"><div class="dist-dot dist-deep" />60-179m Deep</div>
            <div class="dist-legend-item"><div class="dist-dot dist-marathon" />&gt;=180m Marathon</div>
          </div>
        </>
      )}

      <div class="highlights">
        {highlights.longest_session && (
          <div class="highlight-item">
            Longest session: <span class="highlight-value">{(highlights.longest_session.duration_minutes / 60).toFixed(1)}h</span>
            {highlights.longest_session.project && ` on ${highlights.longest_session.project}`}
          </div>
        )}
        {highlights.most_active_day && (
          <div class="highlight-item">
            Most active day: <span class="highlight-value">{highlights.most_active_day.day_name}</span> with {highlights.most_active_day.count} sessions
          </div>
        )}
        {highlights.most_used_project && (
          <div class="highlight-item">
            Most used project: <span class="highlight-value">{highlights.most_used_project.name}</span> ({highlights.most_used_project.count} sessions)
          </div>
        )}
        {highlights.high_context_sessions > 0 && (
          <div class="highlight-item ctx-warn">
            {highlights.high_context_sessions} session{highlights.high_context_sessions > 1 ? "s" : ""} reached &gt;=70% context window usage
          </div>
        )}
      </div>
    </div>
  );
};

const ProjectActivitySection: FC<{ entries: ProjectActivityEntry[] }> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <div class="section">
        <h2>Project Activity</h2>
        <p class="empty-state">No project data for this week.</p>
      </div>
    );
  }

  const memberNames = [...new Set(entries.map((e) => e.member_name))];
  const isSingleMember = memberNames.length === 1;

  if (isSingleMember) {
    // Flat table: group entries by project
    const projects = new Map<string, ProjectActivityEntry>();
    for (const e of entries) {
      projects.set(e.project, e);
    }
    const sorted = [...projects.values()].sort((a, b) => b.session_count - a.session_count);

    return (
      <div class="section">
        <h2>Project Activity</h2>
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th>Sessions</th>
              <th>Turns</th>
              <th>Edited</th>
              <th>Written</th>
              <th>Commits</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr>
                <td>{p.project}</td>
                <td>{p.session_count}</td>
                <td>{p.turns}</td>
                <td>{p.files_edited}</td>
                <td>{p.files_written}</td>
                <td>{p.commit_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // Multi-member matrix: project rows × member columns
  const projectTotals = new Map<string, number>();
  const lookup = new Map<string, number>();
  for (const e of entries) {
    projectTotals.set(e.project, (projectTotals.get(e.project) ?? 0) + e.session_count);
    lookup.set(`${e.project}:${e.member_name}`, e.session_count);
  }
  const projectsSorted = [...projectTotals.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div class="section">
      <h2>Project Activity</h2>
      <table>
        <thead>
          <tr>
            <th>Project</th>
            {memberNames.map((m) => <th>{m}</th>)}
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {projectsSorted.map(([project, total]) => (
            <tr>
              <td>{project}</td>
              {memberNames.map((m) => (
                <td>{lookup.get(`${project}:${m}`) ?? 0}</td>
              ))}
              <td>{total}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};

const SessionLogSection: FC<{ sessions: SessionLogEntry[] }> = ({ sessions }) => (
  <div class="section">
    <h2>Session Log</h2>
    {sessions.length === 0 ? (
      <p class="empty-state">No sessions recorded this week.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Session</th>
            <th>Project</th>
            <th>Duration</th>
            <th>Turns</th>
            <th>Model</th>
            <th>Context %</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr>
              <td>{s.member_name}</td>
              <td>{s.session_name || "(unnamed)"}</td>
              <td>{s.project || "-"}</td>
              <td>{s.duration_minutes}m</td>
              <td>{s.turns}</td>
              <td>{s.model || "-"}</td>
              <td class={s.context_estimate_pct >= 70 ? "ctx-warn" : ""}>
                {s.context_estimate_pct === 0 ? "\u2014" : `${s.context_estimate_pct}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </div>
);

const SkillSection: FC<{ skills: SkillUsageEntry[]; unusedSkills: string[] }> = ({ skills, unusedSkills }) => (
  <div class="section">
    <h2>Skill Usage</h2>
    {skills.length === 0 && unusedSkills.length === 0 ? (
      <p class="empty-state">No skill data available.</p>
    ) : (
      <>
        {skills.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Skill</th>
                <th>Sessions</th>
                <th>Used By</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s, i) => (
                <tr>
                  <td><span class="skill-rank">{i + 1}</span></td>
                  <td>{s.skill_name}</td>
                  <td>{s.session_count}</td>
                  <td>{s.members}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {skills.length === 0 && (
          <p class="empty-state">No skills were used this week.</p>
        )}
        {unusedSkills.length > 0 && (
          <div style="margin-top: 1rem; padding-top: 1rem; border-top: 1px solid var(--border-dim);">
            <div style="font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.15em; color: var(--text-dim); margin-bottom: 0.5rem;">
              Unused Skills
            </div>
            <div class="unused-list">
              {unusedSkills.map((s) => (
                <span class="unused-tag">{s}</span>
              ))}
            </div>
          </div>
        )}
      </>
    )}
  </div>
);

// --- Main Layout ---

const WeeklyReportPage: FC<{
  week: string;
  fromDate: string;
  toDate: string;
  overview: WeeklyOverviewData;
  distribution: SessionDistribution;
  highlights: WeeklyHighlights;
  projectActivity: ProjectActivityEntry[];
  sessionLog: SessionLogEntry[];
  skills: SkillUsageEntry[];
  unusedSkills: string[];
}> = ({ week, fromDate, toDate, overview, distribution, highlights, projectActivity, sessionLog, skills, unusedSkills }) => (
  <html>
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Weekly Report — {week}</title>
      <style>{CSS}</style>
    </head>
    <body>
      <div class="container">
        <h1>Weekly <span>Report</span></h1>
        <p class="subtitle">{week} ({fromDate} ~ {toDate})</p>
        {overview.total_sessions === 0 ? (
          <p class="empty-state">No data available for this week.</p>
        ) : (
          <>
            <OverviewSection data={overview} distribution={distribution} highlights={highlights} />
            <ProjectActivitySection entries={projectActivity} />
            <SessionLogSection sessions={sessionLog} />
            <SkillSection skills={skills} unusedSkills={unusedSkills} />
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
  const distribution = getSessionDistribution(db, from, to);
  const highlights = getHighlights(db, from, to);
  const projectActivity = getProjectActivity(db, from, to);
  const sessionLog = getSessionLog(db, from, to);
  const skills = getSkillUsageSummary(db, from, to);
  const unusedSkills = getUnusedSkills(db, from, to);

  const sundayDate = new Date(toDate + "T00:00:00Z");
  sundayDate.setUTCDate(sundayDate.getUTCDate() - 1);
  const toDateDisplay = sundayDate.toISOString().split("T")[0];

  return c.html(
    <WeeklyReportPage
      week={week}
      fromDate={fromDate}
      toDate={toDateDisplay}
      overview={overview}
      distribution={distribution}
      highlights={highlights}
      projectActivity={projectActivity}
      sessionLog={sessionLog}
      skills={skills}
      unusedSkills={unusedSkills}
    />
  );
});

export default weeklyReport;
export { getWeekDateRange, getCurrentWeek };
