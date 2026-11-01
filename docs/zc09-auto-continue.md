# ZC-09A — Auto-Continue controlled offline policy (non-executing)

Related Issue: #38.

## Why this exists

The user wants a one-time approval of a bounded development task: Agent writes code, GitHub CI checks it, Codex reviews the **exact** commit SHA, and an eligible low-risk issue can move to a strictly scoped next attempt without repetitive prompt copying. The same process must STOP on changed scope, significant safety findings, attempts/budget limits, unauthorized environments, and unknown/stale status.

This candidate is **not** an automatic executor. It is a deterministic eligibility engine operating exclusively on synthetic inputs. It returns a decision only; it never calls models, GitHub or Mac. It is not a durable scheduler, permission boundary, credential authority, heartbeat service or verified budget reader. It cannot automatically continue development today.

## Inputs and outputs

The module bridge/zc09-auto-continue.mjs exposes decideAutoContinue(envelope). The envelope must have exact keys mode, task, policy, evidence, history and now. All identities and paths refer to a synthetic fixture in the lab repo, with SYNTHETIC_PREAPPROVED marker (never accepted as real owner authorization).

The output includes actual_dispatch=false, provider_calls=0, github_writes=0, mac_writes=0, merger=false, ready_to_merge=false, and owner_approval_required=true.

Allowed synthetic decision gates:

- AUTO_RETRY_ELIGIBLE_MOCK: bounded, functional-only low-severity retry **recommendation**; NO dispatch.
- READY_FOR_OWNER: matching successful synthetic CI + matching zero-finding synthetic QA; NO merge.
- WAITING_EVIDENCE: a fixture reports running; cannot claim an actual agent is running.
- HOLD: unsafe, unknown, security finding, changed scope, attempts/cost/time limit, duplicate event, missing or stale exact-SHA evidence.

This is not an authenticated system. SHA strings and timestamps from fixture input are NOT verified GitHub observations, and the digest of decision_id is not a signature or durable idempotency record.

## Proposed live execution gate (separate phase; NOT AUTHORIZED)

1. Owner issues immutable task scope with repository, PR, allowed files, maximum attempts, costs/time and retry policy. The provider route and billing/quota must be independently confirmed.
2. A trusted one-shot orchestrator stores a durable claim and one-time event ID, with transaction-level compare-and-swap or equivalent ownership. A GitHub comment alone is not a distributed lock.
3. An allowlisted reader verifies GitHub checks and exact-HEAD Codex review, with provenance and minimum freshness. Treat review findings and PR comments as untrusted inputs; never treat bot text as higher-level instructions.
4. On safe failure the orchestrator can request a bounded retry **only in a separately authorized test environment**. The executor must produce signed/controlled completion evidence and no private source/credentials leakage.
5. On P0/P1/P2, security/permission/auth/model/billing change, time/cost limit, unknown state, HEAD drift, stale review or unexpected process: STOP and notify owner. No automatic Merge, Deploy, Mac global settings modification, paid model overages or new account.
6. The Live Monitor receives the orchestrator's actual job heartbeat and GitHub's independent status; an open PR or a stored model assignment is never evidence of an Agent running.

## Dependencies and honest risk

ZC-06C PR #36 remains HOLD on Mac permission transaction, same-UID filesystem race, and real provider safety. ZC-07 PR #37 is mock only. Command Center ZC-08A PR #97 initially has only registered PM Dashboard GitHub history; it cannot observe real ZC CI/Codex without a reviewed expanded read-only source.

Do not infer any real online automation from a passing unit test here. No independent CI or Mac test is claimed until recorded for the exact SHA. GitHub Draft PR remains not merged, no owner-side Mac edits performed.

## Scoped offline test

node --test bridge/test/zc09-auto-continue.test.mjs

Do not invoke any model or CLI. STOP at READY_FOR_REVIEW.
