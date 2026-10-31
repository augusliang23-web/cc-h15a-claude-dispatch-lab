import test from 'node:test';
import assert from 'node:assert/strict';
import {VERSION, REPOSITORY, projectTelemetry} from '../telemetry-mock.mjs';
const sha = 'a'.repeat(40);
const task = 'ZC-04-TELEMETRY-MOCK-01';
const time = n => new Date(Date.UTC(2026, 9, 31, 7, 0, n)).toISOString();
function e(type, seq, actor, source, kind, ref, second=seq) {
  return {version:VERSION,repository:REPOSITORY,task_id:task,sequence:seq,
    at:time(second),actor,source,type,proof:{kind,ref}};
}
const queued = () => e('QUEUED',1,'control-plane','github','ISSUE','issue:25');
const claimed = () => e('CLAIMED',2,'antigravity','mac-relay','LOCAL_CLAIM','claim:mock');
const running = () => e('RUNNING',3,'antigravity','mac-relay','PROCESS','process:mock');
const heartbeat = (seq=4,second=seq) => e('HEARTBEAT',seq,'antigravity','mac-relay','PROCESS','process:mock',second);
const artifact = (seq=4,second=seq) => e('ARTIFACT_READY',seq,'antigravity','github','COMMIT','sha:'+sha,second);
const reviewing = (seq=5,second=seq) => e('REVIEWING',seq,'codex','codex-cloud','REVIEW_RUNNING','review:'+sha+':22',second);
const passing = (seq=6,second=seq) => e('QA_PASSED',seq,'codex','codex-cloud','REVIEW_PASS','review:'+sha+':22',second);
const completed = (seq=7,second=seq) => e('COMPLETED',seq,'control-plane','github','RESULT_VERIFIED','result:'+sha+':22',second);
const asOf = n => time(n);
const result = (events, timeArg=12, opts={}) => projectTelemetry(events,{asOf:asOf(timeArg),...opts});
const invalid = x => {const o=result(x);assert.equal(o.status,'HOLD');assert.equal(o.stage,'UNVERIFIED');assert.equal(o.simulated,true);};

test('T01 full synthetic flow completes only with matching artifact plus Codex review',()=>{
 const x=result([queued(),claimed(),running(),artifact(),reviewing(),passing(),completed()]);
 assert.equal(x.stage,'COMPLETED');
 assert.equal(x.health,'COMPLETED_VERIFIED_IN_FIXTURE');
 assert.equal(x.simulated,true);
 assert.equal(x.milestone_proof_count,7);
 assert.equal(x.agents.codex,'REVIEW_PASSED');
});

test('T02 queue-only means both agents WAITING, never RUNNING',()=>{
 const x=result([queued()]);assert.equal(x.stage,'QUEUED');
 assert.deepEqual(x.agents,{antigravity:'WAITING',codex:'WAITING'});
 assert.equal(x.health,'OBSERVED_ONLY');
});

test('T03 heartbeat does not advance stage or milestone proof count',()=>{
 const x=result([queued(),claimed(),running(),heartbeat()]);
 assert.equal(x.stage,'RUNNING');
 assert.equal(x.heartbeat_count,1);
 assert.equal(x.milestone_proof_count,3);
});

test('T04 stale running heartbeat yields STALLED, not fake healthy',()=>{
 const x=result([queued(),claimed(),running(),heartbeat()],12,{staleAfterMs:1000,noProgressAfterMs:2000});
 assert.equal(x.health,'STALLED');
});

test('T05 fresh heartbeat with old milestone yields ALIVE_NO_PROGRESS',()=>{
 const x=result([queued(),claimed(),running(),heartbeat(4,9)],10,{staleAfterMs:1500,noProgressAfterMs:10000});
 // Last progress at 07:00:03 and last heartbeat at :09.
 assert.equal(x.health,'ACTIVE');
 const y=projectTelemetry([queued(),claimed(),running(),heartbeat(4,9)],{
   asOf:asOf(10),staleAfterMs:1500,noProgressAfterMs:2000});
 assert.equal(y.health,'ALIVE_NO_PROGRESS');
});

