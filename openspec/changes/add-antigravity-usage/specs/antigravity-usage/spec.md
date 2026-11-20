## Purpose

Collect local Google Antigravity (AGY) usage as isolated daily snapshots through the ccusage `antigravity daily` reader and report them to the tracker server. Reporting is triggered by an Antigravity Stop hook, by the Claude and Codex reporting workers as a fallback, or manually, and only token counts, estimated cost, model names and routing identity leave the machine.

## ADDED Requirements

### Requirement: Canonical Antigravity snapshots

The reporter script `agent-sync.mjs` SHALL collect Antigravity usage only through `ccusage antigravity daily --json --since <YYYYMMDD> --until <YYYYMMDD> --timezone <IANA zone>` for the member's local calendar day, and SHALL NOT fall back to the unified `ccusage daily` command. Before collecting it SHALL run `ccusage --version` and SHALL compare the reported version as a semantic version: versions from 20.0.21 up to but excluding 21.0.0 SHALL be accepted; a 20.x version below 20.0.21 SHALL fail with a message containing `ccusage@20.0.51` without running the Antigravity command, and any version outside major 20, or an unparsable version, SHALL fail with the same install guidance. The collector output SHALL be accepted only when it is a JSON object with a `daily` array and a `totals` object and without `type`, `data` or `summary` keys, and when the daily array holds exactly one row whose `date` equals the requested day, whose `inputTokens`, `outputTokens`, `cacheCreationTokens`, `cacheReadTokens` and `totalTokens` are non-negative safe integers, whose `totalTokens` is not smaller than the sum of the four buckets, whose `totalCost` is finite and non-negative, and whose `modelsUsed` is an array of strings. Because ccusage passes unmapped Antigravity display names through unchanged, a model name SHALL NOT cause rejection: each name SHALL be sanitized by replacing every run of characters outside `[A-Za-z0-9_.:/-]` with a single `-`, removing leading and trailing `-` and truncating to 200 characters, and names that are empty after sanitizing SHALL be dropped. For an accepted row the reporter SHALL post one snapshot with session_id `antigravity-daily`, input_tokens equal to `inputTokens`, cache_read_tokens equal to `cacheReadTokens`, cache_creation_tokens equal to `cacheCreationTokens`, output_tokens equal to `outputTokens` plus the reasoning remainder `totalTokens - (inputTokens + outputTokens + cacheCreationTokens + cacheReadTokens)`, total_cost_usd equal to `totalCost` with negative zero sent as 0, and models equal to the distinct sanitized `modelsUsed` names. The request body SHALL contain no field other than these, member_name and date.

#### Scenario: Reasoning tokens counted once in output

- **WHEN** the collector reports ccusage 20.0.51 and returns one row for today with inputTokens 100, outputTokens 30, cacheCreationTokens 5, cacheReadTokens 20, totalTokens 165, totalCost 0.000187 and modelsUsed `["gemini-3-pro"]`
- **THEN** `/api/ingest` SHALL receive session_id `antigravity-daily`, input_tokens 100, output_tokens 40, cache_creation_tokens 5, cache_read_tokens 20, total_cost_usd 0.000187 and models `["gemini-3-pro"]`

##### Example: token mapping

| inputTokens | outputTokens | cacheCreationTokens | cacheReadTokens | totalTokens | posted output_tokens | Notes |
| ----------- | ------------ | ------------------- | --------------- | ----------- | -------------------- | ----- |
| 100 | 30 | 5 | 20 | 165 | 40 | 10 reasoning tokens added once |
| 200 | 50 | 0 | 0 | 250 | 50 | no reasoning |
| 100 | 30 | 5 | 20 | 150 | rejected | totalTokens below bucket sum |

#### Scenario: Explicit Antigravity command

- **WHEN** a sync runs against a synthetic collector that records its arguments
- **THEN** the recorded calls SHALL be `--version` followed by one call whose first arguments are `antigravity daily --json`, and no call SHALL have `daily` as its first argument

#### Scenario: Collector without an Antigravity reader

- **WHEN** `ccusage --version` reports `ccusage 20.0.20`
- **THEN** manual sync SHALL exit nonzero with a message containing `ccusage@20.0.51`, SHALL NOT run `ccusage antigravity daily` and SHALL NOT post anything

##### Example: collector version gate

| `ccusage --version` output | Result |
| -------------------------- | ------ |
| `ccusage 20.0.20` | rejected, Antigravity command not run |
| `20.0.21` | accepted |
| `ccusage 20.0.51` | accepted |
| `20.1.0` | accepted |
| `21.0.0` | rejected |
| `18.0.9` | rejected |

#### Scenario: Invalid collector output

- **WHEN** the collector output is malformed JSON, has an unknown top-level schema, holds more than one daily row, carries a date other than today, has a negative or non-integer token count, has totalTokens smaller than the bucket sum, has a negative or non-finite cost, or has a `modelsUsed` value that is not an array of strings
- **THEN** manual sync SHALL exit nonzero, SHALL write a fixed content-free message to `antigravity-last-error.txt` that does not contain collector output, and SHALL post nothing

