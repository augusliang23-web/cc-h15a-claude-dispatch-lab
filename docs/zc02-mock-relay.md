# ZC-02 — Mac-local mock handoff (candidate, not installed)

**Scope:** Test ChatGPT -> GitHub Issue -> Mac read-only observation -> local
mock receipt. There is NO executable model path, writable target repository,
GitHub writeback, installed background job, UI, or model/API key.

- Input is exactly [private lab Issue #21](https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/issues/21).
- The Issue's numeric ID, node ID, repository, number, title, author, state,
  URL, and byte-for-byte JSON body are pinned in `bridge/zc02-mock-relay.mjs`.
- Earlier [Issue #20](https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/issues/20)
  remains planning-only and must never be consumed as an executable task.
- GitHub GET is via existing `gh` CLI login, fixed `gh api --hostname
  github.com -X GET repos/augusliang23-web/cc-h15a-claude-dispatch-lab/issues/21`.
  No shell expansion or Issue-derived CLI arguments.
- Successful read creates one local claim and one mock receipt in
  `~/.local/state/zc02-mock-relay`. The runner prints the receipt status
  as JSON and exits. The claim is created with exclusive `wx` semantics,
  local-only; it is **not** a multi-machine or GitHub reservation.
- Every subsequent attempt or crash-uncertain claim **HOLDs**; never deletes
  a claim or automatically retries.
- Receipt contains `simulated:true`, `agent_invoked:false`,
  `model_invoked:false` and `execution_allowed:false`.
- Invalid/edited/closed Issue, expired auth, GitHub errors, unsafe local state
  directory or output errors fail closed.
- Existing GitHub Issue-opened canary is exact-title-limited to a DIFFERENT
  title and must remain skipped for Issue #21.

## Verification sequence (not executed on the owner's Mac by this PR)

1. Independent offline CI: `node --test bridge/test/*.test.mjs`.
   No GitHub auth, model provider or API calls in tests.
2. Confirm private lab checkout only, branch exact, current `gh auth status`
   (do not print tokens), and no affected production worktrees.
3. After **separate Mac-local execution authorization**, manually run exactly:
   `node bridge/zc02-mock-relay.mjs --once`.
4. Expected first result: `MOCK_COMPLETED_LOCAL_ONLY`. A second independent
   call should return `HOLD` and `ALREADY_CLAIMED_OR_CLAIM_UNCERTAIN`.
   Do not clean claims to force replay, especially after ambiguous failures.
5. Before scheduling automatic Mac wake-time polls or any real Agent,
   separately approve the installation and source authority.

**What this does NOT prove:** a Mac test, recurring automation, a real Gemini
Flash invocation, subscriber quota availability, independent Codex QA, GitHub
result writeback, or ChatGPT final closed-loop review. These are later gates.

The existing AG2B live-claim/approval guards remain untouched; the mock
receipt neither bypasses them nor qualifies for live execution.

## macOS CLI entrypoint verification / first-run exit-code gate

A Mac smoke run on 2026-10-31 exposed a **silent zero exit with no JSON** when
Node was invoked through macOS's `/var` alias for `/private/var`. The fix
compares `fs.realpathSync` paths for the CLI argument and module URL.
Regression Z08 checks both path identities; Z09 launches the CLI through a
symlink using an **invalid** argument and requires explicit `HOLD` exit 2.
Z10 simulates the complete first and repeat `--once` flow under an isolated
HOME and a stubbed `gh` binary (fixed synthetic GET result): first run exit 0
and receipt, second run exit 2 and HOLD. Z08-Z10 never contact GitHub or a
model provider, and never touch the owner's real claim files.

For any future separately authorized **fresh** canary, acceptance MUST check:
- First invocation: exit code 0 **AND** nonempty JSON with
  `status: MOCK_COMPLETED_LOCAL_ONLY` (exit code 0 alone is insufficient).
- Second invocation: exit code 2 **AND** JSON `status: HOLD` with
  `reason: ALREADY_CLAIMED_OR_CLAIM_UNCERTAIN`.
- On absent/invalid JSON, fail closed. Never record success from an empty stdout.

The owner's Mac has **already** successfully created a durable claim and
receipt for Issue #21 in `~/.local/state/zc02-mock-relay` during the canonical
path smoke test. **Do not delete these files or re-run Issue #21's `--once` path**
to make this fix appear green. The hosted regression is intentionally offline.
This patch alone does not authorize installation, automatic polling, model
calls, real dispatch, branch merging or production changes.
