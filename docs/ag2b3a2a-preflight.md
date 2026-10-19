# AG2B-3A-2A — Offline readiness and first-write preflight

Specification: Issue #14. Product contract: the operator reviews independent
Mac/iPhone approval options, reservation failures and safe recovery without
activating a task. Existing CLI/dry-run behavior and permissions are unchanged;
there is no new user-facing approval screen. Only a later independently enrolled
human could approve a precise reservation; repository actors/labels cannot grant
that permission. Acceptance is all prior tests plus new offline cases, bounded
independent review and exact-head hosted CI, with separate live-write HOLD.
Non-goals: real signer/enrollment/backend, claims, task-state changes, agent/model
calls, services, deployment, merge and production. [ADR-003](adr/0003-independent-approval-reservation.md)
contains the design decision, minimal implementation plan and source references.

## Real read-only observations — 2026-10-19

These observations used existing authenticated GitHub reads, plus visible App and
Claude routine settings. No token was printed/persisted and no setting changed.

| Observation | Result | Interpretation |
| --- | --- | --- |
| Repository | `augusliang23-web/cc-h15a-claude-dispatch-lab`; numeric `1423925660`; node `R_kgDOVN9hnA`; private; not archived/disabled | Exact authorized lab only |
| Main | `f49dda30136a41e8b9b23dbe55d8be916bdce208`; PR #13 merged | Pinned implementation baseline, not a reservation manifest |
| Planning Issue #14 | number 14; numeric `5916030661`; node `I_kwDOVN9hnM8AAAABYJ92xQ`; open; updated `2026-10-19T01:02:34Z` | Planning ticket, NOT an executable task or approval |
| Repository rulesets / main protection | Both GETs 403: upgrade to Pro or make public | Capability/permission blocker, not empty rules or approval to upgrade |
| Environments | `total_count=0` | No configured approval gate; private-plan required-reviewer support unverified |
| Actions permissions | enabled, allowed_actions=all | Read-only observation; no setting restriction/enforcement was added |
| Workflows | Existing offline CI plus four Claude workflows | Four Claude workflow bytes preserved; no dispatch |
| Repository hooks / deployments | empty / zero | Current visible records only, not hidden-provider proof |
| Installed Apps (visible settings) | ChatGPT Codex Connector, Claude, Vercel | Inventory only; no App installation/configuration change |
| Known Claude routine, checked before push/PR | Paused; Enabled=0; All triggers paused; exact canary title `H15A4C_CLAUDE_CANARY_V1`, branch `lab/h15a4c-auto-issue-canary-v1`, author `github-actions[bot]` | This development branch/title do not match; no routine executed or toggled |

External effects were assessed before push/open. The known routine was paused,
visible hooks/deployments empty and the four workflow event/guard definitions
reviewed. Provider internals are not independently audited. Unknown/new App
configuration, unpaused automation or unexpected activity requires STOP and a
fresh decision. Final PR description records exact-head CI and observed activity.

## Concrete target: fixture versus authorized live artifact

The deterministic schema retains `claimKey()` (repository + task ID, independent
of revision/retry). A proposed manifest is `{payload, immutable_evidence_digest}`;
its exact fields/validation are in `reservation-readiness.mjs`. `approval` inside
the core is proposed metadata. Detached human approval signs the complete intent
AFTER core and target commit exist; no signature/evidence hash is inserted back
into that core. See ADR's acyclic byte layout.

Reproducible offline fixture from `manifestFixture()` (never create this ref):

- ref: `refs/heads/cc-ag-claims/v1/3c846feb69d1d02ca56ad42090e25d042d218a8f94b1af8bfeba8dedcf94a4f3`
- core digest: `65aedccefc83265d16c873839b8880e34a2bab02ca3a91c729d2339b4e7d4436`
- task/Issue and App/installation IDs in tests are synthetic, not actual authority.

**Real future ref: UNSET. Real expected manifest digest: UNSET. Real target commit:
UNSET. Real task/approval/principal: UNSET.** No valid executable task has been
selected and no immutable manifest commit exists. Inventing these would be unsafe.
Resolve and independently approve each exact value before the first-write gate.
A prefix, fixture, main SHA or PR approval cannot substitute for exact artifacts.
Creating a Git object/manifest commit is itself a write needing separate scope;
this milestone does not conceal it inside a single-ref write budget.

## Explicit future human authorization envelope

`validateWriteIntent()` validates a proposal, never grants permission. A later
independently verified authorization must bind the complete canonical intent:

- Version/purpose: `CC_AG_SINGLE_WRITE_INTENT_V1`, reservation only, no execution.
- Exact repository name + numeric/node identity; deterministic single ref;
  core manifest digest and verified existing target commit SHA/contents.
- Exact task contract/digest; Issue number/node ID and title/body revision digest;
  agent/model/mode; unique approval ID, Mac owner ID and attempt ID.
- Lab-only GitHub App ID + installation ID, verified repository selection and
  actual permissions: Metadata read, Issues read, Contents write. No production
  or organization scope; no generic existing credential accepted as equivalent.
