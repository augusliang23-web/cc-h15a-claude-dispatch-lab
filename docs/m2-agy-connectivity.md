# M2A — CC Antigravity connectivity adapter (offline only)

## Product contract and minimal implementation plan

Only prepare existing Command Center → Antigravity connectivity, not a separate
application. No UI, HTTP server, ledger, approval system, queue, provider calls or
background service. A server-built single safe BLUE LANTERN + random nonce task
can pass through a lab-only mock adapter with CC's id/probe/start/cancel shape.
All results are simulated; default probe/start do not invoke any binary.

Verified 2026-10-19: lab main `f9deef98a987a254aac93ee88f8f87661f7b8512`;
CC main `25692a9a1fdedaf82910630fb767589aa5dccddf`, no drift. Read-only references:
`server/execution/agentAdapter.mjs`, `claudeCliAdapter.mjs`, `streamingProcess.mjs`,
`orchestrator.mjs`, `server/tasks/taskStore.mjs`. No CC checkout was edited or
created. PR #17 remains untouched; this branch starts directly at approved main.

- [x] Write failing offline tests: full capability shape, disabled defaults and
  adversarial configuration/spec injection; exact nonce/frame/exit provenance;
  cancellation/timeout/disappearance/children/stream limits/redaction/no retry.
- [x] Implement small `bridge/antigravity-adapter.mjs` and sealed data-only
  `antigravity-mock-transport.mjs`; no imported launcher or arbitrary callable
  transport. Preserve all 184 tests/legacy guards/four Claude workflows.
- [x] Run all tests; independent focused process-boundary review; fix P1/P2.
- [x] Recheck automation; one Draft PR; exact PR/branch CI allowlist and final
  synchronize exact-head success. No real agy, approval publication or M3 writer.

## Mapping / porting boundary

CC AgentAdapter: `id='antigravity'`, async `probe()`, `start(spec, emit)`,
`cancel(runId)`. Event types remain started/output/tool/usage/denied/error/raw/
finished; this minimal adapter emits only started/output/error/finished, with
output always AGENT_CLAIM and every other event at most RUNTIME_OBSERVED.
All carry explicit MOCK_TRANSPORT/simulated provenance. No agent-supplied grade,
PASS assertion, model or stdout can promote evidence to verified completion.

RunResult uses CC outcomes completed/failed/cancelled/blocked/unknown and carries
exitCode/exitObserved/requestedModel/actualModel/usage. Completed means only a
matching MOCK fixture and observed simulated clean process-tree exit. It is not
CC acceptance, a task transition or CC_AG_RESULT_V1. The old simulated-only result
validator and admitLive/claimLive/executeLive/firstWriteGate stay unchanged.

CC streamingProcess remains the future owner of actual shell:false spawn,
bounded streams, timeout and process-group termination. M2A only models its
handle `{cancel,done}` boundary. No real launcher/supervisor is copied into lab.
Actual descendant termination proof must be resolved before porting: CC's
exitObserved alone does not prove every child is gone. Do not unlock the Fake-only
Orchestrator, extend TaskStore's agent whitelist, use Codex Handoff or add an API
route. A later separately reviewed integration can wire the existing architecture.

## Exact offline interfaces and honest capabilities

`createConnectivitySpec({signal?})` returns one frozen in-process server-issued
spec with CC-shaped `RUN-YYYYMMDD-8hex` / `CC-YYYYMMDD-8hex` IDs, random 128-bit
nonce, `executionProfile: FAST`, fixed non-executable MOCK cwd and a constant
non-tool prompt. No Issue/browser prompt, argv, model, cwd, environment or binary
can be supplied. Copies/extra fields/unknown origins are rejected. One adapter
attempt and one use of each issued spec per process; another adapter cannot replay
it. This is not durable replay protection across process restart and cannot serve
as the M2B real-operation gate.

`new AntigravityAdapter()` returns unavailable from probe and blocked from start;
neither calls agy, including --help/--version/auth. Only an opaque branded
`createMockAgyTransport(script)` instance is accepted, never `spawnImpl`, an
arbitrary callback, a binary path, live flag or environment option. Factory scripts
are bounded plain data (<=64 chunks, <=16 KiB/chunk, delay <=100 ms). Constructor
options allow only that mock, timeout 1–30000 ms and termination grace 1–1000 ms.

Mock handle follows `{cancel(reason), done: Promise<ProcessResult>}`. This is a
fixture concept, not a global process supervisor or real CLI adapter activation.
start emits only fixed/sanitized runtime messages, at most one finished event.
Cancel observes both simulated process and process-tree exit before returning
terminated:true; no exit/descendant proof is unknown/false, never invented success.
Timeout is one deadline then bounded termination observation, no restart/retry.

