# weekly-report Specification

## Purpose

TBD - created by archiving change 'weekly-report-redesign'. Update Purpose after archive.

## Requirements

### Requirement: Report overview with three-layer structure

The weekly report overview section SHALL display three layers:

1. **Activity summary**: total sessions, total hours (sum of duration_minutes / 60, rounded to 1 decimal), and count of active members (distinct member_id with at least one session in the week).
2. **Session distribution bar**: sessions grouped by duration into four categories — Quick (< 15 min), Medium (15–59 min), Deep (60–179 min), Marathon (>= 180 min). Each category SHALL display the session count and a proportional bar segment.
3. **Highlights**: automatically generated observational insights based on the week's data. Highlights SHALL report extremes and differences (e.g., "Longest session: 3.2h on project X", "Most active day: Wednesday with 8 sessions") without making value judgments about session quality.

#### Scenario: Overview with varied sessions

- **WHEN** the week contains 12 sessions from 2 members, total duration 960 minutes, with durations [5, 10, 20, 30, 45, 60, 90, 120, 150, 180, 200, 50]
- **THEN** the overview SHALL display: 12 sessions, 16.0 hours, 2 active members; distribution bar with Quick: 2, Medium: 4, Deep: 4, Marathon: 2

#### Scenario: Overview with single short session

- **WHEN** the week contains 1 session of 8 minutes from 1 member
- **THEN** the overview SHALL display: 1 session, 0.1 hours, 1 active member; distribution bar with Quick: 1, Medium: 0, Deep: 0, Marathon: 0


<!-- @trace
source: weekly-report-redesign
updated: 2026-04-10
code:
  - .spectra.yaml
-->

---
### Requirement: Highlights generation

The overview highlights SHALL be generated server-side and SHALL include the following observations when applicable:

- Longest session (duration and project name)
- Most active day of the week (day name and session count)
- Most used project (project name and session count)
- Sessions with context_estimate_pct >= 70 (count and warning that tasks could benefit from splitting)

Each highlight SHALL be a factual observation. The system SHALL NOT use evaluative language such as "good", "bad", "concerning", or "problematic".

#### Scenario: Highlights with high context usage

- **WHEN** the week contains 10 sessions, 3 of which have context_estimate_pct >= 70
- **THEN** the highlights SHALL include an observation stating that 3 sessions reached >= 70% context window usage

#### Scenario: No notable patterns

- **WHEN** the week contains 1 session with no extreme values
- **THEN** the highlights section SHALL display at least the longest session observation (even if there is only one session)


<!-- @trace
source: weekly-report-redesign
updated: 2026-04-10
code:
  - .spectra.yaml
-->

---
### Requirement: Project activity section

The weekly report SHALL include a project activity section that replaces the former member comparison table.

- **Single member**: the section SHALL display a flat table of projects with columns — project name, session count, total turns, total files edited, total files written, commit count — sorted by session count descending.
- **Multiple members**: the section SHALL display a Member x Project matrix with rows as projects (sorted by total session count descending) and columns as members. Each cell SHALL show the session count for that member-project combination. A total column SHALL be included.

#### Scenario: Single member with multiple projects

- **WHEN** member "eric" has 5 sessions on project "api-server" and 3 sessions on project "dashboard"
- **THEN** the section SHALL display a flat table with "api-server" first (5 sessions) and "dashboard" second (3 sessions), each row showing turns, files edited, files written, and commit count

#### Scenario: Multiple members with overlapping projects

- **WHEN** member "alice" has 4 sessions on "api-server" and member "bob" has 2 sessions on "api-server" and 3 sessions on "docs"
- **THEN** the section SHALL display a matrix with projects as rows: "api-server" (total 6), "docs" (total 3); columns: alice, bob, total

#### Scenario: No project data

- **WHEN** all sessions in the week have empty project fields
- **THEN** the section SHALL group all sessions under a "(no project)" row


