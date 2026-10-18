# AG2B-2 contract, design and execution plan

## Product contract / authorized scope

Implement the supplied frozen AG2B-2 specification in the exact private lab from
main 8af5694bd280e26e7ae44b328a1c9f77bfa49cfa. A developer can verify independent
test attestations, simulate exclusive reservations, persist a local journal,
and inspect conservative recovery. No user permission model is inferred from
Issue text. No user interface, live admission/claim/AI/writeback/scheduler or
Claude workflow change. This new security subsystem uses built-in Node 20+
modules. The supplied implementation request is authorization for this offline
scope and one development Draft PR only; task-state GitHub writes remain banned.

## Architecture and review boundary

1. `security.mjs`: fixed-schema task/Issue binding, restricted canonical JSON
   (sorted schema keys, JSON primitives, no nonfinite numbers/custom prototypes),
   SHA-256, Ed25519 public-key verification with independent trusted-key config,
   expiry/revocation/replay checks. Task canonical digest and a separate raw
   title/body digest bind both semantic task and exact Issue content. Keys in
   tests are generated in memory; no private key is committed or journaled.
2. `claims.mjs`: provider interfaces and an offline authoritative mock. The
   single-use reservation key hashes repository + task ID (not revision), so
   changing Issue/revision cannot bypass the old task reservation. Full approved
   binding, approval ID, owner and attempt ID are immutable evidence. One shared
   mock provider arbitrates concurrent promises synchronously before returning;
   this models a server, not a lock between independent JS processes.
3. `journal.mjs`: a private directory, exclusive local writer lock, strict
   versioned checksummed attempt, state-transition history and recovery metadata.
   Atomic replacement uses unique exclusive temp file, file fsync, rename and
   directory fsync. A failure leaves a lock as an uncertainty marker. Readers
   never ignore a lock, corrupt/missing file, or reset state. New initialization
   is explicit; recovery never initializes. No automatic lock removal/retry.
   Optimistic sequence comparison rejects stale writers. One journal contains
   one attempt, cannot be replaced by a different attempt or reset terminal work.
4. `admission.mjs`: mock-only admission/reconciliation using the above interfaces.
   Record claim intent before requesting the mock reservation. Never execute a
   task. Reconcile authoritative exact claims; uncertain execution/claims HOLD.
   Every live boundary throws unconditionally and has no enable switch.

Independent review scope: authorization binding/replay, concurrent mock ownership,
crash ordering, corruption/stale/missing journal, unsafe resume, retained guards
and unchanged workflows. P1/P2 security or data-integrity findings block delivery
until fixed. Mock success is never a live Gate. No production approval is given.

## Execution plan

- [x] Write deterministic security tests for binding, signatures, expiry, replay,
  revocation, unknown authority and self-declared approval; observe red, implement.
- [x] Write concurrent claims/error/uncertainty tests; observe red, implement the
  offline provider with immutable evidence and snapshot restoration.
- [x] Write real temporary-file journal tests for persistence, restore, corruption,
  missing file, invalid histories, failure injection and stale writers; implement.
- [x] Add admission/recovery tests for R01–R12 and safe side-effect boundaries;
  implement mock-only integration. Keep AG2B-1 source and tests unchanged.
- [ ] Run full offline suite and dry-run; independently review once, fix blockers
  with regression tests; create one Draft PR and stop.

## GitHub reservation assessment (design only)

GitHub's create-reference endpoint documents 201, 409, 422; creation requires
repository Contents:write. A 422 is not proof of a competitor (also validation
or abuse rejection). Timeouts/5xx/connection drops are uncertain even if a
reservation was created; never retry creation automatically. Read the exact ref,
then verify target evidence, ownership and approved binding. A SHA alone does
not contain owner/approval: a future ref must target a verified immutable
manifest commit. Claim key uses SHA-256/domain separation to avoid names leaking
Issue text; compare the full manifest too. Prefix listing is not an exact lookup.

References are mutable/deletable by permitted actors; deletion would permit
replay. Contents:write is broader than create-only. No immutable reservation or
cross-runner guarantee is established here. Retained-ref protection/rulesets,
no deletion/update/bypass, server concurrency and evidence validation must be
verified in the lab before using this candidate. A protected compare-and-set
store would be an alternative only if the Control Plane approves its additional
infrastructure. For now real claiming is unconditionally disabled.

