import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {executeMacPolicyTrial,noMacAcl} from '../zc06c-mac-policy-transaction.mjs';
import {planRestrictedPolicy} from '../zc06c-policy-plan.mjs';

const original=Buffer.from('{\n  "toolPermission":"request-review",\n  "theme":"fixture"\n}\n');
function fixture(fn){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'zc06c-mactx-test-'));
 fs.chmodSync(home,0o700);
 const dir=path.join(home,'.gemini','antigravity-cli');
 fs.mkdirSync(dir,{recursive:true,mode:0o700});
 fs.chmodSync(path.join(home,'.gemini'),0o700);
 fs.chmodSync(dir,0o700);
 const file=path.join(dir,'settings.json');
 fs.writeFileSync(file,original,{mode:0o600});
 const opts={home,platform:'darwin',uid:process.getuid?.()??1000,
   ps:()=>({status:0,stdout:'/sbin/launchd\n',stderr:''}),
   // GitHub CI runs on Linux, so simulate the macOS ls -lde format.
   aclScan:()=>({status:0,stdout:'-rw------- 1 owner group 100 Nov 1 00:00 fixture\n'})};
 try{return fn({opts,home,file,dir});}
 finally{fs.rmSync(home,{recursive:true,force:true});}
}
const recovered=r=>assert.equal(r.gate,'ZC06C_MAC_EXACT_RESTORE_CONFIRMED');
test('MT01 temporary real fixture config is byte-identically restored',()=>fixture(({opts,file,dir})=>{
 const before=fs.readFileSync(file);
 const r=executeMacPolicyTrial(opts);
 recovered(r);
 assert.equal(r.model_invoked,false);
 assert.equal(r.credentials_emitted,false);
 assert.equal(fs.readFileSync(file).equals(before),true);
 assert.equal(fs.statSync(file).mode&0o777,0o600);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT02 existing Antigravity desktop process blocks any writes',()=>fixture(({opts,file,dir})=>{
 const before=fs.readFileSync(file);
 const r=executeMacPolicyTrial({...opts,
  ps:()=>({status:0,stdout:'/Applications/Antigravity.app/Contents/MacOS/Antigravity\n'})});
 assert.equal(r.reason,'ANTIGRAVITY_SESSION_OR_PROCESS_UNKNOWN');
 assert.equal(fs.readFileSync(file).equals(before),true);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT03 an active agy CLI session blocks modification',()=>fixture(({opts})=>{
 const r=executeMacPolicyTrial({...opts,
  ps:()=>({status:0,stdout:'/Users/fixture/.local/bin/agy\n'})});
 assert.equal(r.reason,'ANTIGRAVITY_SESSION_OR_PROCESS_UNKNOWN');
}));
test('MT04 failed process inventory cannot claim safe quiescence',()=>fixture(({opts})=>{
 const r=executeMacPolicyTrial({...opts,
  ps:()=>({status:1,stderr:'SYNTHETIC_SECRET'})});
 assert.equal(r.reason,'ANTIGRAVITY_SESSION_OR_PROCESS_UNKNOWN');
 assert.equal(JSON.stringify(r).includes('SYNTHETIC_SECRET'),false);
}));
test('MT05 interruption after durable backup recovers without applying',()=>fixture(({opts,dir,file})=>{
 const before=fs.readFileSync(file);
 const r=executeMacPolicyTrial({...opts,
  phaseHook:state=>{if(state==='AFTER_DURABLE_BACKUP')throw Error('simulated abort');}});
 assert.equal(r.gate,'ZC06C_MAC_TRANSACTION_HOLD');
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),true);
 recovered(executeMacPolicyTrial({...opts,recoverOnly:true}));
 assert.equal(fs.readFileSync(file).equals(before),true);
}));
test('MT06 exception after applying restriction restores original',()=>fixture(({opts,file,dir})=>{
 const originalBytes=fs.readFileSync(file);
 const r=executeMacPolicyTrial({...opts,phaseHook:state=>{
  if(state==='AFTER_APPLY')throw Error('simulated after apply abort');
 }});
 recovered(r);
 assert.equal(fs.readFileSync(file).equals(originalBytes),true);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT07 concurrent unknown edit after restriction is never overwritten',()=>fixture(({opts,file,dir})=>{
 const unknown=Buffer.from('{"interleaving":"other actor"}\n');
 const r=executeMacPolicyTrial({...opts,phaseHook:state=>{
  if(state==='AFTER_APPLY')fs.writeFileSync(file,unknown);
 }});
 assert.equal(r.gate,'ZC06C_MAC_TRANSACTION_HOLD');
 assert.equal(r.reason,'RESTRICTED_POLICY_VERIFICATION_FAILED');
 assert.equal(fs.readFileSync(file).equals(unknown),true);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),true);
 const recover=executeMacPolicyTrial({...opts,recoverOnly:true});
 assert.equal(recover.reason,'UNKNOWN_OR_CONCURRENT_SETTINGS_CHANGE');
 assert.equal(fs.readFileSync(file).equals(unknown),true);
}));
test('MT08 nonowner-private config is blocked before backup',()=>fixture(({opts,file,dir})=>{
 fs.chmodSync(file,0o644);
 const r=executeMacPolicyTrial(opts);
 assert.equal(r.reason,'SETTINGS_NOT_OWNER_PRIVATE');
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT09 symlinked settings are not trusted',()=>fixture(({opts,file,dir})=>{
 const real=path.join(dir,'actual.json');
 fs.renameSync(file,real);
 fs.symlinkSync(real,file);
 const r=executeMacPolicyTrial(opts);
 assert.equal(r.gate,'ZC06C_MAC_TRANSACTION_HOLD');
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT10 Linux real CLI execution is hard-blocked',()=>{
 const r=executeMacPolicyTrial({platform:'linux'});
 assert.equal(r.reason,'MAC_NONROOT_ONLY');
});
test('MT11 missing private restore record will not manufacture backup',()=>fixture(({opts})=>{
 assert.equal(executeMacPolicyTrial({...opts,recoverOnly:true}).reason,'NO_RECOVERY_RECORD');
}));
test('MT12 invalid settings billing provider is blocked',()=>fixture(({opts,file,dir})=>{
 fs.writeFileSync(file,'{"modelProvider":"gemini"}\n');
 const r=executeMacPolicyTrial(opts);
 assert.equal(r.reason,'UNSAFE_EXISTING_POLICY');
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT13 direct CLI cannot run model or settings changes with --once',()=>{
 const script=new URL('../zc06c-mac-policy-transaction.mjs',import.meta.url);
 const child=spawnSync(process.execPath,[script.pathname,'--once'],{
  encoding:'utf8',timeout:5000});
 assert.equal(child.status,2);
 assert.equal(JSON.parse(child.stdout).reason,'NO_PROVIDER_TRANSACTION_FLAG_REQUIRED');
});


test('MT14 recovery refuses to change policy while Antigravity desktop is present',()=>fixture(({opts,file,dir})=>{
 const before=fs.readFileSync(file);
 const initial=executeMacPolicyTrial({...opts,
  phaseHook:state=>{if(state==='AFTER_DURABLE_BACKUP')throw Error('synthetic interruption');}});
 assert.equal(initial.gate,'ZC06C_MAC_TRANSACTION_HOLD');
 const blocked=executeMacPolicyTrial({...opts,recoverOnly:true,
  ps:()=>({status:0,stdout:'/Applications/Antigravity.app/Contents/MacOS/Antigravity\n'})});
 assert.equal(blocked.reason,'ANTIGRAVITY_SESSION_OR_PROCESS_UNKNOWN');
 assert.equal(fs.readFileSync(file).equals(before),true);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),true);
 recovered(executeMacPolicyTrial({...opts,recoverOnly:true}));
}));
test('MT15 oversized proposed temporary JSON is rejected before any writes',()=>fixture(({opts,file,dir})=>{
 const baseline=Buffer.from(JSON.stringify({padding:'x'.repeat(130900)})+'\n');
 assert.ok(baseline.length<=131072);
 fs.writeFileSync(file,baseline,{mode:0o600});
 const result=executeMacPolicyTrial(opts);
 assert.equal(result.reason,'TEMPORARY_SETTINGS_TOO_LARGE');
 assert.equal(fs.readFileSync(file).equals(baseline),true);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT16 recovery must not report exact restore when original mode drifted',()=>fixture(({opts,file,dir})=>{
 const result=executeMacPolicyTrial({...opts,phaseHook:state=>{
  if(state==='AFTER_DURABLE_BACKUP'){
   fs.chmodSync(file,0o400);
   throw Error('synthetic unexpected mode change');
  }
 }});
 assert.equal(result.gate,'ZC06C_MAC_TRANSACTION_HOLD');
 const restored=executeMacPolicyTrial({...opts,recoverOnly:true});
 assert.equal(restored.reason,'ORIGINAL_MODE_CHANGED');
 assert.equal(fs.statSync(file).mode&0o777,0o400);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),true);
 fs.chmodSync(file,0o600);
 recovered(executeMacPolicyTrial({...opts,recoverOnly:true}));
}));
test('MT17 restricted settings mode drift prevents automatic overwrite',()=>fixture(({opts,file,dir})=>{
 const res=executeMacPolicyTrial({...opts,phaseHook:state=>{
  if(state==='AFTER_APPLY')fs.chmodSync(file,0o400);
 }});
 assert.equal(res.reason,'RESTRICTED_MODE_CHANGED');
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),true);
 assert.equal(executeMacPolicyTrial({...opts,recoverOnly:true}).reason,'RESTRICTED_MODE_CHANGED');
 fs.chmodSync(file,0o600);
 recovered(executeMacPolicyTrial({...opts,recoverOnly:true}));
}));
test('MT18 app start during transaction blocks restore until quiescent',()=>fixture(({opts,file,dir})=>{
 let appStarted=false;
 const ps=()=>({status:0,stdout:appStarted?
  '/Applications/Antigravity.app/Contents/MacOS/Antigravity\n':
  '/sbin/launchd\n'});
 const before=fs.readFileSync(file);
 const result=executeMacPolicyTrial({...opts,ps,phaseHook:state=>{
  if(state==='AFTER_APPLY')appStarted=true;
 }});
 assert.equal(result.reason,'ANTIGRAVITY_SESSION_OR_PROCESS_UNKNOWN');
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),true);
 appStarted=false;
 recovered(executeMacPolicyTrial({...opts,ps,recoverOnly:true}));
 assert.equal(fs.readFileSync(file).equals(before),true);
}));

