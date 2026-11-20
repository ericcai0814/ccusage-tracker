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
  getWeeklyCost,
  type WeeklyOverview as WeeklyOverviewData,
  type SessionDistribution,
  type WeeklyHighlights,
  type ProjectActivityEntry,
  type SessionLogEntry,
  type SkillUsageEntry,
  type WeeklyCost,
} from "../queries";
import type { AppEnv } from "../app";
import { THEME_CSS, WEEKLY_CSS, FONT_LINKS } from "./ui-theme";

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


// --- Section Components ---

function formatCost(n: number): string {
  return `$${n.toFixed(2)}`;
}

function formatTokensShort(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(0)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const OverviewSection: FC<{
  data: WeeklyOverviewData;
  distribution: SessionDistribution;
  highlights: WeeklyHighlights;
  cost: WeeklyCost;
}> = ({ data, distribution, highlights, cost }) => {
  const total = distribution.quick + distribution.medium + distribution.deep + distribution.marathon;
  const pct = (n: number) => (total > 0 ? `${((n / total) * 100).toFixed(0)}%` : "0%");

  return (
    <section class="panel section">
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
        <div class="stat-card">
          <div class="stat-value">{cost.total_cost > 0 ? formatCost(cost.total_cost) : "\u2014"}</div>
          <div class="stat-label">Cost ({formatTokensShort(cost.total_tokens)} tokens)</div>
          {cost.total_cost > 0 && (
            <a href="/" class="cost-link">
              看明細
              <span class="icon icon-arrow-right" aria-hidden="true" />
            </a>
          )}
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
            <div class="dist-legend-item"><div class="dist-dot dist-quick" />Quick <span class="mono">&lt;15m</span></div>
            <div class="dist-legend-item"><div class="dist-dot dist-medium" />Medium <span class="mono">15–59m</span></div>
            <div class="dist-legend-item"><div class="dist-dot dist-deep" />Deep <span class="mono">60–179m</span></div>
            <div class="dist-legend-item"><div class="dist-dot dist-marathon" />Marathon <span class="mono">≥180m</span></div>
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
    </section>
  );
};

const ProjectActivitySection: FC<{ entries: ProjectActivityEntry[] }> = ({ entries }) => {
  if (entries.length === 0) {
    return (
      <section class="panel section">
        <h2>Project Activity</h2>
        <p class="empty-state">No project data for this week</p>
      </section>
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
      <section class="panel section">
        <h2>Project Activity</h2>
        <div class="table-wrapper">
        <table>
          <thead>
            <tr>
              <th>Project</th>
              <th class="num">Sessions</th>
              <th class="num">Turns</th>
              <th class="num">Edited</th>
              <th class="num">Written</th>
              <th class="num">Commits</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p) => (
              <tr>
                <td>{p.project}</td>
                <td class="num">{p.session_count}</td>
                <td class="num">{p.turns}</td>
                <td class="num">{p.files_edited}</td>
                <td class="num">{p.files_written}</td>
                <td class="num">{p.commit_count}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      </section>
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
    <section class="panel section">
      <h2>Project Activity</h2>
      <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Project</th>
            {memberNames.map((m) => <th class="num">{m}</th>)}
            <th class="num">Total</th>
          </tr>
        </thead>
        <tbody>
          {projectsSorted.map(([project, total]) => (
            <tr>
              <td>{project}</td>
              {memberNames.map((m) => (
                <td class="num">{lookup.get(`${project}:${m}`) ?? 0}</td>
              ))}
              <td class="num">{total}</td>
            </tr>
          ))}
        </tbody>
      </table></div>
    </section>
  );
};

const SessionLogSection: FC<{ sessions: SessionLogEntry[] }> = ({ sessions }) => (
  <section class="panel section">
    <h2>Session Log</h2>
    {sessions.length === 0 ? (
      <p class="empty-state">No sessions recorded this week</p>
    ) : (
      <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Member</th>
            <th>Session</th>
            <th>Project</th>
            <th class="num">Duration</th>
            <th class="num">Turns</th>
            <th>Model</th>
            <th class="num">Context %</th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr>
              <td>{s.member_name}</td>
              <td>{s.session_name || "(unnamed)"}</td>
              <td>{s.project || "-"}</td>
              <td class="num">{s.duration_minutes}m</td>
              <td class="num">{s.turns}</td>
              <td>{s.model || "-"}</td>
              <td class={s.context_estimate_pct >= 70 ? "num ctx-warn" : "num"}>
                {s.context_estimate_pct === 0 ? "\u2014" : `${s.context_estimate_pct}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table></div>
    )}
  </section>
);

const SkillSection: FC<{ skills: SkillUsageEntry[]; unusedSkills: string[] }> = ({ skills, unusedSkills }) => (
  <section class="panel section">
    <h2>Skill Usage</h2>
    {skills.length === 0 && unusedSkills.length === 0 ? (
      <p class="empty-state">No skill data available</p>
    ) : (
      <>
        {skills.length > 0 && (
          <div class="table-wrapper">
          <table>
            <thead>
              <tr>
                <th class="rank-col">#</th>
                <th>Skill</th>
                <th class="num">Sessions</th>
                <th>Used By</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((s, i) => (
                <tr>
                  <td><span class="skill-rank">{String(i + 1).padStart(2, "0")}</span></td>
                  <td>{s.skill_name}</td>
                  <td class="num">{s.session_count}</td>
                  <td class="used-by">{s.members.replace(/,\s*/g, ", ")}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {skills.length === 0 && (
          <p class="empty-state">No skills were used this week</p>
        )}
        {unusedSkills.length > 0 && (
          <div class="unused">
            <div class="unused-title">Unused Skills</div>
            <div class="unused-list">
              {unusedSkills.map((s) => (
                <span class="unused-tag">{s}</span>
              ))}
            </div>
          </div>
        )}
      </>
    )}
  </section>
);

// --- Main Layout ---

const ReportFooter: FC = () => (
  <aside class="report-footer">
    <div class="footer-title">Deeper analysis</div>
    <div>Token cost attribution, cache efficiency, subagent breakdown: run <code>/session-report</code> in Claude Code</div>
  </aside>
);

const WeeklyReportPage: FC<{
  week: string;
  fromDate: string;
  toDate: string;
  overview: WeeklyOverviewData;
  distribution: SessionDistribution;
  highlights: WeeklyHighlights;
  cost: WeeklyCost;
  projectActivity: ProjectActivityEntry[];
  sessionLog: SessionLogEntry[];
  skills: SkillUsageEntry[];
  unusedSkills: string[];
}> = ({ week, fromDate, toDate, overview, distribution, highlights, cost, projectActivity, sessionLog, skills, unusedSkills }) => (
  <html lang="zh-Hant">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      <title>Weekly Report — {week}</title>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
      {FONT_LINKS.map((href) => (
        <link rel="stylesheet" href={href} />
      ))}
      <style dangerouslySetInnerHTML={{ __html: THEME_CSS + WEEKLY_CSS }} />
    </head>
    <body>
      <div class="container">
        <header class="topbar">
          <a class="wordmark" href="/">
            <span class="icon icon-terminal" aria-hidden="true" />
            ccusage tracker
            <span class="wordmark-sub">Claude Code ＋ Codex</span>
          </a>
          <nav class="report-nav" aria-label="Pages">
            <a href="/">
              <span class="icon icon-arrow-left" aria-hidden="true" />
              Dashboard
            </a>
            <span class="nav-current" aria-current="page">Weekly Report</span>
          </nav>
        </header>
        <div class="page-head">
          <div>
            <h1 class="page-title">
              <span class="week-badge">{week}</span> 週報
            </h1>
            <p class="page-meta">
              <span class="icon icon-calendar" aria-hidden="true" />
              {fromDate} → {toDate} · 週一到週日
            </p>
          </div>
        </div>
        {overview.total_sessions === 0 ? (
          <p class="empty-state panel">No data available for this week</p>
        ) : (
          <>
            <OverviewSection data={overview} distribution={distribution} highlights={highlights} cost={cost} />
            <ProjectActivitySection entries={projectActivity} />
            <SessionLogSection sessions={sessionLog} />
            <SkillSection skills={skills} unusedSkills={unusedSkills} />
            <ReportFooter />
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
  const cost = getWeeklyCost(db, fromDate, toDate);
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
      cost={cost}
      projectActivity={projectActivity}
      sessionLog={sessionLog}
      skills={skills}
      unusedSkills={unusedSkills}
    />
  );
});

export default weeklyReport;
export { getWeekDateRange, getCurrentWeek };
