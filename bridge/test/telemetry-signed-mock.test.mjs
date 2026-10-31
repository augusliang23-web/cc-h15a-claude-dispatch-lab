import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign} from 'node:crypto';
import {OfflineSignedTelemetryStore,VERSION,REPOSITORY,mockDigest,mockSignable}
  from '../telemetry-signed-mock.mjs';
const mac=generateKeyPairSync('ed25519'),codex=generateKeyPairSync('ed25519');
const keys=()=>new Map([['mac-relay',mac.publicKey],['codex-cloud',codex.publicKey]]);
const makeStore=()=>new OfflineSignedTelemetryStore({
  publicKeys:keys(),task_id:'ZC04B_TASK_01',attempt_id:'ATTEMPT_01',
});
const at=n=>new Date(Date.UTC(2026,9,31,10,0,n)).toISOString();
const event=(seq,producer,type,previous=null)=>{
  const a={version:VERSION,repository:REPOSITORY,task_id:'ZC04B_TASK_01',
    attempt_id:'ATTEMPT_01',producer,session_id:producer==='mac-relay'?'MAC_S1':'CODEX_S1',
    sequence:seq,observed_at:at(seq),type,evidence_ref:
      type==='QA_PASSED'?'review:sha123:22':type==='HEARTBEAT'?'process:mock':'proof:fixture',
    prev_digest:previous};
  a.digest=mockDigest(a);
  a.signature=sign(null,Buffer.from(mockSignable(a)),producer==='mac-relay'?mac.privateKey:codex.privateKey).toString('base64');
  return a;
};
const reseal=(a,key)=>{a.digest=mockDigest(a);
  a.signature=sign(null,Buffer.from(mockSignable(a)),key).toString('base64');return a;};
const first=()=>event(1,'mac-relay','CLAIMED');
const accepted=r=>assert.equal(r.status,'MOCK_ACCEPTED');
const held=r=>{assert.equal(r.status,'HOLD');assert.equal(r.accepted,false);assert.equal(r.simulated,true);};

test('B01 signed Mac -> Codex chain is accepted in mock-only store',()=>{
 const s=makeStore();const a=first();accepted(s.accept(a,{asOf:at(10)}));
 const b=event(2,'mac-relay','RUNNING',a.digest);accepted(s.accept(b,{asOf:at(10)}));
 const c=event(3,'codex-cloud','REVIEWING',b.digest);accepted(s.accept(c,{asOf:at(10)}));
 assert.deepEqual({count:s.snapshot().accepted_count,last:s.snapshot().last_sequence},
   {count:3,last:3});assert.equal(s.snapshot().real_github_writes,false);
});

test('B02 duplicate/replay cannot claim another successful receipt',()=>{
 const s=makeStore(),a=first();accepted(s.accept(a,{asOf:at(10)}));
 held(s.accept(a,{asOf:at(10)}));assert.equal(s.snapshot().accepted_count,1);
});

test('B03 sequence gaps and wrong previous digest fail closed',()=>{
 const s=makeStore(),a=first();accepted(s.accept(a,{asOf:at(10)}));
 held(s.accept(event(3,'mac-relay','HEARTBEAT',a.digest),{asOf:at(10)}));
 held(s.accept(event(2,'mac-relay','RUNNING','0'.repeat(64)),{asOf:at(10)}));
 assert.equal(s.snapshot().last_sequence,1);
});

test('B04 payload tampering and wrong signing key fail closed',()=>{
 const s=makeStore(),a=first();a.evidence_ref='proof:tampered';
 held(s.accept(a,{asOf:at(10)}));
 const b=first();reseal(b,codex.privateKey);
 held(s.accept(b,{asOf:at(10)}));assert.equal(s.snapshot().accepted_count,0);
});

test('B05 unknown producer, wrong task, attempt and repository reject',()=>{
 for(const patch of [{producer:'evil'},{task_id:'OTHER_TASK'},{attempt_id:'OTHER_ATTEMPT'},
 {repository:'other/repo'}]){
   const s=makeStore(),a=first();Object.assign(a,patch);reseal(a,mac.privateKey);
   held(s.accept(a,{asOf:at(10)}));
 }
});

test('B06 producer/session switches are denied despite valid signature',()=>{
 const s=makeStore(),a=first();accepted(s.accept(a,{asOf:at(10)}));
 const b=event(2,'mac-relay','RUNNING',a.digest);
 b.session_id='MAC_S2';reseal(b,mac.privateKey);
 held(s.accept(b,{asOf:at(10)}));
});

test('B07 producer cannot claim disallowed event type',()=>{
 const s=makeStore(),a=event(1,'mac-relay','QA_PASSED');
 held(s.accept(a,{asOf:at(10)}));
});

test('B08 future/stale event ordering and malformed time fail closed',()=>{
 const s=makeStore();
 held(s.accept(first(),{asOf:at(0)}));
 held(s.accept(first(),{asOf:'invalid'}));
 const a=first();a.observed_at='not UTC';reseal(a,mac.privateKey);
 held(s.accept(a,{asOf:at(10)}));
 accepted(s.accept(first(),{asOf:at(10)}));
 const b=event(2,'mac-relay','RUNNING',a.digest);
 b.observed_at=at(0);reseal(b,mac.privateKey);
 held(s.accept(b,{asOf:at(10)}));
});

test('B09 no secret/freeform fields or oversized event accepted',()=>{
 const s=makeStore(),a=first();
 a.token='SECRET';held(s.accept(a,{asOf:at(10)}));
 const b=first();b.evidence_ref='a'.repeat(2000);reseal(b,mac.privateKey);
 held(s.accept(b,{asOf:at(10)}));
 assert.equal(s.snapshot().accepted_count,0);
});

test('B10 event digest cannot silently be changed or reused',()=>{
 const s=makeStore(),a=first();a.digest='0'.repeat(64);
 held(s.accept(a,{asOf:at(10)}));
 const b=first();accepted(s.accept(b,{asOf:at(10)}));
 const c=event(2,'mac-relay','HEARTBEAT',b.digest);
 c.digest=b.digest;reseal(c,mac.privateKey); // reseal recomputes digest on new data
 accepted(s.accept(c,{asOf:at(10)}));
 assert.notEqual(s.snapshot().last_digest,b.digest);
});
