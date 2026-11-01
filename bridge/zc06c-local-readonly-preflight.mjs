// ZC-06C: sanitized, READ-ONLY final local Mac preflight.
// Never prints settings, process arguments, paths, credentials, account IDs,
// raw stderr or model content. No filesystem writes or provider invocations.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectDenyPolicy,inspectAgYExecutable} from './zc06c-single-model.mjs';
const RESULT='ZC06C_LOCAL_READONLY_PREFLIGHT';

export function classifyProcessCommands(input){
 if(typeof input!=='string'||Buffer.byteLength(input)>262144)
  return {inventory:'UNAVAILABLE',agy:'UNKNOWN',antigravity:'UNKNOWN'};
 const names=input.split(/\r?\n/).map(s=>path.basename(s.trim()).toLowerCase());
 return {
  inventory:'PROCESS_NAMES_ONLY',
  agy:names.some(x=>x==='agy'||x==='agy-cli')?'PRESENT':'NOT_OBSERVED',
  antigravity:names.some(x=>x.includes('antigravity'))?'PRESENT':'NOT_OBSERVED',
 };
}
export function inspectReadOnly({
 platform=process.platform,home=os.homedir(),io=fs,
 ps=spawnSync,uid=process.getuid?.(),
}={}){
 const info={
  gate:RESULT,
  platform:platform==='darwin'?'MACOS':'UNSUPPORTED',
  cli:'UNKNOWN',policy:'UNKNOWN',
  process_inventory:'NOT_READ',
  agy_process:'UNKNOWN',antigravity_process:'UNKNOWN',
  account_billing_attested:false,
  effective_tool_deny_verified:false,
  settings_modified:false,model_invoked:false,agent_invoked:false,
  authorized_to_execute:false,
 };
 if(platform!=='darwin'||uid===0)return {...info,reason:'PLATFORM_OR_USER_HOLD'};
 // These functions only inspect current user's settings and binary metadata.
 info.cli=inspectAgYExecutable({home,io})?'OWNER_TRUST_CHECK_PASS':'NOT_VERIFIED';
 info.policy=inspectDenyPolicy({home,io})?'DECLARED_DENIES_PRESENT':'DENIES_MISSING_OR_UNTRUSTED';
 try{
  const out=ps('/bin/ps',['-axo','comm='],{
   encoding:'utf8',timeout:4000,maxBuffer:262144,input:'',
   env:{HOME:home,PATH:'/usr/bin:/bin',LANG:'C',LC_ALL:'C'},
   shell:false,
  });
  if(out&&out.status===0&&!out.error&&!out.signal){
   const proc=classifyProcessCommands(out.stdout);
   info.process_inventory=proc.inventory;
   info.agy_process=proc.agy;
   info.antigravity_process=proc.antigravity;
  }
 }catch{/* no raw errors escape */}
 return info;
}
function direct(entry,url,io=fs){
 try{return typeof entry==='string'&&io.realpathSync(path.resolve(entry))===
  io.realpathSync(fileURLToPath(url));}catch{return false;}
}
if(direct(process.argv[1],import.meta.url)){
 const output=process.argv.length===3&&process.argv[2]==='--inspect'
  ?inspectReadOnly():{
   gate:'ZC06C_PREFLIGHT_HOLD',reason:'ONLY_READONLY_INSPECT_SUPPORTED',
   model_invoked:false,settings_modified:false,authorized_to_execute:false,
  };
 process.stdout.write(JSON.stringify(output)+'\n');
 if(output.gate!==RESULT)process.exitCode=2;
}
