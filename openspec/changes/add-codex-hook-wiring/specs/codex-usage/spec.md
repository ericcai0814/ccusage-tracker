## ADDED Requirements

### Requirement: Hook entry point never blocks Codex

The Codex reporter SHALL provide a `--hook` mode for Codex hooks. In this mode it SHALL read stdin to end of input with a 2 second limit and a 64 KB limit, parse it as JSON and use only the `hook_event_name` field. When the event is `Stop` or `SessionEnd` it SHALL start the detached background worker; for any other event it SHALL exit 0 without starting the worker. Any read, parse or validation error in hook mode SHALL exit 0 without starting the worker and SHALL NOT write the error file. Stdin content SHALL NOT be written to disk, passed as worker arguments or included in any message.

#### Scenario: Stop event starts the worker

- **WHEN** the script runs with `--hook` and stdin is `{"hook_event_name":"Stop","session_id":"s1","cwd":"/tmp"}`
- **THEN** exactly one detached worker SHALL start and the parent SHALL exit 0 before the worker finishes

#### Scenario: Other events are ignored

- **WHEN** the script runs with `--hook` and stdin is `{"hook_event_name":"UserPromptSubmit"}`
- **THEN** no worker SHALL start and the parent SHALL exit 0

#### Scenario: Malformed stdin

- **WHEN** the script runs with `--hook` and stdin is not JSON, is empty, or exceeds 64 KB
- **THEN** no worker SHALL start, the parent SHALL exit 0 and no error file SHALL be written

#### Scenario: Payload privacy

- **WHEN** the hook payload contains a `transcript_path` and message text
- **THEN** none of that content SHALL appear in the worker arguments, the buffer, the error file or stdout

### Requirement: Hook-triggered throttle

Hook and notify triggers SHALL check `~/.config/ccusage-tracker/codex-last-flush.txt` before starting the worker. When the recorded timestamp is less than 5 minutes old the trigger SHALL NOT start the worker. When the check passes the trigger SHALL write the current timestamp before starting the worker. Manual `sync codex` SHALL ignore the throttle.

#### Scenario: Second trigger within five minutes

- **WHEN** a `Stop` hook triggers at T and another `Stop` hook triggers at T plus 2 minutes
- **THEN** only the first trigger SHALL start a worker

#### Scenario: Manual sync during throttle

- **WHEN** `tracker sync codex` runs 1 minute after a hook-triggered worker
- **THEN** the manual sync SHALL run the collector and report the result

## MODIFIED Requirements

### Requirement: Isolated retry and notification

Codex SHALL use independent locks, buffers and status files. A newer snapshot SHALL supersede buffered snapshots for the same identity before replay; a failed source SHALL NOT modify the other source's pending data. The hook entry SHALL discard event payload content and only act on `Stop` and `SessionEnd`. The legacy `--notify` entry SHALL remain functional for users who configured it manually, SHALL discard JSON payload content and SHALL only act on agent-turn-complete; documentation SHALL mark it as deprecated in favor of hooks.

#### Scenario: Offline recovery

- **WHEN** a snapshot of 100 tokens fails offline and the next snapshot of 200 succeeds
- **THEN** the final stored snapshot SHALL remain 200 and the stale 100 snapshot SHALL NOT overwrite it

#### Scenario: Notification privacy and standalone operation

- **WHEN** a Codex completion payload containing raw messages arrives as argv through `--notify` or as stdin through `--hook` with Claude unavailable
- **THEN** the Codex reporter SHALL run without Claude and SHALL NOT log, persist or forward those messages

#### Scenario: Independent concurrency

- **WHEN** Claude and Codex reporting overlap or two Codex syncs overlap
- **THEN** sources SHALL use independent locks and same-source buffer writes SHALL be serialized

#### Scenario: Hook and notify both configured

- **WHEN** a user still has the manual notify entry and the hooks are installed and trusted
- **THEN** the second trigger inside the throttle window SHALL NOT start a worker and the same-day snapshot SHALL remain a single idempotent record
