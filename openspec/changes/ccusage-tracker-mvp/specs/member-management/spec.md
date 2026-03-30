## ADDED Requirements

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

### Requirement: List members

The system SHALL provide a GET endpoint at `/api/admin/members` that returns all registered members. This endpoint SHALL require the `ADMIN_API_KEY` for authentication.

#### Scenario: List all members

- **WHEN** a GET request is sent to `/api/admin/members` with a valid admin API key
- **THEN** the system SHALL return `200 OK` with an array of members, each containing `id`, `name`, and `created_at` (API keys SHALL NOT be included in the list response)

### Requirement: Store API key securely

The system SHALL store API keys as SHA-256 hashes in the database. The plain-text API key SHALL only be returned once at creation time.

#### Scenario: API key storage

- **WHEN** a member is created
- **THEN** the system SHALL store `sha256(api_key)` in the `members` table, not the plain-text key

#### Scenario: API key verification

- **WHEN** an incoming request includes an API key
- **THEN** the system SHALL compute `sha256(incoming_key)` and compare against stored hashes
