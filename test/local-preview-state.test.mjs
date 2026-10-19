import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {PreviewLedger} from '../local-preview/ledger.mjs';
import {ReviewSession,fixtureSource} from '../local-preview/review.mjs';
const NOW='2026-10-19T02:00:00.000Z';
async function sandbox(fn){const root=await fs.mkdtemp(join(tmpdir(),'preview-test-'));try{await fn(join(root,'private'));}finally{await fs.rm(root,{recursive:true,force:true});}}
async function session(dir,source=fixtureSource(),clock=()=>NOW){const ledger=await PreviewLedger.open(dir);return {ledger,review:new ReviewSession({ledger,source,clock})};}

test('P01 fixture must be refreshed; approve persists exact local-only decision across restart',()=>sandbox(async dir=>{
 let {ledger,review}=await session(dir);assert.equal((await review.view()).can_decide,false);
 await review.refresh();const v=await review.view();assert.equal(v.preview.source,'SYNTHETIC_FIXTURE');assert.equal(v.can_decide,true);
 const saved=await review.decide({decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id});
 assert.equal(saved.execution_allowed,false);assert.equal(saved.history.length,1);assert.equal(saved.can_decide,false);
 await ledger.close();({ledger,review}=await session(dir));
 const restarted=await review.view();assert.equal(restarted.history[0].decision,'LOCAL_PREVIEW_APPROVED');assert.equal(restarted.can_decide,false);
 await review.refresh();assert.equal((await review.view()).can_decide,false);await ledger.close();
}));
test('P02 rejection cannot be reversed; duplicate/stale requests add no event',()=>sandbox(async dir=>{
 const {ledger,review}=await session(dir);await review.refresh();const v=await review.view();
 await review.decide({decision:'LOCAL_PREVIEW_REJECTED',sequence:v.sequence,review_id:v.review_id});
 await assert.rejects(()=>review.decide({decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id}));
 assert.equal((await review.view()).history.length,1);await ledger.close();
}));
test('P03 edit between display and decision is blocked, deliberate new review required',()=>sandbox(async dir=>{
 const source=fixtureSource();const {ledger,review}=await session(dir,source);await review.refresh();const v=await review.view();
 const original=source.read;source.read=async()=>{const r=await original();r.task_binding.issue_content_digest='0'.repeat(64);return r;};
 await assert.rejects(()=>review.decide({decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id}));
 assert.equal((await review.view()).history.length,0);assert.equal((await review.view()).can_decide,false);await ledger.close();
}));
test('P04 offline source shows cached non-authoritative preview but no approval',()=>sandbox(async dir=>{
 const source=fixtureSource();const {ledger,review}=await session(dir,source);await review.refresh();source.read=async()=>{throw Error('PRIVATE_BODY_DO_NOT_LEAK');};
 await review.refresh();const v=await review.view();assert.equal(v.can_decide,false);assert.ok(v.preview);assert.equal(v.execution_allowed,false);assert.ok(!JSON.stringify(v).includes('PRIVATE_BODY'));await ledger.close();
}));
test('P05 planning Issue, substituted repository or unknown source fails closed',()=>sandbox(async dir=>{
 const {ledger,review}=await session(dir,{kind:'GITHUB_READ_ONLY',read:async()=>({status:'HOLD',reason:'TASK_SCHEMA_REJECTED',issue_number:14})});
 await review.refresh();assert.equal((await review.view()).can_decide,false);await ledger.close();
}));
test('P06 stale time and backward clock block recording',()=>sandbox(async dir=>{
 let now=NOW;const {ledger,review}=await session(dir,fixtureSource(),()=>now);await review.refresh();const v=await review.view();
 now='2026-10-19T02:03:00.000Z';assert.equal((await review.view()).can_decide,false);
 now='2026-10-19T01:59:00.000Z';await assert.rejects(()=>review.decide({decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id}));await ledger.close();
}));
test('P07 private ledger, exclusive launch, corruption and restart lock HOLD',()=>sandbox(async dir=>{
 const {ledger}=await session(dir);assert.equal((await fs.stat(dir)).mode&0o777,0o700);
 await assert.rejects(()=>PreviewLedger.open(dir),/LEDGER_LOCKED/);await ledger.close();
 await fs.writeFile(join(dir,'ledger.json'),'corrupt',{mode:0o600});await assert.rejects(()=>PreviewLedger.open(dir));
}));
test('P08 checkpoint mismatch detects partial rollback and history cannot be silently recreated',()=>sandbox(async dir=>{
 const {ledger,review}=await session(dir);const old=await fs.readFile(join(dir,'ledger.json'));
 await review.refresh();const v=await review.view();await review.decide({decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id});await ledger.close();
 await fs.writeFile(join(dir,'ledger.json'),old);await assert.rejects(()=>PreviewLedger.open(dir));
}));
test('P09 existing empty directory is HOLD, not automatic reset',()=>sandbox(async dir=>{
 await fs.mkdir(dir,{mode:0o700});await assert.rejects(()=>PreviewLedger.open(dir));
}));

test('P10 state read interleaved with paired-file commit does not corrupt legitimate decision',()=>sandbox(async dir=>{
 const fsDefault=(await import('node:fs/promises')).default;
 const {syncBuiltinESMExports}=await import('node:module');
 const {ledger,review}=await session(dir);await review.refresh();const v=await review.view();
 const rename=fsDefault.rename;let concurrentRead,interleaved=false;
 fsDefault.rename=async(...args)=>{await rename(...args);if(!interleaved && args[1]===join(dir,'ledger.json')){interleaved=true;concurrentRead=review.view();await new Promise(resolve=>setImmediate(resolve));}};
 syncBuiltinESMExports();
 try{const result=await review.decide({decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id});assert.equal(result.history.length,1);assert.equal((await concurrentRead).history.length,1);}
 finally{fsDefault.rename=rename;syncBuiltinESMExports();await ledger.close();}
 const reopened=await PreviewLedger.open(dir);assert.equal((await reopened.snapshot()).length,1);await reopened.close();
}));

test('P11 prior local approval cannot mask restart or clock HOLD status',()=>sandbox(async dir=>{
 let {ledger,review}=await session(dir);await review.refresh();let v=await review.view();await review.decide({decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id});await ledger.close();
 ({ledger,review}=await session(dir));v=await review.view();assert.equal(v.status,'RESTART_REQUIRES_REFRESH');assert.equal(v.can_decide,false);assert.equal(v.history.length,1);await ledger.close();
}));