<!-- @trace
source: weekly-report-redesign
updated: 2026-04-10
code:
  - .spectra.yaml
-->

---
### Requirement: Session log with context percentage

The weekly report SHALL include a session log section that replaces the former anomalous sessions section. The session log SHALL list ALL sessions for the requested week (not filtered by anomaly criteria) in a table with the following columns:

- Member name
- Session name (display "(unnamed)" if empty)
- Project (display "-" if empty)
- Duration (in minutes)
- Turns
- Model (from session_metrics.model column)
- Context % (from session_metrics.context_estimate_pct column)

Sessions SHALL be sorted by started_at descending (most recent first).

Sessions with context_estimate_pct >= 70 SHALL have the Context % cell visually highlighted (e.g., red text or warning background) to indicate potential context window pressure.

#### Scenario: Session log with mixed context percentages

- **WHEN** the week contains sessions with context_estimate_pct values [15, 45, 72, 88, 30]
- **THEN** the session log SHALL list all 5 sessions, with the 72% and 88% rows having highlighted Context % cells

#### Scenario: Session log with legacy data

- **WHEN** sessions exist with context_estimate_pct = 0 (pre-hook data without context tracking)
- **THEN** the session log SHALL display "—" for the Context % cell instead of "0%"

#### Scenario: Empty week

- **WHEN** no sessions exist for the requested week
- **THEN** the session log SHALL display an empty state message


<!-- @trace
source: weekly-report-redesign
updated: 2026-04-10
code:
  - .spectra.yaml
-->

---
### Requirement: Skill usage with unused detection

The weekly report skill usage section SHALL display two sub-sections:

1. **Top skills**: a ranked list of skills invoked during the week, sorted by invocation count descending. Each entry SHALL show: skill name, invocation count (number of sessions that used it), and list of members who used it.
2. **Unused skills**: a list of skills that are installed (appeared in any prior week's data in session_metrics.skills_invoked) but were NOT invoked during the current week.

#### Scenario: Skills with unused detection

- **WHEN** the current week has skills ["commit", "plan", "review-pr"] invoked, and historical data shows skills ["commit", "plan", "review-pr", "tdd", "architect"] have been used in prior weeks
- **THEN** the top skills list SHALL show "commit", "plan", "review-pr" with counts; the unused skills list SHALL show "tdd" and "architect"

#### Scenario: All historical skills used this week

- **WHEN** every skill that has appeared in historical data was also used this week
- **THEN** the unused skills sub-section SHALL be omitted or display "All skills active this week"

#### Scenario: No skills used at all

- **WHEN** no skills were invoked this week and historical data has ["commit", "plan"]
- **THEN** the top skills list SHALL display an empty state; the unused skills list SHALL show "commit" and "plan"


<!-- @trace
source: weekly-report-redesign
updated: 2026-04-10
code:
  - .spectra.yaml
-->

---
### Requirement: S29 Cyber-Bio Noir visual style

The weekly report SHALL use the S29 Cyber-Bio Noir visual style consistent with the existing dashboard. The report SHALL:

- Use CSS custom properties matching the dashboard: `--bg-primary: #050505`, `--brand-primary: #dc2626`, `--text-primary: #ffffff`, and related tokens
- Use the same font stack: Teko (display), Michroma (body), Share Tech Mono (monospace)
- Apply the CRT scanline overlay and carbon fiber texture effects
- Use neon glow effects (`--neon-shadow`) for section headers and accent elements
- Use dark card backgrounds (`--bg-card: #0a0a0a`) with subtle border glow

#### Scenario: Visual consistency with dashboard

- **WHEN** the weekly report is rendered
- **THEN** the page background SHALL be `#050505`, text SHALL be white (`#ffffff`), and accent elements SHALL use red (`#dc2626`) with glow effects

<!-- @trace
source: weekly-report-redesign
updated: 2026-04-10
code:
  - .spectra.yaml
-->