test('MT19 macOS ACL marker and entry are rejected before backup',()=>fixture(({opts,dir})=>{
 const result=executeMacPolicyTrial({...opts,
  aclScan:()=>({status:0,stdout:'drwx------+ 1 owner staff 0 Nov 1 00:00 directory\n 0: group:everyone allow read\n'})});
 assert.equal(result.reason,'ACL_UNSAFE_OR_UNVERIFIED');
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT20 denied ACL inspection is not treated as ACL-free',()=>fixture(({opts,dir})=>{
 const result=executeMacPolicyTrial({...opts,
  aclScan:()=>({status:1,stdout:'',stderr:'private synthetic message'})});
 assert.equal(result.reason,'ACL_UNSAFE_OR_UNVERIFIED');
 assert.equal(JSON.stringify(result).includes('private synthetic'),false);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT21 byte-identical restricted JSON is a no-write even with mode 0400',()=>fixture(({opts,file,dir})=>{
 const plan=planRestrictedPolicy(original);
 assert.equal(plan.gate,'ZC06C_OFFLINE_POLICY_PLAN_ONLY');
 fs.writeFileSync(file,plan.temporaryBytes);
 fs.chmodSync(file,0o400);
 const before=fs.readFileSync(file);
 const result=executeMacPolicyTrial(opts);
 assert.equal(result.reason,'POLICY_ALREADY_IDENTICAL_NO_WRITE');
 assert.equal(fs.readFileSync(file).equals(before),true);
 assert.equal(fs.statSync(file).mode&0o777,0o400);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),false);
}));
test('MT22 parsed ACL without plus still rejects inherited ACL entries',()=>{
 assert.equal(noMacAcl('/synthetic',()=>({
  status:0,stdout:'-rw------- 1 owner group 20 Nov 1 00:00 file\n 0: group:everyone allow read\n'
 })),false);
 assert.equal(noMacAcl('/synthetic',()=>({
  status:0,stdout:'-rw------- 1 owner group 20 Nov 1 00:00 file\n'
 })),true);
});
test('MT23 inherited ACL on new private backup fails before writing source bytes',()=>fixture(({opts,dir})=>{
 const result=executeMacPolicyTrial({...opts,aclScan:(_bin,args)=>{
  const file=args[1];
  return {status:0,stdout:path.basename(file)==='original.bytes'
   ?'-rw-------+ 1 owner group 0 Nov 1 00:00 original.bytes\n 0: group:everyone allow read\n'
   :'-rw------- 1 owner group 0 Nov 1 00:00 file\n'};
 }});
 assert.equal(result.gate,'ZC06C_MAC_TRANSACTION_HOLD');
 const backup=path.join(dir,'.zc06c-restore-once','original.bytes');
 // Fail closed: ACL rejection happens before bytes are written. The private
 // marker remains for manual reconciliation; do NOT silently unlink it.
 assert.equal(fs.existsSync(backup),true);
 assert.equal(fs.statSync(backup).size,0);
 assert.equal(fs.existsSync(path.join(dir,'.zc06c-restore-once')),true);
}));


