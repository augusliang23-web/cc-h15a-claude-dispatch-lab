import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {rehearseReversiblePolicy} from '../zc06c-transaction-rehearsal.mjs';

const seed=Buffer.from('{\n  "toolPermission": "request-review",\n  "theme": "synthetic"\n}\n');
const checkSafety=r=>{
 assert.equal(r.simulated,true);
 assert.equal(r.model_called,false);
 assert.equal(r.user_settings_modified,false);
 assert.equal(r.automatic_retry,false);
 assert.equal(Object.hasOwn(r,'temporaryBytes'),false);
 assert.equal(Object.hasOwn(r,'originalBytes'),false);
};
test('TX01 nominal synthetic atomic policy transaction restores exact bytes',()=>{
 const r=rehearseReversiblePolicy({originalBytes:seed});
 checkSafety(r);
 assert.equal(r.gate,'ZC06C_REHEARSAL_EXACT_RESTORE_PASS');
 assert.equal(r.restored_exactly,true);
});
test('TX02 crash after backup never mutates config',()=>{
 const r=rehearseReversiblePolicy({originalBytes:seed,failureAt:'AFTER_BACKUP'});
 checkSafety(r);
 assert.equal(r.gate,'ZC06C_REHEARSAL_ORIGINAL_PRESENT');
 assert.equal(r.restored_exactly,true);
 assert.equal(r.failure_injected,true);
});
test('TX03 crash after policy swap is recovered from original private backup',()=>{
 const r=rehearseReversiblePolicy({originalBytes:seed,failureAt:'AFTER_APPLY'});
 checkSafety(r);
 assert.equal(r.gate,'ZC06C_REHEARSAL_EXACT_RESTORE_PASS');
 assert.equal(r.simulated_crash_recovery,true);
 assert.equal(r.restored_exactly,true);
});
test('TX04 crash before restore completes via recovery path',()=>{
 const r=rehearseReversiblePolicy({originalBytes:seed,failureAt:'BEFORE_RESTORE'});
 checkSafety(r);
 assert.equal(r.gate,'ZC06C_REHEARSAL_EXACT_RESTORE_PASS');
 assert.equal(r.simulated_crash_recovery,true);
});
test('TX05 unexpected concurrent synthetic settings change is never overwritten',()=>{
 const r=rehearseReversiblePolicy({originalBytes:seed,concurrentChange:true});
 checkSafety(r);
 assert.equal(r.gate,'ZC06C_REHEARSAL_HOLD');
 assert.equal(r.reason,'CONCURRENT_OR_UNKNOWN_SYNTHETIC_CHANGE');
 assert.equal(r.restored_exactly,undefined);
});
test('TX06 changed backup bytes cannot be accepted for restore',()=>{
 const r=rehearseReversiblePolicy({originalBytes:seed,corruptBackup:true});
 checkSafety(r);
 assert.equal(r.gate,'ZC06C_REHEARSAL_HOLD');
 assert.equal(r.reason,'BACKUP_HASH_MISMATCH');
});
test('TX07 malformed JSON seed never starts a synthetic transaction',()=>{
 const r=rehearseReversiblePolicy({originalBytes:Buffer.from('{wrong')});
 checkSafety(r);
 assert.equal(r.reason,'INVALID_SYNTHETIC_POLICY');
});
test('TX08 malformed UTF-8 seed is rejected without lossy restoration',()=>{
 const r=rehearseReversiblePolicy({originalBytes:Buffer.from([0x7b,0x80,0x7d])});
 checkSafety(r);
 assert.equal(r.reason,'INVALID_SYNTHETIC_POLICY');
});
test('TX09 direct-to-API billing JSON is rejected even in rehearsal',()=>{
 const r=rehearseReversiblePolicy({
  originalBytes:Buffer.from('{"modelProvider":"gemini"}')});
 checkSafety(r);
 assert.equal(r.reason,'INVALID_SYNTHETIC_POLICY');
});
test('TX10 invalid fault injections are denied before any simulated IO',()=>{
 const r=rehearseReversiblePolicy({originalBytes:seed,failureAt:'IGNORE_FAILURE'});
 checkSafety(r);
 assert.equal(r.reason,'INVALID_FAULT_POINT');
});
test('TX11 fail-closed for non-buffer source settings input',()=>{
 const r=rehearseReversiblePolicy({originalBytes:'{"a":1}'});
 checkSafety(r);
 assert.equal(r.reason,'INVALID_SYNTHETIC_SEED');
});
test('TX12 normal or crash scenarios never create a user-home settings file',()=>{
 const sentinel=path.join(os.homedir(),'.zc06c-transaction-sim-should-not-exist');
 const before=fs.existsSync(sentinel);
 for(const options of [{},{failureAt:'AFTER_BACKUP'},
  {failureAt:'AFTER_APPLY'},{concurrentChange:true},{corruptBackup:true}]){
  const r=rehearseReversiblePolicy({originalBytes:seed,...options});
  checkSafety(r);
 }
 assert.equal(fs.existsSync(sentinel),before);
});
test('TX13 single-line synthetic seed preserves raw LF in byte-for-byte restore',()=>{
 const r=rehearseReversiblePolicy({
  originalBytes:Buffer.from('{"notifications":true}\n')});
 checkSafety(r);
 assert.equal(r.restored_exactly,true);
});
