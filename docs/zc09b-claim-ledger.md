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
