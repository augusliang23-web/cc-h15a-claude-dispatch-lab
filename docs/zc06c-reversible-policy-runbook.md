# ZC-06C — same-macOS-user reversible AgY tool-permission experiment

**Status:** DESIGN / OFFLINE QA ONLY. Owner approved preparing the procedure, not executing a global settings change. **Do not run this document as a script.** The owner's one-time Gemini experiment remains on HOLD. Do not start a daemon, change credentials, merge PR #36 or touch PM Dashboard / Inventory Tool.

## Exact operator scope

- Keep existing Mac login and Google AI Pro / Antigravity account.
- One intended provider call only, pinned `gemini-3.8-flash-low`, one non-sensitive `BLUE LANTERN` challenge, no fallback/retry, no Agent tools, no repository writeback.
- `~/.gemini/antigravity-cli/settings.json` is a **global** CLI setting; official documentation does not establish a per-headless-session full Deny-list override. Other CLI or desktop Antigravity sessions may observe temporary changes. No writes without new scoped owner permission.
- Under the same Unix UID, CLI caches, credentials and other user files remain within possible process reach. An explicit CLI Deny rule is not a kernel-enforced security boundary.

## Prerequisite evidence to collect (sanitized metadata only)

1. Exact reviewed PR #36 SHA and CI pass, independent Codex review of this exact SHA completed, no outstanding actionable P0/P1/P2; no changes to main branch.
2. Owner confirms on Mac at invocation time: Google AI Pro plan, AI Credit Overages **OFF**, no Gemini API key mode; CLI version and exact model slug unchanged. No credential or account-identifying output.
3. Read-only process inventory shows no other active `agy` CLI session or unidentified Antigravity process that could use these CLI global settings. Do not kill or auto-dismiss other applications. If concurrency cannot be ruled out, STOP.
4. Verify all ancestors of HOME, `.gemini/antigravity-cli`, `.local/bin/agy` and intended Claim directory: trusted root/owner, safe write bits, no untrusted symlinks. Verify actual macOS behavior on the real machine before provider invocation.
5. Read original **raw bytes** only into process memory, never into GitHub / console / chat. Reject invalid UTF-8 without lossy decoding. Capture SHA-256 of the original bytes, mode, owner and inode, and current relative change generation. Restoration MUST compare raw bytes, not decoded strings or normalized JSON. Deny if malformed, >128 KiB, invalid permission schema, nondefault provider, `useG1Credits=true`, `allowNonWorkspaceAccess=true` or changed baseline.

## Off-line plan and transaction state machine (no implementation of writes is authorized yet)

`bridge/zc06c-policy-plan.mjs` is intentionally pure: it calculates synthetic, proposed temporary JSON, hashes and restore checks; it **never** reads or writes any file and never starts a model. Internal proposed bytes are non-enumerable and must never be logged. All tests use non-sensitive fake settings. The following is a design for a future separately approved owner-run transaction:

```text
PREFLIGHT_READONLY
    | if any untrusted file/process/plan/billing state -> HOLD
    v
ORIGINAL_SNAPSHOT_DURABLE
    | original bytes captured to private 0600 backup (not repo)
    | fsync backup and parent; record state + SHA
    v
TEMPORARY_CONFIG_PREPARED
    | retain unrelated settings; strict toolPermission
    | ensure allowNonWorkspaceAccess=false, useG1Credits=false
    | required Deny actions read_file,write_file,command,
    | unsandboxed,read_url,execute_url,mcp; Deny outranks Allow
    v
COMPARE_AND_SWAP_ATOMICALLY
    | only if original inode/owner/mode/hash and no concurrent user
    | changed; no global overwrite on detected conflict
    v
EFFECTIVE_POLICY_CHECK
    | check on-disk temp hash and CLI policy support
    | if negative or uncertain -> RESTORE (no model)
    v
ONE_REAL_MODEL_ATTEMPT
    | one-shot durable Claim BEFORE invocation, fixed args
    | 45 sec supervisor, no fallback/retries, no tool activity
    v
RESTORE_AND_VERIFY
    | atomic restore of exact original bytes; compare SHA+mode
    | if concurrent change, DO NOT overwrite; recover manually
    v
DONE_OR_HOLD
```

