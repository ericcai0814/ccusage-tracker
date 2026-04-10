## REMOVED Requirements

### Requirement: Tool usage heatmap

**Reason**: Tool distribution is a byproduct of Claude's autonomous tool selection, not a meaningful indicator of developer behavior or session quality. The heatmap provides no actionable insight.

**Migration**: Remove `getToolHeatmap` query function and `ToolHeatmapEntry` type from `queries.ts`. Remove `ToolHeatmap` component from `weekly-report.tsx`.

#### Scenario: Removal verification

- **WHEN** the weekly report is rendered after this change
- **THEN** no tool usage heatmap section SHALL be present in the HTML output

### Requirement: Anomalous session detection

**Reason**: The anomaly criteria (high turns with no output, error-heavy, long duration with no commit) were found to be fundamentally flawed — none of these conditions reliably indicate a problematic session. Replaced by the Session Log + Context % section in the `weekly-report` capability.

**Migration**: Remove `getAnomalousSessions` query function, `AnomalousSession` type, and `ANOMALY_THRESHOLDS` constant from `queries.ts`. Remove `AnomalySection` component and `getAnomalyReasons` helper from `weekly-report.tsx`.

#### Scenario: Removal verification

- **WHEN** the weekly report is rendered after this change
- **THEN** no anomalous sessions section SHALL be present in the HTML output

### Requirement: Cost trend integration

**Reason**: Daily cost trend duplicates the token usage visualization already available on the dashboard. The weekly report is a triage tool meant to be read once, not a monitoring dashboard.

**Migration**: Remove `getWeeklyCostTrend` query function and `DailyCostEntry` type from `queries.ts`. Remove `CostTrendSection` component from `weekly-report.tsx`. Cost data remains accessible via the dashboard at `/dashboard`.

#### Scenario: Removal verification

- **WHEN** the weekly report is rendered after this change
- **THEN** no cost trend section SHALL be present in the HTML output
