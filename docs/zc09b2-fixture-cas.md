# ZC-09B2 — Fixture-only revision CAS persistence (NOT a live runner)

Related Issue: #43. Independent from unmerged ZC-09A PR #39 and ZC-09B1 PR #42.

## Scope

This experiment fills one missing engineering proof: two **honest, concurrent Linux fixture processes** must not both commit the same revision. It writes only to a newly created 0700 child of the Linux runtime's temporary directory whose basename begins `zc09b2-fixture-`. It never opens a GitHub token, changes a real repository, reads the owner's Mac settings, calls a model or launches an Agent.

- `initializeFixture({root,ledger})`: creates `ledger.json` with O_EXCL, 0600, fsync. Cannot overwrite a previous record.
- `inspectFixture({root})`: checks the exact expected directory inventory, non-symlink 0600 regular file, bounded size, canonical JSON digest and strict synthetic schema. An orphan stage or lock produces HOLD.
- `compareAndSwapFixture({root,expectedRevision,proposedLedger,now})`: obtains an exclusive lock, reads committed state, checks exact expected revision, immutable task SHA, append-only event history, timestamp order, attempt/lease consistency, sticky terminal gate, and future lease expiration. Commits by fsync of a new randomized stage and atomic rename into the existing temp fixture, followed by directory fsync.
- CAS mismatch or invalid proposal detected before staged writes releases the fixture lock; ambiguous failure after stage creation **keeps both lock and stage**. There is no automatic cleanup, lease stealing or crash-replay.
- Every output declares `actual_dispatch=false`, `github_writes=0`, `provider_calls=0`, `mac_writes=0`, `durable_live_claim=false`, and `ready_to_merge=false`.

## Explicit limitations

1. This is a **cooperative-process fixture**, not a secure distributed lease or production data store. A malicious process running under the same UID can race known files, locks, and staging names. Linux permissions and unkeyed SHA-256 are not an authentication boundary. The same-UID macOS vulnerability discovered in ZC-06C is **not fixed** by this experiment.
2. No real GitHub event or independent CI/Codex verification is performed. Ledger input remains synthetic; `now` is caller supplied and cannot attest real time.
3. No work is automatically resumed. No active process heartbeat, authentication, permissions, billing checks, or transactionally integrated executor exists.
4. The code intentionally rejects native macOS execution, any location outside the direct temporary fixture prefix, and group-visible directories or files.
5. A successful test proves only that two **cooperating test processes** cannot both win the same revision. It does not prove global exactly-once execution, durability after power loss, or resilience against hostile same-UID writers.

## Test plan and gates

Run `node --check bridge/zc09b2-fixture-cas.mjs`, `node --check bridge/test/zc09b2-fixture-cas.test.mjs`, and `node --test bridge/test/zc09b2-fixture-cas.test.mjs` on a disposable Linux runner. Tests include two-process competition, revision replay, crash left-behind records, symlink attempts, invalid trusted paths, corruption, malformed proposals, impossible lease lifecycles and sticky safety stop.

Do not execute the fixture module with production data or assume `SYNTHETIC_FIXTURE` is an owner authorization. The proposed next step is a separately reviewed trust model using an authenticated event source and an OS-isolated worker; it requires distinct approval and is not granted here.

**Gate:** `ZC09B2_OFFLINE_FIXTURE_ONLY / LIVE_EVENT_AND_WORKER_HOLD / NO_MERGE_OR_DEPLOY`.