- Operation `CREATE_REF`; `max_writes=1`; `automatic_retry=false`; trusted
  not-before/expiry bounded by approval validity; current revocation/one-shot use.
- Side effects exactly `ONE_LAB_REF_CREATE_NO_EXECUTION`; pre/post verification
  `EXACT_REF_AND_MANIFEST`; cleanup `RETAIN_NO_AUTOMATIC_DELETE`.
- Pinned independent credential/RP/origin and trusted review display, signature
  bytes, authority/key ID and rotation/revocation evidence retained separately.
  The old approval authority field and valid JSON alone are insufficient.

Human and Control Plane must accept the precise evidence and stop conditions.
Generic 'start next phase', merge approval or passing mocks is insufficient.

## Read / one-shot / verify / reconcile protocol (NOT executed)

Before: re-read pinned repo/main; task Issue identity/raw revision; independent
signature, trusted clock, expiry/revocation/consumption; exact principal/selection/
permissions; applicable prefix rules incl. create/update/delete and all bypasses;
Actions/App/create/push effects; exact ref and complete target commit/tree/core
bytes with digest. A 404 is missing OR inaccessible and never makes this GO.
Require authoritative retained non-replay evidence even if the ref was deleted.
Check awake/available Mac, readable credential and existing private durable locked
journal. Persist and fsync exact intent before any separately authorized request.
Unavailable/unknown/malformed/stale evidence means HOLD, zero automatic retries.

If eventually authorized, perform ONLY that one create operation. No ref update,
force, deletion, metadata fallback, implicit object creation or retry. Reconcile
409/422/timeout/5xx against exact authoritative evidence rather than interpreting
an error or a missing ref as another write opportunity.

After: read exact ref target, commit/tree and canonical core, detached approval,
owner/attempt, current Issue/revocation state and authoritative consumption
receipt. Retain sanitized request IDs, response/time/digests and journal state.
Any ambiguity stays sticky RECONCILE_REQUIRED/UNCERTAIN/BLOCKED. Even fully
matching observations do not authorize execution: `assessRecovery()` always HOLDs.

Cleanup: retain reservation and consumed-approval evidence; no automatic rollback
or delete. Deleting a ref could enable replay and cannot undo external effects.
A human compares remote/journal/approval evidence; uncertain or changed tasks stay
blocked. Any corrective write or new attempt needs separate exact authorization,
not clearing the sticky journal or recreating a missing ref. No exactly-once or
real power-loss durability is claimed.

## Offline tests and independent review

148 original tests unchanged + 36 new = **184**. New cases cover manifest/intent
identity and scope, acyclic detached signature construction/tampering, availability,
credential/journal failure, stale/wrong/completed/running state, create conflict,
duplicate/replayed approvals, overwrite/delete with retained simulated history,
failed/partial/5xx writes, pre-network failure, timeout/5xx after simulated success,
revocation/edit races before/after creation, restart snapshots and no client retry.
Two independent child processes read before a barrier, then contend against one
simulated authority: exactly one simulated winner. No remote request/server.

The authority assumes atomic retained receipts and a trusted clock/revocation
state. This is explicitly NOT proven for GitHub refs; restoring a manipulated
simulation snapshot is not adversarial durable storage. Availability and credential
inputs are interfaces with fixtures, not real sleep/reboot/token detectors.
Subprocesses are bounded test workers, not installed/background services.

A separate GPT-6.1 Sol High reviewer inspected the actual proposed files and ran
183 tests independently. One P2 found circular signed-approval/manifest hashing.
A failing constructibility test reproduced the gap; core -> existing commit ->
intent -> detached approval/receipt now forms an acyclic layout. Its added test
verifies construction and altered digest/target/attempt/principal rejection; all
184 pass after fix. No P1 or other concrete implementation P2 was reported.
The same independent reviewer inspected the focused fix, ran M04 (1/1) and
closed P2 within this offline scope. The reviewer did not approve a Gate or live
operation.

CI extends only the exact same-repo Draft branch/PR pair, base main, contents:read,
GitHub-hosted runner, pinned actions; no secrets/cache/dependencies/live smoke.
The PR description carries final exact-head hosted evidence. Source/tests for
AG2B-1/2/3A-1 and all four Claude workflows stay byte-identical to baseline.

## Recommendation

Offline implementation: ready for review when exact-head CI passes. Approval
path: validate independently enrolled passkey review feasibility; local manual
approval with delayed processing is the lower-service-cost fallback. Neither is
operational or device-tested here. No added recurring service was provisioned;
future hosting/courier or CAS costs and private-plan suitability remain unknown.

**AG2B-3A-2 first live reservation write: HOLD.** Missing independent human proof,
real task/core/commit/ref/principal, immutable nondeletable consumption and bypass
proof, accepted real concurrency/ambiguous-outcome protocol, current automation/
Mac/journal evidence and explicit one-write authorization. GitHub refs alone are
not accepted as a permanent immutable reservation. ADR evaluates conditional
DynamoDB CAS as an unprovisioned alternative; do not add it without a new decision.
