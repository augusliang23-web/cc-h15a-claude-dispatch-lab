# ZC-MVP-A: Mac Local Bridge Mock E2E Architecture & Deployment Specification

**Status:** Mock MVP / Prototype (OFFLINE ONLY)  
**Security Gate:** `G1_HOLD / ZC_WORKER_HOLD`  
**Repository:** `augusliang23-web/cc-h15a-claude-dispatch-lab`  
**Base Commit:** `b577bbae9e26c8751db9fe389753c4dda1b5cdac`  
**Associated Issue:** [Issue #45](https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/issues/45)  
**Branch:** `zc/zc-mvp-a-mac-local-bridge`  

---

## 1. Overview & Objective

ZC-MVP-A implements an offline, synthetic **Mac Local Bridge Mock MVP** within the Zero-Copy Dispatch Lab. It proves that a local host process on macOS can safely receive, validate, lock, simulate execution, and normalize results without making live API calls, invoking the real `agy` CLI, or performing unauthorized writes to GitHub.

### End-to-End Synthetic Control Flow
```
Synthetic Grok Task (zc.task/v1 JSON)
       │
       ▼
Mock GitHub Task Source (Read-only fixture reader)
       │
       ▼
Local Bridge (zc-mock-bridge.mjs)
       │
       ├──► 1. Task Envelope Validator (zc-bridge-auth.mjs)
       │       └── Schema, keys, prototypes, expiry, size
       │
       ├──► 2. Authorization Scope Validator (zc-bridge-auth.mjs)
       │       └── Exact HEAD SHA, allowlist boundaries, risk level
       │
       ├──► 3. Local Claim Controller (zc-bridge-claim.mjs)
       │       └── Mutual exclusion, state ledger, idempotency
       │
       ├──► 4. Mock Antigravity Worker (zc-mock-worker.mjs)
       │       └── 0 provider calls, simulated BLUE LANTERN outcome
       │
       ├──► 5. Mock QA Result Normalizer (zc-mock-worker.mjs)
       │       └── Verify synthetic CI & Codex QA approval evidence
       │
       ▼
Structured Normalized Result (CC_AG_RESULT_V1)
```

---

## 2. Module Boundaries & Responsibilities

1. **`bridge/zc-bridge-auth.mjs` (Task & Authorization Validator)**:
   - Validates the `zc.task/v1` (and `CC_AG_BRIDGE_V1`) task envelope.
   - Enforces exact commit binding (`target_sha === context.head_sha`).
   - Confines allowed file modifications strictly to the authorized allowlist.
   - Rejects prototype pollution (`__proto__`, `constructor`, `prototype`), path traversals, expired tasks, and unapproved requests.
   - Stops at `HIGH_RISK_HOLD` if `risk:high` is declared.

2. **`bridge/zc-bridge-claim.mjs` (Claim Controller & State Ledger)**:
   - Enforces the state machine:
     `QUEUED -> CLAIMED -> RUNNING -> COMPLETED`
     `RUNNING -> FAILED`
     `RUNNING -> INTERRUPTED -> BLOCKED`
   - Single-instance mutual exclusion via `bridge.lock` containing the active PID.
   - Hash-chained audit journal (`journal.ndjson`) with SHA-256 digests.
   - Replay defense: prevents re-executing `COMPLETED` tasks.
   - Maximum attempt counter: stops with `FAILED_MAX_RETRIES` if retries exceed `max_attempts`.
   - Crash recovery (`recover()`): automatically transitions abandoned `CLAIMED` or `RUNNING` tasks to `INTERRUPTED -> BLOCKED`.

3. **`bridge/zc-mock-worker.mjs` (Mock Worker & QA Normalizer)**:
   - 100% offline synthetic worker adapter.
   - Never calls `agy`, Gemini/Claude APIs, or external tools.
   - Supports fault injection (`crash`, `network-failure`, `timeout`, `malformed-result`, `failing-ci`, `rejecting-qa`, `unauthorized-action`).
   - Normalizes output to `CC_AG_RESULT_V1` with anti-forgery report markers (`CC_AG_BRIDGE_V1_MOCK_<uuid>`).
   - Verifies that `files_modified: []` and `commits_created: []` remain empty during mock execution.
   - Requires verified passing CI and Codex QA approval before allowing task completion.

4. **`bridge/zc-mock-bridge.mjs` (Main Orchestrator)**:
   - Ties all stages together into a single reproducible pipeline.
   - Responds to emergency STOP file sentinels and signals.
   - Produces structured traces and metrics:
     `{ actual_dispatch: false, provider_calls: 0, runtime_github_writes: 0, mac_settings_writes: 0 }`.

---

## 3. Automated Security & Negative Test Matrix

The test suite in `bridge/test/zc-mock-bridge.test.mjs` executes via Node.js native test runner (`node --test`) covering 16 test cases:

| ID | Test Case | Condition / Input | Expected Assertion |
| :---: | :--- | :--- | :--- |
| **TC-01** | Happy Path Rehearsal | Valid Synthetic Grok Task, correct SHA, allowlist match | `COMPLETED`, `MOCK_E2E_SUCCESS`, valid trace, 0 provider calls |
| **TC-02** | Missing Authorization | `approval !== 'approved'` | `HOLD`, `MISSING_AUTHORIZATION` |
| **TC-03** | Commit SHA Mismatch | `target_sha !== head_sha` | `HOLD`, `SHA_MISMATCH` |
| **TC-04** | Allowlist Tampering | Path traversal (`../../etc/shadow`) or unauthorized file | `HOLD`, `PATH_TRAVERSAL_IN_ALLOWLIST` / `ALLOWLIST_VIOLATION` |
| **TC-05** | Duplicate Replay Defense | Identical `task_id` submitted twice | Second execution rejected with `TASK_ALREADY_SEEN` |
| **TC-06** | Expired Task | `expires_at <= current_time` | `HOLD`, `TASK_EXPIRED` |
| **TC-07** | High Risk Task | `risk: 'risk:high'` | `HOLD`, `HIGH_RISK_HOLD` |
| **TC-08** | Max Retry Cap | Attempt count exceeds `max_attempts` | `FAILED_MAX_RETRIES` |
| **TC-09** | Worker Crash Recovery | Worker process crashes unexpectedly | Journal preserved; recovery marks task `INTERRUPTED -> BLOCKED` |
| **TC-10** | Network Failure | Simulated `ENOTFOUND` during task fetch/execution | Handled gracefully, returns `FAILED`, no uncaught exception |
| **TC-11** | Malformed Result | Worker returns missing fields or corrupt types | `HOLD`, `INVALID_RESULT_SCHEMA` |
| **TC-12** | Missing CI / QA Evidence | CI failed or QA findings > 0 | `HOLD`, `GATE_CI_MISSING_HOLD` / `GATE_QA_MISSING_HOLD` |
| **TC-13** | Unauthorized Action | Attempted file writes or deploy actions | `HOLD`, `UNAUTHORIZED_FILE_MODIFICATIONS_DETECTED`, 0 github writes |
| **TC-14** | Prototype Pollution | Payload containing `__proto__` / `constructor` | Throws `UNTRUSTED_TASK_KEY` |
| **TC-15** | Emergency STOP Sentinel | File `STOP` present in bridge storage | `HOLD`, `EMERGENCY_STOP_TRIGGERED` |
| **TC-16** | Concurrency Lock | Concurrent bridge instances on same storage | Throws `BRIDGE_BUSY_LOCK_HELD` |

---

## 4. macOS Execution & launchd Planning Specification

> [!CAUTION]
> **This section is a design draft only.** No background daemon is installed or started during this mock phase.

### 4.1 launchd Service Configuration (`com.zerocopy.localbridge.plist`)
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.zerocopy.localbridge</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/node</string>
        <string>/Users/augusliang/Developer/augusliang23-web/cc-h15a-claude-dispatch-lab/bridge/zc-mock-bridge.mjs</string>
        <string>--daemon-mode</string>
    </array>
    <key>RunAtLoad</key>
    <false/>
    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
        <key>Crashed</key>
        <true/>
    </dict>
    <key>ThrottleInterval</key>
    <integer>30</integer>
    <key>StandardOutPath</key>
    <string>/Users/augusliang/.gemini/bridge/logs/bridge.out.log</string>
    <key>StandardErrorPath</key>
    <string>/Users/augusliang/.gemini/bridge/logs/bridge.err.log</string>
</dict>
</plist>
```

### 4.2 Key Operational Safeguards
1. **Mac Sleep & Power Management**:
   - Mac system sleep suspends background event loops and drops network sockets.
   - For real workers in future milestones, execution must wrap the running task in macOS power assertions (`caffeinate -i -s`) strictly during `RUNNING` state, releasing immediately upon completion or failure.
2. **Polling Frequency & Exponential Backoff**:
   - Idle polling interval: 15 seconds.
   - Queue empty or HOLD: 60 seconds.
   - Network failure backoff: $15\text{s} \times 2^n$ up to a maximum ceiling of 300 seconds.
3. **Single-Instance Mutual Exclusion**:
   - Managed via atomic lockfile `bridge.lock` containing the active PID.
   - If the PID is alive, secondary processes exit immediately with `BRIDGE_BUSY_LOCK_HELD`.
4. **Crash Recovery**:
   - When the bridge boots, `recover()` inspects existing state records.
   - Orphaned `CLAIMED` or `RUNNING` tasks are immediately converted to `INTERRUPTED -> BLOCKED`. No task is silently restarted without explicit human authorization.
5. **Emergency Manual STOP Mechanism**:
   - Creating a sentinel file `~/.gemini/bridge/STOP` causes the bridge orchestrator to pause immediately, reject incoming claims, and safely park.
6. **Log Sanitization & Redaction**:
   - All log writes pass through regex sanitizers redacting API keys, GitHub PATs, OAuth bearer tokens, and private paths.
7. **Zero-Cost Guarantee**:
   - `provider_calls === 0` is strictly enforced. No LLM tokens or API credits are consumed.

---

## 5. Security Gates & Review Status

- **Current Gate:** `READY_FOR_REVIEW` (for ZC-MVP-A offline mock scope).
- **Formal Worker Gate:** `G1_HOLD / ZC_WORKER_HOLD` remains in effect.
- **Merge & Deploy:** Forbidden. This work is isolated to Draft PR only.
