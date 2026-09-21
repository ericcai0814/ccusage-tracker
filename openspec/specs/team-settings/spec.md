# team-settings Specification

## Purpose

Store team-level settings such as the monthly budget in the tracker database and expose them through the admin API, so operators can adjust them without redeploying the server.

## Requirements

### Requirement: Settings storage

The server SHALL keep team settings in a `settings` table with columns `key` (primary key), `value` and `updated_at`, created idempotently at startup. Reading a missing key SHALL return null. Writing SHALL upsert and refresh `updated_at`.

#### Scenario: Missing key

- **WHEN** no row exists for `monthly_budget_usd`
- **THEN** reading it SHALL return null and the dashboard SHALL treat the budget as unset

#### Scenario: Upsert

- **WHEN** `monthly_budget_usd` is written twice with 1000 then 2000
- **THEN** one row SHALL exist with value 2000

---
### Requirement: Monthly budget admin API

The admin API SHALL expose `GET /api/admin/settings` returning all settings as a JSON object with `monthly_budget_usd` as a number or null, and `PUT /api/admin/settings/monthly_budget_usd` accepting `{ "value": number }`. Both SHALL require the admin Bearer key. A value of 0 SHALL clear the budget. Negative or non-numeric values SHALL return 400 with a message.

#### Scenario: Unauthorized

- **WHEN** the request has no valid admin Bearer key
- **THEN** the API SHALL return 401

#### Scenario: Set budget

- **WHEN** an authorized client sends `{ "value": 2000 }`
- **THEN** the API SHALL return 200 and a subsequent GET SHALL return `monthly_budget_usd: 2000`

#### Scenario: Invalid value

- **WHEN** an authorized client sends `{ "value": -1 }` or `{ "value": "abc" }`
- **THEN** the API SHALL return 400 and the stored value SHALL remain unchanged
