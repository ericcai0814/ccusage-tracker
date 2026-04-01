# session-hook Delta Specification

## MODIFIED Requirements

### Requirement: Non-blocking execution

The hook SHALL NOT block Claude Code from exiting, regardless of success or failure. The retry phase (defined in `local-buffer` capability) executes before current data collection. The current session's POST SHALL still execute in the background. The retry phase SHALL disable `set -e` (use explicit error checking per command) to prevent individual curl failures from aborting the entire hook.

#### Scenario: Server unreachable

- **WHEN** the hook attempts to POST but the server is unreachable
- **THEN** the hook SHALL buffer the payload locally and exit with code 0

#### Scenario: Background POST

- **WHEN** the hook sends the current session's POST request
- **THEN** the hook SHALL execute the curl command in the background (`&`) and exit immediately

#### Scenario: Buffer write failure

- **WHEN** the hook attempts to write to the buffer file but the write fails (disk full, permission denied)
- **THEN** the hook SHALL silently skip the buffer write and exit with code 0