Future minimum access: App installed on this lab alone; metadata/issues read,
Contents:write for ref/manifest creation only after separate approval. No org,
production, secrets, workflow-write or runner permissions. Ref creation can
trigger `create` and branch-related automation; audit Actions and external Apps
before activation, do not assume a nonstandard prefix avoids events. Nothing
in this phase creates reservation refs or changes workflows.

Sources (checked 2026-10-19):
- https://docs.github.com/en/rest/git/refs#create-a-reference
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#create
- https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments

## Practical future approval / iPhone

ChatGPT prepares a task + exact digest for a separately authenticated approval
screen. The human uses an independently verified identity/device to approve
that digest, with validity and unique ID; an attestor signs it. A protected
GitHub Environment is a candidate only if the plan supports private-repo required
reviewers and prevents self-review/bypass, and its reviewer identity/action is
proven independent from the ChatGPT integration's same-account credential.
Environment approval alone does not solve that identity problem. Do not deploy
an App/secret or change settings in AG2B-2. Test Ed25519 attestations prove only
cryptographic verification, not human presence. No live approval provider exists.

## Durability and trust limits

Atomic rename gives visibility atomicity, not full power-loss durability. File
and directory fsync are attempted; unsupported/failed sync returns HOLD. Node's
fsync does not request macOS F_FULLFSYNC; APFS/storage hardware may still reorder
or lose acknowledged data after sudden power loss. Checksums detect accidental
corruption, not malicious same-user editing or restoration of an older valid
snapshot. Always reconcile remote evidence; no local snapshot alone authorizes
execution. Private 0700 directory/0600 files and symlink checks mitigate accidents,
not an attacker with the same OS account or root. Lock files are not automatically
expired. Manual reconciliation/removal needs separate approval. A completed local
record prevents replay even if remote evidence is unavailable. Missing journal
HOLDs even when the remote appears empty. No distributed exactly-once claim.


## Interface details and evidence

The Journal record is strict: version, monotonic sequence, claim, task state,
transition history with timestamps, recovery status and updated timestamp.
Required task ID/revision digest/approval ID/claim ID/owner/attempt ID are nested
in `claim.approval.binding`, `claim.approval`, and `claim`; no task body, signature,
private key, token or arbitrary error is stored. Sequence compares reject stale
writers; terminal records cannot be updated or reinitialized. One attempt per
directory is deliberate: this phase has no multi-task executor or retry API.
A new directory is a trusted explicit test setup action, never automatic recovery.

`Ed25519ApprovalVerifier.verify(issue, attestation, ISO-now)` returns a detached
verified payload. The supplied clock/key/status stores are trusted test inputs;
a future live provider must use trusted time, current revocation/consumption and
independent authority configuration. Mock GitHub atomically consumes approval
IDs with reservations. Its snapshot preserves consumed IDs through immutable
claims, and has no release/delete API. Separate mock instances require the same
snapshot/authority; they are not a distributed lock. `readTask` and raw-content
binding perform revision checks before and after a mock reservation. All keys
and signing happen only in test support, generated at runtime in memory.

`simulateClaim` requires an explicitly initialized Journal and MockGitHub.
It validates approval, requires no prior claim or execution evidence, persists
CLAIM_PENDING, attempts one mock reservation, reads it back, revalidates approval
and revision, then records CLAIMED. Every result has `execution_allowed:false`.
No method calls the Antigravity adapter. `recover` never calls attemptClaim.
Any observed inconsistent execution evidence is durably remembered as
RECONCILE_REQUIRED, so disappearance of evidence cannot re-enable admission.
Unknown remote replies, missing evidence, journal errors or availability
conditions HOLD. Availability is injected, not actual machine monitoring.

| Recovery cases | Outcome |
| --- | --- |
| R01 before claim / offline | QUEUED retained; no remote mutation |
| R02 remote claim exists, local QUEUED intent | exact owner/binding reconciled to CLAIMED; HOLD for authorization |
| R03/R04 shutdown/process termination in RUNNING | validated INTERRUPTED → BLOCKED; uncertain, no retry |
| R05/R06 network/ambiguous create failure | RECONCILE_REQUIRED; no second request, exact remote read required |
| R07/R08 missing/corrupt/locked journal | HOLD; no reset or new admission |
| R09 completed | HOLD / ALREADY_COMPLETED; no replay even if remote unavailable |
| R10 another owner or binding | HOLD; existing claim never overwritten |
| R11/R12 stale approval/edited task | HOLD; no admission; edits during claim leave a reservation for review |

