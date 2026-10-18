import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { setup,NOW,sandbox } from './support.mjs';
import { claimRequest } from '../claims.mjs';
import { Journal, validateJournal } from '../journal.mjs';
const later='2026-10-19T01:01:00.000Z';
const claim=()=>claimRequest(setup().payload,'mac-1','attempt-1');

test('C valid private journal persists/restores with history and rejects stale writer',()=>sandbox(async dir=>{
 const j=new Journal(dir),r=await j.initialize(claim(),NOW);
 assert.equal(r.state,'QUEUED');assert.equal((await new Journal(dir).load()).sequence,0);
 const next=await j.update(0,{recovery_status:'CLAIM_PENDING'},later);
 assert.equal(next.sequence,1);assert.equal(next.claim.approval.binding.task_id,'AG2B2-test');
 await assert.rejects(j.update(0,{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'},later),/STALE_JOURNAL/);
 const stat=await fs.stat(join(dir,'attempt.json'));assert.equal(stat.mode&0o777,0o600);
 await assert.rejects(j.initialize(claim(),NOW));
}));
test('C missing/corrupted/invalid history journals never silently reset',()=>sandbox(async dir=>{
 const j=new Journal(dir);await assert.rejects(j.load(),/JOURNAL_MISSING/);
 const r=await j.initialize(claim(),NOW);
 for(const bad of [{...r,state:'COMPLETED'},{...r,history:[{state:'COMPLETED',at:NOW}]},{...r,sequence:-1},{...r,extra:'private-key'}])assert.throws(()=>validateJournal(bad));
 await fs.writeFile(join(dir,'attempt.json'),'corrupted');await assert.rejects(j.load(),/JOURNAL_INVALID/);
 await assert.rejects(j.initialize(claim(),NOW));
}));
test('C rename failure leaves HOLD marker, old state intact, never false completion',()=>sandbox(async dir=>{
 const j=new Journal(dir);await j.initialize(claim(),NOW);
 await j.update(0,{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'},NOW);
 await j.update(1,{state:'RUNNING',recovery_status:'EXECUTING'},NOW);
 const broken=new Journal(dir,{io:{...fs,rename:async()=>{throw Error('SECRET transport');}}});
 await assert.rejects(broken.update(2,{state:'COMPLETED',recovery_status:'COMPLETED'},later),/JOURNAL_WRITE_UNCERTAIN/);
 await assert.rejects(new Journal(dir).load(),/JOURNAL_LOCKED/);
 const disk=JSON.parse(await fs.readFile(join(dir,'attempt.json'),'utf8'));
 assert.equal(disk.record.state,'RUNNING');assert.ok(!JSON.stringify(disk).includes('SECRET'));
}));
test('C completed task cannot restart or be overwritten after process restart',()=>sandbox(async dir=>{
 let j=new Journal(dir);await j.initialize(claim(),NOW);
 await j.update(0,{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'},NOW);
 await j.update(1,{state:'RUNNING',recovery_status:'EXECUTING'},NOW);
 await j.update(2,{state:'COMPLETED',recovery_status:'COMPLETED'},later);
 j=new Journal(dir);assert.equal((await j.load()).state,'COMPLETED');
 await assert.rejects(j.update(3,{state:'RUNNING',recovery_status:'EXECUTING'},later));
 await assert.rejects(j.initialize(claim(),NOW));
}));
test('C concurrent local writers yield one winner, no lost state',()=>sandbox(async dir=>{
 const j=new Journal(dir);await j.initialize(claim(),NOW);
 const result=await Promise.allSettled(Array.from({length:10},()=>new Journal(dir).update(0,{recovery_status:'CLAIM_PENDING'},later)));
 assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await j.load()).sequence,1);
}));
test('C checksum detects edits; symlinks and unsafe directory permissions rejected',()=>sandbox(async dir=>{
 const j=new Journal(dir);await j.initialize(claim(),NOW);
 const path=join(dir,'attempt.json'),d=JSON.parse(await fs.readFile(path,'utf8'));d.record.claim.owner='other';
 await fs.writeFile(path,JSON.stringify(d));await assert.rejects(j.load(),/JOURNAL_INVALID/);
 await fs.unlink(path);await fs.symlink(join(dir,'absent'),path);await assert.rejects(j.load());
 await fs.unlink(path);await fs.chmod(dir,0o755);await assert.rejects(j.initialize(claim(),NOW),/UNSAFE_JOURNAL_DIRECTORY/);
}));
test('C fsync failure after rename keeps uncertainty marker even if completed bytes are visible',()=>sandbox(async dir=>{
 const j=new Journal(dir);await j.initialize(claim(),NOW);
 await j.update(0,{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'},NOW);
 await j.update(1,{state:'RUNNING',recovery_status:'EXECUTING'},NOW);
 let directorySyncs=0;
 const io={...fs,open:async(path,...args)=>{const h=await fs.open(path,...args);if(path===dir)h.sync=async()=>{if(++directorySyncs===2)throw Error('SECRET fsync');};return h;}};
 await assert.rejects(new Journal(dir,{io}).update(2,{state:'COMPLETED',recovery_status:'COMPLETED'},later),/JOURNAL_WRITE_UNCERTAIN/);
 assert.equal(JSON.parse(await fs.readFile(join(dir,'attempt.json'),'utf8')).record.state,'COMPLETED');
 await assert.rejects(j.load(),/JOURNAL_LOCKED/);
}));
test('C temporary-file fsync failure preserves previous durable state and locks',()=>sandbox(async dir=>{
 const j=new Journal(dir);await j.initialize(claim(),NOW);
 const io={...fs,open:async(path,...args)=>{const h=await fs.open(path,...args);if(path.endsWith('.tmp'))h.sync=async()=>{throw Error('SECRET fsync');};return h;}};
 await assert.rejects(new Journal(dir,{io}).update(0,{recovery_status:'CLAIM_PENDING'},later),/JOURNAL_WRITE_UNCERTAIN/);
 assert.equal(JSON.parse(await fs.readFile(join(dir,'attempt.json'),'utf8')).record.recovery_status,'READY');
 await assert.rejects(j.load(),/JOURNAL_LOCKED/);
}));

test('C a separate restarted process restores persisted running history',()=>sandbox(async dir=>{
 const j=new Journal(dir);await j.initialize(claim(),NOW);
 await j.update(0,{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'},NOW);
 await j.update(1,{state:'RUNNING',recovery_status:'EXECUTING'},NOW);
 const code="import {Journal} from './bridge/journal.mjs'; const r=await new Journal(process.argv[1]).load(); console.log(JSON.stringify({state:r.state,attempt:r.claim.attempt_id,history:r.history.map(x=>x.state)}));";
 const restored=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code,dir],{encoding:'utf8'}));
 assert.deepEqual(restored,{state:'RUNNING',attempt:'attempt-1',history:['QUEUED','CLAIMED','RUNNING']});
}));
