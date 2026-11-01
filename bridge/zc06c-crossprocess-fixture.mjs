// ZC-06C: synthetic, cross-process recovery experiment. NOT a settings updater.
// Only accepts its own freshly minted 0700 temp fixture carrying a marker.
// No HOME access, AgY provider call, model invocation, or service credentials.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {planRestrictedPolicy} from './zc06c-policy-plan.mjs';

const PREFIX='zc06c-crossproc-';
const markerName='synthetic.fixture';
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const response=(gate,reason)=>({
 gate,reason,synthetic:true,settings_modified:false,model_called:false,
});
const fail=reason=>response('ZC06C_CROSSPROC_HOLD',reason);
const syncDir=root=>{const fd=fs.openSync(root,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}};
const newFile=(root,name,bytes)=>{
 const f=path.join(root,name);
 const fd=fs.openSync(f,'wx',0o600);
 try{
  const n=fs.writeSync(fd,bytes,0,bytes.length,0);
  if(n!==bytes.length)throw Error('SHORT_WRITE');
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 syncDir(root);
};
const replace=(root,target,bytes,staged)=>{
 newFile(root,staged,bytes);
 fs.renameSync(path.join(root,staged),path.join(root,target));
 syncDir(root);
};
function trustedRoot(root) {
 if(typeof root!=='string'||!path.isAbsolute(root))return false;
 const prefix=path.join(fs.realpathSync(os.tmpdir()),PREFIX);
 if(!root.startsWith(prefix)||path.dirname(root)!==path.dirname(prefix))return false;
 const st=fs.lstatSync(root);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||
    (typeof process.getuid==='function'&&st.uid!==process.getuid()))return false;
 const m=fs.lstatSync(path.join(root,markerName));
 if(!m.isFile()||m.isSymbolicLink()||(m.mode&0o077)!==0)return false;
 const value=fs.readFileSync(path.join(root,markerName),'utf8');
 return value==='ZC06C_SYNTHETIC_FIXTURE_V1\n';
}
function secureRead(root,name) {
 const file=path.join(root,name),st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)!==0||
    (typeof process.getuid==='function'&&st.uid!==process.getuid())||
    st.size>131072)throw Error('UNTRUSTED_FIXTURE_FILE');
 return fs.readFileSync(file);
}
function readJournal(root){
 const j=JSON.parse(secureRead(root,'journal.json').toString('utf8'));
 if(!j||j.synthetic!==true||
    !['PREPARED','APPLYING','APPLIED','RECOVERING'].includes(j.state)||
    !/^[0-9a-f]{64}$/.test(j.original)||
    !/^[0-9a-f]{64}$/.test(j.restricted))
  throw Error('JOURNAL_INVALID');
 return j;
}
function journalWrite(root,j){
 replace(root,'journal.json',Buffer.from(JSON.stringify(j)+'\n'),
  'journal.next');
}
export function createSyntheticFixture({
 originalBytes=Buffer.from('{"toolPermission":"request-review"}\n'),
}={}){
 if(!Buffer.isBuffer(originalBytes))return fail('INVALID_INPUT');
 const plan=planRestrictedPolicy(originalBytes);
 if(plan.gate!=='ZC06C_OFFLINE_POLICY_PLAN_ONLY')return fail('INVALID_PLAN');
 let root;
 try{
  root=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),PREFIX));
  fs.chmodSync(root,0o700);
  newFile(root,markerName,Buffer.from('ZC06C_SYNTHETIC_FIXTURE_V1\n'));
  newFile(root,'settings.synthetic.json',Buffer.from(originalBytes));
  newFile(root,'backup.original',Buffer.from(originalBytes));
  newFile(root,'restricted.synthetic',Buffer.from(plan.temporaryBytes));
  newFile(root,'journal.json',Buffer.from(JSON.stringify({
   synthetic:true,state:'PREPARED',original:plan.original_sha256,
   restricted:plan.temporary_sha256
  })+'\n'));
  return {gate:'ZC06C_CROSSPROC_FIXTURE_CREATED',root,synthetic:true};
 }catch{
  if(root){try{fs.rmSync(root,{recursive:true,force:true});}catch{}}
  return fail('FIXTURE_CREATION_FAILED');
 }
}
export function simulateSyntheticApply(root){
 try{
  if(!trustedRoot(root))return fail('UNTRUSTED_FIXTURE_ROOT');
  const j=readJournal(root);
  if(j.state!=='PREPARED')return fail('NOT_PREPARED');
  if(sha(secureRead(root,'settings.synthetic.json'))!==j.original||
     sha(secureRead(root,'backup.original'))!==j.original||
     sha(secureRead(root,'restricted.synthetic'))!==j.restricted)
    return fail('SOURCE_CHANGED');
  journalWrite(root,{...j,state:'APPLYING'});
  if(sha(secureRead(root,'settings.synthetic.json'))!==j.original)
    return fail('SOURCE_CHANGED_DURING_PREPARATION');
  replace(root,'settings.synthetic.json',secureRead(root,'restricted.synthetic'),'apply.next');
  journalWrite(root,{...j,state:'APPLIED'});
  return response('ZC06C_CROSSPROC_SYNTHETIC_APPLIED','SIMULATED_ONLY');
 }catch{return fail('SYNTHETIC_APPLY_UNCERTAIN');}
}
export function recoverSyntheticFixture(root,{beforeFinalCheck}={}){
 try{
  if(!trustedRoot(root))return fail('UNTRUSTED_FIXTURE_ROOT');
  const j=readJournal(root);
  const backup=secureRead(root,'backup.original');
  if(sha(backup)!==j.original)return fail('BACKUP_CHANGED');
  const settings=secureRead(root,'settings.synthetic.json');
  if(sha(settings)===j.original)return response(
   'ZC06C_CROSSPROC_EXACT_BYTES_RESTORED','ORIGINAL_PRESENT');
  if(sha(settings)!==j.restricted)return fail('CONCURRENT_OR_UNKNOWN_SETTINGS_CHANGE');
  journalWrite(root,{...j,state:'RECOVERING'});
  // Best-effort final check detects edits between initial inspection and
  // preparation. This is NOT an atomic compare-and-swap: noncooperating
  // writers can still race after this check.
  if(typeof beforeFinalCheck==='function')beforeFinalCheck(root);
  const latest=secureRead(root,'settings.synthetic.json');
  if(sha(latest)!==j.restricted)return fail('CONCURRENT_OR_UNKNOWN_SETTINGS_CHANGE');
  replace(root,'settings.synthetic.json',backup,'restore.next');
  if(!secureRead(root,'settings.synthetic.json').equals(backup))
    return fail('RESTORE_MISMATCH');
  return response('ZC06C_CROSSPROC_EXACT_BYTES_RESTORED','RECOVERED_FROM_BACKUP');
 }catch{return fail('RECOVERY_UNCERTAIN');}
}
export function disposeSyntheticFixture(root){
 try{
  if(!trustedRoot(root))return false;
  fs.rmSync(root,{recursive:true,force:true});
  return true;
 }catch{return false;}
}
