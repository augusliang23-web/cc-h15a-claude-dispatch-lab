import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { manifestFixture,authorityFixture } from './readiness-support.mjs';
import { SimulatedReservationAuthority,OfflineReservationClient } from '../reservation-simulator.mjs';
import { digest } from '../security.mjs';

test('S01 create conflict/duplicate owner and retained receipt survive simulator restart',async()=>{
 const m=manifestFixture(),authority=new SimulatedReservationAuthority(authorityFixture(m));
 const a=new OfflineReservationClient(),b=new OfflineReservationClient();
 assert.equal((await a.attempt(authority,m)).status,'SIMULATED_RESERVED');
 assert.equal((await b.attempt(authority,m)).reason,'CREATE_CONFLICT');
 const restored=new SimulatedReservationAuthority(authority.snapshot());
 assert.equal((await new OfflineReservationClient().attempt(restored,m)).reason,'CREATE_CONFLICT');
 assert.equal(restored.observe(m.payload.ref).manifest.payload.owner_id,'mac-A');
});
for(const fault of ['failed-write','5xx','partial-write','timeout-after-success','5xx-after-success','network-before'])test(`S02 ${fault} HOLD and client never automatically retries`,async()=>{
 const m=manifestFixture(),authority=new SimulatedReservationAuthority(authorityFixture(m)),client=new OfflineReservationClient();
 const r=await client.attempt(authority,m,{fault});assert.equal(r.status,'HOLD');assert.equal(r.execution_allowed,false);
 const calls=authority.callCount;assert.equal((await client.attempt(authority,m)).reason,'ATTEMPT_ALREADY_USED');assert.equal(authority.callCount,calls);
 if(fault.includes('after-success'))assert.equal(authority.observe(m.payload.ref).kind,'RESERVED');
 if(fault==='network-before')assert.equal(calls,0);
});
for(const mutation of ['overwrite','delete'])test(`S03 ${mutation} cannot erase consumption or permit recreation`,async()=>{
 const m=manifestFixture(),authority=new SimulatedReservationAuthority(authorityFixture(m));
 await new OfflineReservationClient().attempt(authority,m);
 authority.tamperForSimulation(m.payload.ref,mutation);
 assert.equal(authority.observe(m.payload.ref).kind,'INCONSISTENT');
 const restored=new SimulatedReservationAuthority(authority.snapshot());
 assert.equal((await new OfflineReservationClient().attempt(restored,manifestFixture('another','new-attempt'))).reason,'CREATE_CONFLICT');
});
test('S04 replayed approval cannot reserve another task and malformed snapshots fail closed',async()=>{
 const m=manifestFixture(),authority=new SimulatedReservationAuthority(authorityFixture(m));await new OfflineReservationClient().attempt(authority,m);
 const other=manifestFixture('other','attempt-other');other.payload.approval.binding.task_id='another-task';
 const {claimKey}=await import('../claims.mjs');other.payload.ref=claimKey(other.payload.approval.binding);other.payload.task_key=other.payload.ref.split('/').at(-1);other.immutable_evidence_digest=digest(other.payload);
 assert.equal((await new OfflineReservationClient().attempt(authority,other)).reason,'APPROVAL_REPLAYED');
 const snapshot=authority.snapshot();assert.throws(()=>new SimulatedReservationAuthority({...snapshot,receipts:[...snapshot.receipts,...snapshot.receipts]}));
});
for(const race of ['revoke-before','edit-before','revoke-after-success','edit-after-success'])test(`S05 ${race} never yields clean simulation readiness`,async()=>{
 const m=manifestFixture(),authority=new SimulatedReservationAuthority(authorityFixture(m));
 if(race==='revoke-before')authority.approvalForSimulation(m.payload.approval.approval_id,'REVOKED');
 if(race==='edit-before')authority.revisionForSimulation(m.payload.ref,'0'.repeat(64));
 const r=await new OfflineReservationClient().attempt(authority,m,{fault:race.includes('after')?race:'none'});
 assert.equal(r.status,'HOLD');assert.equal(r.execution_allowed,false);
});
test('S06 missing/inaccessible observations never count as proven empty ownership',()=>{
 const m=manifestFixture(),authority=new SimulatedReservationAuthority(authorityFixture(m));
 assert.equal(authority.observe(m.payload.ref).kind,'MISSING_OR_INACCESSIBLE');
});
test('S07 two independent client processes race through one simulated authority, exactly one winner', {timeout:10000},async()=>{
 const m=manifestFixture(),authority=new SimulatedReservationAuthority(authorityFixture(m));
 const children=[0,1].map(()=>fork(new URL('./reservation-race-client.mjs',import.meta.url),[],{stdio:['ignore','ignore','pipe','ipc']}));
 const reads=[];const results=[];
 try {
  await Promise.all(children.map((child,index)=>new Promise((resolve,reject)=>{
   let finished=false;
   child.on('error',reject);child.on('exit',code=>{if(!finished)reject(Error(`client exit ${code}`));});
   child.on('message',message=>{
    if(message.type==='observe') {
     reads.push(child);
     if(reads.length===2)for(const c of reads)c.send({type:'observed',observation:authority.observe(m.payload.ref)});
    } else if(message.type==='create') {
     child.send({type:'created',result:authority.create(message.manifest)});
    } else if(message.type==='result') {finished=true;results[index]=message.result;resolve();}
   });
   child.send({type:'start',manifest:manifestFixture(`mac-${index}`,`attempt-${index}`)});
  })));
  assert.equal(reads.length,2);assert.equal(results.filter(r=>r.status==='SIMULATED_RESERVED').length,1);
  assert.equal(results.filter(r=>r.reason==='CREATE_CONFLICT').length,1);assert.equal(authority.callCount,2);
 } finally {for(const child of children)child.kill();}
});
