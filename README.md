# cc-h15a-claude-dispatch-lab
Isolated lab for testing zero-copy AI agent task handoff.

## AG2B-1 Mac Agent Bridge foundation (offline only)

Requires Node.js 20+. No package installation or credentials required.

```sh
node --test bridge/test/*.test.mjs
node bridge/dry-run.mjs
```

The dry-run uses only `bridge/fixtures/queue.json`: 3 candidates, 1 valid,
2 rejected, next task `AG2B-fixture-1`. It does not claim tasks or call the
mock adapter. No arguments or live mode are supported. HOLD exits nonzero;
individual rejected candidates are counted without blocking valid candidates.
Rejections contain indexes and fixed error codes, never raw Issue bodies.
Fixture Issue numbers are synthetic and do not refer to actual lab Issues.

### Task contract

Issue body format is one JSON object, with exactly these required fields:

```json
{
  "contract_version": "CC_AG_BRIDGE_V1",
  "task_id": "AG2B-example-1",
  "repository": "augusliang23-web/cc-h15a-claude-dispatch-lab",
  "issue_number": 101,
  "agent": "antigravity",
  "model": "gemini-3.8-flash-low",
  "task_type": "synthetic",
  "execution_mode": "dry-run",
  "approval": "approved",
  "status": "QUEUED"
}
```

All fixed values above are exact. Task IDs use 1–80 ASCII letters, digits,
periods, underscores or hyphens, starting with a letter or digit. Issue numbers
must be positive safe integers and match the open Issue envelope; PR envelopes
are rejected. Missing/extra fields are rejected. Bodies are limited to 16 KiB;
fixture batches to 1,000 candidates. Duplicate task IDs are rejected for **all**
copies. Selection orders valid tasks by Issue number then task ID.

`approval` here validates fixture shape only. It does not verify the identity
or authority of the approver. Never use this preview as authorization to run.

### State and availability

Only these transitions exist:

```text
QUEUED -> CLAIMED -> RUNNING -> COMPLETED
                         | -> FAILED
                         | -> INTERRUPTED -> BLOCKED
```

`MockOwnership` is an in-memory design model, not a real claim mechanism.
Snapshots preserve all transitions and are validated before restoration.
At most one CLAIMED/RUNNING/INTERRUPTED task may exist in a snapshot. Any known
task ID, including completed, failed or blocked, cannot be claimed again.
Recovery blocks interrupted work; CLAIMED stays reserved for manual resolution.
A separate candidate cannot bypass an active reservation. There is no retry API.

| Condition supplied to pure logic | Foundation behavior |
| --- | --- |
| Mac offline or asleep | HOLD; source task stays QUEUED |
| Mac restarted | HOLD; reconcile history; no automatic restart |
| Network/GitHub unavailable | HOLD; no next task |
| GitHub reader throws / auth read fails | Sanitized HOLD; no partial selection |
| CLI unavailable / authentication expired | HOLD; no invocation or login attempt |
| Prior RUNNING / INTERRUPTED history | Recovery records INTERRUPTED then BLOCKED; no retry |
| Prior COMPLETED history | Reject same ID; no repeated execution |

Availability is an injected test input. This phase does not detect actual Mac,
network, CLI or authentication state. GitHub remains the future authoritative
source; the fixture reader cannot mutate it, and no live reader is included.

### Mock adapter and result

`MockAntigravityAdapter` exposes `validateConfiguration`, `prepareTask`,
`executeTask`, `collectResult`. Only mock execution exists; it returns
`BLUE LANTERN` without a process or provider call. `executeLive` and `claimLive`
always throw. There is no environment/configuration switch to enable them.

Result V1 includes `result_version`, `task_id`, `issue_number`, `agent`, `model`,
`execution_status`, `started_at`, `finished_at`, `result`, `error_code`,
`files_modified`, `commits_created`, `report_marker`, `simulated`.
This phase accepts only simulated COMPLETED results with BLUE LANTERN, null
error, empty file/commit arrays, ISO UTC timestamps and a unique
`CC_AG_BRIDGE_V1_MOCK_<UUID>` marker. COMPLETED describes the mock, not live work.
Tests save/read results only in temporary directories and remove them afterward.
The adapter itself never stores results or publishes reports.

### Evidence and next gate

- IMPLEMENTED / MOCK TESTED: task/result contracts, state machine, fixture reader,
  dry-run, single-owner history model, recovery decisions, mock adapter.
- LIVE TESTED: none of the Bridge behavior.
- NOT TESTED: actual Mac sleep/restart, GitHub queue integration, provider
  execution, durable recovery, multiple bridge processes, authenticated approval.
- NOT IMPLEMENTED: real claims, AI execution, GitHub writeback, retries,
  scheduling, daemon, LaunchAgent, startup registration, cloud infrastructure.

31 offline tests cover T01–T15 and input/history/result boundaries. T15 compares
all existing workflow bytes to baseline `ac71eda90e128cd9e4d337c3fe4e927747461f21`.
Only tests use child_process to read that local baseline and exercise the CLI;
Bridge implementation imports no process launcher or network client.
An independent bounded review found a non-string result-ID validation gap;
regression tests reproduced it and an explicit type check fixes it.

No distributed atomic lock or exactly-once execution is claimed. GitHub labels
and comments alone cannot safely claim concurrently; real claiming remains
disabled. AG2B-2 requires a separate Control Plane decision on trusted approvals,
atomic ownership and crash-safe persistence, then explicit human authorization.
No merge/deploy or next-phase authorization is provided by these tests.
See [product contract and design](docs/ag2b1-foundation.md).

## AG2B-2 secure admission and recovery (offline only)

[Security design, interfaces, test evidence and limitations](docs/ag2b2-security.md)
cover independent Ed25519 test approvals, exact Issue revision binding, mock
exclusive reservations, a durable private local journal, and conservative
recovery. Run the same offline test command above: 85 tests (31 existing + 54 new).
The existing dry-run stays unchanged. There is no live admission/claim/AI mode.

The journal uses actual Node filesystem operations only in explicit local/test
locations. Tests generate signing keys in memory and clean temporary journals.
Do not point it at real tasks or treat its checksum as protection from a malicious
same-user process. No GitHub reservation refs or task-state writes are performed.
AG2B-3 requires new approval; this milestone does not activate dispatch.

## AG2B-3A-1 GitHub read-only observations

[GET-only adapter, manual read evidence and live-claim STOP gates](docs/ag2b3a1-readonly.md).
`ReadOnlyGitHub` observes only the pinned private lab, Issues and exact claim-ref
metadata. Every result denies execution; it cannot replace the mock claim provider.
The optional manual smoke reads existing planning Issue #12 and expects a task
rejection. It is excluded from offline CI and takes existing auth only via stdin.
No live admission, human signer, claim write, daemon or Antigravity activation.
