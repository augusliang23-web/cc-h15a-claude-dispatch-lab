import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { setup,NOW,sandbox } from './support.mjs';
import { claimRequest } from '../claims.mjs';
import { Journal } from '../journal.mjs';
import { recover } from '../admission.mjs';
import { MockGitHub } from '../claims.mjs';

async function atState(dir,state,status) {
 const j=new Journal(dir);await j.initialize(claimRequest(setup().payload,'mac','attempt'),NOW);
 let r=await j.load();
 if(state!=='QUEUED')r=await j.update(r.sequence,{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'},NOW);
 if(['RUNNING','INTERRUPTED','BLOCKED'].includes(state))r=await j.update(r.sequence,{state:'RUNNING',recovery_status:'EXECUTING'},NOW);
 if(['INTERRUPTED','BLOCKED'].includes(state))r=await j.update(r.sequence,{state:'INTERRUPTED',recovery_status:'UNCERTAIN'},NOW);
 if(state==='BLOCKED')r=await j.update(r.sequence,{state:'BLOCKED',recovery_status:'BLOCKED'},NOW);
 if(r.recovery_status!==status)r=await j.update(r.sequence,{recovery_status:status},NOW);
 return {j,r};
}

for(const [name,state,status,patch] of [
 ['J01 CLAIMED reconciliation cannot be confirmed','CLAIMED','RECONCILE_REQUIRED',{recovery_status:'CLAIM_CONFIRMED'}],
 ['J02 RUNNING uncertainty cannot resume','RUNNING','UNCERTAIN',{recovery_status:'EXECUTING'}],
 ['J03 QUEUED reconciliation cannot request claim','QUEUED','RECONCILE_REQUIRED',{recovery_status:'CLAIM_PENDING'}],
 ['J04 uncertain execution cannot become completed','RUNNING','UNCERTAIN',{state:'COMPLETED',recovery_status:'COMPLETED'}],
 ['equivalent CLAIMED reconciliation cannot start execution','CLAIMED','RECONCILE_REQUIRED',{state:'RUNNING',recovery_status:'EXECUTING'}],
 ['equivalent CLAIMED reconciliation cannot relabel to running uncertainty','CLAIMED','RECONCILE_REQUIRED',{state:'RUNNING',recovery_status:'UNCERTAIN'}],
 ['equivalent QUEUED reconciliation cannot confirm a claim','QUEUED','RECONCILE_REQUIRED',{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'}],
 ['equivalent uncertainty cannot claim clean failure','RUNNING','UNCERTAIN',{state:'FAILED',recovery_status:'BLOCKED'}],
 ['equivalent BLOCKED cannot restart','BLOCKED','BLOCKED',{state:'RUNNING',recovery_status:'EXECUTING'}],
])test(`${name}; J07 persisted bytes unchanged`,()=>sandbox(async dir=>{
 const {j,r}=await atState(dir,state,status);const before=await fs.readFile(join(dir,'attempt.json'));
 await assert.rejects(j.update(r.sequence,patch,NOW));
 assert.deepEqual(await fs.readFile(join(dir,'attempt.json')),before);
 assert.deepEqual(await j.load(),r);
}));

test('J05 verified claim progression remains valid, pending is not irreversible uncertainty',()=>sandbox(async dir=>{
 const {j,r}=await atState(dir,'QUEUED','READY');
 const pending=await j.update(r.sequence,{recovery_status:'CLAIM_PENDING'},NOW);
 const claimed=await j.update(pending.sequence,{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'},NOW);
 assert.equal(claimed.state,'CLAIMED');assert.equal(claimed.recovery_status,'CLAIM_CONFIRMED');
}));
test('J06 uncertain execution still recovers through INTERRUPTED to BLOCKED',()=>sandbox(async dir=>{
 const {j}=await atState(dir,'RUNNING','UNCERTAIN');
 const outcome=await recover({journal:j,remote:new MockGitHub(),now:NOW});
 assert.equal(outcome.reason,'EXECUTION_UNCERTAIN');
 const saved=await j.load();assert.equal(saved.recovery_status,'BLOCKED');
 assert.deepEqual(saved.history.map(x=>x.state),['QUEUED','CLAIMED','RUNNING','INTERRUPTED','BLOCKED']);
}));
test('J08 separate restarted process cannot clear persisted reconciliation restriction',()=>sandbox(async dir=>{
 const {j,r}=await atState(dir,'CLAIMED','RECONCILE_REQUIRED');
 const script=`import {Journal} from './bridge/journal.mjs'; const j=new Journal(process.argv[1]); const r=await j.load(); try {await j.update(r.sequence,{recovery_status:'CLAIM_CONFIRMED'},process.argv[2]);console.log('CLEARED');}catch{console.log((await j.load()).recovery_status);}`;
 const output=execFileSync(process.execPath,['--input-type=module','-e',script,dir,NOW],{encoding:'utf8'});
 assert.equal(output.trim(),'RECONCILE_REQUIRED');assert.deepEqual(await j.load(),r);
}));
test('J09 stale and current writer both cannot clear a new uncertainty marker',()=>sandbox(async dir=>{
 const {j,r}=await atState(dir,'RUNNING','EXECUTING');
 const oldWriter=new Journal(dir);const uncertain=await j.update(r.sequence,{recovery_status:'UNCERTAIN'},NOW);
 await assert.rejects(oldWriter.update(r.sequence,{recovery_status:'EXECUTING'},NOW),/STALE_JOURNAL/);
 await assert.rejects(oldWriter.update(uncertain.sequence,{recovery_status:'EXECUTING'},NOW));
 assert.deepEqual(await j.load(),uncertain);
}));
test('J10 malformed/corrupted persisted data remains fail closed',()=>sandbox(async dir=>{
 const {j}=await atState(dir,'RUNNING','UNCERTAIN');
 await fs.writeFile(join(dir,'attempt.json'),'{"record":{"state":"RUNNING","recovery_status":"EXECUTING"}}');
 await assert.rejects(j.load(),/JOURNAL_INVALID/);
 await assert.rejects(j.update(0,{recovery_status:'EXECUTING'},NOW),/JOURNAL_INVALID/);
}));
