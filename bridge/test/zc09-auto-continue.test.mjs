import test from 'node:test';
import assert from 'node:assert/strict';
import {decideAutoContinue,FIXTURE} from '../zc09-auto-continue.mjs';

const trial = edit => { const x=structuredClone(FIXTURE); edit?.(x); return decideAutoContinue(x); };
const safe = r => {
 assert.equal(r.mode,'OFFLINE_SYNTHETIC_ONLY');
 assert.equal(r.actual_dispatch,false);
 assert.equal(r.provider_calls,0);
 assert.equal(r.github_writes,0);
 assert.equal(r.mac_writes,0);
 assert.equal(r.merger,false);
 assert.equal(r.ready_to_merge,false);
 assert.equal(r.owner_approval_required,true);
};
test('AC01 one normal synthetic CI failure may recommend bounded retry, NEVER dispatch',()=>{
 const r=trial();safe(r);
 assert.equal(r.gate,'AUTO_RETRY_ELIGIBLE_MOCK');
 assert.equal(r.reason,'BOUNDED_OFFLINE_RETRY_RECOMMENDATION');
 assert.match(r.decision_id,/^[a-f0-9]{64}$/);
});
test('AC02 synthetic matching CI+QA PASS stops for owner, never auto-merges',()=>{
 const r=trial(x=>{x.evidence.ci.status='SUCCESS';x.evidence.qa.status='APPROVED';});
 safe(r);assert.equal(r.gate,'READY_FOR_OWNER');
});
test('AC03 repeated event cannot dispatch or recommend again',()=>{
 const r=trial(x=>{x.history.processedEventIds.push(x.evidence.eventId);});
 safe(r);assert.equal(r.reason,'DUPLICATE_EVENT');
});
test('AC04 exact HEAD CI mismatch blocked',()=>{
 const r=trial(x=>{x.evidence.ci.head='f'.repeat(40);});
 safe(r);assert.equal(r.reason,'EXACT_HEAD_MISMATCH');
});
test('AC05 exact HEAD QA mismatch blocked',()=>{
 const r=trial(x=>{x.evidence.qa.head='f'.repeat(40);});
 safe(r);assert.equal(r.reason,'EXACT_HEAD_MISMATCH');
});
test('AC06 stale evidence or suspicious future clock blocked',()=>{
 for(const updated of ['2026-11-01T01:40:00Z','2026-11-01T02:02:00Z']){
   const r=trial(x=>{x.evidence.ci.checkedAt=updated;});
   safe(r);assert.equal(r.reason,'STALE_OR_FUTURE_EVIDENCE');
 }
});
test('AC07 retry attempt limit 2, no third attempt',()=>{
 const r=trial(x=>{x.history.attemptsUsed=2;});
 safe(r);assert.equal(r.reason,'RETRY_ATTEMPT_CAP_REACHED');
});
test('AC08 projected incremental cost cannot exceed owner cap',()=>{
 const r=trial(x=>{x.history.costSpentUsd=0.5;});
 safe(r);assert.equal(r.reason,'COST_CAP_REACHED');
});
test('AC09 elapsed-time cap refuses another retry',()=>{
 const r=trial(x=>{x.history.elapsedSeconds=300;});
 safe(r);assert.equal(r.reason,'TIME_CAP_REACHED');
});
test('AC10 P2 finding never auto-retries, even if functional',()=>{
 const r=trial(x=>{x.evidence.ci.status='SUCCESS';x.evidence.qa.status='CHANGES_REQUESTED';
 x.evidence.qa.findings=[{severity:'P2',category:'functional'}];});
 safe(r);assert.equal(r.reason,'HUMAN_REVIEW_SECURITY_OR_P2');
});
test('AC11 security P3 finding also requires human review',()=>{
 const r=trial(x=>{x.evidence.ci.status='SUCCESS';x.evidence.qa.status='CHANGES_REQUESTED';
 x.evidence.qa.findings=[{severity:'P3',category:'security'}];});
 safe(r);assert.equal(r.reason,'HUMAN_REVIEW_SECURITY_OR_P2');
});
test('AC12 low-risk functional P3 can only create mock retry recommendation',()=>{
 const r=trial(x=>{x.evidence.ci.status='SUCCESS';x.evidence.qa.status='CHANGES_REQUESTED';
 x.evidence.qa.findings=[{severity:'P3',category:'functional'}];});
 safe(r);assert.equal(r.gate,'AUTO_RETRY_ELIGIBLE_MOCK');
});
test('AC13 unverified CI or review status blocked',()=>{
 for(const side of ['ci','qa']){
   const r=trial(x=>{x.evidence[side].status='UNKNOWN';});
   safe(r);assert.equal(r.reason,'UNVERIFIED_EXTERNAL_STATE');
 }
});
test('AC14 running fixture is WAIT only, never REAL_RUNNING',()=>{
 const r=trial(x=>{x.evidence.ci.status='RUNNING';});
 safe(r);assert.equal(r.gate,'WAITING_EVIDENCE');
});
test('AC15 invalid external scope, arbitrary path and fake owner approval blocked',()=>{
 const cases=[
  x=>{x.task.repo='augusliang23-web/pm-dashboard';},
  x=>{x.task.paths=['../../.ssh/id_rsa'];},
  x=>{x.task.approval='approved';},
  x=>{x.task.extra='unreviewed';},
  x=>{x.mode='LIVE';},
  x=>{x.policy.maxAttempts=100;},
  x=>{x.policy.maxCostUsd=100;},
 ];
 for(const f of cases){const r=trial(f);safe(r);assert.equal(r.reason,'INVALID_OFFLINE_ENVELOPE');}
});
test('AC16 inconsistent or ambiguous evidence blocks automatic retry',()=>{
 const r=trial(x=>{x.evidence.qa.status='APPROVED';});
 safe(r);assert.equal(r.reason,'CONTRADICTORY_CI_QA_STATE');
});
test('AC17 different event ID yields unique decision ID, no time-based nondeterminism',()=>{
 const first=trial();const again=trial();const second=trial(x=>{x.evidence.eventId='event-0002';});
 safe(first);safe(second);
 assert.equal(first.decision_id,again.decision_id);
 assert.notEqual(first.decision_id,second.decision_id);
});
test('AC18 invalid shape never leaks input into output',()=>{
 const r=trial(x=>{x.task.id='PRIVATE_PROMPT_SENTINEL';x.task.paths=['src/private.txt'];});
 safe(r);assert.equal(r.gate,'HOLD');
 assert.equal(JSON.stringify(r).includes('PRIVATE_PROMPT_SENTINEL'),false);
});