test('MT24 one transient ACL error on restore stage does not strand recovery',()=>fixture(({opts,file,dir})=>{
 let failed=false;
 const before=fs.readFileSync(file);
 const aclScan=(_binary,args)=>{
  const name=path.basename(args[1]);
  if(/^restore\.[0-9a-f]{24}\.tmp$/.test(name)&&!failed){
   failed=true;return {status:1,stdout:'',stderr:'SYNTHETIC_ACL_TIMEOUT'};
  }
  return {status:0,stdout:'-rw------- 1 owner staff 10 Nov 1 00:00 fixture\n'};
 };
 const r=executeMacPolicyTrial({...opts,aclScan});
 assert.equal(failed,true);
 assert.equal(r.reason,'RECOVERY_UNEXPECTED_ENTRIES_RETAINED');
 assert.equal(fs.existsSync(path.join(dir,'settings.zc06c.restore.tmp')),false);
 const tx=path.join(dir,'.zc06c-restore-once');
 assert.equal(fs.existsSync(tx),true);
 assert.ok(fs.readdirSync(tx).some(n=>/^restore\.[0-9a-f]{24}\.tmp$/.test(n)));
 assert.equal(fs.readFileSync(file).equals(before),true);
 assert.equal(JSON.stringify(r).includes('SYNTHETIC_ACL_TIMEOUT'),false);
}));
test('MT25 persistent ACL refusal leaves recoverable backup without bad staging',()=>fixture(({opts,file,dir})=>{
 const before=fs.readFileSync(file);
 const denyRestore=(_binary,args)=>({
  status:/^restore\.[0-9a-f]{24}\.tmp$/.test(path.basename(args[1]))?1:0,
  stdout:'-rw------- 1 owner staff 10 Nov 1 00:00 fixture\n'
 });
 const first=executeMacPolicyTrial({...opts,aclScan:denyRestore});
 assert.equal(first.gate,'ZC06C_MAC_TRANSACTION_HOLD');
 assert.equal(fs.existsSync(path.join(dir,'settings.zc06c.restore.tmp')),false);
 const tx=path.join(dir,'.zc06c-restore-once');
 assert.equal(fs.existsSync(tx),true);
 assert.ok(fs.readdirSync(tx).some(n=>/^restore\.[0-9a-f]{24}\.tmp$/.test(n)));
 const retried=executeMacPolicyTrial({...opts,recoverOnly:true});
 assert.equal(retried.reason,'RECOVERY_UNEXPECTED_ENTRIES_RETAINED');
 assert.equal(fs.existsSync(tx),true);
 assert.equal(fs.existsSync(path.join(tx,'original.bytes')),true);
 assert.equal(fs.readFileSync(file).equals(before),true);
}));

