# ADR-003 — Independent approval and first reservation readiness

Status: proposed for Control Plane review; **live-write HOLD**.
Scope: Issue #14, main f49dda30136a41e8b9b23dbe55d8be916bdce208.
No signer, key registration, hosting, App, secrets, ruleset or account changes.

## Decision and threat boundary

Recommend a **separately trusted passkey approval page** as the next design to
validate, with pinned public credential/RP/origin independent from the ChatGPT
GitHub integration. Do not deploy it now. Reject GitHub same-account comments,
labels, workflow_dispatch clicks or actor names as proof of a separate person.
Ordinary WebAuthn authenticates a credential ceremony, not that a person read
and understood a transaction. A trusted review page must display the exact
transaction whose digest is challenged. A compromised page/OS/account remains a
threat; this ADR does not turn a biometric prompt into trusted transaction display.

Current GitHub-native protections cannot establish immutable remote ownership:
lab ruleset and branch-protection GETs returned 403 requiring Pro. This is a
specific observed plan/capability blocker, not proof of the whole account plan.
Do not upgrade, change repository visibility or treat denied reads as empty rules.

## Approval options and user journey

| Candidate | iPhone / Mac steps | Mac off | Assurance, setup and recurring cost | Decision |
| --- | --- | --- | --- | --- |
| Independent WebAuthn/passkey attestor | Open trusted task-review link; see repository/Issue/revision and one-ref operation; tap Approve; Face ID/device verification on iPhone or Touch ID/passkey on Mac; signed artifact returned by the page/share flow, no opaque-token copying | Possible only with an independently reachable HTTPS RP and durable untrusted artifact courier; not a Mac-hosted page | Pin credential public key out of band, origin/RP, challenge, UP+UV flags/signature and replay status. Separate registration/recovery trust. No always-on signer/private key service is inherently required for assertions, but hosting, enrollment, revocation publication and courier need validation. Target existing/static hosting, no assumed free entitlement or promised $0 service | Preferred feasibility work; no real enrollment or device test yet |
| GitHub protected environment / manual reviewer | Open exact environment approval in GitHub from either device; review a displayed immutable manifest; approve under an independently authenticated reviewer identity; read authenticated environment evidence | GitHub-hosted review can remain available | Required reviewers, no-self-approval, admin bypass controls and credential separation must all hold. Same-account connector initiation + same-account reviewer is not independent and may be blocked by no-self-review. Private-repo feature availability must be verified, not inferred from environment existence. Existing empty environment inventory is not approval capability | Not selected: private-plan/independence requirements unproven; Pro alone is not assumed sufficient |
| Local manual approval, no new online service | When Mac is on, inspect exact signed intent in a trusted local UI and explicitly approve with a separately protected signing credential; iPhone may use an already trusted remote session, otherwise wait until Mac returns | No; tasks stay queued | Lowest added recurring-service burden; existing OS/app capabilities must actually support user-presence-protected signatures. An ordinary file Ed25519 key exposed to the agent is insufficient. No new SSH server/remote-access product/key is authorized | Feasible product fallback: accept delayed approval rather than build cloud infrastructure; not operational |

Apple documents passkey use with device verification and iPhone/Mac support [A1,
A2]. This establishes platform feasibility only, not this workflow's deployment.
GitHub documents required reviewers/self-review prevention and private-repository
plan limitations [G1]. No live environment provider has been verified.

### Exact signed approval requirements (all candidates)

Bind repository numeric/node/name identity; Issue number and opaque node ID;
contract version, canonical task digest and raw title/body revision digest;
agent/model/mode; unique approval and attempt IDs; purpose (one reservation,
**not task execution**); exact target ref, manifest digest, pre-existing immutable
commit target, principal/permissions; not-before/expiry; maximum one write and no
retry; side-effect/verification/cleanup policy. The draft write-intent schema
validates shape and equality only; it is **not authorization verification**.

WebAuthn feasibility: challenge a domain-separated digest of those exact bytes;
verify authenticator signature with a pinned public credential, RP-ID hash,
allowed origin, user-presence/user-verification flags and client challenge/type;
reject cross-origin/unknown credential/unsupported algorithm. Use a maintained,
reviewed verifier when implementation is authorized, not a bespoke protocol
stack. Assertion counters alone cannot prevent synced-passkey replay; track
one-shot IDs/attempts at the authoritative reservation boundary. This phase adds
no WebAuthn verifier/browser ceremony: old Ed25519 fixtures prove signatures only,
not a real person or independent approval [W1].

Key custody/rotation: authenticator-protected credential; no private signing key
in source, agent environment or logs. Pin initial public key through independent
human enrollment. Rotation is a signed/independently approved change, revokes old
key IDs and pending approvals, and is audited. Losing a device needs separate
recovery verification; deleting its passkey is not proof of server-side revocation.

Time and withdrawal: use a trusted authority clock and narrow validity. The phone
can sign an approval/withdrawal while Mac is off only if its trusted RP remains
reachable; offline-created artifacts must await current revocation/time checks
when the Mac returns. Withdrawal must name the exact approval/attempt and be
signed and durably acknowledged; transport via the same GitHub account is only
an untrusted courier. An uncertain publication or stale status is HOLD. Define
the create-vs-revocation linearization boundary: changes before creation block;
revocation/edits after reservation retain the reservation but block execution.
No retry or silent reuse under a changed task digest.

## Claim manifest and atomicity decision

`CC_AG_CLAIM_MANIFEST_V1` is an envelope `{payload, immutable_evidence_digest}`.
The payload contains pinned repository identity, exact old approval payload
(including Issue identity/revision and agent/model/mode),
deterministic task key/ref, Mac owner ID, attempt ID and creation timestamp.
`immutable_evidence_digest = SHA256(canonical(payload))`; this is content addressing,
not proof of persistence, signature validity or immutability. The `approval` field
is proposed approval metadata, not a signature or proof that approval occurred.
No private key/token or executable instructions.

