# ZC-06C — first real Gemini Flash Low: safety-corrected one-shot (HOLD)

**Owner choice:** use the existing macOS user and existing Antigravity/Google AI Pro login; no second macOS user. Owner authorized *one* future prompt. The present PR **is not yet released for real execution**. Do NOT manually run `--once`, merge, or change global CLI settings on behalf of the owner.

## Verified from the owner's Mac (2026-10-31)
- `agy 1.4.12`: local `--version` and `--help` exit 0; `agy models` lists `gemini-3.8-flash-low`.
- Desktop usage view: Google AI Pro; Credit Overages toggle OFF at capture time.
- Settings: valid JSON, `toolPermission` defaults to request-review, `agentMode` defaults to standard, `allowNonWorkspaceAccess` and `useG1Credits` default false, `modelProvider` default.
- **No explicit** `permissions.deny` (or allow/ask) array. This means the revised runner deliberately returns `EFFECTIVE_DENY_POLICY_NOT_CONFIGURED` **before any provider/claim**, even if the desktop settings appear benign. This is intentional fail-closed behavior, not a failure of the owner's settings.

## Actual code controls
1. `-p` with an innocuous fixed answer `BLUE LANTERN ZC06C-20261031-A1`, `--model gemini-3.8-flash-low`, `--output-format json`, `--mode=plan`, `--sandbox`, `--disable-slash-commands`, `--print-timeout 40s`. One attempt, no fallback/retry, no GitHub comment.
2. Process is Mac-only and cannot run as root. No provider or GitHub API key environment forwarded; no separately configured Gemini API provider allowed. Owner must reconfirm AI Credit Overages OFF at invocation time.
3. **Mandatory fail-closed config check:** the owner's CLI settings file must be a regular non-symlink, bounded owner-owned non-writable-to-others file, with effective intent `toolPermission` strict/request-review, `allowNonWorkspaceAccess` not true, `useG1Credits` not true, `modelProvider` default, and explicit `permissions.deny` list containing `read_file(*)`, `write_file(*)`, `command(*)`, `unsandboxed(*)`, `read_url(*)`, `execute_url(*)`, `mcp(*)`. This is a **structural inspection of settings**, not independent proof that the CLI implements these policies. **Do not automatically edit the user's global settings**; such a change would affect existing sessions and needs scoped owner approval and backup/recovery.
4. Claim is exclusive `wx`, fsynced and never deleted/reused; fail-closed on a writable home, unsafe user-owned claim ancestors or symlinks, except verified system aliases. Non-writable-to-others readable parent dirs are allowed, but leaf claim dir must be 0700.
5. CLI launch uses Node async spawn with `shell:false`, `detached:true` for its own Mac process group. Bounded timeout requests SIGTERM, then SIGKILL; verifies that process group is gone before treating any response as successful. If the group cannot be proved absent, HOLD. Output bounded; sanitizer never prints raw stdout, stderr, model-identification field, credentials, absolute paths or error stack. A provider-reported model mismatch is HOLD, model omitted = NOT_REPORTED.
6. A temporary empty workspace is used; it is not a macOS process isolation sandbox. `--sandbox` protects terminal commands, not all Agent file tools. **Same-user residual exposure remains real.** The combined explicit Deny rules aim to lower that risk but cannot mathematically prove no bypass, daemon side effect, auth provider mismatch or third-party CLI vulnerability. Owner accepted same-account strategy, not unlimited risk.

## Remaining validation / STOP
- GitHub offline fixture tests and independent exact-head Codex review are mandatory. A passing CI does not prove real macOS process/child shutdown or effective tool Deny.
- The present approved one-time provider test cannot run until a reviewed operator-run method safely limits the *specific session*. Installed CLI 1.4.12 docs provide command-line `--mode` and `--sandbox` overrides, but **do not document a per-session `permissions.deny` override**. Therefore avoid forcing a global change as a shortcut.
- Any eventual temporary settings change needs owner approval, a verified snapshot and atomic backup/recovery, no other concurrent AgY CLI session, and proof of restoration even on abnormal exit. The one-shot Claim is not a restoration record.
- Human final run must not use `--dangerously-skip-permissions`, `agy models` fallback or retry, project workspace, production repo, secret values, or script from a floating branch. Pin exact reviewed HEAD SHA.
- `ZC06C_SINGLE_RESPONSE_OBSERVED` means a verified fixed response/exit only, not verified AI Pro billing identity, absence of all Agent tools, on-device identity proof, or Codex QA closure.

Official references: https://antigravity.google/docs/cli/headless/ and https://antigravity.google/docs/cli-permissions . Risk register: Issue #35. Previous one-time ZC-04B Mac-to-GitHub Claim remains untouched.
