## MODIFIED Requirements

### Requirement: Hook-triggered throttle

Hook and notify triggers SHALL check `~/.config/ccusage-tracker/codex-last-flush.txt` before starting the worker. When the recorded timestamp is less than 5 minutes old the trigger SHALL NOT start the worker. A recorded timestamp that lies in the future SHALL NOT count as recent; the trigger SHALL proceed and overwrite it. When the check passes the trigger SHALL write the current timestamp before starting the worker. Manual `sync codex` SHALL ignore the throttle.

#### Scenario: Second trigger within five minutes

- **WHEN** a `Stop` hook triggers at T and another `Stop` hook triggers at T plus 2 minutes
- **THEN** only the first trigger SHALL start a worker

#### Scenario: Manual sync during throttle

- **WHEN** `tracker sync codex` runs 1 minute after a hook-triggered worker
- **THEN** the manual sync SHALL run the collector and report the result

#### Scenario: Timestamp in the future

- **WHEN** `codex-last-flush.txt` contains a timestamp 1 hour ahead of the current clock and a `Stop` hook triggers
- **THEN** the trigger SHALL start a worker and SHALL overwrite the file with the current timestamp