All 11 CC capability fields are present. **Scope is MOCK ONLY**:
structuredEvents=true (normalized assumed fixture); streaming=none;
cancellation=signal (simulated termination); modelSelection=true (fixed requested
model fixture); usageTelemetry=none; costTelemetry=none; sandbox=none;
editOnly=false; shell/git/network=false. `realExecutionAvailable=false` and
`protocolVerified=false` always. They do not attest actual agy features or an OS
sandbox. Usage tokens/cost remain null; actualModel is UNKNOWN, not inferred from
agent-provided model text. Output is AGENT_CLAIM with explicit simulated provenance.

## Assumed output parser, limits and failure states

No verified prior local agy stdout format was available in the inspected lab/CC
references. No agy command was run to discover it. Therefore this **assumed test
format is NOT advertised as real agy output**. Exactly one UTF-8 canonical JSON
object followed by one LF; no extra whitespace, duplicate keys, additional lines,
prose, tool events or trailing partial data:

```json
{"model":"gemini-3.8-flash-low","nonce":"<32 lowercase hex>","text":"BLUE LANTERN <same nonce>","type":"result","version":"M2A_ASSUMED_V1"}
```

Canonical key ordering matches existing restricted canonical(). Exit 0 alone or
BLUE LANTERN text alone is insufficient. Mock completion also requires exact
nonce/model/frame, no stderr, clean exit and descendant-exit observations.
Stdout <=8192 bytes, terminal frame including LF <=4096 bytes, stderr <=1024 bytes.
Overflow triggers simulated cancellation; malformed/noncanonical/truncated output,
nonce/model mismatch or stderr produces unknown, nonzero exit failed, spawn
failure blocked, exit/child disappearance unknown. Raw stdout/stderr/errors/tokens
are never emitted, logged or included as tails. Unexpected text is fully dropped;
only the pre-known matched phrase/nonce can be emitted as output.

M2B must first observe and separately approve the actual format/parser mapping;
do not force real stdout into this invented schema or label it a live
CC_AG_RESULT_V1. M2A completion is only MOCK/UNIT protocol matching.

## Proposed M2B one-shot envelope — NOT AUTHORIZED / NOT RUN

Purpose: one harmless Mac CLI/provider connectivity observation, not M3 E2E,
Command Center integration, source editing, GitHub writeback or task claiming.
This document is an approval proposal, not a runnable launcher or authorization.

1. **Separate preflight approval:** revalidate the absolute executable's realpath,
   file/hash/version and documented help/permissions. M2A only used shell path
   lookup (no invocation) to locate `/Users/augusliang/.local/bin/agy`.
   Even `agy --help`, `--version` or auth-status must receive separate explicit
   permission first. Read help only after that permission; stop on unknown tool
   access, state-writing, startup hook/plugin behavior, auth or model ambiguity.
   No tools/install/API key/account switching/credits/overages authorized.
2. **Review exact final bytes:** the candidate argv below is deliberately
   UNVERIFIED. `--mode=plan`, output-format and stdin support must be confirmed;
   plan wording/prompt is not itself a sandbox or non-write guarantee. Confirm
   no file/shell/git/network tools, hooks, MCP, workspace loads, updater, telemetry
   or persistent state side effects. If CLI cannot meet these restrictions,
   HOLD; do not weaken them or substitute guessed flags.
3. **Explicit final human GO:** only after preflight, approve absolute realpath +
   executable hash, exact argv/stdin, cwd/environment/permissions, nonce, account
   subscription mode, timeout/output/termination budget and max-one-attempt.
   Generic continue, PR approval/merge or mock PASS cannot authorize this call.

Proposed fixed values for that final review (do not execute):

