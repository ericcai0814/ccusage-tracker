## ADDED Requirements

### Requirement: Ingest token usage data

The system SHALL accept POST requests to `/api/ingest` containing token usage data from a member's SessionEnd hook. The request body SHALL include: `date` (ISO date string), `session_id` (string, optional), `input_tokens` (integer), `output_tokens` (integer), `cache_creation_tokens` (integer), `cache_read_tokens` (integer), `total_cost_usd` (number), and `models` (JSON array of strings).

#### Scenario: Successful ingest

- **WHEN** a valid POST request is sent to `/api/ingest` with a valid API key in the `Authorization: Bearer <key>` header
- **THEN** the system SHALL store the usage record associated with the authenticated member and return `200 OK` with `{ "ok": true }`

#### Scenario: Duplicate session ingest (idempotency)

- **WHEN** a POST request is sent with the same `(member_id, date, session_id)` combination as an existing record
- **THEN** the system SHALL replace the existing record with the new data (INSERT OR REPLACE) and return `200 OK`

#### Scenario: Missing session_id

- **WHEN** a POST request is sent without a `session_id` field
- **THEN** the system SHALL accept the record with `session_id` set to NULL and store it normally

### Requirement: Authenticate ingest requests

The system SHALL require a valid API key in the `Authorization: Bearer <key>` header for all `/api/ingest` requests.

#### Scenario: Unauthorized request

- **WHEN** a POST request is sent to `/api/ingest` without an API key or with an invalid API key
- **THEN** the system SHALL return `401 Unauthorized` with `{ "error": "unauthorized" }`

#### Scenario: Constant-time comparison

- **WHEN** the system validates an API key
- **THEN** the system SHALL use constant-time string comparison to prevent timing attacks

### Requirement: Validate ingest payload

The system SHALL validate the request body and reject malformed data.

#### Scenario: Missing required fields

- **WHEN** a POST request is sent with missing required fields (e.g., no `date`)
- **THEN** the system SHALL return `400 Bad Request` with a descriptive error message

#### Scenario: Invalid field types

- **WHEN** a POST request is sent with invalid field types (e.g., `input_tokens` as a string)
- **THEN** the system SHALL return `400 Bad Request` with a descriptive error message