#### Scenario: Unmapped display name is sanitized

- **WHEN** an otherwise valid row has modelsUsed `["Kimi K3 (Preview)", "gemini-3-pro", "gemini-3-pro", "()"]`
- **THEN** the posted models SHALL be `["Kimi-K3-Preview", "gemini-3-pro"]` and the snapshot SHALL be posted

#### Scenario: No usage today

- **WHEN** the collector returns an empty daily array
- **THEN** manual sync SHALL print `No Antigravity usage for today.`, SHALL exit 0 and SHALL NOT post a zero snapshot

#### Scenario: Three sources ingested twice

- **WHEN** Claude `daily`, Codex `codex-daily` and Antigravity `antigravity-daily` snapshots for one member and date are each submitted twice
- **THEN** three records SHALL remain for that member and date and reports SHALL count each source once

#### Scenario: Unpriced models are named

- **WHEN** the collector's `totals.unpricedModels` lists `antigravity-model-77` and the row is otherwise valid
- **THEN** manual sync SHALL post the snapshot and SHALL print a note naming `antigravity-model-77` as excluded from the cost estimate

---

### Requirement: Isolated Antigravity state

Antigravity reporting SHALL keep its own state under `~/.config/ccusage-tracker/` in `antigravity-buffer.jsonl`, `antigravity-worker.lock`, `antigravity-last-error.txt`, `antigravity-last-upload.txt` and `antigravity-last-flush.txt`. A newer snapshot SHALL replace buffered snapshots for the same member and date before any replay is sent. An Antigravity collection or upload failure SHALL NOT read, modify or delete any Claude or Codex buffer, lock, error, upload or flush file. A successful upload SHALL update `antigravity-last-upload.txt` and clear `antigravity-last-error.txt`; a failed upload SHALL keep the snapshot in `antigravity-buffer.jsonl` and manual sync SHALL exit nonzero.

#### Scenario: Offline recovery

- **WHEN** a snapshot with 100 output tokens fails to upload and the next snapshot for the same day with 200 output tokens succeeds
- **THEN** the stored record SHALL hold 200 output tokens and the stale 100 snapshot SHALL NOT be sent after it

#### Scenario: Failure leaves other sources untouched

- **WHEN** an Antigravity upload fails while `buffer.jsonl` and `codex-buffer.jsonl` hold pending rows
- **THEN** both files SHALL remain byte-identical and no Claude or Codex marker file SHALL change

#### Scenario: Concurrent workers

- **WHEN** two Antigravity workers start at the same time
- **THEN** only one SHALL acquire `antigravity-worker.lock` and the other SHALL exit without modifying `antigravity-buffer.jsonl`

---

### Requirement: Antigravity Stop hook never blocks Antigravity

`node "<home>/.config/ccusage-tracker/agent-sync.mjs" --hook antigravity` SHALL be the command registered for the Antigravity `Stop` event. In this mode the script SHALL read stdin until end of input, 2 seconds or 64 KB, whichever comes first, and SHALL discard what it read without parsing, storing, logging or forwarding it. It SHALL write exactly `{"decision":"stop"}` followed by a newline to stdout, SHALL start the detached Antigravity worker when the trigger throttle allows it, and SHALL exit 0. Failures while reading stdin or starting the worker SHALL NOT change the stdout line or the exit code. The worker SHALL receive only the arguments `--worker antigravity`.

#### Scenario: Stop starts one worker

- **WHEN** the hook runs with stdin `{"conversationId":"c1","lastUserInput":"secret prompt","transcriptPath":"~/x/transcript.jsonl","fullyIdle":true}` and `antigravity-last-flush.txt` does not exist
- **THEN** exactly one detached worker SHALL start, stdout SHALL be `{"decision":"stop"}` and the hook process SHALL exit 0 before the worker finishes

#### Scenario: Payload privacy

- **WHEN** the hook payload contains the text `secret prompt` and a transcript path
- **THEN** neither SHALL appear in the worker arguments, in any file under `~/.config/ccusage-tracker/`, on stdout or on stderr

#### Scenario: Oversized or unterminated stdin

- **WHEN** stdin exceeds 64 KB, or stays open without data for more than 2 seconds
- **THEN** the hook SHALL print `{"decision":"stop"}`, SHALL exit 0 within 3 seconds and SHALL start the worker when the throttle allows it

#### Scenario: Never keeps the agent running

- **WHEN** the worker cannot be started
- **THEN** stdout SHALL still be exactly `{"decision":"stop"}` and SHALL NOT contain `continue`

---

### Requirement: Antigravity trigger throttle

The Antigravity hook and the trigger started by other reporters SHALL read `antigravity-last-flush.txt` before starting a worker. When the recorded timestamp is less than 5 minutes old the trigger SHALL NOT start a worker. A recorded timestamp that lies in the future SHALL NOT count as recent; the trigger SHALL proceed and overwrite it. When the check passes the trigger SHALL write the current timestamp before starting the worker. Manual `tracker sync antigravity` SHALL ignore the throttle and SHALL NOT write the flush file.