// The failed temporary stage is private and randomized; never delete a
// pathname that an unrelated same-UID writer could have swapped in.
test('MT26 failed random stage preserves a substituted pathname',()=>fixture(({opts,dir})=>{
 const tx=path.join(dir,'.zc06c-restore-once');
 let substituted;
 const aclScan=(_binary,args)=>{
  const name=path.basename(args[1]);
  if(/^restore\.[0-9a-f]{24}\.tmp$/.test(name)){
   if(!substituted){
    substituted=args[1];
    fs.renameSync(substituted,substituted+'.original');
    fs.writeFileSync(substituted,'OTHER_WRITER', {mode:0o600});
   }
   return {status:1,stdout:'',stderr:'ACL_UNAVAILABLE'};
  }
  return {status:0,stdout:'-rw------- 1 owner staff 10 Nov 1 00:00 fixture\n'};
 };
 const before=fs.readFileSync(path.join(dir,'settings.json'));
 const r=executeMacPolicyTrial({...opts,aclScan});
 assert.equal(r.gate,'ZC06C_MAC_TRANSACTION_HOLD');
 assert.equal(fs.readFileSync(substituted,'utf8'),'OTHER_WRITER');
 assert.equal(fs.existsSync(substituted+'.original'),true);
 assert.equal(fs.existsSync(path.join(tx,'original.bytes')),true);
 const retried=executeMacPolicyTrial({...opts,recoverOnly:true});
 assert.equal(retried.reason,'RECOVERY_UNEXPECTED_ENTRIES_RETAINED');
 assert.equal(fs.readFileSync(path.join(dir,'settings.json')).equals(before),true);
 assert.equal(fs.readFileSync(substituted,'utf8'),'OTHER_WRITER');
 assert.equal(fs.existsSync(substituted+'.original'),true);
 assert.equal(fs.existsSync(path.join(tx,'original.bytes')),true);
 assert.equal(fs.existsSync(path.join(tx,'manifest.json')),true);
}));