The dependency order is acyclic and requires only one human approval:

1. Freeze core payload and its digest. Prepare and verify an existing immutable
   Git commit containing this core; its creation needs separate authorization.
2. Freeze the exact `CC_AG_SINGLE_WRITE_INTENT_V1` bytes, including core digest,
   target commit SHA, principal, operation, one-shot IDs and time window.
3. Independently review and sign the domain-separated canonical intent bytes
   (`CC_AG_DETACHED_ONE_WRITE_V1` UTF-8 bytes followed by one NUL byte,
   then canonical intent UTF-8 bytes). This is a proposed fixture format, not a deployed
   WebAuthn verifier or live signature protocol.
4. Retain detached assertion/signature and any evidence receipt downstream.
   Its digest must **never** be inserted into the core, target commit or signed
   intent. A receipt may address the already fixed core, intent and signature;
   it is not itself an authorization. Verify original detached bytes, current
   revocation and consumption state before any future reservation.

The offline regression constructs this sequence with ephemeral Ed25519 fixture
keys and rejects changed core digest, target commit, attempt or installation.
It proves constructibility and binding only, not independent human approval.

Two clients must contend at one authoritative conditional-create operation;
read-then-write at each client is insufficient. The offline harness uses two
separate Node processes over IPC against one simulated authority, with both reads
barriered before the race. This tests client/server boundaries, not GitHub. The
simulator assumes retained receipts/tombstones that actual refs do not supply.
A deleted/overwritten ref must not erase the historical task/approval consumption.

| Native feature | Required property | Observed/known limitation and live status |
| --- | --- | --- |
| Ref creation | One exact single-use ref, conflict rather than overwrite | API creation/conflict is only one moment; 409/422/timeout do not prove ownership. No real race tested; HOLD |
| Restrict updates + deletions | Every writer/App/admin subject to protections | Private-lab ruleset/protection reads return 403 upgrade required; no enforcement proof. Even available rulesets need exact prefix and empty/controlled bypass evidence; HOLD |
| Creation rules | Permit reservation create but deny later mutations | Generic bypass may also bypass update/delete. Rule combinations need actual proof; no create-only Contents token presumed |
| App credentials | Lab-only minimal scope | Metadata/Issues/Contents read for preflight; Contents:write needed for ref create is broader than create-only. No new token installed; scope of existing CLI credential not narrowed by reads |
| Manifest commit | Immutable addressed approval/owner evidence | A SHA pointing to main is not a claim manifest; real manifest/commit is absent. Git-object creation is also a write, requiring separate authorization before a one-ref-only experiment |
| Branch events | No agent/build/deploy from creation | `create`/push/external-App effects require audit; the offline CI PR allowlist is not a guarantee about ref creation |
| Retention / restore | Consumption history survives deletion, rollback, import | Ordinary refs alone have no permanent tombstone/restore epoch. Unknown/missing/inaccessible 404 is HOLD; no recreate/delete cleanup |

Rule behavior and bypass controls are documented [G2]; observed 403 and absent
current approvals are recorded in the preflight report. We do **not** recommend
making the lab public or buying a plan merely to force this design through.

### Alternative authoritative compare-and-set store

If remote immutable ref ownership remains unsuitable, a single-region DynamoDB
conditional `PutItem` with `attribute_not_exists(task_key)` is a concrete remote
CAS candidate [D1]. Use an independently administered, narrow broker that always
applies that condition and retains immutable consumption/tombstones; clients must
not have arbitrary PutItem/Update/Delete, table-delete/TTL/restore or bypass rights.
An ordinary PutItem replaces existing data, so raw broad credentials are unsafe.
Require separate IAM/backup/restore epochs/audit, signed immutable manifest,
strongly consistent exact reads, bounded no-retry client and revocation ordering.
Account-admin malicious reset remains outside ordinary client guarantees and must
trigger HOLD if detected. This is new infrastructure, **not selected/provisioned**.

On-demand billing charges requests/storage rather than an always-on instance
[D2]; broker/auth/audit can also cost money. Region, included credits, eligibility
and total bills are unknown. No numeric savings or free-tier guarantee is made.
Its setup/IAM burden likely exceeds the value of a personal one-Mac experiment.
A local single-Mac locked journal is cheaper operationally but cannot replace a
remote multi-client authoritative CAS. Prefer HOLD and a smaller manually approved
workflow until this product trade-off is accepted; do not add a cloud service now.

## Minimal implementation / test plan

- Pure manifest and explicit one-write-intent validation; no signer or grant API.
- Separate offline authority/client fixtures, append-only receipts, fault simulator
  and two independent-process mock clients; no HTTP server, listener or daemon.
- Pure availability/credential/journal/revision/evidence assessment, always denying
  live execution and returning concrete conservative reconciliation actions.
- Preserve all 148 tests/source and old Claude workflows. Narrowly add exact new
  PR/branch CI pairing after PR number is known; no live smoke in CI.
- Read-only lab preflight, one bounded independent security review, exact-head
  hosted CI and one Draft PR. No merge or real remote write.

## Sources (checked 2026-10-19)

[A1] https://support.apple.com/en-euro/guide/iphone/iphf538ea8d0/ios
[A2] https://support.apple.com/en-au/guide/passwords/mchl4af65d1a/2.0/mac/26
[W1] https://www.w3.org/TR/webauthn-3/#sctn-verifying-assertion
[G1] https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments
[G2] https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
[D1] https://docs.aws.amazon.com/amazondynamodb/latest/APIReference/API_PutItem.html
[D2] https://aws.amazon.com/dynamodb/pricing/
