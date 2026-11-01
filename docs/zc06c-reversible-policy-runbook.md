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


## Cross-process synthetic recovery rehearsal

The new `bridge/zc06c-crossprocess-fixture.mjs` and its CP01–CP08 tests exercise **separate Node processes** and a deliberately private synthetic temporary directory. A child process applies restricted synthetic settings and exits without restoring; another separate child process reads the on-disk journal and original backup and restores the synthetic settings byte-for-byte. The tests also check unknown concurrent modifications, corrupted backup, invalid journal, duplicate apply and symlinked fixture markers.

The synthetic fixture rejects paths outside its own `zc06c-crossproc-...` temporary namespace and never accesses `~/.gemini/antigravity-cli/settings.json`, billing, the actual AgY executable or the owner's project repositories. The process-exit simulation does **not** simulate OS power loss, torn writes, fsync failure at every possible instruction, or real macOS APFS crash recovery. Nor does it establish that global Deny works for the installed CLI version.

After CP01–CP08 pass on Linux CI, the next useful non-invasive step is a pinned-SHA Mac run of those eight tests; this requires no settings changes, only temporary synthetic fixture files. The run remains **strictly no-provider** and must not be conflated with permission to run a real model.


### TOCTOU / concurrent writer limitation after final hash check

Codex identified a P2: a second process can write settings between the hash inspection and `rename` replacement. The cross-process **synthetic** fixture now checks the settings hash once again just before apply and just before restore, and tests CP09–CP10 inject a competing writer after journal update to confirm HOLD without overwriting **in those observable interleavings**.

However this does **not** provide atomic compare-and-swap. An uncooperative writer can still mutate the file after the last check. Portable Node filesystem API has no atomic check-current-hash-and-replace primitive. A production Mac transaction must use an exclusive cooperating lock and confirm no other AgY settings users; external noncooperating writes remain a residual risk. The actual user settings must never be changed under the current design-only authorization.

**Guarantee language:** We detect changes present at inspection and specific test interleavings; we do **not** guarantee preserving concurrent writes at every timing or true power-loss-safe restoration. If a conflicting active process cannot be excluded, STOP rather than attempt the global transaction. Neither CI nor synthetic tests prove the owner Mac is free of concurrent writers.


## Owner-authorized real Mac configuration-only trial (no provider)

On 2026-11-01, the owner authorized a **temporary, locally applied global Antigravity CLI settings policy change and exact restore** while no Antigravity tasks are running. They **did not authorize Gemini/AgY model invocation, billing changes, PR merge/deploy, a second macOS user or a background daemon**.