| Field | Proposed value / acceptance |
| --- | --- |
| Binary | `/Users/augusliang/.local/bin/agy`; canonical target/hash/version UNVERIFIED, must pin after separately approved preflight |
| Candidate argv | `["--model=gemini-3.8-flash-low", "--mode=plan", "--output-format=json"]` — ASSUMED, not approved or verified; no prompt in argv |
| Cwd | `/private/tmp/cc-m2b-blue-lantern-e7cd0a15cfe627cad1e610f7594a5c04`; dedicated empty canonical non-repo directory, not created in M2A; no product/CC/lab worktree attached |
| Nonce | `e7cd0a15cfe627cad1e610f7594a5c04` (randomly generated proposal, never sent to provider) |
| Stdin | `Connectivity test only. Return exactly BLUE LANTERN e7cd0a15cfe627cad1e610f7594a5c04. No tools, files, commands, git, external requests or other actions.` then EOF |
| Model/mode | exactly gemini-3.8-flash-low, verified plan/non-write mode; no fallback model or effort setting invented |
| Environment | server-built allowlist only: HOME/USER/LOGNAME for verified existing subscription auth, PATH=/usr/bin:/bin and required locale/TMPDIR if justified; no inherited API keys, GitHub/cloud/SSH tokens, routing or project config |
| Identity/cost | existing subscribed agy account required, currently UNVERIFIED; reject API billing/overage/upgrade; no usage/cost estimate fabricated |
| Process | direct argv, shell:false via separately reviewed existing CC streamingProcess; 30s provider deadline, SIGTERM then 1s, SIGKILL then 1s; unobserved exit/children => UNKNOWN/HOLD |
| Output | bounded <=8192 stdout / <=1024 stderr / <=4096 frame, raw values never printed; actual grammar must be reviewed before acceptance |
| Attempt budget | exactly ONE prompt/provider invocation, no retry/resume/fallback even on error/timeout; Control Plane must record the consumed one-shot budget and interruption STOP using existing workflow evidence, not a new journal; M2A memory guard cannot grant this |
| Allowed effects | CLI's own authorized provider transport only; no task files, git, GitHub writes, workspace reads, commands/tools or approval publication. Incidental CLI state writes remain an unresolved blocker |
| Acceptance | independent observer binds nonce to request/output and trusted process exit/child state, confirms no side effects and records requested vs genuinely observed model separately; output remains AGENT_CLAIM |
| Stop | mismatch, prompt/permission dialog, unexpected tool/state write, auth/cost ambiguity, nonzero/timeout/leak => STOP/HOLD, no additional invocation or cleanup write |

Do not create this cwd, launch a harness, check auth by calling agy, or publish a
result in M2A. Preflight commands and one provider invocation are distinct approval
scopes. Once the CLI is proven compatible, Control Plane should issue the exact
M2B instruction and human should authorize that one operation. M3 GitHub result
handback is a later decision after M2B evidence, not an adapter responsibility.


## Validation / review evidence boundary

184 unchanged baseline tests + 28 new = **212/212 local PASS** (zero skipped).
Tests first failed for missing implementation; an additional replay test first
reproduced fresh-adapter reuse and then passed with shared in-process consumption.
New coverage includes all 11 capability keys, disabled defaults/adversarial real
spawn options, one-shot fixed requests, assumed frame/UTF-8/duplicate/nonce/model,
exit code/exit disappearance/children, cancel/early abort/timeout, byte limits,
stderr/error redaction, emitter failure and no process/I/O imports.

Separate GPT-6.1 Sol High reviewer independently ran 28/28 adapter tests and
additional adversarial cancellation/split framing/bounds checks. No actionable
P1/P2 found; real CLI/output compatibility remains unverified. Hosted exact-head
CI and the final narrow PR/branch guard review are recorded in the Draft PR.

Read-only sources at the exact CC commit:
- [AgentAdapter contract](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/blob/25692a9a1fdedaf82910630fb767589aa5dccddf/server/execution/agentAdapter.mjs)
- [Streaming process boundary](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/blob/25692a9a1fdedaf82910630fb767589aa5dccddf/server/execution/streamingProcess.mjs)
- [Concrete CLI adapter](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/blob/25692a9a1fdedaf82910630fb767589aa5dccddf/server/execution/claudeCliAdapter.mjs)
- [Fake-only Orchestrator](https://github.com/augusliang23-web/Micro-SaaS-Command-Center/blob/25692a9a1fdedaf82910630fb767589aa5dccddf/server/execution/orchestrator.mjs)

**M2A mock/unit evidence: ready for review after exact-head CI. M2B real agy:
NOT RUN / HOLD pending separate precise preflight and final one-shot authorization.
M3 E2E / GitHub result writer: out of scope.** No separate application, approval
system, frontend, server, background service, CC write, PR #17 edit, real claim,
model invocation, merge or deployment was performed.

Automation preflight (before push/open): known external Claude Routine was
Paused / Enabled=0 / All triggers paused with exact unrelated canary PR title,
branch and bot author. Three Claude workflows require manual dispatch; the fourth
requires Issue-opened exact title H15A4C_DISPATCH_CANARY_V1. No Issue/dispatch is
created. Visible hooks/deployments zero; hidden provider internals are not audited.
PR #17 remains OPEN/Draft at 041f49571961e1871967f4073a8edde87838d14a, untouched.
