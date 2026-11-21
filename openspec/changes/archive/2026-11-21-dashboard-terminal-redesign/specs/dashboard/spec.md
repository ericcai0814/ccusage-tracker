## MODIFIED Requirements

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
