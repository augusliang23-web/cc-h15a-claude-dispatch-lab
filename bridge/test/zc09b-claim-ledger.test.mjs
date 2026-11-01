import test from 'node:test';
import assert from 'node:assert/strict';
import {proposeClaimTransition,SYNTHETIC_FIXTURE} from '../zc09b-claim-ledger.mjs';

const clone=()=>structuredClone(SYNTHETIC_FIXTURE);
const run=edit=>{const x=clone();edit?.(x);return proposeClaimTransition(x);};
const safe=r=>{
 assert.equal(r.mode,'SYNTHETIC_OFFLINE_ONLY');
 assert.equal(r.actual_dispatch,false);
 assert.equal(r.provider_calls,0);
 assert.equal(r.github_writes,0);
 assert.equal(r.mac_writes,0);
 assert.equal(r.ready_to_merge,false);
 assert.equal(r.durable_claim,false);
 assert.equal(r.owner_approval_required,true);
};
const hold=(r,reason)=>{
 safe(r);assert.equal(r.gate,'HOLD');assert.equal(r.reason,reason);
};
const claim=()=>{const r=run();safe(r);assert.equal(r.gate,'MOCK_CLAIM_PROPOSED');return r;};
const follow=(first,kind='COMPLETE',completion='PASS',edit)=>{
 const x=clone();
 x.ledger=structuredClone(first.proposed_ledger);
 x.expectedRevision=x.ledger.revision;
 x.event.eventId='event-0002';
 x.event.observedAt='2026-11-01T01:02:00Z';
 x.event.proof.ciCheckedAt='2026-11-01T01:01:15Z';
 x.event.proof.qaCheckedAt='2026-11-01T01:01:30Z';
 x.now='2026-11-01T01:02:05Z';
 x.event.kind=kind;
 if(kind==='COMPLETE'){x.event.leaseId=x.ledger.activeLease.leaseId;x.event.completion=completion;}
 edit?.(x);
 return proposeClaimTransition(x);
};