Offline suite: existing 31 + new 54 = **85 tests**. Test results include real
private temporary-file writes, a separate Node process restoring persisted
history, promise concurrency (20 mock claimants), 10 competing local journal
writers, fsync/rename failure injection, and a child-process harness trapping
network and process-launch calls while mock admission/recovery runs. Test keys
never leave memory. All temporary journals are removed by test cleanup.
Actual Mac sleep, power-loss durability, multi-machine GitHub concurrency,
protected-environment approval, live authentication and model execution are
NOT TESTED. No live operational claim is made.

Independent review: one separate GPT-6.1 Sol High reviewer assessed the actual
new implementation. Two P2 findings were reproduced with failing tests and
fixed: (1) prior execution evidence must durably block future admission;
(2) ISO approval intervals must use numerical date comparisons, including
expanded years. The full suite passed after fixes. No other blockers or deferred
minor findings were reported within the bounded review. This is evidence for
Control Plane review, not implementation-agent Gate acceptance.

### Delivery rulings

- The explicit one-Draft-PR deliverable authorizes this development branch/PR;
  all prohibitions on GitHub claiming/task-state mutations remain in force.
  If that interpretation is rejected, do not activate anything; the delivery
  changes only lab source code and remains Draft.
- No additional infrastructure or live approval provider is introduced. GitHub
  references remain a design candidate pending demonstrated immutability and
  concurrency safety; no exactly-once guarantee is inferred from API status codes.

Future experience (not active): ChatGPT on Mac/iPhone → GitHub task → separate
human attestation → Mac Bridge reserves exact task → Antigravity executes →
GitHub report → ChatGPT reviews. AG2B-2 provides offline verification and mock
reservation/recovery only. AG2B-3 needs explicit scope, accepted trusted approval
path and independently tested live reservation protections before activation.

## AG2B-2A — sticky journal restrictions and independent offline CI

### Finding, root cause and minimal fix

Control Plane review on PR #11 at `69310e901c073fac01ed72b48fcadc555949ed4f`
identified that a valid recovery-status *value* was being confused with a safe
recovery-status *transition*. Ordinary updates could clear CLAIMED /
RECONCILE_REQUIRED back to CLAIM_CONFIRMED, or RUNNING / UNCERTAIN back to
EXECUTING, and even mark uncertain execution COMPLETED. Live execution was and
remains disabled, but this would be unsafe for a future executor.

`Journal.update` now applies a small explicit safety-progression policy, under
the same exclusive lock and before persistence, in addition to the existing
state machine, schema validation and sequence check:

| Previous restriction | Only permitted destination pairs |
| --- | --- |
| RECONCILE_REQUIRED | QUEUED / RECONCILE_REQUIRED; CLAIMED / RECONCILE_REQUIRED |
| UNCERTAIN | RUNNING / UNCERTAIN; INTERRUPTED / UNCERTAIN; BLOCKED / BLOCKED |
| BLOCKED | No update; existing terminal guard remains |

Task-state transitions must also be valid, so the table does not permit skipping
RUNNING → INTERRUPTED before BLOCKED or moving CLAIMED backward to QUEUED.
QUEUED / RECONCILE_REQUIRED → CLAIMED / RECONCILE_REQUIRED remains available to
record an exact remote claim without clearing the restriction. CLAIM_PENDING is
not an irreversible uncertainty state: READY → CLAIM_PENDING → verified CLAIMED /
CLAIM_CONFIRMED continues to work. Failed ordinary downgrades leave persisted
bytes and sequence unchanged. A different process or refreshed sequence cannot
bypass the policy.

There is no restriction-clear API, environment flag or CLI bypass. A future
trusted reconciliation mechanism would need independent authorization bound to
exact task digest and attempt identity, verified remote evidence, an explicit
recovery decision and an audit trail. That mechanism is documentation-only here.
Checksums still do not prevent a malicious same-user process from editing or
rolling back the file; the earlier durability/trust limits remain unchanged.

### Focused test evidence

`bridge/test/journal-policy.test.mjs` covers J01–J10 and equivalent cross-state
bypasses, with parameterized cases rather than duplicate tests for each property.
Each rejected-update case also compares actual file bytes before/after (J07).
The restart case uses another Node process (J08); stale/current writer checks
cover J09; corrupt journal read/update checks cover J10.

