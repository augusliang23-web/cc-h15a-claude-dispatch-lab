# ZC-05 — Integrated offline gate (combined snapshot, no merges)

This branch copies verified file snapshots from independent Draft PRs **#22**, **#26** and **#28**, without merging any of them and without modifying `main`.

- PR #22: `da13c19c66b5f1f1a0f1ff20cfae536703295dc3`; Mac Relay MOCK safety, 238/238 CI and owner-run macOS final smoke 26/26 PASS.
- PR #26: `26bb5ed6b7f480c63dc96e23db976c92fb0dbe42`; Telemetry Projection MOCK, 227/227 CI, Codex no-current-head-findings.
- PR #28: `2c52bf3586a2c353ce4a00cf6be7014d7f896a94`; signed event fixture, 224/224 CI, Codex no-current-head-findings.
- The original PRs each modified `.github/workflows/ag2b-offline-ci.yml` to allow only their own branch. In this integration branch the workflow starts from original `main` and adds **only** the exact `zc/zc05-integrated-offline` branch (no broad PR permission or live triggers). CI is read-only `contents: read`.
- All modules remain offline-only with no authenticated GitHub event transport, no live Mac writeback, no Antigravity/Codex execution and no ongoing monitoring. Existing Claim/Receipt never deleted or reused. No automatic install, merge, deployment, paid model/API calls or scheduling.

## Integration Acceptance

- All legacy + ZC-02 + ZC-04A + ZC-04B tests pass together on exact commit.
- Codex independent read-only PR review on integrated patch.
- A passing integrated mock does not authorize merge or real Agent telemetry. These are separate human gates.
