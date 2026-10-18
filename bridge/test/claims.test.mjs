import test from 'node:test';
import assert from 'node:assert/strict';
import { setup,issue,NOW } from './support.mjs';
import { claimRequest, MockGitHub, validateClaim, claimLive } from '../claims.mjs';

test('B concurrent claimants produce one winner and preserve exact immutable evidence',async()=>{
 const f=setup();const approval=await f.verifier.verify(issue(),f.attest(),NOW);const remote=new MockGitHub();
 const requests=Array.from({length:20},(_,i)=>claimRequest(approval,`mac-${i}`,`attempt-${i}`));
 const results=await Promise.all(requests.map(r=>remote.attemptClaim(r)));
 assert.equal(results.filter(x=>x.status==='CLAIMED').length,1);
 assert.equal(results.filter(x=>x.status==='CONFLICT').length,19);
 const stored=await remote.readClaim(requests[0].claim_id);assert.deepEqual(stored,requests[0]);
 stored.owner='tamper';assert.equal((await remote.readClaim(requests[0].claim_id)).owner,'mac-0');
 const restored=new MockGitHub(remote.snapshot());
 assert.equal((await restored.attemptClaim(requests[0])).status,'CONFLICT');
 assert.equal(await restored.isConsumed('approval-1'),true);
});
test('B revision/Issue changes cannot obtain a new reservation key or reuse approval',async()=>{
 const f=setup(),r=claimRequest(f.payload,'mac','attempt-1'),remote=new MockGitHub();await remote.attemptClaim(r);
 const changed=claimRequest({...f.payload,approval_id:'approval-2',binding:{...f.payload.binding,task_digest:'1'.repeat(64),issue_id:'I_other'}},'mac','attempt-2');
 assert.equal(changed.claim_id,r.claim_id);assert.equal((await remote.attemptClaim(changed)).status,'CONFLICT');
 const replay=claimRequest({...f.payload,binding:{...f.payload.binding,task_id:'new-task'}},'mac','attempt-3');
 assert.equal((await remote.attemptClaim(replay)).status,'REPLAY');
});
test('B malformed claims/snapshots rejected and live claim unconditionally disabled',()=>{
 const f=setup();const r=claimRequest(f.payload,'mac','attempt');
 for(const bad of [{...r,claim_id:'x'},{...r,owner:''},{...r,extra:'secret'}])assert.throws(()=>validateClaim(bad));
 assert.throws(()=>new MockGitHub({claims:[r,r]}));
 assert.throws(()=>claimLive(r),/LIVE_CLAIMING_DISABLED/);
});
