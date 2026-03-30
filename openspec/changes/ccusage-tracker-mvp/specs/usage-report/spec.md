## ADDED Requirements

### Requirement: Query daily usage report

The system SHALL provide a GET endpoint at `/api/report/daily` that returns per-member, per-day token usage data. The endpoint SHALL accept optional query parameters: `from` (ISO date), `to` (ISO date), and `member` (member name).

#### Scenario: Query with date range

- **WHEN** a GET request is sent to `/api/report/daily?from=2026-03-01&to=2026-03-31`
- **THEN** the system SHALL return a JSON response containing each member's daily usage records within the date range, with totals per member

#### Scenario: Query for specific member

- **WHEN** a GET request is sent to `/api/report/daily?member=eric`
- **THEN** the system SHALL return only the specified member's daily usage records

#### Scenario: Default date range

- **WHEN** a GET request is sent to `/api/report/daily` without `from` or `to` parameters
- **THEN** the system SHALL default to the current calendar month (first day of month to today)

### Requirement: Query summary report

The system SHALL provide a GET endpoint at `/api/report/summary` that returns aggregated token usage per member for a given period.

#### Scenario: Monthly summary

- **WHEN** a GET request is sent to `/api/report/summary?period=month`
- **THEN** the system SHALL return each member's total `input_tokens`, `output_tokens`, `cache_creation_tokens`, `cache_read_tokens`, and `total_cost_usd` for the current month

#### Scenario: Weekly summary

- **WHEN** a GET request is sent to `/api/report/summary?period=week`
- **THEN** the system SHALL return each member's aggregated usage for the current ISO week

#### Scenario: Today summary

- **WHEN** a GET request is sent to `/api/report/summary?period=today`
- **THEN** the system SHALL return each member's aggregated usage for today only

### Requirement: Authenticate report requests

The system SHALL require a valid member API key in the `Authorization: Bearer <key>` header for all `/api/report/*` requests.

#### Scenario: Unauthorized report request

- **WHEN** a GET request is sent to `/api/report/daily` without a valid API key
- **THEN** the system SHALL return `401 Unauthorized`

### Requirement: Health check endpoint

The system SHALL provide a GET endpoint at `/api/health` that returns server status without authentication.

#### Scenario: Health check

- **WHEN** a GET request is sent to `/api/health`
- **THEN** the system SHALL return `200 OK` with `{ "ok": true, "version": "<semver>" }`