test('CB01 eligible synthetic claim only proposes next revision',()=>{
 const r=claim();
 assert.equal(r.proposed_ledger.revision,1);
 assert.equal(r.proposed_ledger.usedClaims,1);
 assert.deepEqual(r.proposed_ledger.seenEvents,['event-0001']);
 assert.equal(r.proposed_ledger.lastObservedAt,'2026-11-01T01:01:00Z');
 assert.equal(r.proposed_ledger.activeLease.sha,'a'.repeat(40));
 assert.match(r.proposed_ledger.activeLease.leaseId,/^[a-f0-9]{64}$/);
});
test('CB02 immutable fixture remains unchanged across policy evaluation',()=>{
 const input=clone(),copy=structuredClone(input);
 proposeClaimTransition(input);
 assert.deepEqual(input,copy);
});
test('CB03 stale expected revision must never claim',()=>hold(run(x=>x.expectedRevision=1),'REVISION_CONFLICT'));
test('CB04 unauthorized repository/task must fail closed',()=>hold(run(x=>x.event.task.repo='someone/other'),'INVALID_ENVELOPE'));
test('CB05 different but valid task SHA is a scope mismatch',()=>hold(run(x=>x.event.task.sha='b'.repeat(40)),'IMMUTABLE_SCOPE_MISMATCH'));
test('CB06 type confusion via array event ID is rejected',()=>hold(run(x=>x.event.eventId=['event-0001']),'INVALID_ENVELOPE'));
test('CB07 processed replay is rejected before new proposal',()=>hold(follow(claim(),'CLAIM',null,x=>{
 x.ledger.seenEvents.push('event-0002');
}),'DUPLICATE_EVENT'));
test('CB08 older unique event cannot override watermark',()=>hold(follow(claim(),'CLAIM',null,x=>{
 x.event.observedAt='2026-11-01T01:00:59Z';
}),'SUPERSEDED_EVENT'));
test('CB09 equal timestamp unique event cannot override watermark',()=>hold(follow(claim(),'CLAIM',null,x=>{
 x.event.observedAt='2026-11-01T01:01:00Z';
}),'SUPERSEDED_EVENT'));
test('CB10 stale event cannot claim',()=>hold(run(x=>{
 x.now='2026-11-01T01:12:00Z';
}),'STALE_OR_FUTURE_EVENT'));
test('CB11 future-dated event cannot claim',()=>hold(run(x=>{
 x.now='2026-11-01T01:00:59Z';
}),'STALE_OR_FUTURE_EVENT'));
test('CB12 stale source timestamp is not proof',()=>hold(run(x=>{
 x.event.proof.ciCheckedAt='2026-11-01T00:55:00Z';
}),'STALE_OR_FUTURE_PROOF'));
test('CB13 proof from future timestamp is not valid',()=>hold(run(x=>{
 x.event.proof.qaCheckedAt='2026-11-01T01:04:00Z';
}),'STALE_OR_FUTURE_PROOF'));
test('CB14 mismatched CI commit is not exact-head verification',()=>hold(run(x=>{
 x.event.proof.ciHead='f'.repeat(40);
}),'EXACT_HEAD_MISMATCH'));
test('CB15 mismatched QA commit is not exact-head verification',()=>hold(run(x=>{
 x.event.proof.qaHead='f'.repeat(40);
}),'EXACT_HEAD_MISMATCH'));
test('CB16 missing CI evidence fails closed',()=>hold(run(x=>{
 x.event.proof.ci='UNKNOWN';
}),'CI_QA_NOT_VERIFIED'));
test('CB17 QA changes requested cannot authorize claims',()=>hold(run(x=>{
 x.event.proof.qa='FAIL';
}),'CI_QA_NOT_VERIFIED'));
test('CB18 findings produce a sticky synthetic STOP',()=>{
 const r=run(x=>x.event.proof.findings=1);
 safe(r);assert.equal(r.reason,'SAFETY_GATE');
 assert.equal(r.proposed_ledger.terminalGate,'SAFETY_HOLD');
 const followup=follow({...r,proposed_ledger:r.proposed_ledger},'CLAIM',null);
 hold(followup,'STICKY_TERMINAL_GATE');
});
test('CB19 security risk produces HOLD with no real activity',()=>{
 const r=run(x=>x.event.proof.risk='SECURITY');
 safe(r);assert.equal(r.reason,'SAFETY_GATE');
 assert.equal(r.proposed_ledger.terminalGate,'SAFETY_HOLD');
});
test('CB20 changed permissions produce sticky HOLD',()=>{
 const r=run(x=>x.event.proof.permissionsChanged=true);
 safe(r);assert.equal(r.proposed_ledger.terminalGate,'SAFETY_HOLD');
});
test('CB21 claim while lease active must not double-assign',()=>hold(follow(claim(),'CLAIM',null),'ACTIVE_OR_EXPIRED_LEASE_REQUIRES_RECONCILIATION'));
test('CB22 expired lease is never silently reclaimed',()=>hold(follow(claim(),'CLAIM',null,x=>{
 x.event.observedAt='2026-11-01T01:03:10Z';
 x.now='2026-11-01T01:03:15Z';
}),'ACTIVE_OR_EXPIRED_LEASE_REQUIRES_RECONCILIATION'));
test('CB23 wrong lease token cannot settle existing claim',()=>hold(follow(claim(),'COMPLETE','PASS',x=>{
 x.event.leaseId='b'.repeat(64);
}),'LEASE_MISMATCH'));
test('CB24 late settlement cannot silently extend a lease',()=>hold(follow(claim(),'COMPLETE','PASS',x=>{
 x.event.observedAt='2026-11-01T01:03:30Z';
 x.now='2026-11-01T01:03:35Z';
}),'EXPIRED_LEASE_REQUIRES_RECONCILIATION'));
test('CB25 matching completion creates READY_FOR_OWNER not merge',()=>{
 const r=follow(claim());
 safe(r);
 assert.equal(r.gate,'READY_FOR_OWNER');
 assert.equal(r.proposed_ledger.activeLease,null);
 assert.equal(r.proposed_ledger.terminalGate,'READY_FOR_OWNER');
 hold(follow({...r,proposed_ledger:r.proposed_ledger},'CLAIM',null),'STICKY_TERMINAL_GATE');
});
test('CB26 failed synthetic completion only permits a separately proposed retry',()=>{
 const r=follow(claim(),'COMPLETE','FAIL');
 safe(r);assert.equal(r.gate,'MOCK_RETRY_ALLOWED');
 assert.equal(r.proposed_ledger.activeLease,null);
 assert.equal(r.proposed_ledger.usedClaims,1);
 const x=clone();x.ledger=structuredClone(r.proposed_ledger);x.expectedRevision=2;
 x.event.eventId='event-0003';
 x.event.observedAt='2026-11-01T01:02:45Z';
 x.event.proof.ciCheckedAt='2026-11-01T01:02:15Z';
 x.event.proof.qaCheckedAt='2026-11-01T01:02:30Z';
 x.now='2026-11-01T01:02:50Z';
 const retry=proposeClaimTransition(x);
 safe(retry);assert.equal(retry.gate,'MOCK_CLAIM_PROPOSED');
 assert.equal(retry.proposed_ledger.usedClaims,2);
 // A third attempt, even after valid settlement, is over the cap.
 const done=follow({proposed_ledger:retry.proposed_ledger},'COMPLETE','FAIL',y=>{
  y.event.eventId='event-0004';
  y.event.observedAt='2026-11-01T01:03:00Z';
  y.event.proof.ciCheckedAt='2026-11-01T01:02:55Z';
  y.event.proof.qaCheckedAt='2026-11-01T01:02:56Z';
  y.now='2026-11-01T01:03:05Z';
 });
 assert.equal(done.gate,'MOCK_RETRY_ALLOWED');
 const final=clone();final.ledger=done.proposed_ledger;final.expectedRevision=4;
 final.event.eventId='event-0005';
 final.event.observedAt='2026-11-01T01:03:25Z';
 final.event.proof.ciCheckedAt='2026-11-01T01:03:15Z';
 final.event.proof.qaCheckedAt='2026-11-01T01:03:20Z';
 final.now='2026-11-01T01:03:26Z';
 hold(proposeClaimTransition(final),'ATTEMPT_CAP_REACHED');
});
test('CB27 unknown event kind or unknown extra field invalidates envelope',()=>{
 hold(run(x=>x.event.kind='RUN_REAL_AGENT'),'INVALID_ENVELOPE');
 hold(run(x=>x.event.unexpected='DO_IT'),'INVALID_ENVELOPE');
});
test('CB28 invalid ledger lifecycle and extra keys fail closed',()=>{
 hold(run(x=>x.ledger.revision=-1),'INVALID_ENVELOPE');
 hold(run(x=>x.ledger.activeLease={fake:'lease'}),'INVALID_ENVELOPE');
 hold(run(x=>x.ledger.terminalGate='RUNNING'),'INVALID_ENVELOPE');
});
test('CB29 malformed ISO and future source values fail closed',()=>{
 hold(run(x=>x.event.observedAt='2026-11-31T01:00:00Z'),'INVALID_ENVELOPE');
 hold(run(x=>x.now=['2026-11-01T01:01:05Z']),'INVALID_ENVELOPE');
});
test('CB30 malformed proof source cannot act as authenticated approval',()=>{
 hold(run(x=>x.event.proof.source='OWNER_APPROVED'),'INVALID_ENVELOPE');
});
test('CB31 explicit HALT records sticky owner-safety decision',()=>{
 const x=run(x=>x.event.kind='HALT');
 safe(x);
 assert.equal(x.proposed_ledger.terminalGate,'SAFETY_HOLD');
 assert.equal(x.proposed_ledger.activeLease,null);
});
test('CB32 missing or overfull event history fails closed',()=>{
 hold(run(x=>x.ledger.seenEvents='not-a-list'),'INVALID_ENVELOPE');
 hold(run(x=>{
  x.ledger.seenEvents=Array.from({length:16},(_,i)=>'prior-'+String(i).padStart(4,'0'));
  x.ledger.lastObservedAt='2026-11-01T00:59:00Z';
 }),'EVENT_HISTORY_FULL');
});
test('CB33 invalid attempt caps and excessive lease TTL fail closed',()=>{
 hold(run(x=>x.ledger.maxClaims=999),'INVALID_ENVELOPE');
 hold(run(x=>x.ledger.maxLeaseSeconds=3600),'INVALID_ENVELOPE');
});
test('CB34 malformed settle tuple or lease array is rejected',()=>{
 const r=claim();
 hold(follow(r,'COMPLETE','PASS',x=>x.event.leaseId=['a'.repeat(64)]),'INVALID_ENVELOPE');
 hold(follow(r,'COMPLETE','PASS',x=>x.event.completion='AUTO_MERGE'),'INVALID_ENVELOPE');
});
