import test from 'node:test';
import assert from 'node:assert/strict';
import * as s from '../security.mjs';
import { task, issue, setup, NOW } from './support.mjs';
test('A01 signed exact binding accepted, canonical ordering stable',async()=>{
 const f=setup();const p=await f.verifier.verify(issue(),f.attest(),NOW);
 assert.equal(p.approval_id,'approval-1');assert.equal(p.binding.issue_id,'I_test_101');
 assert.equal(s.canonical({b:2,a:1}),'{'+'"a":1,"b":2}');
 assert.equal(s.digest({b:2,a:1}),s.digest({a:1,b:2}));
 const reordered=task(); const reversed=Object.fromEntries(Object.entries(reordered).reverse());
 assert.equal(s.bindIssue(issue({body:JSON.stringify(reversed)})).task_digest,p.binding.task_digest);
 assert.notEqual(s.bindIssue(issue({body:JSON.stringify(reversed)})).issue_content_digest,p.binding.issue_content_digest);
});
for(const [name,alter] of [
 ['missing',()=>null],['forged',f=>({...f.attest(),signature:Buffer.alloc(64).toString('base64')})],
 ['expired',f=>f.attest({expires_at:'2026-10-19T00:30:00.000Z'})],
 ['future',f=>f.attest({not_before:'2026-10-19T01:30:00.000Z'})],
 ['unknown authority',f=>f.attest({authority:'unknown'})],
 ['wrong repository',f=>f.attest({binding:{...f.payload.binding,repository:'other/repo'}})],
 ['wrong task',f=>f.attest({binding:{...f.payload.binding,task_id:'other'}})],
 ['wrong issue identity',f=>f.attest({binding:{...f.payload.binding,issue_id:'I_other'}})],
 ['wrong digest',f=>f.attest({binding:{...f.payload.binding,task_digest:'0'.repeat(64)}})],
 ['unknown field',f=>f.attest({command:'never'})],
])test(`A rejection: ${name}`,async()=>{const f=setup();await assert.rejects(f.verifier.verify(issue(),alter(f),NOW));});
test('A replay and revoked approval rejected',async()=>{
 const f=setup();f.consumed.add('approval-1');await assert.rejects(f.verifier.verify(issue(),f.attest(),NOW),/APPROVAL_REPLAYED/);
 f.consumed.clear();f.revoked.add('approval-1');await assert.rejects(f.verifier.verify(issue(),f.attest(),NOW),/APPROVAL_REVOKED/);
});
test('A any Issue title/body mutation invalidates approval; self-declaration insufficient',async()=>{
 const f=setup();for(const changed of [issue({title:'Changed'}),issue({body:issue().body+' '}),issue({body:JSON.stringify(task({task_id:'changed'}))})])await assert.rejects(f.verifier.verify(changed,f.attest(),NOW));
 assert.throws(()=>s.admitLive(issue(),f.attest()),/LIVE_ADMISSION_DISABLED/);
 await assert.rejects(f.verifier.verify(issue(),null,NOW));
});
test('A canonical input and Issue metadata reject unsupported/malformed data',()=>{
 for(const x of [NaN,undefined,{x:undefined},new Date(),{x:Infinity}])assert.throws(()=>s.canonical(x));
 for(const i of [issue({repository:'other/repo'}),issue({state:'closed'}),issue({issue_number:102}),issue({body:'not JSON'}),issue({issue_id:''}),issue({body:'null'}),issue({body:JSON.stringify(task({command:'bad'}))})])assert.throws(()=>s.bindIssue(i));
});
test('A expanded-year timestamps cannot bypass chronological validity checks',async()=>{
 const f=setup();
 for(const changes of [
  {not_before:'+010000-01-01T00:00:00.000Z',expires_at:'2027-01-01T00:00:00.000Z'},
  {not_before:'+010000-01-01T00:00:00.000Z',expires_at:'+010001-01-01T00:00:00.000Z'},
 ])await assert.rejects(f.verifier.verify(issue(),f.attest(changes),NOW));
});
