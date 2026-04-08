## ADDED Requirements

### Requirement: Generate weekly report via API

The system SHALL provide a `GET /api/report/weekly` endpoint that returns a server-side rendered HTML page containing aggregated session analytics for a specified week.

The endpoint SHALL accept the following query parameters:
- `week` (string, optional) — ISO week format `YYYY-Www` (e.g., `2026-W15`). Defaults to the current week if omitted.

The endpoint SHALL use the `dashboard-auth` middleware for authentication (same as existing dashboard).

#### Scenario: Retrieve current week report

- **WHEN** a GET request is sent to `/api/report/weekly` without a `week` parameter and valid dashboard auth
- **THEN** the system SHALL return HTTP 200 with an HTML page containing analytics for the current ISO week

#### Scenario: Retrieve specific week report

- **WHEN** a GET request is sent to `/api/report/weekly?week=2026-W15` with valid dashboard auth
- **THEN** the system SHALL return HTTP 200 with an HTML page containing analytics for the week of 2026-W15

#### Scenario: Invalid week format

- **WHEN** a GET request is sent with `week=2026-15` (missing 'W' prefix) or `week=invalid`
- **THEN** the system SHALL return HTTP 400 with an error indicating the expected format is `YYYY-Www`

#### Scenario: No data for requested week

- **WHEN** a GET request is sent for a week with zero session_metrics records
- **THEN** the system SHALL return HTTP 200 with an HTML page showing an empty state message indicating no data is available for that week

#### Scenario: Unauthenticated access

- **WHEN** a GET request is sent without valid dashboard auth
- **THEN** the system SHALL return HTTP 401

### Requirement: Report overview section

The weekly report HTML SHALL include an overview section displaying the following aggregated metrics for the requested week:
- Total number of sessions
- Total duration in hours (sum of duration_minutes / 60, rounded to 1 decimal)
- Commit rate (percentage of sessions where has_commit is true)
- Average turns per session
- Total tool errors across all sessions

#### Scenario: Overview with mixed sessions

- **WHEN** the week contains 10 sessions with total duration 480 minutes, 6 sessions with commits, average 15 turns, and 3 total tool errors
- **THEN** the overview section SHALL display: 10 sessions, 8.0 hours, 60% commit rate, 15.0 avg turns, 3 errors

#### Scenario: Overview with single session

- **WHEN** the week contains 1 session of 30 minutes, 0 commits, 5 turns, 0 errors
- **THEN** the overview section SHALL display: 1 session, 0.5 hours, 0% commit rate, 5.0 avg turns, 0 errors

### Requirement: Member comparison table

The weekly report SHALL include a member comparison section displaying a table with one row per member who has session data in the requested week. Each row SHALL contain:
- Member name
- Number of sessions
- Total turns
- Total files edited
- Total files written
- Number of sessions with commits
- Total tool errors

The table SHALL be sorted by total turns in descending order.

#### Scenario: Multiple members in same week

- **WHEN** member "alice" has 5 sessions with 80 total turns and member "bob" has 3 sessions with 120 total turns
- **THEN** the table SHALL show "bob" first (120 turns) and "alice" second (80 turns)

#### Scenario: Single member

- **WHEN** only one member has sessions in the week
- **THEN** the table SHALL display one row with that member's aggregated metrics

### Requirement: Tool usage heatmap

The weekly report SHALL include a tool usage section displaying a matrix of tool usage counts per member. The matrix rows SHALL represent tools (sorted by total usage descending), and columns SHALL represent members. Each cell SHALL display the usage count and use background color intensity proportional to the count relative to the maximum cell value.

#### Scenario: Tool heatmap rendering

- **WHEN** member "alice" used Bash 20 times and Read 10 times, and member "bob" used Bash 5 times and Edit 15 times
- **THEN** the heatmap SHALL show 3 tool rows (Bash, Edit, Read) and 2 member columns with the corresponding counts, where the cell with value 20 has the most intense background color

#### Scenario: No tool usage

- **WHEN** all sessions in the week have empty tool_calls
- **THEN** the tool usage section SHALL display a message indicating no tool usage data

### Requirement: Anomalous session detection

The weekly report SHALL include an anomalous sessions section listing sessions that meet ANY of the following criteria:
- High turns with low output: turns >= 20 AND files_edited + files_written == 0
- Error-heavy: tool_errors >= 5
- Long duration with no commit: duration_minutes >= 60 AND has_commit == 0

Each anomalous session entry SHALL display: member name, session name, project, turns, duration, files edited, tool errors, and the anomaly reason(s).

#### Scenario: Session with multiple anomaly reasons

- **WHEN** a session has 25 turns, 0 files edited, 0 files written, 7 tool errors, and duration 90 minutes with no commit
- **THEN** the session SHALL appear in the anomalous list with all three reasons: high turns with low output, error-heavy, and long duration with no commit

#### Scenario: No anomalous sessions

- **WHEN** no sessions in the week meet any anomaly criteria
- **THEN** the section SHALL display a message indicating no anomalies detected

### Requirement: Skill usage summary

The weekly report SHALL include a skill usage section displaying each unique skill invoked during the week, with the count of sessions that used it and the list of members who used it. Skills SHALL be sorted by usage count descending.

#### Scenario: Skills used by multiple members

- **WHEN** skill "commit" was used in 8 sessions by members "alice" and "bob", and skill "review-pr" was used in 2 sessions by "alice" only
- **THEN** the skill list SHALL show "commit" first (8 sessions, alice + bob) and "review-pr" second (2 sessions, alice)

#### Scenario: No skills used

- **WHEN** all sessions in the week have empty skills_invoked arrays
- **THEN** the section SHALL display a message indicating no skills were used

### Requirement: Cost trend integration

The weekly report SHALL include a cost trend section that combines data from `usage_records` (existing table) to display daily cost for the requested week. The visualization SHALL show a simple chart (inline SVG or CSS bars) with one data point per day, displaying the total_cost_usd summed across all members for each date.

#### Scenario: Full week with cost data

- **WHEN** the requested week has usage_records for all 7 days with varying costs
- **THEN** the cost trend section SHALL display 7 data points, one per day (Monday through Sunday), each showing the daily total cost in USD

#### Scenario: Partial week data

- **WHEN** the requested week has usage_records for only 3 of 7 days
- **THEN** the cost trend section SHALL display 7 data points with zero values for days without data

#### Scenario: No cost data

- **WHEN** no usage_records exist for the requested week
- **THEN** the cost trend section SHALL display a message indicating no cost data available
