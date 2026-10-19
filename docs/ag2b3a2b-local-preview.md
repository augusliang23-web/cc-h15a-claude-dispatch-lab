# AG2B-3A-2B — One-Mac preview product contract and plan

Spec: Issue #16. Baseline main `f9deef98a987a254aac93ee88f8f87661f7b8512`.

## Product contract / design

One foreground local review page, defaulting to a clearly synthetic valid task.
The person inspects fixed source, repository, Issue identity, exact revision and
proposed agent/model/dry-run scope; Refresh deliberately verifies it; Approve
Preview asks confirmation; Reject records a terminal local rejection. History
survives stop/restart and remains non-authoritative. No remote text is rendered;
a safe fixed summary replaces it. No remote task is currently selected/enrolled.

Node built-ins only. A double-clickable `.command` starts the foreground process
and opens the loopback browser; normal interaction is buttons, no typed commands.
A Stop button shuts down. Gatekeeper/quarantine and existing Node availability
are documented rather than bypassed or installed. No launch registration.

UI and assets use a random loopback port, strict exact Host and Origin, per-launch
fragment capability exchanged in POST (removed from address bar), HttpOnly
SameSite Strict session, CSRF token, JSON-only size-bounded POSTs, CSP/no-cache,
no remote assets, no client storage. Reload/page fetch never refreshes task proof.
One session is local convenience, not independent human authentication.

Dedicated private preview ledger, separate from the existing execution Journal:
checksummed hash-chain event history, sequence and checkpoint consistency,
exclusive lock, synced atomic rename. Interrupted writes/locks/corruption/time
rollback or mismatched checkpoint HOLD. No automatic repair/reset. No software
can detect coordinated restoration/deletion of all local evidence by the same OS
user without an independent anchor; this preview is not an authoritative audit.
Restart, stale observation, edited/unknown/offline source and duplicates never
reapprove. Terminal local decisions cannot reverse; new revision needs new review.

Optional source abstraction accepts the existing GET-only adapter's sanitized
observations. Default launcher needs no credential, network or valid remote task;
it is explicitly synthetic. No new token UI/cache, signer, claim writer, provider,
cloud, persistent service or real execution path is added. Existing gates unchanged.

## Implementation plan (native execution + one independent security reviewer)

- [x] Tests first: ledger persistence/sequence/rollback/locks/corruption/terminal
  decisions; source validation/pinned refresh, revision change, offline and restart.
- [x] Implement `local-preview/ledger.mjs`, `review.mjs` and synthetic source.
- [x] Tests first: loopback Host/Origin, session/CSRF/replay, verbs/body limits,
  headers/static routes/shutdown. Implement `server.mjs` + fixed local assets.
- [x] Add double-click launcher and five-minute walkthrough. Verify actual browser
  journey (confirmation/cancel/approve/reject/history/restart); report separately
  from the human's own device acceptance.
- [x] Run all 184 prior plus new offline tests. Keep original source/tests and four
  Claude workflows byte-identical; scope CI exact new PR/branch after number known.
- [x] Inspect external routines before push/open; independently review actual diff,
  fix P1/P2, create one Draft PR and collect exact-head hosted CI. Stop.

Review focus: cross-site localhost writes; stale async refresh/decision races;
duplicate sessions/requests; restart/corrupt/rolled-back ledger; accidental remote
content/credentials in UI or disk. None may authorize real work.


## 五分鐘 Mac 操作示範（使用者驗收尚未進行）

前提：這個候選版本已放在 Mac，本機已有 Node.js 20+。不需 GitHub
登入、網路或 token。若尚未具備前提，停止並回報；不要安裝或改系統設定。

1. **0:00–1:00** 在 Finder 雙擊專案根目錄的 **Open Local Preview.command**。
   系統會開啟一個前景 Terminal 視窗及瀏覽器；無需輸入指令。
   若 macOS 阻擋或 Node 不存在，停止並回報。此入口未簽章／公證，
   下載來源的 quarantine/Gatekeeper 行為尚未驗證，不要求繞過防護。
2. **1:00–2:00** 確認頁首 LOCAL PREVIEW，再按「重新核對 Refresh」。
   應看到 SYNTHETIC FIXTURE、合成 Issue #101、儲存庫、完整版本雜湊、
   提議的 antigravity/model 和 dry-run。這不是實際 GitHub 任務。
3. **2:00–3:00** 選「批准預覽」→先按「取消」，歷史應不變。
   再選批准並確認，**或改選拒絕**。這個版本只能記錄一個終局決定，
   不能為了示範反轉或刪除歷史。按鈕應停用，歷史增加一筆。
4. **3:00–4:00** 按「停止並關閉服務」，等前景視窗顯示服務已停止。
   再雙擊同一入口。歷史應保留；頁面顯示待重新核對／已過期，
   不能把舊決定當作新批准。按 Refresh 後仍不能重批同版本。
5. **4:00–5:00** 確認沒有 GitHub 保留、AI 執行或發布功能，然後按停止。
   關閉瀏覽器頁面不等於停止服務；不要同時開第二個啟動視窗。

若閱讀超過兩分鐘，預覽會過期，需要重新核對。此版本沒有會執行遠端
動作的計時器、輪詢或隱藏按鈕。若已在同一資料夾做過示範，會先看到
既有歷史；不提供清空歷史捷徑以重演批准。拒絕路徑可在獨立測試目錄驗證。

