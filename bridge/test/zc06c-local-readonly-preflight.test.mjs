import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {REQUIRED_DENY} from '../zc06c-single-model.mjs';
import {classifyProcessCommands,inspectReadOnly} from '../zc06c-local-readonly-preflight.mjs';

function fixture(fn){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'zc06c-readonly-'));
 fs.chmodSync(home,0o700);
 try{
  fs.mkdirSync(path.join(home,'.local','bin'),{recursive:true,mode:0o700});
  fs.mkdirSync(path.join(home,'.gemini','antigravity-cli'),{recursive:true,mode:0o700});
  fs.writeFileSync(path.join(home,'.local','bin','agy'),
   Buffer.from('#!/bin/sh\nexit 1\n'),{mode:0o700});
  fs.writeFileSync(path.join(home,'.gemini','antigravity-cli','settings.json'),
   Buffer.from(JSON.stringify({toolPermission:'request-review',
    permissions:{deny:REQUIRED_DENY}})),{mode:0o600});
  return fn(home);
 }finally{fs.rmSync(home,{recursive:true,force:true});}
}
test('RO01 report recognizes process names without leaking raw commands',()=>fixture(home=>{
 const secret='--token PRIVATE_TEST_SECRET';
 let args;
 const ps=(cmd,argv,options)=>{
  args={cmd,argv,options};
  return {status:0,
   stdout:'/Applications/Antigravity.app/Contents/MacOS/Antigravity\nagy\nsomething '+secret+'\n',
   stderr:''};
 };
 const r=inspectReadOnly({platform:'darwin',home,ps});
 assert.equal(r.gate,'ZC06C_LOCAL_READONLY_PREFLIGHT');
 assert.equal(r.agy_process,'PRESENT');
 assert.equal(r.antigravity_process,'PRESENT');
 assert.equal(JSON.stringify(r).includes(secret),false);
 assert.equal(args.cmd,'/bin/ps');
 assert.deepEqual(args.argv,['-axo','comm=']);
 assert.equal(args.options.shell,false);
 assert.equal(r.settings_modified,false);
 assert.equal(r.model_invoked,false);
 assert.equal(r.authorized_to_execute,false);
}));
test('RO02 Mac config and executable checks remain no-go',()=>fixture(home=>{
 const r=inspectReadOnly({platform:'darwin',home,
  ps:()=>({status:0,stdout:'/usr/bin/launchd\n'})});
 assert.equal(r.cli,'OWNER_TRUST_CHECK_PASS');
 assert.equal(r.policy,'DECLARED_DENIES_PRESENT');
 assert.equal(r.effective_tool_deny_verified,false);
 assert.equal(r.account_billing_attested,false);
}));
test('RO03 missing Deny is HOLD',()=>fixture(home=>{
 fs.writeFileSync(path.join(home,'.gemini','antigravity-cli','settings.json'),'{}');
 const r=inspectReadOnly({platform:'darwin',home,
  ps:()=>({status:0,stdout:''})});
 assert.equal(r.policy,'DENIES_MISSING_OR_UNTRUSTED');
 assert.equal(r.authorized_to_execute,false);
}));
test('RO04 errors never expose raw stderr',()=>fixture(home=>{
 const secret='VERY_PRIVATE_TEST_SECRET';
 const r=inspectReadOnly({platform:'darwin',home,
  ps:()=>({status:1,stdout:'',stderr:secret})});
 assert.equal(r.process_inventory,'NOT_READ');
 assert.equal(JSON.stringify(r).includes(secret),false);
}));
test('RO05 oversized process output discarded',()=>{
 const out=classifyProcessCommands('agy\n'.repeat(70000));
 assert.equal(out.inventory,'UNAVAILABLE');
 assert.equal(out.agy,'UNKNOWN');
});
test('RO06 process inventory errors do not imply absence',()=>fixture(home=>{
 const r=inspectReadOnly({platform:'darwin',home,ps:()=>{throw Error('secret');}});
 assert.equal(r.agy_process,'UNKNOWN');
 assert.equal(r.antigravity_process,'UNKNOWN');
 assert.equal(r.process_inventory,'NOT_READ');
}));
test('RO07 Linux cannot claim eligible Mac session',()=>{
 const r=inspectReadOnly({platform:'linux',ps:()=>{throw Error('should not call');}});
 assert.equal(r.reason,'PLATFORM_OR_USER_HOLD');
 assert.equal(r.authorized_to_execute,false);
});
test('RO08 unsupported args cannot invoke model or change settings',()=>{
 const src=new URL('../zc06c-local-readonly-preflight.mjs',import.meta.url);
 const r=spawnSync(process.execPath,[src.pathname,'--once'],{
  encoding:'utf8',timeout:5000});
 assert.equal(r.status,2);
 const value=JSON.parse(r.stdout);
 assert.equal(value.reason,'ONLY_READONLY_INSPECT_SUPPORTED');
 assert.equal(value.settings_modified,false);
 assert.equal(value.model_invoked,false);
});
