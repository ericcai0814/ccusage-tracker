# gap-detection Specification

## Purpose

Tracks each member's last successful report timestamp on the server and exposes it via the report API, enabling downstream consumers (dashboard, CLI) to detect broken or misconfigured hooks.

## ADDED Requirements

### Requirement: Record last seen timestamp on ingest

The server SHALL update the member's `last_seen_at` timestamp to the current UTC datetime each time a usage record is successfully ingested via `POST /api/ingest`. The timestamp update and usage record insert SHALL execute within the same database transaction.

#### Scenario: Successful ingest updates last_seen_at

- **WHEN** a POST to `/api/ingest` succeeds and the usage record is stored
- **THEN** the server SHALL set `last_seen_at` to the current UTC datetime for the corresponding member in the `members` table

#### Scenario: First ingest for a new member

- **WHEN** a new member is auto-created via `findOrCreateMember` during their first ingest
- **THEN** the member's `last_seen_at` SHALL be set to the current UTC datetime after the usage record is stored

### Requirement: Include last_seen_at in report API responses

The report API endpoints SHALL include `last_seen_at` for each member in their response payloads. The `last_seen_at` value represents the member's absolute last report time, independent of the requested date range.

#### Scenario: Summary report includes last_seen_at

- **WHEN** a client requests `GET /api/report/summary`
- **THEN** each member object in the response SHALL include a `last_seen_at` field (ISO 8601 string or null)