**Recovery after crash:** Before temporary config is swapped, durable backup + transaction marker must be committed to a trusted owner-only path. On the next preflight, a leftover marker forces HOLD and an explicit recovery procedure. Recovery must distinguish original/temporary/unknown hashes, reject unknown or concurrently changed settings, avoid recreating or deleting the one-time model Claim, and never silently restart the provider.

**Timeout and failure:** Even a `SUCCESS` response is HOLD if process group liveness is uncertain, model identity mismatches, CLI diagnostics indicate tool use, workspace unexpectedly changes, or original settings fail exact restoration. Do not report "zero cost", verified subscription route or OS-level file isolation. Process-group termination is a best effort; verified test is still needed on Mac. A SIGKILL cannot ensure restoring files without separate durable recovery.

## Explicitly forbidden shortcuts

- Do **not** run `agy -p` while the owner's current settings lack explicit verified Deny rules.
- Do **not** set `--dangerously-skip-permissions`, `always-proceed`, `proceed-in-sandbox` or a direct API-key provider.
- Do **not** use a second macOS account (owner rejected it), and do not modify normal Antigravity global settings without scoped approval.
- Do **not** rely on a prompt like "do not use tools", chmod of empty cwd, or `--sandbox` as a complete access boundary. Google docs note that `--sandbox` can be ineffective if OS sandbox is unavailable.
- Do **not** hide permission changes in an AppBlock/terminal command, assume Codex review means model execution, auto-merge PR, or replay the old ZC-04B Claim.
- Do **not** promise that a Headless AgY session appears in Antigravity desktop chat; use future sanitized CLI event stream / GitHub Task ID to observe it.

## Current acceptance / next real human boundary

- Offline plan module and negative tests pass GitHub CI.
- Independent Codex exact-head review must confirm no new P0/P1/P2 within the changed code.
- **Still needs human approval of the actual temporary settings transaction** and macOS process inventory, plus a verified transaction/restore implementation. The earlier permission was to *prepare* only.
- Use CI/PR links as evidence; report `ZC06C_DESIGN_READY_REAL_CALL_HOLD` until evidence is satisfied.

Docs: [Antigravity permissions](https://antigravity.google/docs/permissions?tab=cli), [Headless](https://antigravity.google/docs/cli/headless/), [CLI flags](https://antigravity.google/docs/cli/reference/). Project: Issue #35 / Draft PR #36.


## Isolated filesystem rehearsal — implemented in CI only

`bridge/zc06c-transaction-rehearsal.mjs` exercises the transaction state machine on **synthetic bytes in a newly created private directory under the CI runner's OS temporary directory**. It deliberately does not accept a user-supplied settings path and never reads/writes real `~/.gemini`, launches AgY, or communicates with Gemini/GitHub.

It uses real fixture-only file creates, `fsync`, atomic renames, backup hashes and recovery checks. TX01–TX13 check normal restoration, **simulated** interruptions after backup/after apply/before restore, concurrent changes without overwriting, corrupted backup, malformed JSON/UTF-8 and nondefault billing configuration. Passing these tests proves only Linux CI's fixture code paths, **not** survival of a real power failure, macOS filesystem semantics, absence of an Antigravity permission bypass or restoration of the owner's actual settings.

For every simulated failure/recovery result, `simulated:true`, `user_settings_modified:false`, `model_called:false`. Recovery in this fixture happens inside one test process; it does **not** constitute a tested durable cross-process crash recovery mechanism. The fixture is cleaned up at completion. A live Mac transaction implementation, independent OS-level tests and exact owner approval remain separate gates.

**Gate:** offline fixture rehearsal PASS is necessary preparation, but is never sufficient to unlock any real settings write or Gemini call.
