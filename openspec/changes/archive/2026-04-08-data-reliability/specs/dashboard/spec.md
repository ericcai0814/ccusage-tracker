# dashboard Delta Specification

## MODIFIED Requirements

### Requirement: Dashboard data display

The dashboard SHALL display the following data for each member: name, input tokens, output tokens, cache read tokens, cache creation tokens, estimated cost in USD, and last report time. The `last_seen_at` value is the member's absolute last report time from the `gap-detection` capability, independent of the selected dashboard period.

#### Scenario: Summary cards

- **WHEN** the dashboard loads
- **THEN** the page SHALL display summary cards showing: total cost for the period, total token count, and number of active members

#### Scenario: Member table

- **WHEN** the dashboard loads
- **THEN** the page SHALL display a table with one row per member, columns for each token type, cost, share, and a "Last Report" column showing relative time since last ingest

#### Scenario: Stale member warning

- **WHEN** a member's last report time is more than 24 hours ago or is NULL
- **THEN** the "Last Report" cell SHALL display a visual warning indicator (warning color) and text "Never" for NULL values

#### Scenario: Recent member no warning

- **WHEN** a member's last report time is within 24 hours
- **THEN** the "Last Report" cell SHALL display relative time without any warning indicator
