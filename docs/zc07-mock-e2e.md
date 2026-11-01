# ZC-07 — Synthetic Zero-Copy E2E (read-only candidate)

## Purpose

Prove the **ordering, correlation and fail-closed gates** for this proposed workflow:

Control Plane task -> mock Gemini proposal -> mock CI -> mock Codex independent review -> owner-review report.

This is a **simulated state machine**, not a real ChatGPT-to-GitHub bridge, agent dispatch, real PR, CI approval or provider result. It must NEVER be used as evidence for unlocking ZC-06C or billing/model authorization.

## Status and exact boundaries

- Branch: zc/zc07-offline-mock-e2e, independent of ZC-06C Draft PR #36.
- Runner: node bridge/zc07-mock-flow.mjs --demo, no other accepted runtime flag.
- Tests: node --test bridge/test/zc07-mock-flow.test.mjs.
- Outputs always have mode=OFFLINE_SYNTHETIC_ONLY, synthetic=true,
  provider_calls=0, github_writes=0, mac_settings_writes=0,
  real_pr_created=false, real_qa_requested=false.
- Does not read user home, GitHub credentials, project files or private data; no
  fs, Git CLI, provider SDK, network or child-process invocation in the module.
- GitHub Actions runs only on an exact named Draft PR, with contents:read,
  pinned checkout/Node actions and no package installation.
- Mock Gemini/Codex stages are deterministic in-memory data, not AI calls.
- A digest chain makes synthetic event changes detectable; it is NOT a signature
  or a durable one-time claim and cannot authenticate real external events.

## Acceptance requirements

1. Fixed synthetic task accepted and mapped to an entirely simulated candidate.
2. Synthetic candidate bound to an exact stable pseudo-commit digest.
3. Synthetic CI must pass before mock QA; failing CI enters HOLD.
4. The mock independent review must match the exact pseudo-commit and approve
   with zero findings; mismatched or rejected review enters HOLD.
5. Final output says ZC07_MOCK_FLOW_PASS_NOT_LIVE_AUTHORIZED, requires owner
   review and never represents real deployment, GitHub PR approval or provider use.
6. Reject real workspaces, traversal paths, unexpected fault modes and malformed
   fixture tasks. No automatic retries, GitHub writes, external model calls or merge.
7. No operational or permission changes to PR #36. In particular, do NOT call AgY
   or execute the user's real macOS temporary configuration trial.
8. Any native CI result applies ONLY to this synthetic contract.

## What remains after this mock

- Authenticated ChatGPT task trigger and durable event transport to GitHub.
- Real eligible provider authentication / quota attestation, independently gated.
- A sandboxed development worker with a minimal scoped repository write path.
- Actual CI/PR readback, exact SHA QA proof and approval authorization.
- User-facing task visibility and change-only notification with failure recovery.
- Strict budget/spend guard; no uncontrolled background process.

All these need distinct security, real-environment and Owner GO gates.
