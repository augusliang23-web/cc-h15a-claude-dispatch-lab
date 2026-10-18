import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { setup,issue,NOW,sandbox } from './support.mjs';
import { claimRequest,MockGitHub } from '../claims.mjs';
import { Journal } from '../journal.mjs';
import { simulateClaim,recover } from '../admission.mjs';
const prepare=async(dir,f=setup())=>{const remote=new MockGitHub({claims:[]},{task:issue(),attestation:f.attest()});const j=new Journal(dir);await j.initialize(claimRequest(f.payload,'mac','attempt-1'),NOW);return {journal:j,remote,verifier:f.verifier,now:NOW};};

test('D mock admission verifies independently then claims once and persists binding',()=>sandbox(async dir=>{
 const args=await prepare(dir);const r=await simulateClaim(args);
 assert.equal(r.status,'MOCK_CLAIMED');assert.equal(r.execution_allowed,false);
 assert.equal((await args.journal.load()).state,'CLAIMED');
 const again=await simulateClaim(args);assert.equal(again.status,'HOLD');
 assert.equal(args.remote.snapshot().claims.length,1);
}));
test('R01 offline before claim leaves queued without contacting remote',()=>sandbox(async dir=>{
 const args=await prepare(dir);args.remote.readTask=async()=>{throw Error('must not read');};
 const r=await simulateClaim({...args,availability:'offline'});
 assert.equal(r.reason,'UNAVAILABLE');assert.equal((await args.journal.load()).state,'QUEUED');
 assert.equal(args.remote.snapshot().claims.length,0);
 assert.equal((await recover({...args,availability:'offline'})).status,'HOLD');
}));
for(const availability of ['network-unavailable','cli-unavailable','authentication-expired','asleep','restarted','unexpected'])test(`D availability ${availability} HOLD`,()=>sandbox(async dir=>{
 const args=await prepare(dir);assert.equal((await simulateClaim({...args,availability})).status,'HOLD');assert.equal(args.remote.snapshot().claims.length,0);
}));
test('R02 crash after remote claim before local recording reconciles ownership, never autoexecutes',()=>sandbox(async dir=>{
 const args=await prepare(dir);const initial=await args.journal.load();
 await args.journal.update(0,{recovery_status:'CLAIM_PENDING'},NOW);await args.remote.attemptClaim(initial.claim);
 const r=await recover(args);assert.equal(r.status,'HOLD');assert.equal(r.reason,'CLAIMED_REQUIRES_AUTHORIZATION');
 assert.equal((await args.journal.load()).state,'CLAIMED');assert.equal(args.remote.snapshot().claims.length,1);
}));
for(const name of ['R03 shutdown during execution','R04 process terminated','D uncertain execution outcome'])test(name,()=>sandbox(async dir=>{
 const args=await prepare(dir);await simulateClaim(args);
 const claimed=await args.journal.load();await args.journal.update(claimed.sequence,{state:'RUNNING',recovery_status:'EXECUTING'},NOW);
 const r=await recover(args);assert.equal(r.status,'HOLD');assert.equal(r.reason,'EXECUTION_UNCERTAIN');
 const final=await args.journal.load();assert.equal(final.state,'BLOCKED');
 assert.deepEqual(final.history.map(e=>e.state),['QUEUED','CLAIMED','RUNNING','INTERRUPTED','BLOCKED']);
 assert.equal((await simulateClaim(args)).status,'HOLD');
}));
for(const ambiguous of [false,true])test(`R05/R06 API failure ambiguous=${ambiguous} HOLD and no automatic retry`,()=>sandbox(async dir=>{
 const args=await prepare(dir);const original=args.remote.attemptClaim.bind(args.remote);let calls=0;
 args.remote.attemptClaim=async request=>{calls++;if(ambiguous)await original(request);throw Error('SECRET token');};
 const r=await simulateClaim(args);assert.equal(r.status,'HOLD');assert.equal(r.reason,'CLAIM_OUTCOME_UNCERTAIN');
 assert.ok(!JSON.stringify(r).includes('SECRET'));
 assert.equal((await args.journal.load()).recovery_status,'RECONCILE_REQUIRED');
 await simulateClaim(args);assert.equal(calls,1);
 const reconciled=await recover(args);assert.equal(reconciled.status,'HOLD');assert.equal(calls,1);
}));
test('R07/R08 missing/corrupt journal stops, no reset or remote mutation',()=>sandbox(async dir=>{
 const f=setup();const args={journal:new Journal(dir),remote:new MockGitHub(),verifier:f.verifier,now:NOW};
 assert.equal((await simulateClaim(args)).reason,'JOURNAL_UNTRUSTED');assert.equal((await recover(args)).reason,'JOURNAL_UNTRUSTED');
 await args.journal.initialize(claimRequest(f.payload,'mac','attempt'),NOW);
 await fs.writeFile(join(dir,'attempt.json'),'broken');
 assert.equal((await recover(args)).reason,'JOURNAL_UNTRUSTED');assert.equal(args.remote.snapshot().claims.length,0);
}));
test('R09 completed local history never reruns even if remote unavailable',()=>sandbox(async dir=>{
 const args=await prepare(dir);await simulateClaim(args);
 let r=await args.journal.load();r=await args.journal.update(r.sequence,{state:'RUNNING',recovery_status:'EXECUTING'},NOW);
 await args.journal.update(r.sequence,{state:'COMPLETED',recovery_status:'COMPLETED'},NOW);
 args.remote.readClaim=async()=>{throw Error('offline');};
 assert.equal((await recover(args)).reason,'ALREADY_COMPLETED');assert.equal((await simulateClaim(args)).status,'HOLD');
}));
test('R10 another owner or mismatched claim HOLD without overwrite',()=>sandbox(async dir=>{
 const args=await prepare(dir);const c=(await args.journal.load()).claim;
 await args.remote.attemptClaim({...c,owner:'another',attempt_id:'another-attempt'});
 assert.equal((await simulateClaim(args)).reason,'EXISTING_CLAIM');
 assert.equal((await recover(args)).reason,'CLAIM_MISMATCH');
 assert.equal(args.remote.snapshot().claims[0].owner,'another');
}));
test('R11 queued approval expired; R12 changed Issue; no claim',()=>sandbox(async dir=>{
 const args=await prepare(dir);assert.equal((await simulateClaim({...args,now:'2026-10-19T03:00:00.000Z'})).status,'HOLD');
 args.remote.readTask=async()=>issue({title:'new revision'});
 assert.equal((await simulateClaim(args)).status,'HOLD');assert.equal(args.remote.snapshot().claims.length,0);
}));
test('D authoritative read failure/ambiguous evidence cause sanitized HOLD',()=>sandbox(async dir=>{
 const args=await prepare(dir);args.remote.readClaim=async()=>{throw Error('SECRET');};
 const r=await simulateClaim(args);assert.equal(r.status,'HOLD');assert.ok(!JSON.stringify(r).includes('SECRET'));
 assert.equal(args.remote.snapshot().claims.length,0);
}));
test('D no automatic admission after intent exists even with no remote claim',()=>sandbox(async dir=>{
 const args=await prepare(dir);await args.journal.update(0,{recovery_status:'CLAIM_PENDING'},NOW);
 assert.equal((await simulateClaim(args)).status,'HOLD');assert.equal((await recover(args)).reason,'CLAIM_UNCERTAIN');
 assert.equal(args.remote.snapshot().claims.length,0);
}));
test('D real provider substitution rejected before any write',()=>sandbox(async dir=>{
 const args=await prepare(dir);let writes=0;
 const remote={readClaim:async()=>null,attemptClaim:async()=>{writes++;}};
 assert.equal((await simulateClaim({...args,remote})).reason,'MOCK_PROVIDER_REQUIRED');assert.equal(writes,0);
}));
test('D task edited or approval revoked during reservation yields HOLD',async()=>{
 for(const mutation of ['edit','revoke'])await sandbox(async dir=>{
  const f=setup(),args=await prepare(dir,f);const original=args.remote.attemptClaim.bind(args.remote);
  args.remote.attemptClaim=async request=>{const result=await original(request);if(mutation==='edit')args.remote.readTask=async()=>issue({title:'edited during claim'});else f.revoked.add('approval-1');return result;};
  assert.equal((await simulateClaim(args)).reason,'CLAIM_OUTCOME_UNCERTAIN');
  assert.equal((await args.journal.load()).recovery_status,'RECONCILE_REQUIRED');assert.equal(args.remote.snapshot().claims.length,1);
 });
});
test('D remote evidence cannot silently mark a task completed or restart it',()=>sandbox(async dir=>{
 const args=await prepare(dir);await simulateClaim(args);
 args.remote.readEvidence=async()=>({status:'COMPLETED'});
 assert.equal((await recover(args)).reason,'REMOTE_EXECUTION_EVIDENCE_REQUIRES_REVIEW');
 assert.equal((await args.journal.load()).state,'CLAIMED');
}));
test('D a clean preclaim restart only observes QUEUED and never creates a claim',()=>sandbox(async dir=>{
 const args=await prepare(dir);const r=await recover(args);
 assert.equal(r.status,'QUEUED');assert.equal(r.execution_allowed,false);assert.equal(args.remote.snapshot().claims.length,0);
}));
test('D prior execution evidence forbids fresh reservation and remains blocked if evidence disappears',()=>sandbox(async dir=>{
 const args=await prepare(dir);args.remote.readEvidence=async()=>({status:'UNKNOWN',attempt_id:'old'});
 assert.equal((await simulateClaim(args)).status,'HOLD');assert.equal(args.remote.snapshot().claims.length,0);
 assert.equal((await args.journal.load()).recovery_status,'RECONCILE_REQUIRED');
 args.remote.readEvidence=async()=>null;
 assert.equal((await simulateClaim(args)).status,'HOLD');assert.equal(args.remote.snapshot().claims.length,0);
}));
test('D inconsistent evidence seen by recovery is sticky and cannot later be re-admitted',()=>sandbox(async dir=>{
 const args=await prepare(dir);args.remote.readEvidence=async()=>({status:'COMPLETED'});
 assert.equal((await recover(args)).reason,'INCONSISTENT_REMOTE_EVIDENCE');
 args.remote.readEvidence=async()=>null;
 assert.equal((await simulateClaim(args)).status,'HOLD');assert.equal(args.remote.snapshot().claims.length,0);
}));
