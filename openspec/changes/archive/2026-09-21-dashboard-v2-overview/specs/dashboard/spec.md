## ADDED Requirements

### Requirement: Overview trend chart

The dashboard SHALL render a daily cost trend for the selected period as an inline SVG with one line per source (Claude Code and Codex), a legend that is always present, and a direct label at the end of each line. Each data point SHALL carry a `<title>` with the date and value. The chart SHALL use a single y axis. When the period contains a single day, the dashboard SHALL render a two-bar comparison instead of lines.

#### Scenario: Month view with both sources

- **WHEN** the dashboard loads with `period=month` and both `daily` and `codex-daily` records exist
- **THEN** the HTML SHALL contain one `<svg>` with two `<path>` elements and the legend texts `Claude Code` and `Codex`

#### Scenario: Single-day period

- **WHEN** the dashboard loads with `period=today`
- **THEN** the HTML SHALL NOT contain a trend `<path>` and SHALL contain the two-bar comparison for that day

### Requirement: Rankings and provider split

The dashboard SHALL render a member ranking sorted by cost with a single-hue horizontal bar per member (at most 10 rows, the rest folded into one "others" row), a provider split that maps `daily` to Anthropic and `codex-daily` to OpenAI as a two-segment stacked bar with amounts and percentages, and a model table listing each model's source, distinct days present and distinct members.

#### Scenario: Ranking order

- **WHEN** three members have costs 30, 10 and 20 in the period
- **THEN** the ranking SHALL list them in the order 30, 20, 10 with bar widths proportional to cost

#### Scenario: Provider percentages

- **WHEN** Claude records total 75 USD and Codex records total 25 USD in the period
- **THEN** the provider split SHALL show Anthropic 75% and OpenAI 25%

#### Scenario: Model presence

- **WHEN** model `claude-opus-5` appears in records on 3 distinct dates for 2 distinct members
- **THEN** the model table SHALL show days 3 and members 2 for that model

#### Scenario: Malformed models column

- **WHEN** a usage record's `models` column is not a JSON array
- **THEN** the dashboard SHALL skip that record in the model table and SHALL still render the page

### Requirement: Budget reference

When a monthly budget is set and the period is `month`, the total cost KPI SHALL show the percentage used, the budget amount, the daily average and the month-end projection, with a same-hue meter. When the projection exceeds the budget by more than 10% the note SHALL carry a critical label and symbol; when it exceeds by 0 to 10% a warning label and symbol; the label text SHALL be present in the HTML, never color alone. When no budget is set, or the period is not `month`, the dashboard SHALL NOT show any budget text.

#### Scenario: Budget set and on track

- **WHEN** the monthly budget is 2000 and month-to-date cost projects to 1500
- **THEN** the cost KPI SHALL contain `預算`, `已用`, `月底推估` and no warning or critical label

#### Scenario: Projection over budget

- **WHEN** the monthly budget is 1000 and the projection is 1200
- **THEN** the cost KPI SHALL contain a critical label and symbol

#### Scenario: No budget

- **WHEN** no monthly budget is stored
- **THEN** the HTML SHALL NOT contain `預算`

## MODIFIED Requirements

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