## Storage, recovery and source boundary

Normal launcher uses only a synthetic fixture. It creates `local-preview/.demo-state/`
with 0700 directory, 0600 ledger/checkpoint and an exclusive session lock, excluded
from git. No task body, title, token, email or signing key is stored. History holds
only bounded schema fields/digests, local decision, sequence, timestamps and prior
hash. Local `approval: approved` in a fixture schema is never authority.

A clean Stop syncs completed operations and releases the lock. Interrupted writes,
corruption, an existing empty directory, invalid permissions, mismatched checkpoint,
external changes or a left-over lock HOLD with no automatic deletion/repair. Stop
and preserve files for human reconciliation. Coordinated rollback of ledger AND
checkpoint, deletion of the entire directory, malicious same-user filesystem changes
or automating local clicks cannot be independently detected/prevented. This is a
local convenience audit, not tamper-proof human consent or an authoritative record.

Mac off/asleep: no polling or task execution. After restart or page reload, an
explicit Refresh is required. Offline sources may show cached sanitized preview/
history only; failed current recheck blocks decisions. A changed revision consumes
the old display proof and requires a new deliberate review. Terminal decisions
cannot reverse at the same exact binding/source. No exactly-once guarantee.

`githubSource(ReadOnlyGitHub, issueNumber, pinnedNodeId)` is a trusted developer
integration seam for the existing adapter, not a UI URL/token box. It rechecks
pinned identity/revision before recording. No automatic selection of a remote task
or credential lookup was added to the double-click entry. No authorized valid
remote task is currently configured, so the default demo remains synthetic.
One separate manual authenticated GET-only observation of real planning Issue #14
returned TASK_SCHEMA_REJECTED, execution_allowed=false, node
`I_kwDOVN9hnM8AAAABYJ92xQ`, revision
`66e2d0cc1d5eb70b2f1b4b4951df79a980b29bcb9a4db266aa697784c1f68ab3`,
request ID `2E12:39068E:B2406D:116B8F5:6AD57BAC` (2026-10-19).
Existing auth stayed in memory via stdin; no token appeared in UI, files or logs.
This proves a planning ticket was rejected, not live task acceptance.

## Evidence and independent review

- Local full suite: **184 existing + 22 new = 206/206**, zero failed/skipped.
  New tests cover real local HTTP/CSRF/session/body/Host/Origin boundaries, fixed
  static routing, explicit shutdown, reload invalidation, ledger concurrency,
  restart/corrupt/locked/partial rollback/time conditions, no repeat/reversal,
  revision edit/offline and the existing GET-only adapter behind mock transport.
- Agent browser check: synthetic card; full identity/revision/agent fields;
  confirmation/cancel leaves history unchanged; approval records once and disables
  buttons; Stop; clean restart preserves history with non-current/disabled state.
  Separate disposable browser session verified Reject, terminal history and Stop.
  Browser automation is NOT the user's independent human/device acceptance.
- Finder automation could not reliably bind its window, so a real Finder double
  click has not yet been independently verified. Executable mode and shell syntax
  are checked; browser UI is exercised through the same server. The user's demo
  should verify launcher/Node/Gatekeeper behavior first. Nothing was installed.
- Separate GPT-6.1 Sol High reviewer ran the 15 then-current new tests and found
  one P2: reads interleaved between ledger/checkpoint replacements caused false
  corruption HOLD. P10 first failed, then a shared FIFO serializing ALL reads and
  appends fixed it. The reviewer independently confirmed P10/P07/P08 and genuine
  corruption still HOLDs. Targeted closure PASS; no unresolved in-scope P1/P2.
- Browser opening revealed an over-strict public-shell navigation guard; a failing
  H07 reproduced it. Fixed static GET can load while API/session requests retain
  exact Host/Origin/Sec-Fetch-Site checks. P11/H08 also verify historical approval
  cannot mask restart/HOLD and a page reload invalidates the old review proof.
  The reviewer separately inspected only these changed areas and passed them.
- Read-only automation preflight before push/open: known Claude Routine Paused,
  Enabled=0, All triggers paused; exact unrelated canary PR title/branch/author.
  Four existing workflows reviewed: three manual dispatch only, Issue-opened
  canary requires `H15A4C_DISPATCH_CANARY_V1`; this task opens no Issues/dispatches.
  No settings changed. Final exact-head hosted CI/activity evidence lives in PR.

## Acceptance and next gate

Implementation/offline tests: ready for review, subject to final exact-head CI.
Human hands-on Mac acceptance: **NOT RUN**. Deployment: **NOT PERFORMED**.
Recommend Control Plane allow only the synthetic five-minute hands-on demo.

Real single-Mac one-task execution stays **HOLD**: independent trusted approval
(or an explicitly redesigned and approved trust contract), actual safe task and
exact revision, lab-only credential, immutable reservation/replay protocol, current
source/time/revocation checks, proven interruption recovery, accepted automation
and execution adapter boundaries, plus new explicit operation-specific approval.
None of these are supplied by a local click, CI or PR acceptance. Existing
firstWriteGate/admitLive/claimLive/executeLive remain unchanged and fail closed.
No real reservation, provider execution, deployment, service installation, merge
or production modification was performed.
