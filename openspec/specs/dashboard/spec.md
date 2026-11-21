# dashboard Specification

## Purpose

TBD - created by archiving change 'ccusage-tracker-mvp'. Update Purpose after archive.

## Requirements

### Requirement: Dashboard page

The system SHALL serve an HTML dashboard page at `GET /` that displays team token usage in a table format.

#### Scenario: View dashboard

- **WHEN** a user navigates to the server root URL in a browser
- **THEN** the system SHALL render an HTML page showing a summary table with each member's token usage

#### Scenario: Period switching

- **WHEN** the user clicks a period toggle (today / week / month) on the dashboard
- **THEN** the dashboard SHALL reload with the selected period's data

#### Scenario: Period keyboard shortcuts

- **WHEN** the user presses `D`, `W` or `M` on the dashboard without any modifier key (Meta, Ctrl, Alt, Shift) and focus is not in an input, textarea, select or contenteditable element
- **THEN** the dashboard SHALL navigate to `?period=today`, `?period=week` or `?period=month` respectively; pressing the key of the already active period SHALL do nothing
- **AND** each period keycap SHALL be an `<a>` linking to its `?period=` URL with `aria-keyshortcuts` set to its key, so the keycaps remain working links when JavaScript does not run


<!-- @trace
source: ccusage-tracker-mvp
updated: 2026-03-31
code:
  - packages/server/src/routes/report.ts
  - packages/server/src/app.ts
  - Dockerfile
  - packages/server/src/routes/ingest.ts
  - .dockerignore
  - packages/server/src/routes/dashboard.tsx
  - packages/server/src/queries.ts
  - packages/server/src/middleware/team-auth.ts
  - packages/server/src/scripts.ts
  - README.md
tests:
  - packages/server/src/routes/report.test.ts
  - packages/server/src/routes/ingest.test.ts
  - packages/server/src/routes/dashboard.test.ts
  - packages/server/src/queries.test.ts
-->

---
### Requirement: Dashboard data display

The dashboard SHALL display, in order: a KPI row (total cost, total tokens, active members, Claude conversation turns with a note that the figure covers Claude Code only), the trend chart, the member ranking and provider split, the model table, and the existing member table with one row per member showing name, input tokens, output tokens, cache read tokens, cache creation tokens and estimated cost in USD with a total row. All figures SHALL respect the selected period.

#### Scenario: Summary cards

- **WHEN** the dashboard loads
- **THEN** the page SHALL display KPI cards showing total cost for the period, total token count, number of active members and Claude conversation turns

#### Scenario: Member table

- **WHEN** the dashboard loads
- **THEN** the page SHALL display a table with one row per member, columns for each token type and cost, and a total row at the bottom

#### Scenario: Empty database

- **WHEN** no usage records exist for the period
- **THEN** every section SHALL render its empty-state text and the response SHALL be 200

#### Scenario: KPI comparison with the previous period

- **WHEN** the dashboard loads for a period
- **THEN** each KPI card SHALL show its change against the previous period computed with the same algorithm as the current window shifted back one period: `today` against yesterday (`vs 昨天`), `week` against last Monday through the same weekday (`vs 上週同期`), `month` against the 1st through the same day of last month, clamped to last month's final day (`vs 上月同期`)
- **AND** total cost, total tokens and Claude turns SHALL show a whole-number percentage with `+` or a true minus sign (U+2212), active members SHALL show the head-count difference (`+1 人`), and a change that rounds to zero SHALL read `持平`
- **AND** when the previous value is zero or either value is not finite, the card SHALL show `<previous label>無資料` (e.g. `上月同期無資料`) and never `NaN` or `Infinity`
- **AND** the change text SHALL use the neutral muted color; direction SHALL be carried by the sign only, not by red or green

#### Scenario: Member report status

- **WHEN** a member row appears in the member ranking or the member table
- **THEN** the row SHALL carry a status dot: a filled green dot when `last_seen_at` is within 24 hours, a hollow grey dot when it is older or null
- **AND** each dot SHALL have a text alternative (`aria-label` and `title`): `24 小時內有回報` or `超過 24 小時未回報`
- **AND** the member table's Last Report cell SHALL keep the relative time text, shown in the muted color when stale
- **AND** the folded "others" ranking row and the total row SHALL NOT carry a dot

---
### Requirement: Dashboard authentication (optional)

The dashboard SHALL support optional basic authentication via a `DASHBOARD_PASSWORD` environment variable.

#### Scenario: Password set

- **WHEN** the `DASHBOARD_PASSWORD` environment variable is set
- **THEN** the system SHALL require HTTP Basic Auth (username: `admin`, password: value of env var) to access the dashboard

#### Scenario: Password not set

- **WHEN** the `DASHBOARD_PASSWORD` environment variable is not set
- **THEN** the dashboard SHALL be accessible without authentication


