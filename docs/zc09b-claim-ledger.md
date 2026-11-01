# ZC-09B1 — Synthetic claim ledger (pure logic, NO execution)

Related: Issue #41. Builds on the ZC-09A (#39) idea but is deliberately standalone because that PR is unmerged.

## Why this milestone matters

The existing ZC-09A decision recommends a synthetic retry but has **no task claim or persisted ownership**. This candidate defines a version-pinned transition that future infrastructure could store using a transaction or compare-and-swap. Until such storage and a trusted worker exist, **nothing is running automatically**.

## Contract

- Exports `proposeClaimTransition({ledger,event,expectedRevision,now})` and a frozen synthetic fixture. No fs, network, shell, GitHub client, provider, timers or environment variables.
- Fixed lab repository and task/PR/exact SHA, strict allowlisted field types, synthetic-only event evidence, freshness clock, version and event-history watermark.
- Candidate `MOCK_CLAIM_PROPOSED`: increments proposed revision/attempts, records event and a deterministic lease token. The token is a **digest, not a signature or authenticator**. The result must NOT be taken as an actual claim; there is no committed state.
- `MOCK_RETRY_ALLOWED`: a failed synthetic completion removed the old mock lease but made no worker call; another event/revision would still be necessary to attempt a mock claim.
- `READY_FOR_OWNER`: matching synthetic completion only; terminal, **not** authorized for merge or deploy.
- `HOLD`: malformed, duplicate, stale/equal/reordered event, mismatched immutable task or HEAD, unverified CI/QA, risk or permission change, wrong/expired lease, active claim, cap, unknown state or revision conflict.
- Unsafe findings, HIGH/SECURITY risk, permission change and explicit HALT propose a sticky `SAFETY_HOLD`. Owner approval is still needed; no means of automatic reset.
- Max 3 claims, at most 600 seconds per lease, 16 retained event IDs. All output flags: `actual_dispatch=false`, `provider_calls=0`, `github_writes=0`, `mac_writes=0`, `durable_claim=false`, `ready_to_merge=false`.

**Security limitation:** Inputs are synthetic and do not authenticate GitHub, CI, Codex, task ownership, actual billing, or native Mac isolation. `expectedRevision` is a mere argument; two callers can receive the same proposed revision and both think they won. A future owner-approved implementation MUST persist a single ledger with a trusted transaction-level CAS, verify the exact GitHub evidence from independent APIs, and guard worker execution with authenticated one-shot tokens. No untrusted GitHub comment or model-written text may authorize execution.

## Verification

`node --check bridge/zc09b-claim-ledger.mjs`

`node --test bridge/test/zc09b-claim-ledger.test.mjs`

GitHub Actions workflow (separate Draft-only, exact PR number) runs only these synthetic tests, without packages, credentials, providers or source writes. Any green test cannot be described as a live end-to-end Zero-Copy workflow.

## Future gates (not authorized here)

1. Store the proposed ledger transactionally with a real compare-and-swap primitive.
2. Authenticate event source and exact SHA of CI/review, independently distinguish code review from successful tests.
3. Enforce model/tool limits, bounded cost/time/attempts and independent approval before a real work process.
4. Prove macOS tool permissions and same-account isolation, or use separate sandbox that does not alter global user settings.
5. Only then, with explicit owner approval, turn on one controlled worker. No autonomous Merge or Deploy.

Current gate: `OFFLINE_POLICY_AND_CLAIM_PROPOSAL_ONLY / LIVE_DISPATCH_HOLD`.

## Review-1 P2 remediation — recorded exact-HEAD negative evidence

Codex reviewed initial `3d773bf2` and identified four P2 edge cases; the next candidate closes them by proposing an immutable revision advance when a **structurally valid exact-head CI/QA failure** is observed. The negative event's ID and observed timestamp are stored in the *proposed* ledger so an older green result cannot subsequently claim work. This still is **not durable** until a future authorized compare-and-swap store commits it.

Explicit `HALT`, HIGH/SECURITY risks, permissions changes and positive findings now propose sticky `SAFETY_HOLD` **before** the CI/QA proof freshness check; a recent safety event carrying old CI/QA evidence cannot be silently discarded. An expired prospective lease is never proposed, even if the event itself falls inside the 5-minute event-freshness window. Ledger validation now requires `revision === seenEvents.length`, positive claims before any active lease and a lease claimEventId previously recorded in the event history. These are syntactic lifecycle constraints, not proof of external authority.

Test coverage grew from 34 to 41 cases. GitHub Actions [run #41289555312](https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/actions/runs/41289555312) passed **41/41** on exact source/test HEAD `e92778b7b2c87dad381a265663b8f013dc4d4873`; the document commit changes HEAD again and requires independent exact-HEAD verification before final QA acceptance. No live worker, durable ledger or file/network write was activated.