#### Scenario: Hook and Claude trigger within five minutes

- **WHEN** the Antigravity hook starts a worker at T and the Claude worker triggers Antigravity at T plus 2 minutes
- **THEN** only the first trigger SHALL start an Antigravity worker

#### Scenario: Manual sync during throttle

- **WHEN** `tracker sync antigravity` runs 1 minute after a hook-triggered worker
- **THEN** the manual sync SHALL run the collector, report the result and leave `antigravity-last-flush.txt` unchanged

#### Scenario: Timestamp in the future

- **WHEN** `antigravity-last-flush.txt` holds a timestamp 1 hour ahead of the clock and the hook runs
- **THEN** the hook SHALL start a worker and SHALL overwrite the file with the current timestamp

---

### Requirement: Trigger from Claude and Codex workers

When the Claude reporting worker (`session-end.mjs --mode=worker`) finishes after holding its lock, and when the Codex reporting worker (`codex-sync.mjs --worker`) finishes, each SHALL start `agent-sync.mjs --trigger` as a detached process with stdio ignored and without passing any hook payload, transcript path, model or argument from its own invocation, provided `~/.config/ccusage-tracker/agent-sync.mjs` exists. In `--trigger` mode the script SHALL start an Antigravity worker only when Antigravity is detected and the trigger throttle allows it, SHALL print nothing and SHALL exit 0. For this check Antigravity SHALL count as detected when `ANTIGRAVITY_DATA_DIR` is non-empty or a `conversations` directory exists directly below at least one of `~/.gemini/antigravity`, `~/.gemini/antigravity-cli`, `~/.gemini/antigravity-ide`, `~/.gemini/antigravity-backup`, `~/.gemini/antigravity-acp` and `~/.config/antigravity`; a root directory without `conversations` SHALL NOT count. Starting the trigger, or failing to start it, SHALL NOT change any Claude or Codex error file, buffer, lock or upload marker.

#### Scenario: Claude-only machine

- **WHEN** the Claude worker finishes on a machine where none of the Antigravity directories exists and `ANTIGRAVITY_DATA_DIR` is unset
- **THEN** no Antigravity worker SHALL start and no `antigravity-*` file SHALL be created

#### Scenario: Antigravity hook did not fire

- **WHEN** the Claude worker finishes on a machine with the directory `~/.gemini/antigravity-cli/conversations` and no Antigravity flush in the last 5 minutes
- **THEN** exactly one Antigravity worker SHALL start

#### Scenario: Leftover directory without conversations

- **WHEN** `~/.gemini/antigravity` exists and holds only a `bin` directory, no other Antigravity root exists and `ANTIGRAVITY_DATA_DIR` is unset
- **THEN** the trigger SHALL NOT start an Antigravity worker and SHALL NOT create any `antigravity-*` file

#### Scenario: Installation without the new script

- **WHEN** `~/.config/ccusage-tracker/agent-sync.mjs` does not exist
- **THEN** the Claude and Codex workers SHALL NOT start any additional process and their files SHALL be identical to a run before this change

#### Scenario: Codex outcome unchanged

- **WHEN** the Codex worker fails its own upload and then triggers Antigravity
- **THEN** `codex-last-error.txt` SHALL hold the Codex failure message and `codex-buffer.jsonl` SHALL keep the pending Codex snapshot

---

### Requirement: Server source table

The server SHALL define every known usage source in one table that maps a session_id to a source identifier, display label, provider name and data color: `daily` to claude, `Claude Code`, `Anthropic`, `#3987e5`; `codex-daily` to codex, `Codex`, `OpenAI`, `#d95926`; and `antigravity-daily` to antigravity, `Antigravity`, `Google`, `#f0b800`. Any other session_id, including NULL, SHALL resolve to other, `其他`, `其他`, `#8a8a8a`. The SQL attribution expression, the code resolver, the dashboard labels, colors and provider names, and the dashboard source order SHALL all be derived from this table, in table order followed by other. Every session_id in the table SHALL match `^[a-z0-9-]+$`, and the SQL attribution expression SHALL be built only from table constants. The ingest API, its validation and the database schema SHALL remain unchanged.

#### Scenario: Attribution of known and unknown session ids

- **WHEN** records exist with session_id `daily`, `codex-daily`, `antigravity-daily`, `manual` and NULL
- **THEN** the SQL expression and the code resolver SHALL both attribute them to claude, codex, antigravity, other and other

#### Scenario: Adding a source is a table entry

- **WHEN** the attribution expression and the resolver are built from a table that also contains session_id `gemini-daily`
- **THEN** `gemini-daily` records SHALL be attributed to that entry by both without any other code change

#### Scenario: Ingest accepts Antigravity snapshots unchanged

- **WHEN** an `antigravity-daily` snapshot is posted to `/api/ingest` twice for the same member and date
- **THEN** the existing validation SHALL accept it and the `(member_id, date, session_id)` upsert SHALL leave one record
