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

The dashboard SHALL display the following data for each member: name, input tokens, output tokens, cache read tokens, cache creation tokens, and estimated cost in USD.

#### Scenario: Summary cards

- **WHEN** the dashboard loads
- **THEN** the page SHALL display summary cards showing: total cost for the period, total token count, and number of active members

#### Scenario: Member table

- **WHEN** the dashboard loads
- **THEN** the page SHALL display a table with one row per member, columns for each token type and cost, and a total row at the bottom


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