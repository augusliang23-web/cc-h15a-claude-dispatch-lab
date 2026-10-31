# ZC-06C: first REAL AgY Headless response — operator-run only

**Authorization:** owner authorized exactly one real Gemini Flash invocation. This Draft PR implements its bounded launcher; CI and Codex review must pass before the single Mac run. It must never run inside GitHub Actions or automatically in a relay.

**Provider request:** pinned `gemini-3.8-flash-low`, `--output-format json`, `--mode=plan`, `--sandbox`, `--disable-slash-commands`, `--print-timeout 40s`. Model prompt asks only for `BLUE LANTERN ZC06C-20261031-A1`. A total process ceiling of 45 seconds applies. No automatic retry, model fallback, custom prompt or prior-conversation resume.

**Local guard:** Mac-only, no root, exact non-symlink executable, explicit `ZC06C_OVERAGES_OFF_CONFIRMED=YES` (owner confirms UI overages OFF at run time), no detected alternate API billing environment, unique durable local claim before invoking the provider. One blank, non-writable temporary workspace. Minimal process environment does not forward provider keys or GitHub tokens. Original ZC-04B state/Claim is untouched.

**Critical limitation:** `--sandbox` limits **terminal commands**, not all file-operation tools, while `--mode=plan` alters behavior and may produce an execution plan rather than the requested exact phrase. The CLI might read global configuration or cached auth; sandbox may be unavailable. Explicit no-tools prompt is NOT a security boundary. This initial test is allowed only because workspace is isolated and no project sources are mounted. CLI auth identity/subscription linkage cannot be cryptographically verified by this runner. `billing_attested:false` is always returned even on response success; external billing check remains necessary.

**Output:** status, fixed model, exact string matched yes/no, reported token total if supplied, model reported if supplied. Never print raw model output, account identifiers, paths, credentials, raw stderr, detailed errors or internal reasoning. `tool_use_verified_absent:false` means absence of tool actions is not proven by JSON summary. If file activity, response mismatch, timeout or CLI error: HOLD with no retry. There is no GitHub writeback.

**Offline tests** `node --test bridge/test/zc06c-single-model.test.mjs`. Do not run `node bridge/zc06c-single-model.mjs --once` on CI or until reviewed and operator has checked Overages OFF.

**Success gate:** `ZC06C_SINGLE_RESPONSE_OBSERVED` only, not full automated Agent execution, billing attestation, safe tool execution or Codex QA loop.
