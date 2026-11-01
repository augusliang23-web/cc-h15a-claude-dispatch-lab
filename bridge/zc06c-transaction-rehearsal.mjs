// ZC-06C: isolated real-filesystem REHEARSAL ONLY, not a Mac settings updater.
// All writes are confined to a freshly created, synthetic, private temp fixture.
// No caller-supplied paths, no HOME, no AgY/other subprocesses or network.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {planRestrictedPolicy,verifyRestore} from './zc06c-policy-plan.mjs';

const hash=b=>createHash('sha256').update(b).digest('hex');
const hold=reason=>({gate:'ZC06C_REHEARSAL_HOLD',reason,simulated:true,
  user_settings_modified:false,model_called:false,automatic_retry:false});
const safeReport=(gate,extra={})=>({
  gate,simulated:true,user_settings_modified:false,model_called:false,
  automatic_retry:false,...extra
});
const VERSION=1;
function syncDir(dir){
 const fd=fs.openSync(dir,'r');
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function syncFile(file){
 const fd=fs.openSync(file,'r');
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function safeWriteNew(file,bytes) {
 const fd=fs.openSync(file,'wx',0o600);
 try{
  const n=fs.writeSync(fd,bytes,0,bytes.length,0);
  if(n!==bytes.length)throw Error('SHORT_WRITE');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 syncDir(path.dirname(file));
}
function atomicPut(file,bytes){
 const candidate=file+'.staged';
 safeWriteNew(candidate,bytes);
 fs.renameSync(candidate,file);
 syncDir(path.dirname(file));
}
function writeJournal(root,source,target,phase){
 const j={version:VERSION,source_sha256:source,target_sha256:target,
   phase,synthetic:true};
 const bytes=Buffer.from(JSON.stringify(j)+'\n');
 atomicPut(path.join(root,'journal.json'),bytes);
}
function readJournal(root){
 const j=JSON.parse(fs.readFileSync(path.join(root,'journal.json'),'utf8'));
 if(!j||j.version!==VERSION||j.synthetic!==true||
    !['PREPARED','APPLYING','RESTRICTED','RESTORING'].includes(j.phase)||
    !/^[a-f0-9]{64}$/.test(j.source_sha256)||
    !/^[a-f0-9]{64}$/.test(j.target_sha256))
   throw Error('INVALID_JOURNAL');
 return j;
}
function recoverFixture(root){
 try{
  const j=readJournal(root);
  const backup=fs.readFileSync(path.join(root,'backup.original'));
  if(hash(backup)!==j.source_sha256)return hold('BACKUP_HASH_MISMATCH');
  const target=path.join(root,'settings.synthetic.json');
  const observed=fs.readFileSync(target);
  if(hash(observed)===j.source_sha256)
   return safeReport('ZC06C_REHEARSAL_ORIGINAL_PRESENT',{restored_exactly:true});
  if(hash(observed)!==j.target_sha256)
   return hold('CONCURRENT_OR_UNKNOWN_SYNTHETIC_CHANGE');
  writeJournal(root,j.source_sha256,j.target_sha256,'RESTORING');
  atomicPut(target,backup);
  const match=verifyRestore(backup,fs.readFileSync(target));
  return match.restored_exactly
   ?safeReport('ZC06C_REHEARSAL_EXACT_RESTORE_PASS',{restored_exactly:true})
   :hold('RESTORE_BYTES_MISMATCH');
 }catch{return hold('RECOVERY_UNCERTAIN');}
}

/** Explicitly synthetic fault injection. Never takes a settings path. */
export function rehearseReversiblePolicy({
 originalBytes=Buffer.from('{"toolPermission":"request-review"}\n','utf8'),
 failureAt=null,concurrentChange=false,corruptBackup=false,
}={}){
 if(!Buffer.isBuffer(originalBytes))return hold('INVALID_SYNTHETIC_SEED');
 if(![null,'AFTER_BACKUP','AFTER_APPLY','BEFORE_RESTORE'].includes(failureAt))
  return hold('INVALID_FAULT_POINT');
 const plan=planRestrictedPolicy(originalBytes);
 if(plan.gate!=='ZC06C_OFFLINE_POLICY_PLAN_ONLY')
  return hold('INVALID_SYNTHETIC_POLICY');
 let root;
 try {
  root=fs.mkdtempSync(path.join(os.tmpdir(),'zc06c-rehearsal-'));
  fs.chmodSync(root,0o700);
  const settings=path.join(root,'settings.synthetic.json');
  safeWriteNew(settings,Buffer.from(originalBytes));
  safeWriteNew(path.join(root,'backup.original'),Buffer.from(originalBytes));
  writeJournal(root,plan.original_sha256,plan.temporary_sha256,'PREPARED');
  if(failureAt==='AFTER_BACKUP')
    return {...recoverFixture(root),failure_injected:true};
  const current=fs.readFileSync(settings);
  if(hash(current)!==plan.original_sha256)
    return hold('SOURCE_CHANGED_BEFORE_SWAP');
  writeJournal(root,plan.original_sha256,plan.temporary_sha256,'APPLYING');
  atomicPut(settings,plan.temporaryBytes);
  const installed=fs.readFileSync(settings);
  if(hash(installed)!==plan.temporary_sha256)
    return hold('RESTRICTED_BYTES_MISMATCH');
  writeJournal(root,plan.original_sha256,plan.temporary_sha256,'RESTRICTED');
  if(concurrentChange)atomicPut(settings,Buffer.from('{"changed":"external"}\n'));
  if(corruptBackup)atomicPut(path.join(root,'backup.original'),Buffer.from('corrupt\n'));
  const interrupted=failureAt==='AFTER_APPLY'||failureAt==='BEFORE_RESTORE';
  const restored=recoverFixture(root);
  return {...restored,failure_injected:interrupted,simulated_crash_recovery:interrupted};
 }catch{
  return hold('SYNTHETIC_IO_OR_TRANSACTION_UNCERTAIN');
 }finally{
  // All files belong to a freshly created temporary fixture in our process.
  // Never delete anything from HOME or an operator-supplied path.
  if(root){
   try{fs.rmSync(root,{recursive:true,force:true,maxRetries:1});}
   catch{/* leftover synthetic data => HOLD is still reported on next run */}
  }
 }
}
