import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {initializeFixture,inspectFixture,compareAndSwapFixture,FIXTURE_LEDGER}
 from '../zc09b2-fixture-cas.mjs';

const copy=x=>structuredClone(x);
const withFixture=async fn=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'zc09b2-fixture-'));
 fs.chmodSync(root,0o700);
 try{return await fn(root);}
 finally{fs.rmSync(root,{recursive:true,force:true});}
};
const expected=r=>{
 assert.equal(r.mode,'SYNTHETIC_LINUX_TEMP_ONLY');
 assert.equal(r.actual_dispatch,false);
 assert.equal(r.provider_calls,0);
 assert.equal(r.github_writes,0);
 assert.equal(r.mac_writes,0);
 assert.equal(r.durable_live_claim,false);
 assert.equal(r.ready_to_merge,false);
 assert.equal(r.owner_approval_required,true);
 return r;
};
const init=root=>{
 const r=expected(initializeFixture({root,ledger:copy(FIXTURE_LEDGER)}));
 assert.equal(r.gate,'FIXTURE_INITIALIZED');return r;
};
const claim=()=>{
 const l=copy(FIXTURE_LEDGER);
 l.revision=1;l.seenEvents=['event-0001'];
 l.lastObservedAt='2026-11-01T01:01:00Z';
 l.usedClaims=1;
 l.activeLease={leaseId:'b'.repeat(64),claimEventId:'event-0001',
  expiresAt:'2026-11-01T01:03:00Z',sha:'a'.repeat(40)};
 return l;
};
const commit=(root,proposal=claim(),extra={})=>expected(compareAndSwapFixture({
 root,expectedRevision:0,proposedLedger:proposal,now:'2026-11-01T01:01:05Z',...extra
}));
const recorded=root=>{
 const x=expected(inspectFixture({root}));
 assert.equal(x.gate,'FIXTURE_READ_ONLY');
 return x.ledger;
};

