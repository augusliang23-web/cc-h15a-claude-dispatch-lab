// ZC-06C one-time NO-PROVIDER settings transaction.
// Live CLI ONLY --apply-and-restore or --recover-only. Neither starts AgY.
// Owner must close Antigravity first. No arbitrary path arguments on CLI.
// This is an experimental fail-closed updater, not an OS sandbox or daemon.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {planRestrictedPolicy,verifyRestore} from './zc06c-policy-plan.mjs';

const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const TX='.zc06c-restore-once';
const BACKUP='original.bytes';
const MANIFEST='manifest.json';
const SETTINGS='settings.json';
const APPLIED='settings.zc06c.tmp';
const RESTORING='settings.zc06c.restore.tmp';
const hold=reason=>({gate:'ZC06C_MAC_TRANSACTION_HOLD',reason,
 model_invoked:false,credentials_emitted:false});
const result=(gate,extra={})=>({gate,model_invoked:false,credentials_emitted:false,...extra});
const safeStat=(file,uid,kind='file')=>{
 const st=fs.lstatSync(file);
 if(st.isSymbolicLink()||!(kind==='dir'?st.isDirectory():st.isFile())||
   st.uid!==uid||(st.mode&0o022)!==0)
  throw Error('UNTRUSTED_PATH');
 if(kind==='file'&&(st.size<=0||st.size>131072))throw Error('INVALID_FILE_SIZE');
 return st;
};
const syncDir=dir=>{
 const fd=fs.openSync(dir,'r');
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
};
const newFile=(dir,name,bytes,mode=0o600)=>{
 const dest=path.join(dir,name);
 const fd=fs.openSync(dest,fs.constants.O_WRONLY|fs.constants.O_CREAT|
   fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),mode);
 try{
  let offset=0;
  while(offset<bytes.length){
   const wrote=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);
   if(wrote<=0)throw Error('SHORT_WRITE');
   offset+=wrote;
  }
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
 syncDir(dir);
};
const atomicReplace=(dir,tempName,finalName,bytes,mode)=>{
 newFile(dir,tempName,bytes,mode);
 fs.renameSync(path.join(dir,tempName),path.join(dir,finalName));
 syncDir(dir);
};
const ensureDirs=(home,uid)=>{
 // This live test supports a regular user home; it deliberately refuses
 // symlinks, untrusted owners, nonstandard aliases and writable ancestors.
 const parsed=path.parse(home);
 if(!path.isAbsolute(home)||parsed.root!==path.sep)throw Error('HOME_INVALID');
 let current=parsed.root;
 for(const part of home.slice(parsed.root.length).split(path.sep)){
  if(!part||part==='.'||part==='..')throw Error('HOME_INVALID_COMPONENT');
  current=path.join(current,part);
  const st=fs.lstatSync(current);
  if(st.isSymbolicLink()||!st.isDirectory()||
    (st.uid!==0&&st.uid!==uid)||(st.mode&0o022)!==0)
    throw Error('HOME_UNTRUSTED_ANCESTOR');
 }
 const settingsRoot=path.join(home,'.gemini','antigravity-cli');
 for(const d of [home,path.join(home,'.gemini'),settingsRoot]){
  safeStat(d,uid,'dir');
 }
 return settingsRoot;
};
const assertSettings=(dir,uid)=>{
 const file=path.join(dir,SETTINGS);
 const st=safeStat(file,uid);
 const bytes=fs.readFileSync(file);
 if(bytes.length!==st.size)throw Error('SETTINGS_CHANGED');
 return {bytes,mode:st.mode&0o777,ino:st.ino,uid:st.uid};
};
const processQuiescent=({ps=spawnSync}={})=>{
 const r=ps('/bin/ps',['-axo','comm='],{
  encoding:'utf8',timeout:4000,maxBuffer:262144,shell:false,input:'',
  env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'}
 });
 if(r.status!==0||r.error||r.signal||typeof r.stdout!=='string')
  return false;
 // A conservative check: even an idle Antigravity desktop window blocks
 // a temporary global CLI settings change. Never kill processes for owner.
 const names=r.stdout.split(/\r?\n/).map(x=>path.basename(x.trim()).toLowerCase());
 return !names.some(x=>x==='agy'||x==='agy-cli'||
  x.includes('antigravity'));
};
const manifestBytes=o=>Buffer.from(JSON.stringify(o)+'\n','utf8');
const readManifest=(root,uid)=>{
 safeStat(root,uid,'dir');
 const st=safeStat(path.join(root,MANIFEST),uid);
 if((st.mode&0o077)!==0)throw Error('MANIFEST_EXPOSED');
 const val=JSON.parse(fs.readFileSync(path.join(root,MANIFEST),'utf8'));
 if(!val||val.protocol!=='ZC06C_MAC_NO_PROVIDER_V1'||
   val.noProvider!==true||
   !/^[0-9a-f]{64}$/.test(val.originalHash)||
   !/^[0-9a-f]{64}$/.test(val.restrictedHash)||
   !Number.isInteger(val.mode)||val.mode<0||val.mode>0o777)
   throw Error('MANIFEST_INVALID');
 return val;
};
const cleanRecovery=(dir,root,uid)=>{
 safeStat(root,uid,'dir');
 for(const name of [MANIFEST,BACKUP]){
  safeStat(path.join(root,name),uid);
 }
 fs.rmSync(root,{recursive:true,force:false});
 syncDir(dir);
};
const restore=(dir,uid)=>{
 const root=path.join(dir,TX);
 const m=readManifest(root,uid);
 const saved=fs.readFileSync(path.join(root,BACKUP));
 if(sha(saved)!==m.originalHash)return hold('BACKUP_HASH_MISMATCH');
 const current=assertSettings(dir,uid).bytes;
 const currentHash=sha(current);
 if(currentHash===m.originalHash){
  // Source already exact. Only cleanup after exact restore verified.
  if(!verifyRestore(saved,current).restored_exactly)
    return hold('ORIGINAL_BYTES_MISMATCH');
  cleanRecovery(dir,root,uid);
  return result('ZC06C_MAC_EXACT_RESTORE_CONFIRMED',
    {restore:'ORIGINAL_ALREADY_PRESENT'});
 }
 if(currentHash!==m.restrictedHash)
  return hold('UNKNOWN_OR_CONCURRENT_SETTINGS_CHANGE');
 if(fs.existsSync(path.join(dir,RESTORING)))
  return hold('UNKNOWN_RESTORE_STAGING_FILE');
 // A final check closes only observable windows. Another noncooperating
 // writer CAN still change the target before rename; there is no atomic CAS.
 if(sha(assertSettings(dir,uid).bytes)!==m.restrictedHash)
  return hold('SETTINGS_CHANGED_BEFORE_RESTORE');
 atomicReplace(dir,RESTORING,SETTINGS,saved,m.mode);
 const observed=assertSettings(dir,uid);
 if(!verifyRestore(saved,observed.bytes).restored_exactly||
    observed.mode!==m.mode)return hold('RESTORE_VERIFICATION_FAILED');
 cleanRecovery(dir,root,uid);
 return result('ZC06C_MAC_EXACT_RESTORE_CONFIRMED',
  {restore:'FROM_PRIVATE_BACKUP'});
};
export function executeMacPolicyTrial({
 home=os.homedir(),platform=process.platform,uid=process.getuid?.(),
 ps=spawnSync,recoverOnly=false,
}={}){
 if(platform!=='darwin'||!Number.isInteger(uid)||uid===0)
  return hold('MAC_NONROOT_ONLY');
 let dir,root,settingsReplaced=false;
 try{
  dir=ensureDirs(home,uid);
  root=path.join(dir,TX);
  if(recoverOnly){
   if(!fs.existsSync(root))return hold('NO_RECOVERY_RECORD');
   return restore(dir,uid);
  }
  if(fs.existsSync(root)||fs.existsSync(path.join(dir,APPLIED))||
     fs.existsSync(path.join(dir,RESTORING)))
   return hold('PENDING_RECOVERY_OR_UNKNOWN_STAGING');
  if(!processQuiescent({ps}))
   return hold('ANTIGRAVITY_SESSION_OR_PROCESS_UNKNOWN');
  const baseline=assertSettings(dir,uid);
  const plan=planRestrictedPolicy(baseline.bytes);
  if(plan.gate!=='ZC06C_OFFLINE_POLICY_PLAN_ONLY')
   return hold('UNSAFE_EXISTING_POLICY');
  // Restrict writable configuration file to owner. Preserve original mode.
  fs.mkdirSync(root,{mode:0o700});
  syncDir(dir);
  newFile(root,BACKUP,baseline.bytes);
  newFile(root,MANIFEST,manifestBytes({
   protocol:'ZC06C_MAC_NO_PROVIDER_V1',noProvider:true,
   originalHash:plan.original_sha256,restrictedHash:plan.temporary_sha256,
   mode:baseline.mode,
  }));
  if(!processQuiescent({ps}))return hold('PROCESS_STARTED_BEFORE_APPLY');
  const current=assertSettings(dir,uid);
  if(current.ino!==baseline.ino||current.mode!==baseline.mode||
    sha(current.bytes)!==plan.original_sha256)
   return hold('SETTINGS_CHANGED_BEFORE_APPLY');
  // This script intentionally does not invoke model, tools, API, or CLI.
  atomicReplace(dir,APPLIED,SETTINGS,plan.temporaryBytes,baseline.mode);
  settingsReplaced=true;
  if(sha(assertSettings(dir,uid).bytes)!==plan.temporary_sha256)
   return hold('RESTRICTED_POLICY_VERIFICATION_FAILED');
  return restore(dir,uid);
 }catch{
  // When possible, restore now; if uncertain, leave the durable private
  // backup/manifest for explicit --recover-only. Never overwrite unknown edits.
  if(settingsReplaced&&dir&&root){
   try{return restore(dir,uid);}
   catch{return hold('RECOVERY_NEEDED_AFTER_FAILURE');}
  }
  return hold('PREFLIGHT_OR_TRANSACTION_FAILURE');
 }
}
function sameEntrypoint(entry,url){
 try{return typeof entry==='string'&&
   fs.realpathSync(path.resolve(entry))===fs.realpathSync(fileURLToPath(url));}
 catch{return false;}
}
if(sameEntrypoint(process.argv[1],import.meta.url)){
 const action=process.argv.length===3?process.argv[2]:'';
 const ans=action==='--apply-and-restore'
   ?executeMacPolicyTrial()
   :action==='--recover-only'
     ?executeMacPolicyTrial({recoverOnly:true})
     :hold('NO_PROVIDER_TRANSACTION_FLAG_REQUIRED');
 process.stdout.write(JSON.stringify(ans)+'\n');
 if(ans.gate!=='ZC06C_MAC_EXACT_RESTORE_CONFIRMED')process.exitCode=2;
}
