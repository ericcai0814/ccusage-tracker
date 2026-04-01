# member-management Specification

## Purpose

TBD - created by archiving change 'ccusage-tracker-mvp'. Update Purpose after archive.

## Requirements

### Requirement: Create member

The system SHALL provide a POST endpoint at `/api/admin/members` that creates a new team member and generates a unique API key. This endpoint SHALL require the `ADMIN_API_KEY` for authentication.

#### Scenario: Successful member creation

- **WHEN** a POST request is sent to `/api/admin/members` with `{ "name": "Eric" }` and a valid admin API key
- **THEN** the system SHALL create the member, generate a unique API key, and return `201 Created` with `{ "id": "<nanoid>", "name": "Eric", "api_key": "sk-tracker-<random>" }`

#### Scenario: Duplicate member name

- **WHEN** a POST request is sent with a name that already exists
- **THEN** the system SHALL return `409 Conflict` with `{ "error": "member already exists" }`

#### Scenario: Unauthorized admin request

- **WHEN** a POST request is sent to `/api/admin/members` without the admin API key or with an invalid key
- **THEN** the system SHALL return `401 Unauthorized`


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
### Requirement: List members

The system SHALL provide a GET endpoint at `/api/admin/members` that returns all registered members. This endpoint SHALL require the `ADMIN_API_KEY` for authentication.

#### Scenario: List all members

- **WHEN** a GET request is sent to `/api/admin/members` with a valid admin API key
- **THEN** the system SHALL return `200 OK` with an array of members, each containing `id`, `name`, and `created_at` (API keys SHALL NOT be included in the list response)


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
### Requirement: Store API key securely

The system SHALL store API keys as SHA-256 hashes in the database. The plain-text API key SHALL only be returned once at creation time.

#### Scenario: API key storage

- **WHEN** a member is created
- **THEN** the system SHALL store `sha256(api_key)` in the `members` table, not the plain-text key

#### Scenario: API key verification

- **WHEN** an incoming request includes an API key
- **THEN** the system SHALL compute `sha256(incoming_key)` and compare against stored hashes

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