test('MT27 unrelated file within recovery directory must not be removed on exact restore',()=>fixture(({opts,file,dir})=>{
 const tx=path.join(dir,'.zc06c-restore-once');
 const before=fs.readFileSync(file);
 const unrelated=path.join(tx,'OTHER_WRITER_FILE');
 const r=executeMacPolicyTrial({...opts,phaseHook:state=>{
  if(state==='AFTER_APPLY')fs.writeFileSync(unrelated,'UNTRUSTED_PAYLOAD',{mode:0o600});
 }});
 assert.equal(r.reason,'RECOVERY_UNEXPECTED_ENTRIES_RETAINED');
 assert.equal(fs.readFileSync(file).equals(before),true);
 assert.equal(fs.readFileSync(unrelated,'utf8'),'UNTRUSTED_PAYLOAD');
 assert.equal(fs.existsSync(path.join(tx,'original.bytes')),true);
 assert.equal(fs.existsSync(path.join(tx,'manifest.json')),true);
 const again=executeMacPolicyTrial({...opts,recoverOnly:true});
 assert.equal(again.reason,'RECOVERY_UNEXPECTED_ENTRIES_RETAINED');
 assert.equal(fs.readFileSync(unrelated,'utf8'),'UNTRUSTED_PAYLOAD');
 assert.equal(fs.existsSync(path.join(tx,'original.bytes')),true);
}));
