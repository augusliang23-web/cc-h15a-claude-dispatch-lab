# AG2B-1 product contract and implementation plan

## Approved boundary

The Control Plane needs a safe preview of GitHub tasks for a Mac bridge, including when the Mac is unavailable. This phase implements only offline foundation logic. The supplied AG2B-1 task is the frozen specification and authorizes implementation, local tests, and one Draft PR.

Primary scenario: a developer runs a local dry-run over mock GitHub Issue envelopes and sees candidate/valid/rejected counts, sanitized rejection codes, and the next eligible task. Only the exact private lab repository is allowed. The caller is a local developer; a self-declared `approval: approved` in an Issue is schema data, **not authenticated authorization**. No live admission is permitted.

Non-goals: actual GitHub reads/writes from the bridge, task claiming, provider calls, subprocess execution, scheduling, deployment, merge, and changes to Claude workflows. Real Mac sleep/restart and GitHub integration are not tested by simulation.

## Design

Use dependency-free Node.js 20+ ES modules and node:test. Strict JSON-only Issue bodies contain exactly the versioned task keys; no free-form commands, prompt, script, or extension fields. Issue envelope number must match contract number. Duplicate identifiers in a batch are all rejected, including the first occurrence; previously owned identifiers are never eligible again in the mock history.

A pure state machine enforces only the six approved transitions. A mock ownership ledger models one active task, immutable event history, and conservative recovery: RUNNING becomes INTERRUPTED then BLOCKED; CLAIMED remains reserved and requires manual resolution. COMPLETED/FAILED/BLOCKED history cannot be reused. Unknown/corrupt history fails closed. This is a simulation, not a durable or distributed lock.

The fixture reader has only a read method. Errors return a sanitized HOLD with no next task. Availability gates preserve QUEUED tasks without retries. A mock adapter returns a structured, explicitly simulated BLUE LANTERN result. All live entry points throw unconditionally; no enable flag exists.

## Implementation sequence

- [x] Write T01–T15 and boundary tests; run against missing implementation to verify red.
- [x] Implement contract, queue preview, state and recovery model, mock result adapter, and fixture CLI.
- [x] Run full offline suite and dry-run; review diff and compare all existing workflow bytes to baseline.
- [ ] Commit and push only this branch; open one Draft PR with evidence and limitations, verify remote diff, then stop.

## Acceptance / review boundary

Implementation is ready for Control Plane review only when T01–T15 pass, dry-run has no AI/network/task-state writes, and workflows remain byte-identical. Missing safety evidence means HOLD. Mock test success is not a live/UAT Gate approval. No independent live or security approval is implied by implementer self-review.

## Future AG2B-2 gate

Before any real admission, decide how trusted Control Plane authorization is bound to exact task content/revision. Require a separately authorized atomic ownership mechanism or a documented single-runner constraint plus durable crash-safe journal; labels/comments alone are insufficient. Reconcile uncertain history against authoritative GitHub evidence before resuming; never treat missing local state as permission to replay. Explicit retry approval must identify the task and prior attempt. No distributed exactly-once guarantee is made.
