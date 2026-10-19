import test from 'node:test';
import assert from 'node:assert/strict';
import { manifestFixture,intentFixture } from './readiness-support.mjs';
import { validateManifest,validateWriteIntent,assessRecovery,firstWriteGate } from '../reservation-readiness.mjs';
import { canonical,digest } from '../security.mjs';
import { generateKeyPairSync,sign,verify } from 'node:crypto';
import { claimRequest } from '../claims.mjs';
import { Journal } from '../journal.mjs';
import { sandbox,NOW } from './support.mjs';

test('M01 exact manifest content address and one-write intent validate without authorizing anything',()=>{
 const m=manifestFixture(),intent=intentFixture(m);
 assert.deepEqual(validateManifest(m),m);assert.deepEqual(validateWriteIntent(intent,m,NOW),intent);
 assert.equal(firstWriteGate({manifest:m,intent,approval_verified:true,protected:true}).status,'HOLD');
 assert.equal(firstWriteGate().execution_allowed,false);
});
for(const [name,alter] of [
 ['wrong evidence digest',m=>({...m,immutable_evidence_digest:'0'.repeat(64)})],
 ['wrong repository',m=>({...m,payload:{...m.payload,repository:'other/repo'}})],
 ['wrong deterministic ref',m=>({...m,payload:{...m.payload,ref:'refs/heads/other'}})],
 ['forbidden circular signed evidence address',m=>({...m,payload:{...m.payload,approval_evidence_digest:null}})],
 ['extra executable field',m=>({...m,payload:{...m.payload,command:'touch NEVER'}})],
 ['outside approval time',m=>({...m,payload:{...m.payload,created_at:'2026-10-20T00:00:00.000Z'}})],
])test(`M02 reject manifest ${name} even after recomputing digest`,()=>{
 const bad=alter(manifestFixture());assert.throws(()=>validateManifest(bad));
 if(name!=='wrong evidence digest')assert.throws(()=>validateManifest({...bad,immutable_evidence_digest:digest(bad.payload)}));
});
for(const [name,patch] of [
 ['retry',{automatic_retry:true}],['two writes',{max_writes:2}],['delete',{operation:'DELETE_REF'}],
 ['scope expansion',{principal:{kind:'GitHubAppInstallation',app_id:101,installation_id:202,permissions:{metadata:'read',issues:'read',contents:'write',workflows:'write'}}}],
 ['wrong attempt',{attempt_id:'another'}],['wrong target',{ref:'refs/heads/main'}],
 ['wrong manifest',{manifest_digest:'0'.repeat(64)}],['expired',{expires_at:'2026-10-19T00:30:00.000Z'}],
 ['cleanup bypass',{cleanup:'DELETE_ON_FAILURE'}],['missing principal',{principal:null}],
])test(`M03 invalid one-write intent ${name} rejected`,()=>{const m=manifestFixture();assert.throws(()=>validateWriteIntent({...intentFixture(m),...patch},m,NOW));});