<!-- @trace
source: ccusage-tracker-mvp
updated: 2026-03-31
code:
  - packages/server/src/routes/report.ts
  - packages/server/src/app.ts
  - Dockerfile
  - packages/server/src/routes/ingest.ts
  - .dockerignore
  - packages/server/src/routes/dashboard.tsx
  - packages/server/src/queries.ts
  - packages/server/src/middleware/team-auth.ts
  - packages/server/src/scripts.ts
  - README.md
tests:
  - packages/server/src/routes/report.test.ts
  - packages/server/src/routes/ingest.test.ts
  - packages/server/src/routes/dashboard.test.ts
  - packages/server/src/queries.test.ts
-->

---
### Requirement: Server-side rendering

The dashboard SHALL be rendered server-side using Hono JSX. It SHALL NOT require any client-side JavaScript framework.

#### Scenario: No JS framework dependency

- **WHEN** the dashboard HTML is served
- **THEN** the page SHALL function without client-side JavaScript (progressive enhancement allowed for period switching)

<!-- @trace
source: ccusage-tracker-mvp
updated: 2026-03-31
code:
  - packages/server/src/routes/report.ts
  - packages/server/src/app.ts
  - Dockerfile
  - packages/server/src/routes/ingest.ts
  - .dockerignore
  - packages/server/src/routes/dashboard.tsx
  - packages/server/src/queries.ts
  - packages/server/src/middleware/team-auth.ts
  - packages/server/src/scripts.ts
  - README.md
tests:
  - packages/server/src/routes/report.test.ts
  - packages/server/src/routes/ingest.test.ts
  - packages/server/src/routes/dashboard.test.ts
  - packages/server/src/queries.test.ts
-->

---
### Requirement: Overview trend chart

The dashboard SHALL render a daily cost trend for the selected period as an inline SVG with one line per source in the source table (`packages/server/src/sources.ts`; currently Claude Code, Codex and Antigravity) that has data in the period, in table order, with records whose `session_id` is not in the table shown as a separate Other line, a legend that is always present, and a direct label at the end of each line. Each data point SHALL carry a `<title>` with the date and value. The chart SHALL use a single y axis. When the period contains a single day, the dashboard SHALL render a bar comparison with one bar per source that has data that day instead of lines.

#### Scenario: Month view with all three sources

- **WHEN** the dashboard loads with `period=month` and `daily`, `codex-daily` and `antigravity-daily` records exist
- **THEN** the HTML SHALL contain one `<svg>` with three `<path>` elements and the legend texts `Claude Code`, `Codex` and `Antigravity` in that order

#### Scenario: Single-day period

- **WHEN** the dashboard loads with `period=today`
- **THEN** the HTML SHALL NOT contain a trend `<path>` and SHALL contain one bar per source that has data that day

---
### Requirement: Rankings and provider split

The dashboard SHALL render a member ranking sorted by cost with a single-hue horizontal bar per member (at most 10 rows, the rest folded into one "others" row), a provider split that maps each source in the source table to its provider (currently `daily` to Anthropic, `codex-daily` to OpenAI and `antigravity-daily` to Google) as a stacked bar with one segment per source that has data, each labelled with its provider, amounts and percentages, and a model table listing each model's source, distinct days present and distinct members.

#### Scenario: Ranking order

- **WHEN** three members have costs 30, 10 and 20 in the period
- **THEN** the ranking SHALL list them in the order 30, 20, 10 with bar widths proportional to cost

#### Scenario: Provider percentages

- **WHEN** Claude records total 75 USD and Codex records total 25 USD in the period
- **THEN** the provider split SHALL show Anthropic 75% and OpenAI 25%

#### Scenario: Model presence

- **WHEN** model `claude-opus-5` appears in records on 3 distinct dates for 2 distinct members
- **THEN** the model table SHALL show days 3 and members 2 for that model

#### Scenario: Malformed models column

- **WHEN** a usage record's `models` column is not a JSON array
- **THEN** the dashboard SHALL skip that record in the model table and SHALL still render the page

---
### Requirement: Budget reference

When a monthly budget is set and the period is `month`, the total cost KPI SHALL show the percentage used, the budget amount, the daily average and the month-end projection, with a same-hue meter. When the projection exceeds the budget by more than 10% the note SHALL carry a critical label and symbol; when it exceeds by 0 to 10% a warning label and symbol; the label text SHALL be present in the HTML, never color alone. When no budget is set, or the period is not `month`, the dashboard SHALL NOT show any budget text.

#### Scenario: Budget set and on track

- **WHEN** the monthly budget is 2000 and month-to-date cost projects to 1500
- **THEN** the cost KPI SHALL contain `預算`, `已用`, `月底推估` and no warning or critical label

#### Scenario: Projection over budget

- **WHEN** the monthly budget is 1000 and the projection is 1200
- **THEN** the cost KPI SHALL contain a critical label and symbol

#### Scenario: No budget

- **WHEN** no monthly budget is stored
- **THEN** the HTML SHALL NOT contain `預算`