Before fix: **14 tests, 4 pass / 10 fail**, reproducing unsafe state clearing.
After fix: **14/14 pass**. Full local suite: **85 existing + 14 new = 99/99 pass**
on Node 20.20.2. Existing dry-run remains 3 candidates / 1 valid / 2 rejected.
Syntax and whitespace checks pass. The separate-process/network-trapping safety
suite still exercises the unconditionally disabled live admission/claim/AI
boundaries. No original AG2B-1/AG2B-2 tests are removed or weakened.

### Dedicated CI, permissions and reproducibility

New workflow: `.github/workflows/ag2b-offline-ci.yml`, **AG2B offline safety CI**.
Only pull_request synchronize/reopened events on main with relevant bridge,
workflow or security-document changes are eligible. The job additionally requires
this exact lab, PR #11, same-repository head, branch
`codex/ag2b2-secure-claim-recovery` and Draft status. There is no push, issues,
pull_request_target, workflow_run, manual or schedule trigger.

The hosted Ubuntu job has a five-minute timeout and only contents:read. It checks
out the exact event PR HEAD with full history and persist-credentials:false,
ensuring the older AG2B-1 workflow-byte-comparison baseline exists. Verified
immutable official pins: checkout v6.1.0 at
`d23441a48e516b6c34aea4fa41551a30e30af803`; setup-node v7.1.0 at
`949feb2413d6458794dcd2491c4babbbce0c15c1`. Node 22 is selected; automatic package
caching is disabled. No package installation, matrix, cache or artifacts.

Commands:

```sh
node --check <each changed .js/.mjs file>
git diff --check <event base SHA> <event PR HEAD SHA>
node --test --test-reporter=spec bridge/test/*.test.mjs
node bridge/dry-run.mjs
```

The job validates the checked-out HEAD and baseline commit before testing. The
full CI command includes the safety tests trapping model/network/process launch
and the immutable old Claude workflow comparison. It has no provider credentials,
secret expressions, deploy commands, task-state writes or merge actions.

Run-specific evidence (actual run URL, exact HEAD, executed steps and outcome)
is recorded in the existing Draft PR #11 description after readback. The checked-in
workflow/document alone is not CI PASS. Keeping that evidence in the PR avoids
changing the candidate just to embed its own run URL. CI runs the same 99-test
suite as local; the observed result, rather than this configured scope, decides
CI TESTED status. No local result substitutes for a failed/missing CI run.

### Automation preflight and review boundary

Read-only preflight found repository webhooks empty; Actions enabled. All four
existing workflows have only their existing manual/Issue-opened triggers and
remain unchanged. The repository Apps page lists ChatGPT Codex Connector, Claude
and Vercel; no changes to those integrations were made. At the starting HEAD,
checks/status lists and repository deployments were empty. GitHub App-specific
API enumeration was unavailable to the CLI token; the repository Apps browser
page supplied the inventory instead.

Claude's Routines UI was inspected directly: the only listed experimental
routine, `Command center測試用`, is Paused, Enabled=0, with **All triggers are
paused**. Its trigger is PR Opened for this lab, guarded by exact canary title
`H15A4C_CLAUDE_CANARY_V1`, branch `lab/h15a4c-auto-issue-canary-v1` and bot author.
PR #11 updates do not match. No routine/App was enabled, disabled or edited; no
new PR or dispatch Issue is created. Remote activity is checked after CI too.
This is the observed preflight, not a claim to inspect hidden provider internals.

IMPLEMENTED: monotonic safety transition policy and narrow offline CI workflow.
MOCK TESTED: task/claim/approval and recovery scenarios; actual temporary-file IO
and separate Node process restore are tested locally. CI TESTED requires actual
run evidence in PR #11. LIVE TESTED: none of the operational Bridge. NOT TESTED:
real distributed GitHub locks, Mac shutdown, power-loss durability, independent
human approval or Antigravity execution. Merge and AG2B-3 remain separate Gate
and explicit human-authorization decisions.

AG2B-2A independent bounded review: a separate GPT-6.1 Sol High reviewer inspected
the journal-policy diff, J01–J10 tests and CI configuration, and independently
ran 99/99 offline tests, dry-run, syntax and whitespace checks. No actionable
P1/P2 findings were reported. Hosted Node 22 execution remains a separate CI
check; the reviewer did not claim a Gate or release approval.