A new experimental command has been implemented in \`bridge/zc06c-mac-policy-transaction.mjs\`. Its only direct CLI flags are \`--apply-and-restore\` and \`--recover-only\`; it cannot call an AI model. No user-supplied path is accepted by its CLI. Until a pinned HEAD passes independent Codex review and an owner-side macOS run succeeds, it remains a **candidate**, not a proven restore facility.

### Preflight / execution boundary

1. Save all Antigravity work. Fully quit the Antigravity desktop application and any \`agy\` CLI sessions. The transaction preflight rejects any process whose process name indicates Antigravity or \`agy\`. It does not attempt to kill processes, but a process-name scan cannot prove absolute quiescence against invisible/unrecognized processes.
2. Use a clean exact-SHA checkout of the reviewed branch. Never run a floating-branch script or a command pasted from an unverified source.
3. The script requires \`darwin\`, non-root, trusted HOME ancestors and settings parents, a regular owned non-symlink \`settings.json\`, owner-private permissions \`0600\`, and a valid JSON baseline accepted by the pure policy planner. Any unexpected state stops without attempting a provider call.
4. It requires an absent previous recovery directory and absent staging files. Creates a private durable backup and manifest under \`.gemini/antigravity-cli/.zc06c-restore-once\` before temporary config replacement; verifies original inode/mode/hash immediately before application.
5. Temporarily inserts strict \`toolPermission\`, explicit tool Deny rules, no nonworkspace access and no extra AI credits. It checks the applied settings bytes and immediately restores the original backup with matching raw bytes and original mode. It removes its recovery directory only after verifying the restoration.
6. Any exception or unknown file change results in a HOLD. If the private recovery folder remains, the owner should **not manually delete it or launch AgY**. Review the sanitized result and invoke the *same exact SHA* \`--recover-only\` on the Mac, only after understanding why the preceding run held; unresolved or competing writes require manual reconciliation, not forced overwrite.
7. The script uses Node synchronous filesystem operations, fsync and same-directory rename. **SIGKILL, OS crash and noncooperating writers can still interrupt restoration or race its final check**. A durable private backup makes explicit recovery possible but does not guarantee automatic recovery after sudden process termination. The script is not a kernel-enforced sandbox.

### Forbidden outcome claims

- Do NOT infer from configuration apply/restore that the installed AgY CLI obeys Deny at runtime; the tool is never launched by this trial.
- Do NOT infer Google AI Pro account mapping, zero provider cost guarantees for future model use, or freedom from other applications reading the global settings.
- Do NOT claim this can run while Antigravity Desktop is still open; the candidate intentionally fails closed when it detects the app.
- Only \`ZC06C_MAC_EXACT_RESTORE_CONFIRMED\` plus a separate owner-run trace and independent security review establish that one trial restored its observed settings bytes. They do **not** establish unrestricted production readiness.

**Incremental AI usage for this config-only run is zero** by design (no provider action), though GitHub Actions CI may consume included runner minutes. Full development "Zero Copy" dispatch remains a later separate milestone.


### Codex P1/P2 adjustments before Mac write

The first review of the live config-only runner identified three real blockers:
- **P1:** \`--recover-only\` originally bypassed the Antigravity process-quiescence check. **Fixed:** all recovery paths now refuse to change settings when a known Antigravity/agy process is present. This may deliberately defer recovery until the owner closes the app; never kill that app automatically.
- **P2:** temporary JSON can exceed 128 KiB even when original JSON passes validation. **Fixed:** reject any proposed temporary settings above 131072 bytes **before backup or replacement**.
- **P2:** an original file with matching bytes but altered permissions must not be called fully restored. **Fixed:** require original mode and raw bytes to match the saved manifest before deleting backup and returning PASS; reject unexpected restricted mode too.

Five additional synthetic tests MT14–MT18 exercise those exact cases. The runner still cannot guarantee protection against noncooperating writers racing after a hash comparison, and does not attest that AgY implements the Deny list. The only authorized live action remains config-only apply-and-restore; any provider/model execution is prohibited.


### Codex macOS ACL and no-op policy guards

The second review of the owner-authorized config-only runner found two more P2 issues:
- On macOS, BSD mode 0600/0700 alone is insufficient if ACL entries grant additional file or inherited directory access. The runner now uses read-only \`/bin/ls -lde\` checks on the trusted HOME/config ancestry, the original settings, the private recovery directory and newly created staging/backup files **before writing secret-bearing bytes**. It rejects explicit ACL markers/entries and unverifiable output. These checks are conservative and need native macOS confirmation; Linux CI mocks macOS ACL output.
- A byte-identical already-restricted JSON should not be replaced, since its original mode might be 0400 and an unnecessary 0600 replacement can strand restoration. The runner now returns \`POLICY_ALREADY_IDENTICAL_NO_WRITE\` before any backup or config write.

Synthetic regression cases MT19–MT23 cover declared ACLs, unknown ACL state, inherited ACL on backup creation and a byte-identical 0400 policy. Neither a mocked \`ls\` nor a clean Codex review alone proves macOS ACL safety. The code still cannot guarantee race-free protection against arbitrary noncooperating settings writers.


### Restore staging cleanup after transient ACL failure

A subsequent exact-HEAD Codex review reported P2: an ACL check failure after creating an owner-private restore staging file could leave an empty file that causes both automatic and explicit recovery to HOLD forever. The corrected \`newFile\` handling unlinks **only** the currently open descriptor's own inode (verified by file/device identifiers and no symlink) after a failed staged write; it never deletes another file merely because a path name matches. The durable original backup is preserved.

Regression tests MT24–MT25 simulate a one-time ACL scan error and a persistent ACL refusal on the restore stage. A persistent failure yields HOLD and leaves a recovery backup; when ACL scanning is safe, an explicit \`--recover-only\` can succeed. This is still synthetic Linux evidence; the owner must verify the actual Mac run independently, with Antigravity closed and no provider call.

### ZC-06C R3: retain unfamiliar recovery entries (Linux synthetic evidence only)

The most recent independent review of Draft PR #36 found another P2: when a different same-UID writer substituted an unexpected restore-stage pathname, `cleanRecovery()` recursively deleted the **other writer's** file after the original settings had been restored. MT26 originally stopped too early to detect this.

The experimental candidate now inspects the recovery directory's immediate entry names before cleanup. When any unexpected entry or abandoned randomized stage remains, the resulting gate is `ZC06C_MAC_TRANSACTION_HOLD`, reason `RECOVERY_UNEXPECTED_ENTRIES_RETAINED`, **even after original settings bytes/mode are restored**. It preserves the backup, manifest, and unexpected file for reconciliation. For an exactly two-entry record, it uses individually named unlink operations followed by nonrecursive rmdir instead of `fs.rmSync(...recursive:true)`. MT24–MT26 now check retained records, including MT26's *subsequent successful restoration*. MT27 introduces an unexpected same-UID entry before cleanup and confirms it survives both initial and later recovery.

**Operational impact:** a transient ACL failure can now produce a safe but *persistent* recovery HOLD after exact settings restoration; a later `--recover-only` is not permission to delete unknown files. Do not clear the recovery directory manually without independent analysis of all entries and rollback evidence.

**Residual risk:** pathname check + named unlink still cannot provide atomic exclusion against an adversarial same-UID process racing those *known* names. The owner selected the existing Mac account, so this is not an OS-level filesystem isolation guarantee. The real Mac trial, global settings edits, actual Gemini call and unattended execution remain **HOLD** pending native macOS evidence, security review and the required owner gates.

Verified isolated GitHub Actions for HEAD `9ef54d172be8b2b38289489540ef0b3ef1e7136f`: [Run #41286375208](https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/actions/runs/41286375208), **369/369 PASS** (Linux synthetic). The tests do not establish native macOS safety, and an exact-HEAD independent Codex review is still missing.

### ZC-06C R4 — no automated cleanup without OS-enforced isolation

The next exact-HEAD independent Codex review found one remaining P2 in R3: checking `manifest.json` and `original.bytes` by name/owner/mode before deleting them still permits a different process with the **same macOS user identity** to replace either path after inspection. The cleanup could delete the substitute, even if only the two expected names exist. No re-stat, hash, inode comparison or additional pathname check can provide an atomic file ownership guarantee across an untrusted same-UID writer.

**Conservative R4 behavior:**
- All source policy restore attempts still verify raw saved settings bytes and original mode before reaching the end of a transaction.
- `cleanRecovery` intentionally performs **no destructive operation** (no unlink, rmdir, recursive removal), even when exactly two expected files are present.
- Successful byte/mode restoration returns `ZC06C_MAC_TRANSACTION_HOLD` / `RECOVERY_EVIDENCE_RETAINED_OWNER_ACTION_REQUIRED`, NOT `ZC06C_MAC_EXACT_RESTORE_CONFIRMED`. The remaining recovery directory intentionally blocks a new apply attempt.
- MT28/MT29 inject substitutions of the two *known* recovery file names before and after a read-only cleanup checkpoint and verify both foreign files and the original settings persist. Earlier MT tests have been updated to expect retained records.
- The candidate does **not** provide a safe automated cleanup or an approved owner-side manual deletion recipe. Manual reconciliation must establish current file provenance and OS session safety independently; never simply remove all files to make the gate green.

This deliberately sacrifices a successful self-cleaning outcome until a reviewed stronger isolation primitive or revised transaction architecture can protect the files against a same-UID adversary. Native macOS filesystem semantics, actual ACL enforcement, CLI tool-deny policy and real Gemini usage remain **HOLD**. A green Linux synthetic CI only attests its modeled behavior.

R4 candidate pending exact-HEAD CI and independent Codex security review. No owner Mac, provider, Merge, Deploy or automatic worker action was performed.