test('FS01 initializes exact private Linux temp fixture',()=>withFixture(root=>{
 init(root);assert.deepEqual(recorded(root),FIXTURE_LEDGER);
 assert.deepEqual(fs.readdirSync(root),['ledger.json']);
}));
test('FS02 does not overwrite a previously initialized fixture',()=>withFixture(root=>{
 init(root);const r=expected(initializeFixture({root,ledger:copy(FIXTURE_LEDGER)}));
 assert.equal(r.gate,'HOLD');assert.deepEqual(recorded(root),FIXTURE_LEDGER);
}));
test('FS03 first revision-pinned transition is actually committed locally',()=>withFixture(root=>{
 init(root);const r=commit(root);assert.equal(r.gate,'FIXTURE_CAS_COMMITTED');
 assert.deepEqual(recorded(root),claim());assert.equal(fs.readdirSync(root).length,1);
}));
test('FS04 stale competing revision never replaces the committed ledger',()=>withFixture(root=>{
 init(root);assert.equal(commit(root).gate,'FIXTURE_CAS_COMMITTED');
 const r=commit(root);assert.equal(r.reason,'REVISION_CONFLICT');
 assert.deepEqual(recorded(root),claim());
}));
test('FS05 duplicate event cannot be committed twice even with current revision',()=>withFixture(root=>{
 init(root);commit(root);
 const invalid=copy(claim());
 invalid.revision=2;invalid.seenEvents=['event-0001','event-0001'];
 invalid.lastObservedAt='2026-11-01T01:02:00Z';
 assert.equal(commit(root,invalid,{expectedRevision:1,now:'2026-11-01T01:02:01Z'}).gate,'HOLD');
 assert.deepEqual(recorded(root),claim());
}));
test('FS06 a later unique event can settle the previous mock lease into READY_FOR_OWNER',()=>withFixture(root=>{
 init(root);commit(root);
 const next=copy(claim());
 next.revision=2;next.seenEvents.push('event-0002');
 next.lastObservedAt='2026-11-01T01:02:00Z';next.terminalGate='READY_FOR_OWNER';
 next.activeLease=null;
 const r=commit(root,next,{expectedRevision:1,now:'2026-11-01T01:02:05Z'});
 assert.equal(r.gate,'FIXTURE_CAS_COMMITTED');
 assert.deepEqual(recorded(root),next);
 assert.equal(r.ready_to_merge,false);
}));
test('FS07 terminal state cannot be cleared by a new proposal',()=>withFixture(root=>{
 init(root);commit(root);
 const next=copy(claim());next.revision=2;next.seenEvents.push('event-0002');
 next.lastObservedAt='2026-11-01T01:02:00Z';next.activeLease=null;
 next.terminalGate='SAFETY_HOLD';
 commit(root,next,{expectedRevision:1,now:'2026-11-01T01:02:05Z'});
 const illegal=copy(next);illegal.revision=3;illegal.seenEvents.push('event-0003');
 illegal.lastObservedAt='2026-11-01T01:03:00Z';illegal.terminalGate='NONE';
 assert.equal(commit(root,illegal,{expectedRevision:2,now:'2026-11-01T01:03:05Z'}).reason,'INVALID_TRANSITION');
 assert.equal(recorded(root).terminalGate,'SAFETY_HOLD');
}));
test('FS08 immutable task SHA drift is rejected',()=>withFixture(root=>{
 init(root);const changed=claim();changed.task.sha='f'.repeat(40);
 assert.equal(commit(root,changed).gate,'HOLD');
 assert.deepEqual(recorded(root),FIXTURE_LEDGER);
}));
test('FS09 negative source event can advance watermark without claiming worker',()=>withFixture(root=>{
 init(root);const n=copy(FIXTURE_LEDGER);
 n.revision=1;n.seenEvents=['event-0001'];
 n.lastObservedAt='2026-11-01T01:01:00Z';
 assert.equal(commit(root,n).gate,'FIXTURE_CAS_COMMITTED');
 assert.equal(recorded(root).activeLease,null);
 assert.equal(recorded(root).usedClaims,0);
}));
test('FS10 event watermark cannot move backward',()=>withFixture(root=>{
 init(root);commit(root);
 const later=copy(claim());later.revision=2;later.seenEvents.push('event-0002');
 later.lastObservedAt='2026-11-01T01:00:59Z';
 assert.equal(commit(root,later,{expectedRevision:1,now:'2026-11-01T01:02:00Z'}).gate,'HOLD');
 assert.deepEqual(recorded(root),claim());
}));
test('FS11 cannot initiate a lease already expired at evaluation clock',()=>withFixture(root=>{
 init(root);
 assert.equal(commit(root,claim(),{now:'2026-11-01T01:04:00Z'}).gate,'HOLD');
 assert.deepEqual(recorded(root),FIXTURE_LEDGER);
}));
test('FS12 an existing lease cannot be replaced by an unrelated claim',()=>withFixture(root=>{
 init(root);commit(root);
 const illegal=copy(claim());illegal.revision=2;illegal.seenEvents.push('event-0002');
 illegal.lastObservedAt='2026-11-01T01:02:00Z';
 illegal.activeLease.leaseId='c'.repeat(64);
 assert.equal(commit(root,illegal,{expectedRevision:1,now:'2026-11-01T01:02:05Z'}).gate,'HOLD');
 assert.deepEqual(recorded(root),claim());
}));
test('FS13 forged additional fields never become accepted ledger state',()=>withFixture(root=>{
 init(root);const x=claim();x.runAgent=true;
 assert.equal(commit(root,x).gate,'HOLD');
 assert.deepEqual(recorded(root),FIXTURE_LEDGER);
}));
test('FS14 swapped task identity does not pass strict record validation',()=>withFixture(root=>{
 init(root);const x=claim();x.task.repo='other/repo';
 assert.equal(commit(root,x).gate,'HOLD');
 assert.deepEqual(recorded(root),FIXTURE_LEDGER);
}));
test('FS15 malformed JSON and incorrect digest fail closed on read',()=>withFixture(root=>{
 init(root);
 const p=path.join(root,'ledger.json'), data=JSON.parse(fs.readFileSync(p,'utf8'));
 data.ledger.revision=99;
 fs.writeFileSync(p,JSON.stringify(data));
 const out=expected(inspectFixture({root}));
 assert.equal(out.gate,'HOLD');
}));
test('FS16 unexpected stage filename remains a hard HOLD',()=>withFixture(root=>{
 init(root);fs.writeFileSync(path.join(root,'stage-other.tmp'),'unknown');
 assert.equal(inspectFixture({root}).reason,'UNKNOWN_STAGING_OR_LOCK');
 assert.equal(commit(root).gate,'HOLD');
}));
test('FS17 interrupted durable-stage write retains lock and stage, no automatic cleanup',()=>withFixture(root=>{
 init(root);
 const r=commit(root,claim(),{phaseHook:()=>{throw Error('SIMULATED_CRASH');}});
 assert.equal(r.reason,'TRANSACTION_UNCERTAIN_LOCK_RETAINED');
 assert.equal(inspectFixture({root}).reason,'UNKNOWN_STAGING_OR_LOCK');
 const files=fs.readdirSync(root);
 assert.ok(files.includes('.cas-lock'));
 assert.ok(files.some(n=>/^stage-[0-9a-f]{24}\.tmp$/.test(n)));
 assert.equal(commit(root).reason,'LOCK_BUSY_OR_EXISTING_RECORD');
 const raw=JSON.parse(fs.readFileSync(path.join(root,'ledger.json'),'utf8'));
 assert.deepEqual(raw.ledger,FIXTURE_LEDGER);
}));
test('FS18 a reentrant second caller is denied while first holds exclusive lock',()=>withFixture(root=>{
 init(root);let contender=null;
 const first=commit(root,claim(),{phaseHook:()=>{
  contender=commit(root);
 }});
 assert.equal(first.gate,'FIXTURE_CAS_COMMITTED');
 assert.equal(contender.reason,'LOCK_BUSY_OR_EXISTING_RECORD');
 assert.deepEqual(recorded(root),claim());
}));
test('FS19 unexpected lock alone blocks all read paths',()=>withFixture(root=>{
 init(root);fs.writeFileSync(path.join(root,'.cas-lock'),'not-owner-claim');
 assert.equal(inspectFixture({root}).gate,'HOLD');
 assert.equal(commit(root).gate,'HOLD');
}));
test('FS20 symlinked ledger is never followed',()=>withFixture(root=>{
 init(root);
 const p=path.join(root,'ledger.json');
 fs.renameSync(p,path.join(root,'safe.ledger'));
 fs.symlinkSync('safe.ledger',p);
 assert.equal(inspectFixture({root}).gate,'HOLD');
}));
test('FS21 outside temporary root is forbidden',()=>{
 const r=inspectFixture({root:path.join(os.tmpdir(),'unauthorized-path')});
 assert.equal(r.gate,'HOLD');
});
test('FS22 symlinked fixture root is forbidden',()=>withFixture(root=>{
 init(root);
 const alias=path.join(os.tmpdir(),'zc09b2-fixture-aliasTEST99');
 try{fs.symlinkSync(root,alias);
  assert.equal(inspectFixture({root:alias}).gate,'HOLD');
 }finally{if(fs.existsSync(alias))fs.unlinkSync(alias);}
}));
test('FS23 group-visible root is rejected',()=>withFixture(root=>{
 init(root);fs.chmodSync(root,0o755);
 assert.equal(inspectFixture({root}).gate,'HOLD');
 fs.chmodSync(root,0o700);
}));
test('FS24 group-visible ledger is rejected',()=>withFixture(root=>{
 init(root);
 fs.chmodSync(path.join(root,'ledger.json'),0o644);
 assert.equal(inspectFixture({root}).gate,'HOLD');
}));
test('FS25 missing and malformed root values always fail closed',()=>{
 for(const root of [undefined,null,[],{},'', 'relative/dir']) {
  assert.equal(inspectFixture({root}).gate,'HOLD');
 }
});
test('FS26 malformed proposal time is rejected before filesystem mutation',()=>withFixture(root=>{
 init(root);
 assert.equal(commit(root,claim(),{now:['2026-11-01T01:01:05Z']}).gate,'HOLD');
 assert.deepEqual(recorded(root),FIXTURE_LEDGER);
}));
test('FS27 malformed initial ledger cannot create a record',()=>withFixture(root=>{
 const x=copy(FIXTURE_LEDGER);x.terminalGate='READY_FOR_OWNER';
 assert.equal(initializeFixture({root,ledger:x}).gate,'HOLD');
 assert.equal(fs.readdirSync(root).length,0);
}));
test('FS28 cap increase cannot be smuggled into a version transition',()=>withFixture(root=>{
 init(root);const x=claim();x.maxClaims=3;
 assert.equal(commit(root,x).gate,'HOLD');
 assert.deepEqual(recorded(root),FIXTURE_LEDGER);
}));
test('FS29 an unrecorded lease cannot be used to settle a claim',()=>withFixture(root=>{
 init(root);const x=claim();x.activeLease.claimEventId='event-not-seen';
 assert.equal(commit(root,x).gate,'HOLD');
}));
test('FS30 hash digest is for accidental corruption, not same-UID authentication',()=>withFixture(root=>{
 init(root);const p=path.join(root,'ledger.json');
 const d=JSON.parse(fs.readFileSync(p,'utf8'));d.digest='f'.repeat(64);
 fs.writeFileSync(p,JSON.stringify(d));
 assert.equal(inspectFixture({root}).gate,'HOLD');
}));
test('FS31 two independent Node processes cannot commit the same revision twice',()=>withFixture(async root=>{
 init(root);
 const mod=fileURLToPath(new URL('../zc09b2-fixture-cas.mjs',import.meta.url));
 const proposal=Buffer.from(JSON.stringify(claim())).toString('base64');
 const script=String.raw`
  const {pathToFileURL}=await import('node:url');
  const m=await import(pathToFileURL(process.argv[1]).href);
  const proposedLedger=JSON.parse(Buffer.from(process.argv[3],'base64').toString());
  const r=m.compareAndSwapFixture({root:process.argv[2],expectedRevision:0,
   proposedLedger,now:'2026-11-01T01:01:05Z'});
  process.stdout.write(JSON.stringify({gate:r.gate,reason:r.reason})+'\n');
 `;
 const launch=()=>new Promise((resolve,reject)=>{
  const cp=spawn(process.execPath,['--input-type=module','-e',script,mod,root,proposal],{
   stdio:['ignore','pipe','pipe'],env:{PATH:process.env.PATH??'/usr/bin:/bin'}
  });
  let out='',err='';
  cp.stdout.on('data',x=>out+=x.toString());
  cp.stderr.on('data',x=>err+=x.toString());
  cp.once('error',reject);
  cp.once('close',code=>{
   if(code!==0||err)reject(Error('CHILD_UNEXPECTED'));
   else{try{resolve(JSON.parse(out.trim()));}catch{reject(Error('CHILD_INVALID_REPORT'));}}
  });
 });
 const outcomes=await Promise.all([launch(),launch()]);
 assert.equal(outcomes.filter(x=>x.gate==='FIXTURE_CAS_COMMITTED').length,1);
 assert.equal(outcomes.filter(x=>x.gate==='HOLD').length,1);
 assert.deepEqual(recorded(root),claim());
}));

test('FS32 reordered fields of the same validated lease do not invalidate a CAS',()=>withFixture(root=>{
 init(root);assert.equal(commit(root).gate,'FIXTURE_CAS_COMMITTED');
 const next=copy(claim());
 next.revision=2;next.seenEvents.push('event-0002');
 next.lastObservedAt='2026-11-01T01:02:00Z';
 const l=next.activeLease;
 next.activeLease={sha:l.sha,expiresAt:l.expiresAt,claimEventId:l.claimEventId,leaseId:l.leaseId};
 const r=commit(root,next,{expectedRevision:1,now:'2026-11-01T01:02:05Z'});
 assert.equal(r.gate,'FIXTURE_CAS_COMMITTED');
 assert.deepEqual(recorded(root),next);
}));
