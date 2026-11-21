## MODIFIED Requirements

### Requirement: Overview trend chart

The dashboard SHALL render a daily cost trend for the selected period as an inline SVG with one line per source that has records in the period, ordered Claude Code, Codex, Antigravity, then other, a legend that is always present, and a direct label at the end of each line. Each data point SHALL carry a `<title>` with the date and value. The chart SHALL use a single y axis. When the period contains a single day, the dashboard SHALL render one horizontal bar per source present instead of lines. Source names, colors and order SHALL come from the server source table, so a source added to that table SHALL appear without further dashboard changes.

#### Scenario: Month view with both sources

- **WHEN** the dashboard loads with `period=month` and both `daily` and `codex-daily` records exist
- **THEN** the HTML SHALL contain one `<svg>` with two `<path>` elements and the legend texts `Claude Code` and `Codex`

#### Scenario: Month view with three sources

- **WHEN** the dashboard loads with `period=month` and `daily`, `codex-daily` and `antigravity-daily` records exist
- **THEN** the HTML SHALL contain one `<svg>` with three `<path>` elements, the legend texts `Claude Code`, `Codex` and `Antigravity` in that order, and the Antigravity line SHALL use the color `#f0b800`

#### Scenario: Antigravity is not shown as other

- **WHEN** the only records in the period have session_id `antigravity-daily`
- **THEN** the legend SHALL contain `Antigravity` and SHALL NOT contain `其他`

#### Scenario: Single-day period

- **WHEN** the dashboard loads with `period=today` and records from two sources exist for that day
- **THEN** the HTML SHALL NOT contain a trend `<path>` and SHALL contain one bar per source for that day

---

### Requirement: Rankings and provider split

The dashboard SHALL render a member ranking sorted by cost with a single-hue horizontal bar per member (at most 10 rows, the rest folded into one "others" row), a provider split with one segment per source that has cost in the period, mapping `daily` to Anthropic, `codex-daily` to OpenAI and `antigravity-daily` to Google, shown as a stacked bar with amounts and percentages, and a model table listing each model's source, distinct days present and distinct members. Provider names SHALL come from the server source table.

#### Scenario: Ranking order

- **WHEN** three members have costs 30, 10 and 20 in the period
- **THEN** the ranking SHALL list them in the order 30, 20, 10 with bar widths proportional to cost

#### Scenario: Provider percentages

- **WHEN** Claude records total 75 USD and Codex records total 25 USD in the period
- **THEN** the provider split SHALL show Anthropic 75% and OpenAI 25%

#### Scenario: Provider percentages with Antigravity

- **WHEN** Claude records total 50 USD, Codex records total 30 USD and Antigravity records total 20 USD in the period
- **THEN** the provider split SHALL show Anthropic 50%, OpenAI 30% and Google 20%, and the whole-number percentages SHALL sum to 100

#### Scenario: Model presence

- **WHEN** model `claude-opus-5` appears in records on 3 distinct dates for 2 distinct members
- **THEN** the model table SHALL show days 3 and members 2 for that model

#### Scenario: Model source for Antigravity

- **WHEN** model `gemini-3-pro` appears only in `antigravity-daily` records
- **THEN** the model table SHALL show `Antigravity` as that model's source

#### Scenario: Same model from two sources

- **WHEN** model `claude-opus-5-5` appears in `daily` records and in `antigravity-daily` records
- **THEN** the model table SHALL show two rows for `claude-opus-5-5`, one with source `Claude Code` and one with source `Antigravity`, each with its own days and members

#### Scenario: Malformed models column

- **WHEN** a usage record's `models` column is not a JSON array
- **THEN** the dashboard SHALL skip that record in the model table and SHALL still render the page