test('T06 no heartbeat and old CLAIMED state is STALLED',()=>{
 const x=result([queued(),claimed()],8,{staleAfterMs:1000,noProgressAfterMs:2000});
 assert.equal(x.health,'STALLED');
});

test('T07 mismatched task, duplicated sequence and wrong order fail closed',()=>{
 const other=running();other.task_id='ANOTHER_TASK';
 invalid([queued(),claimed(),other]);
 const dupe=running();dupe.sequence=2;invalid([queued(),claimed(),dupe]);
 invalid([queued(),running()]);
});

test('T08 future timestamps, malformed envelopes and extra keys fail closed',()=>{
 assert.equal(result([queued()],0).status,'HOLD');
 const unknown=queued();unknown.secret='NEVER';invalid([unknown]);
 const bad=queued();bad.at='2026-10-31T07:00:01Z';invalid([bad]);
 const badTime=queued();badTime.at='garbage';invalid([badTime]);
});

test('T09 forged source, proof kind, author and review mismatch fail closed',()=>{
 const forged=claimed();forged.source='github';invalid([queued(),forged]);
 const untrusted=running();untrusted.proof.kind='COMMIT';invalid([queued(),claimed(),untrusted]);
 const wrong=reviewing();wrong.proof.ref='review:'+('b'.repeat(40))+':22';
 invalid([queued(),claimed(),running(),artifact(),wrong]);
});

test('T10 queue/comment/commit alone cannot claim QA complete',()=>{
 invalid([queued(),claimed(),running(),artifact(),completed(5,5)]);
 invalid([queued(),claimed(),running(),artifact(),reviewing(),completed(6,6)]);
 const bad=passing();bad.proof.ref='review:'+sha+':23';
 invalid([queued(),claimed(),running(),artifact(),reviewing(),bad]);
});

test('T11 HOLD/FAILED are terminal, no retries or subsequent heartbeat',()=>{
 const hold=e('HOLD',4,'antigravity','mac-relay','ERROR','error:TIMEOUT');
 const failed=e('FAILED',4,'antigravity','mac-relay','ERROR','error:MODEL_FAILED');
 assert.equal(result([queued(),claimed(),running(),hold]).health,'NEEDS_ATTENTION');
 assert.equal(result([queued(),claimed(),running(),failed]).stage,'FAILED');
 invalid([queued(),claimed(),running(),hold,e('RUNNING',5,'antigravity','mac-relay','PROCESS','process:mock')]);
 invalid([queued(),claimed(),running(),failed,heartbeat(5)]);
});

test('T12 review stage needs explicit reviewer source, not a GitHub comment',()=>{
 const bogus=reviewing();bogus.source='github';invalid([queued(),claimed(),running(),artifact(),bogus]);
 const fakePass=passing();fakePass.proof.kind='REVIEW_RUNNING';
 invalid([queued(),claimed(),running(),artifact(),reviewing(),fakePass]);
});

test('T13 non-monotone, too many events, or unknown event type => HOLD',()=>{
 const old=claimed();old.at=time(0);
 invalid([queued(),old]);
 invalid(Array(101).fill(queued()));
 const x=claimed();x.type='CODE_EXEC';invalid([queued(),x]);
});

test('T14 empty or unsafe inputs never report active/complete',()=>{
 invalid([]);
 invalid(null);
 const x=projectTelemetry([queued()],{asOf:'bad'});
 assert.equal(x.status,'HOLD');
});


test('T15 mismatched process heartbeat never refreshes another process',()=>{
 const unrelated = heartbeat(4,58);
 unrelated.proof.ref = 'process:unrelated';
 const res=projectTelemetry([queued(),claimed(),running(),unrelated],{
   asOf:time(59),staleAfterMs:10000,noProgressAfterMs:20000,
 });
 assert.equal(res.status,'HOLD');
 assert.equal(res.stage,'UNVERIFIED');
 const original=projectTelemetry([queued(),claimed(),running()],{
   asOf:time(59),staleAfterMs:10000,noProgressAfterMs:20000,
 });
 assert.equal(original.health,'STALLED');
});
