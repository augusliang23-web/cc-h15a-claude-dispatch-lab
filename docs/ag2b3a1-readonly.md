# AG2B-3A-1 — GET-only GitHub observations and claim preflight

Specification: lab Issue #12. Starting main:
`4f652d1a6a106cbfeadb8f2d148f1686b44e452c` (merged PR #11).
The supplied request authorizes only development, offline tests, one existing
harmless-Issue read, one Draft PR and its offline CI. No task/ref mutations,
model execution, signer setup or background process are authorized.

## Product contract and minimal plan

A developer can inspect lab repository/Issue metadata, list Issues with bounded
pagination, bind an exact Issue revision, and observe an existing reservation
ref. Results are explicitly non-executable. The transport only performs GET to
fixed paths under https://api.github.com/repos/augusliang23-web/cc-h15a-claude-dispatch-lab.
No URL supplied by an Issue, pagination link or API body is executed/followed.
The repository name, private status and numeric/node identity are pinned.

- [x] Write transport/identity/pagination/revision/error/guard tests; observe red.
- [x] Implement built-in Node fetch adapter and explicit fixed-Issue manual smoke.
- [x] Preserve 99 prior tests and four Claude workflows; narrowly extend offline CI
  to the new same-repository Draft branch and opened events.
- [x] Perform one real read-only smoke with existing auth, record sanitized evidence;
  never accept this planning Issue as an approved task.
- [ ] Independent targeted security review, fix blockers with regression tests;
  one Draft PR and exact-head successful CI, then stop.

## Trust and interpretation

`node_id` is an opaque GitHub Issue identity, not a username, Issue number or
base64-decoded assumption. Normalize it directly into `issue_id` after validating
API URL/number/node identity. A caller may pin expected identity and exact
revision digest for a subsequent read; changed, closed, deleted/inaccessible or
PR-shaped Issues HOLD. A canonical task digest plus raw title/body digest still
detects task edits. Provenance proves an observation from the pinned API, not
human approval. Labels, comments, owner names and self-declared `approved` are
never an independent attestation. No live approval provider is installed.

Issue lists are not transactional snapshots. Complete bounded pagination,
duplicate detection and later exact revision checks mitigate inconsistent reads;
any malformed/partial/error page discards the entire batch. No partial task list
is returned as safe. Exactly-full pages without trustworthy next-page metadata
HOLD rather than guessing completeness. No automatic retry, sleep-until-reset,
account change or token provisioning occurs. Rate-limit headers/headroom are
checked per response; they do not prove future quota or secondary-limit safety.

Existing auth is supplied only in memory. The adapter enforces endpoint/method
boundaries even if that existing credential itself has broader permissions; it
does not claim to downscope the credential. Future real use needs lab-only
Metadata/Issues/Contents read access. No tokens, raw Issue bodies, usernames,
private keys or server error payloads appear in the smoke report.

## Future independent approval (Mac/iPhone; not operational)

ChatGPT prepares the exact digest/Issue identity/agent/model/mode/expiry and unique
approval ID. The person approves it through a separately authenticated device or
identity; a trusted attestor signs the approved bytes. Verify current trusted
keys/time/revocation and replay evidence before admission. A comment under the
same GitHub account used by the ChatGPT connector cannot prove a separate human
act. A protected environment is only a candidate if private-repo plan support,
reviewer independence, self-review prevention and bypass protections are verified.
This phase uses only existing in-memory Ed25519 test fixtures. No key publication,
webhook, signer installation or secrets are added.

## Future single-use reservation protocol and STOP gates

One task slot hashes repository + task ID, independent of revision or retry.
A future exclusive create must target an immutable manifest binding repository,
Issue node identity/number, exact digests, signed approval, owner, attempt and
creation evidence. Never trust a label, ref name or commit SHA alone as ownership.
The prior shared mock's concurrency tests prove only the mock arbiter; independent
GitHub clients have not demonstrated a single winner.

Before any separately authorized one-shot write, require all of:

- Independently accepted exact approval and trustworthy key/time/revocation path.
- Proven immutable manifest and reservation protection against update, deletion,
  recreation/replay and bypass, with remote evidence retained.
- Lab-only, minimum-permission credentials. GitHub ref creation requires
  Contents:write, broader than create-only; no organization or production access.
- Real concurrency/conflict/error semantics validated within a new approved gate;
  409/422 alone do not prove another owner. Timeouts/5xx may follow a successful
  create: exact authoritative read/reconciliation, never blind retries.
- Private durable journal intent before write and sticky uncertainty after any
  ambiguous outcome. Missing/corrupt/rolled-back local data never authorizes retry.
- Current Actions/external-App event audit, no unintended create/push/PR agent or
  deployment effects, a named scope for exactly one reservation mutation and
  explicit human authorization for it. No write is authorized by this PR.

A ref lookup returning 404 means missing **or inaccessible**, not permission to
claim. A present commit-target ref remains unverified ownership until its immutable
manifest/protections are accepted. The preflight always HOLDs live claiming;
there is no configuration switch to clear it. No distributed exactly-once claim.

## CI and activation boundary

Extend the existing read-only workflow with an exact allowlisted branch pair,
not a wildcard PR #12+ rule. New Draft PR opened/synchronize/reopened events can
run the same offline suite on exact head with full baseline history. Original
PR #11 pairing remains explicit. Keep permissions contents:read, five-minute
hosted job, SHA-pinned actions, no persisted credentials/dependencies/secrets or
cache. Tests never read environment credentials or call real GitHub. The manual
read smoke is excluded from CI. Do not edit the four Claude workflows.

Automation preflight: repo hooks empty, deployment records empty; known Claude
canary observed Paused / Enabled=0 / All triggers paused, exact unrelated canary
PR title/branch. No settings were changed. Installed App inventory previously
identified Codex Connector/Claude/Vercel; check candidate activity after delivery.
Hidden provider internals are not claimed as independently audited.

## Sources checked for the adapter design

- https://docs.github.com/en/rest/issues/issues#list-repository-issues
- https://docs.github.com/en/rest/using-the-rest-api/using-pagination-in-the-rest-api
- https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
- https://docs.github.com/en/rest/git/refs#get-a-reference

## Implemented interface and bounds

`ReadOnlyGitHub({getToken, fetchImpl?, timeoutMs?})` has readRepository(),
readIssue(number, {expectedIssueId?, expectedRevisionDigest?}), listIssues(),
observeClaimRef(binding). The caller-supplied token getter is trusted local
configuration; neither Issue text nor remote links configure it. fetchImpl is an
offline test seam. The production default is Node fetch with method GET,
redirect:error, cache:no-store and fixed official API host/routes. There are no
write methods or general-purpose request/URL entry points. The new adapter is
not a MockGitHub and cannot be used by simulateClaim.

Repository pins observed from the authorized metadata endpoint: numeric ID
1423925660, node ID `R_kgDOVN9hnA`, exact full_name and API/web URLs, private=true,
archived=false and disabled=false. Every high-level read verifies these first.
Issue normalization checks repository_url, number, numeric ID, opaque node_id,
API/web URL, state and created/updated timestamps. PRs are explicitly excluded.
Only sanitized metadata/digests or strict task bindings leave the adapter; no
raw titles/bodies/server errors or credential values are returned in reports.
`contract_valid_count` means schema validity, never approval/readiness; next task
is always null, execution_allowed always false. This provider has no live
readApproval implementation: existing test-only attestation verification remains
separate, and live admission remains disabled.

Limits: 100 items/page, at most 5 pages, 4 MiB decoded JSON/response, at least 20
remaining core requests, default 5s full-request deadline (including auth/body),
strict request-id/core-rate/content-type evidence, bounded body validation and
exact repository URL. Redirects, unsafe/looping/ambiguous pagination, full pages
without a trustworthy next indicator, duplicate Issue identities, malformed
UTF-8/JSON, truncated/failed streams, low/missing quota evidence and any later-page
failure HOLD the entire batch. Links are checked and next URLs reconstructed,
never followed as arbitrary targets. No retry/backoff or token refresh exists.
401, 403, 404, 429 and 5xx map to fixed codes without response payloads. A 404
cannot distinguish deletion from hidden access; ref absence never clears a gate.

These are strict observation checks, not proof that GitHub list pages represent
one immutable instant. A caller must re-read an exact Issue with expected node
identity and revision digest; mismatch HOLDs. Ref metadata is expressly
REF_PRESENT_UNVERIFIED_MANIFEST, not immutable ownership or execution evidence.
Unknown claim-manifest formats are not silently parsed as authorized claims.

## Real read-only evidence (manual, non-agent)

On 2026-10-19 a single manual invocation of the new adapter performed two GETs:
private repository metadata, then existing harmless planning Issue #12. Existing
GitHub CLI auth was piped to stdin in memory; no credential was printed, written,
requested or provisioned. No new task/claim/comment/label was created.

```sh
gh auth token | node bridge/github-readonly-smoke.mjs
```

Observed result:

- smoke_status: PASS_READ_ONLY_REJECTION
- issue_number: 12
- issue_id: I_kwDOVN9hnM8AAAABYJf80A (direct node_id mapping)
- raw revision digest: e4aa68b4f4ce7f2cd8d5f1c5b29da96fad6f35837df1355160d65b707da56211
- reason: TASK_SCHEMA_REJECTED (planning ticket is not a task contract)
- execution_allowed: false; live_claim_preflight: HOLD
- core rate_remaining observed: 4956 (time-bound, not a quota promise)
- GitHub request ID: 4216:1BA7FD:7EB6A1:C91941:6AD5601F

The smoke command accepts no arguments, reads only this fixed existing Issue
with its pinned node identity, and treats any unexpected outcome as HOLD. It is
not scheduled and is never run by CI. Tests never consume the operator's token.

## Test/evidence boundary

IMPLEMENTED: GET-only adapter, normalized observations, revision pins, pagination,
fail-closed errors and permanent live-claim preflight HOLD. MOCK TESTED: transport
response/error/rate/provenance/pagination scenarios and concurrency via the
existing immutable mock reservation server. READ-ONLY GITHUB TESTED: private repo
metadata and Issue #12 identity/task rejection only. NOT TESTED: live list
pagination, live ref lookup/manifest verification, real distributed locking,
independent human approval, power-loss durability, Mac restart/sleep or any AI.

Offline suite: 99 prior + 49 adapter boundary tests = 148. Targeted tests cover
G01–G19, including fake GET-only transport assertions, no offsite pagination
follow, duplicate task IDs across pages, no partial results, content edits and
identity replacement, missing auth, deleted/inaccessible/closed Issues, low
headroom, timeout/body failure and inability to substitute the real reader into
mock claiming. Real GitHub calls remain outside this suite.
Run-specific hosted CI evidence and independent review findings are recorded in
the Draft PR after exact-head verification. A workflow definition alone is not
CI PASS. Live-claim GO requires a separate Control Plane decision and explicit
one-shot write authorization; this implementation always returns HOLD.


Independent bounded security review: one separate GPT-6.1 Sol High reviewer
inspected the actual adapter/CI boundary and independently passed the then-current
144 tests. One P2 identified an inconsistent pagination case (last page > current
without next) that could report a partial short page as complete. Four focused
regressions reproduced it and related inconsistent first/prev/last directions;
relations are now cross-checked before any speculative next fetch, and the full
148-test suite passed after correction. No other actionable P1/P2 was reported.
Unsupported legacy opaque node IDs (e.g. characters/length outside the existing
signed binding schema) remain a documented fail-closed compatibility limitation;
no identity aliases or signature semantics were silently changed. The actual lab
node IDs passed the real smoke. The review makes no Gate or release approval.