test('R01 availability/credential/journal/missing evidence never grants execution',()=>sandbox(async dir=>{
 const m=manifestFixture(),j=new Journal(dir);const p=m.payload;await j.initialize(claimRequest(p.approval,p.owner_id,p.attempt_id),NOW);
 const args={manifest:m,journal_status:'OK',journal:await j.load(),availability:'available',credential_state:'readable',approval_state:'VALID',current_issue_digest:p.approval.binding.issue_content_digest,remote:{kind:'MISSING_OR_INACCESSIBLE'},now:NOW};
 assert.equal(assessRecovery(args).reason,'REMOTE_OWNERSHIP_UNPROVEN');
 for(const patch of [{availability:'asleep'},{availability:'offline'},{credential_state:'expired'},{journal_status:'LOCKED'},{journal_status:'MISSING'},{journal_status:'CORRUPT'},{approval_state:'REVOKED'},{current_issue_digest:'0'.repeat(64)},{now:'2026-10-20T00:00:00.000Z'}]) {
  const r=assessRecovery({...args,...patch});assert.equal(r.status,'HOLD');assert.equal(r.execution_allowed,false);
 }
 assert.equal(assessRecovery({...args,remote:{kind:'RESERVED',manifest:m}}).reason,'OWNERSHIP_OBSERVED_RECONCILIATION_REQUIRED');
 assert.equal(assessRecovery({...args,remote:{kind:'RESERVED',manifest:manifestFixture('other','other-attempt')}}).reason,'REMOTE_OWNER_OR_ATTEMPT_MISMATCH');
 const before=await j.load();const running=await j.update(before.sequence,{state:'CLAIMED',recovery_status:'RECONCILE_REQUIRED'},NOW);
 assert.equal(assessRecovery({...args,journal:running,remote:{kind:'RESERVED',manifest:m}}).reason,'STICKY_JOURNAL_RESTRICTION');
 assert.deepEqual(await j.load(),running);
}));
test('R02 stale/completed/wrong local attempt cannot be reconciled automatically',()=>sandbox(async dir=>{
 const m=manifestFixture(),p=m.payload,j=new Journal(dir);let r=await j.initialize(claimRequest(p.approval,p.owner_id,p.attempt_id),NOW);
 const args={manifest:m,journal_status:'OK',journal:r,availability:'available',credential_state:'readable',approval_state:'VALID',current_issue_digest:p.approval.binding.issue_content_digest,remote:{kind:'RESERVED',manifest:m},now:NOW};
 assert.equal(assessRecovery({...args,journal:{...r,claim:{...r.claim,attempt_id:'old'}}}).reason,'LOCAL_BINDING_MISMATCH');
 assert.equal(assessRecovery({...args,journal:{...r,sequence:-1}}).reason,'JOURNAL_UNTRUSTED');
 r=await j.update(r.sequence,{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'},NOW);
 r=await j.update(r.sequence,{state:'RUNNING',recovery_status:'EXECUTING'},NOW);
 assert.equal(assessRecovery({...args,journal:r}).reason,'EXECUTION_MAY_HAVE_STARTED');
 r=await j.update(r.sequence,{state:'COMPLETED',recovery_status:'COMPLETED'},NOW);
 assert.equal(assessRecovery({...args,journal:r}).reason,'ALREADY_COMPLETED');
}));

test('M04 acyclic core then detached authorization is constructible and binding tampering fails',()=>{
 const m=manifestFixture();
 assert.deepEqual(validateManifest(m),m);
 const intent=validateWriteIntent(intentFixture(m),m,NOW);
 const {privateKey,publicKey}=generateKeyPairSync('ed25519'); // ephemeral offline fixture only
 const bytes=Buffer.from('CC_AG_DETACHED_ONE_WRITE_V1\0'+canonical(intent));
 const signature=sign(null,bytes,privateKey);
 const receipt={manifest_digest:m.immutable_evidence_digest,intent_digest:digest(intent),signature_digest:digest({signature:signature.toString('base64')})};
 assert.equal(verify(null,bytes,publicKey,signature),true);
 for(const patch of [{manifest_digest:'0'.repeat(64)},{target_commit_sha:'0'.repeat(40)},{attempt_id:'changed'},{principal:{...intent.principal,installation_id:999}}]) {
  assert.equal(verify(null,Buffer.from('CC_AG_DETACHED_ONE_WRITE_V1\0'+canonical({...intent,...patch})),publicKey,signature),false);
 }
 assert.equal(validateManifest(m).immutable_evidence_digest,receipt.manifest_digest);
 assert.equal(digest(intent),receipt.intent_digest);
 assert.throws(()=>validateManifest({payload:{...m.payload,approval_evidence_digest:receipt.signature_digest},immutable_evidence_digest:digest({...m.payload,approval_evidence_digest:receipt.signature_digest})}));
});
