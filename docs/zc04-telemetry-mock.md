# ZC-04A — Agent Telemetry Mock V1 (NON-LIVE)

This is an **offline-only**, deterministic status projection. Every returned snapshot contains `simulated:true`. It does **not** read GitHub live data, use an Agent, modify Issue/PR/Claim, heartbeat in the background, or verify any provider's session. The evidence kinds are **fixture assertions**, not cryptographic provenance. Never show these statuses as real-time operational data.

## Event flow and freshness

`QUEUED (GitHub)` → `CLAIMED (Mac)` → `RUNNING (Mac)` → `ARTIFACT_READY (GitHub commit)` → `REVIEWING (Codex cloud)` → `QA_PASSED` → `COMPLETED (verified result)`. Terminal `HOLD / FAILED` allowed at pre-terminal states. Strict event schema, one task ID, sequence starting at 1, monotone UTC times and approved actor/source/proof combinations. `HEARTBEAT` is accepted only in `RUNNING` (Mac) or `REVIEWING` (Codex cloud) and does **not** advance milestones.

Snapshot health is `ACTIVE`, `STALLED` (last observation too old), `ALIVE_NO_PROGRESS` (fresh heartbeat but last milestone old), `NEEDS_ATTENTION`, `OBSERVED_ONLY`, or `COMPLETED_VERIFIED_IN_FIXTURE`. `ACTIVE` means recently observed mock event, not guaranteed real execution. No invented progress percent. Invalid or unknown event data produces sanitized `HOLD/UNVERIFIED`.

## Proof semantics and limitations

- GitHub Issue existence alone never means Antigravity is running. A `@codex review` comment is not a completed review.
- A Git commit does not establish QA PASS or end-to-end success. `QA_PASSED` must refer to the same review and SHA as `ARTIFACT_READY`; `COMPLETED` requires matching final result proof.
- Last heartbeat establishes, at best, transport liveness; it cannot prove useful progress. Stale signals should request a check, not automatically retry a task.
- A single local view is not a distributed Claim/Reservation system. Real source identity, signed/pinned events, atomic no-replay delivery, stale events and source fetch authentication remain design work for ZC-04B.

## Offline verification

```sh
node --test bridge/test/telemetry-mock.test.mjs
node bridge/telemetry-demo.mjs
```

Both commands use local in-repo fixture data only. The demo uses a pinned 2026-10-31 simulation clock; it does not read the current time as a live-status assertion. No extra dependencies.

## Release gates

- ZC-04A: deterministic mock + CI. Draft PR only; no merge by default.
- ZC-04B: **separate** permission required for least-privilege Mac → GitHub telemetry writes and provenance/replay controls.
- ZC-04C: live ChatGPT operational view and optional notifications only after data can be verified.
- PR #22's two Codex P2 findings (ancestor symlink / fsync durability) remain unresolved. This prototype is NOT a workaround and MUST NOT authorize real agent execution.
