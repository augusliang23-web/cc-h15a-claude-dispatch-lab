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

test('AC19 non-string event ID must fail closed even when coerced text matches processed ID',()=>{
 const r=trial(x=>{
   x.history.processedEventIds=['event-0001'];
   x.evidence.eventId=['event-0001'];
 });
 safe(r);assert.equal(r.gate,'HOLD');
 assert.equal(r.reason,'INVALID_OFFLINE_ENVELOPE');
 assert.equal(r.next_history,null);
});

test('AC20 newer P1 HOLD cannot be overturned by reordered older CI failure',()=>{
 const newer=trial(x=>{
   x.evidence.eventId='event-0002';
   x.evidence.observedAt='2026-11-01T02:01:00Z';
   x.evidence.ci.checkedAt='2026-11-01T02:01:00Z';
   x.evidence.qa.checkedAt='2026-11-01T02:01:00Z';
   x.evidence.ci.status='SUCCESS';
   x.evidence.qa.status='CHANGES_REQUESTED';
   x.evidence.qa.findings=[{severity:'P1',category:'security'}];
   x.now='2026-11-01T02:01:05Z';
 });
 safe(newer);
 assert.equal(newer.gate,'HOLD');
 assert.equal(newer.next_history.terminalGate,'SAFETY_HOLD');
 assert.equal(newer.next_history.lastObservedAt,'2026-11-01T02:01:00Z');
 const older=trial(x=>{
   x.history=structuredClone(newer.next_history);
   x.now='2026-11-01T02:01:15Z';
 });
 safe(older);
 assert.equal(older.gate,'HOLD');
 assert.equal(older.reason,'SUPERSEDED_OR_REORDERED_EVENT');
 assert.equal(older.next_history,null);
});

test('AC21 even newer event cannot lift prior security stop without owner gate',()=>{
 const r=trial(x=>{
   x.history.lastObservedAt='2026-11-01T02:01:00Z';
   x.history.lastObservedHead=x.task.head;
   x.history.terminalGate='SAFETY_HOLD';
   x.history.processedEventIds=['event-0002'];
   x.evidence.eventId='event-0003';
   x.evidence.observedAt='2026-11-01T02:02:00Z';
   x.evidence.ci.checkedAt='2026-11-01T02:02:00Z';
   x.evidence.qa.checkedAt='2026-11-01T02:02:00Z';
   x.now='2026-11-01T02:02:05Z';
 });
 safe(r);
 assert.equal(r.reason,'PRIOR_TERMINAL_GATE');
 assert.equal(r.next_history,null);
});

test('AC22 owner-review PASS is terminal, cannot turn into automatic retry',()=>{
 const finished=trial(x=>{
   x.evidence.ci.status='SUCCESS';
   x.evidence.qa.status='APPROVED';
 });
 safe(finished);assert.equal(finished.gate,'READY_FOR_OWNER');
 assert.equal(finished.next_history.terminalGate,'READY_FOR_OWNER');
 const after=trial(x=>{
   x.history=structuredClone(finished.next_history);
   x.evidence.eventId='event-0004';
   x.evidence.observedAt='2026-11-01T02:01:00Z';
   x.evidence.ci.checkedAt='2026-11-01T02:01:00Z';
   x.evidence.qa.checkedAt='2026-11-01T02:01:00Z';
   x.now='2026-11-01T02:01:10Z';
 });
 safe(after);assert.equal(after.reason,'PRIOR_TERMINAL_GATE');
});

test('AC23 proposed history marks event as processed, no double retry recommendation',()=>{
 const first=trial();safe(first);
 assert.equal(first.gate,'AUTO_RETRY_ELIGIBLE_MOCK');
 assert.deepEqual(first.next_history.processedEventIds,['event-0001']);
 const replay=trial(x=>{x.history=structuredClone(first.next_history);});
 safe(replay);assert.equal(replay.reason,'DUPLICATE_EVENT');
 assert.equal(replay.next_history,null);
});

test('AC24 mismatch between pinned head and historical watermark must HOLD',()=>{
 const r=trial(x=>{
   x.history.lastObservedAt='2026-11-01T01:59:00Z';
   x.history.lastObservedHead='f'.repeat(40);
   x.history.terminalGate='NONE';
 });
 safe(r);assert.equal(r.reason,'HISTORY_HEAD_MISMATCH');
});

test('AC25 equal-timestamp unseen event is not fresh evidence',()=>{
 const r=trial(x=>{
   x.history.lastObservedAt='2026-11-01T02:00:00Z';
   x.history.lastObservedHead=x.task.head;
   x.history.terminalGate='NONE';
   x.evidence.eventId='event-0008';
 });
 safe(r);assert.equal(r.reason,'SUPERSEDED_OR_REORDERED_EVENT');
});

test('AC26 malformed watermark, missing terminal gate, and inconsistent history fail closed',()=>{
 const cases=[
  x=>{x.history.lastObservedAt='2026-11-01T01:59:00Z';},
  x=>{x.history.lastObservedHead=x.task.head;},
  x=>{x.history.terminalGate='SAFETY_HOLD';},
  x=>{delete x.history.terminalGate;},
  x=>{x.history.lastObservedAt=['2026-11-01T01:59:00Z'];},
  x=>{x.history.terminalGate='RUNNING';},
 ];
 for(const mutate of cases){
   const r=trial(mutate);safe(r);
   assert.equal(r.reason,'INVALID_OFFLINE_ENVELOPE');
   assert.equal(r.next_history,null);
 }
});

test('AC27 stale evidence does not advance monotonic history',()=>{
 const r=trial(x=>{x.evidence.observedAt='2026-11-01T01:50:00Z';});
 safe(r);assert.equal(r.reason,'STALE_OR_FUTURE_EVIDENCE');
 assert.equal(r.next_history,null);
});

test('AC28 processed-ID capacity exhausted stops without recording new event',()=>{
 const r=trial(x=>{
   x.history.processedEventIds=Array.from({length:50},(_,i)=>'prior-'+String(i).padStart(4,'0'));
 });
 safe(r);assert.equal(r.reason,'HISTORY_EVENT_LIMIT');
 assert.equal(r.next_history,null);
});
