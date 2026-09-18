## ADDED Requirements

### Requirement: Stop throttle ignores future timestamps

The Claude Stop hook throttle SHALL treat a `last-flush.txt` timestamp that lies in the future as not recent. The hook SHALL proceed with the background worker and SHALL overwrite the file with the current timestamp.

#### Scenario: Future timestamp does not block reporting

- **WHEN** `~/.config/ccusage-tracker/last-flush.txt` contains a timestamp 1 hour ahead of the current clock and the Stop hook runs
- **THEN** the hook SHALL start the worker and the file SHALL contain the current timestamp afterwards
