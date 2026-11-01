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
// Read-only macOS ACL check: if 'ls -lde' cannot be parsed, fail closed.
// A BSD 0600 mode alone does not exclude inheritable ACL grants.
export const noMacAcl=(file,aclScan=spawnSync)=>{
 try{
  const r=aclScan('/bin/ls',['-lde',file],{
   encoding:'utf8',timeout:4000,maxBuffer:16384,shell:false,input:'',
   env:{PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},
  });
  if(r.status!==0||r.error||r.signal||typeof r.stdout!=='string')return false;
  const lines=r.stdout.split(/\r?\n/).filter(Boolean);
  const token=lines[0]?.trim().split(/\s+/)[0];
  if(!token||token.length<10||token.length>12||
     !['-','d','l'].includes(token[0])||token.includes('+'))return false;
  if(lines.slice(1).some(x=>/^\s*\d+:/.test(x)))return false;
  return true;
 }catch{return false;}
};

const syncDir=dir=>{
 const fd=fs.openSync(dir,'r');
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
};
const newFile=(dir,name,bytes,mode=0o600,aclScan=spawnSync)=>{
 const dest=path.join(dir,name);
 const fd=fs.openSync(dest,fs.constants.O_WRONLY|fs.constants.O_CREAT|
   fs.constants.O_EXCL|(fs.constants.O_NOFOLLOW||0),mode);
 try{
  fs.fchmodSync(fd,mode);
  if(!noMacAcl(dest,aclScan))throw Error('INHERITED_ACL_UNTRUSTED');
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
// Never unlink a failed staging pathname. Keep it inside the private
// transaction directory, where a future recovery can use a NEW random name.
// Only after original settings are fully restored do we remove this directory.
const atomicReplace=(txRoot,destDir,stagePrefix,finalName,bytes,mode,aclScan)=>{
 const stage=stagePrefix+'.'+crypto.randomBytes(12).toString('hex')+'.tmp';
 newFile(txRoot,stage,bytes,mode,aclScan);
 fs.renameSync(path.join(txRoot,stage),path.join(destDir,finalName));
 syncDir(txRoot);
 syncDir(destDir);
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
    (st.uid!==0&&st.uid!==uid)||
    ((st.mode&0o022)!==0&&!(st.uid===0&&(st.mode&0o1000)!==0)))
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
const restore=(dir,uid,ps,aclScan)=>{
 if(!processQuiescent({ps}))return hold('ANTIGRAVITY_SESSION_OR_PROCESS_UNKNOWN');
 const root=path.join(dir,TX);
 for(const file of [root,path.join(root,BACKUP),path.join(root,MANIFEST),
                    path.join(dir,SETTINGS)]){
  if(!noMacAcl(file,aclScan))return hold('ACL_UNSAFE_OR_UNVERIFIED');
 }
 const m=readManifest(root,uid);
 const saved=fs.readFileSync(path.join(root,BACKUP));
 if(sha(saved)!==m.originalHash)return hold('BACKUP_HASH_MISMATCH');
 const currentState=assertSettings(dir,uid);
 const current=currentState.bytes;
 const currentHash=sha(current);
 if(currentHash===m.originalHash){
  if(currentState.mode!==m.mode)return hold('ORIGINAL_MODE_CHANGED');
  // Source already exact. Only cleanup after exact restore verified.
  if(!verifyRestore(saved,current).restored_exactly)
    return hold('ORIGINAL_BYTES_MISMATCH');
  cleanRecovery(dir,root,uid);
  return result('ZC06C_MAC_EXACT_RESTORE_CONFIRMED',
    {restore:'ORIGINAL_ALREADY_PRESENT'});
 }
 if(currentHash!==m.restrictedHash)
  return hold('UNKNOWN_OR_CONCURRENT_SETTINGS_CHANGE');
 if(currentState.mode!==0o600)return hold('RESTRICTED_MODE_CHANGED');
 if(fs.existsSync(path.join(dir,RESTORING)))
  return hold('UNKNOWN_RESTORE_STAGING_FILE');
 // A final check closes only observable windows. Another noncooperating
 // writer CAN still change the target before rename; there is no atomic CAS.
 if(sha(assertSettings(dir,uid).bytes)!==m.restrictedHash)
  return hold('SETTINGS_CHANGED_BEFORE_RESTORE');
 atomicReplace(root,dir,'restore',SETTINGS,saved,m.mode,aclScan);
 if(!noMacAcl(path.join(dir,SETTINGS),aclScan))return hold('RESTORED_ACL_UNVERIFIED');
 const observed=assertSettings(dir,uid);
 if(!verifyRestore(saved,observed.bytes).restored_exactly||
    observed.mode!==m.mode)return hold('RESTORE_VERIFICATION_FAILED');
 cleanRecovery(dir,root,uid);
 return result('ZC06C_MAC_EXACT_RESTORE_CONFIRMED',
  {restore:'FROM_PRIVATE_BACKUP'});
};
export function executeMacPolicyTrial({
 home=os.homedir(),platform=process.platform,uid=process.getuid?.(),
 ps=spawnSync,aclScan=spawnSync,recoverOnly=false,phaseHook=()=>{},
}={}){
 if(platform!=='darwin'||!Number.isInteger(uid)||uid===0)
  return hold('MAC_NONROOT_ONLY');
 let dir,root,settingsReplaced=false;
 try{
  dir=ensureDirs(home,uid);
  // Include system/home ancestry, config parent directories and original file.
  let ancestor=path.parse(home).root;
  const checked=[ancestor];
  for(const part of home.slice(ancestor.length).split(path.sep)){
   if(part){ancestor=path.join(ancestor,part);checked.push(ancestor);}
  }
  checked.push(path.join(home,'.gemini'),dir,path.join(dir,SETTINGS));
  if(!checked.every(p=>noMacAcl(p,aclScan)))
   return hold('ACL_UNSAFE_OR_UNVERIFIED');
  root=path.join(dir,TX);
  if(recoverOnly){
   if(!fs.existsSync(root))return hold('NO_RECOVERY_RECORD');
   return restore(dir,uid,ps,aclScan);
  }
  if(fs.existsSync(root)||fs.existsSync(path.join(dir,APPLIED))||
     fs.existsSync(path.join(dir,RESTORING)))
   return hold('PENDING_RECOVERY_OR_UNKNOWN_STAGING');
  if(!processQuiescent({ps}))
   return hold('ANTIGRAVITY_SESSION_OR_PROCESS_UNKNOWN');
  const baseline=assertSettings(dir,uid);
  // Never propagate an existing overly exposed config to staging/backups.
  if((baseline.mode&0o077)!==0)return hold('SETTINGS_NOT_OWNER_PRIVATE');
  const plan=planRestrictedPolicy(baseline.bytes);
  if(plan.gate!=='ZC06C_OFFLINE_POLICY_PLAN_ONLY')
   return hold('UNSAFE_EXISTING_POLICY');
  // The restricted JSON can be larger than the valid original input.
  // Never install bytes that our own bounded recovery cannot inspect.
  if(plan.temporary_bytes>131072)return hold('TEMPORARY_SETTINGS_TOO_LARGE');
  // Do not replace an identical policy: doing so can alter a 0400 baseline.
  if(plan.original_sha256===plan.temporary_sha256)
   return hold('POLICY_ALREADY_IDENTICAL_NO_WRITE');
  // Restrict writable configuration file to owner. Preserve original mode.
  fs.mkdirSync(root,{mode:0o700});
  syncDir(dir);
  if(!noMacAcl(root,aclScan))return hold('ACL_UNSAFE_OR_UNVERIFIED');
  newFile(root,BACKUP,baseline.bytes,0o600,aclScan);
  newFile(root,MANIFEST,manifestBytes({
   protocol:'ZC06C_MAC_NO_PROVIDER_V1',noProvider:true,
   originalHash:plan.original_sha256,restrictedHash:plan.temporary_sha256,
   mode:baseline.mode,
  }),0o600,aclScan);
  phaseHook('AFTER_DURABLE_BACKUP',{dir});
  if(!processQuiescent({ps}))return hold('PROCESS_STARTED_BEFORE_APPLY');
  const current=assertSettings(dir,uid);
  if(current.ino!==baseline.ino||current.mode!==baseline.mode||
    sha(current.bytes)!==plan.original_sha256)
   return hold('SETTINGS_CHANGED_BEFORE_APPLY');
  // This script intentionally does not invoke model, tools, API, or CLI.
  atomicReplace(root,dir,'apply',SETTINGS,plan.temporaryBytes,0o600,aclScan);
  if(!noMacAcl(path.join(dir,SETTINGS),aclScan))return hold('APPLIED_ACL_UNVERIFIED');
  settingsReplaced=true;
  phaseHook('AFTER_APPLY',{dir});
  if(sha(assertSettings(dir,uid).bytes)!==plan.temporary_sha256)
   return hold('RESTRICTED_POLICY_VERIFICATION_FAILED');
  return restore(dir,uid,ps,aclScan);
 }catch{
  // When possible, restore now; if uncertain, leave the durable private
  // backup/manifest for explicit --recover-only. Never overwrite unknown edits.
  if(settingsReplaced&&dir&&root){
   try{return restore(dir,uid,ps,aclScan);}
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
