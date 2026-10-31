// ZC-06C: owner-launched ONE REAL provider call, never repeated or automated.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn as nodeSpawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
export const CONTRACT=Object.freeze({
  task:'ZC06C_GEMINI_SINGLE_CALL_20261031_A1',
  model:'gemini-3.8-flash-low',
  answer:'BLUE LANTERN ZC06C-20261031-A1',
  timeoutMs:45000,
  claimDir:'zc06c-model-once',
});
export const ARGS=Object.freeze([
  '-p', 'Return exactly this line with no other characters: '+CONTRACT.answer+
    '. Do not call tools, run commands, read files, or write files.',
  '--model',CONTRACT.model,
  '--output-format','json',
  '--mode=plan',
  '--sandbox',
  '--disable-slash-commands',
  '--print-timeout','40s',
]);
const hold=reason=>({gate:'ZC06C_HOLD',reason,model_called:false,
  model:CONTRACT.model,repeat_allowed:false,billing_attested:false});
function dirSync(io,dir){
  const fd=io.openSync(dir,'r');
  try{io.fsyncSync(fd);}finally{io.closeSync(fd);}
}
function reserveOne(io,home){
  if(typeof home!=='string'||!path.isAbsolute(home))throw Error('INVALID_HOME');
  const own=process.getuid?.();
  const canonical=io.realpathSync(home);
  if(!io.lstatSync(canonical).isDirectory()||io.lstatSync(canonical).isSymbolicLink()||
     (io.lstatSync(canonical).mode&0o022)!==0||
     (own!==undefined&&io.lstatSync(canonical).uid!==own))
    throw Error('UNSAFE_HOME');
  let parent=canonical;
  for(const name of ['.local','state',CONTRACT.claimDir]){
    const next=path.join(parent,name);
    let st;
    try{st=io.lstatSync(next);}
    catch(e){
      if(e.code!=='ENOENT')throw e;
      io.mkdirSync(next,{mode:0o700});
      dirSync(io,parent);
      st=io.lstatSync(next);
    }
    if(!st.isDirectory()||st.isSymbolicLink()||
       (st.mode&0o077)!==0||(own!==undefined&&st.uid!==own))
      throw Error('UNSAFE_CLAIM_PATH');
    parent=next;
  }
  const file=path.join(parent,CONTRACT.task+'.claim');
  let fd;
  try{
    fd=io.openSync(file,'wx',0o600);
    const line=Buffer.from(CONTRACT.task+'\n','utf8');
    const size=io.writeSync(fd,line,0,line.length,0);
    if(size!==line.length)throw Error('SHORT_WRITE');
    io.fsyncSync(fd);io.closeSync(fd);fd=undefined;
    dirSync(io,parent);
  }finally{if(fd!==undefined){try{io.closeSync(fd);}catch{}}}
}

export const REQUIRED_DENY=Object.freeze([
 'read_file(*)','write_file(*)','command(*)','unsandboxed(*)',
 'read_url(*)','execute_url(*)','mcp(*)'
]);
// This verifies the owner-owned policy file only. It cannot attest that an
// AgY build enforces the rules; execution remains subject to residual risk.
export function inspectDenyPolicy({home=os.homedir(),io=fs}={}) {
 try {
  const filename=path.join(home,'.gemini','antigravity-cli','settings.json');
  const st=io.lstatSync(filename);
  if(!st.isFile()||st.isSymbolicLink()||
     (st.mode&0o022)!==0||
     (typeof process.getuid==='function'&&st.uid!==process.getuid())||
     st.size<2||st.size>131072)return false;
  const value=JSON.parse(io.readFileSync(filename,'utf8'));
  if(!value||typeof value!=='object'||Array.isArray(value))return false;
  if(![undefined,'strict','request-review'].includes(value.toolPermission)||
     value.allowNonWorkspaceAccess===true||value.useG1Credits===true||
     ![undefined,''].includes(value.modelProvider))return false;
  const deny=value.permissions?.deny;
  if(!Array.isArray(deny)||!REQUIRED_DENY.every(rule=>deny.includes(rule)))return false;
  // A separate explicit deny, rather than a prompt or cwd, is mandatory.
  return true;
 }catch{return false;}
}

export function safeEnvironment({home=os.homedir(),tmp=os.tmpdir(),pathValue=process.env.PATH}={}){
  // Explicit allowlist: no cloud credentials, PATs, model-provider API keys,
  // shell startup overrides, or GitHub/SSH environment forwarded to AgY.
  return {HOME:home,TMPDIR:tmp,PATH:pathValue||'/usr/bin:/bin',
    LANG:'C',LC_ALL:'C',CI:'true',NO_COLOR:'1'};
}
export function evaluate(child,workspaceOk) {
  const basic={model:CONTRACT.model,repeat_allowed:false,billing_attested:false,
    agent_health_verified:false,one_provider_process_attempted:true};
  if(!workspaceOk)return {gate:'ZC06C_HOLD',reason:'WORKSPACE_CHANGED',...basic};
  if(!child||child.error||child.signal||child.status!==0||
     child.groupExitObserved===false||child.exitObserved===false||child.stderrPresent===true||
     typeof child.stdout!=='string'||Buffer.byteLength(child.stdout)>32768)
    return {gate:'ZC06C_HOLD',reason:'CLI_NONZERO_TIMEOUT_OR_OUTPUT_INVALID',...basic};
  let value;
  try{value=JSON.parse(child.stdout);}catch{return {gate:'ZC06C_HOLD',reason:'INVALID_JSON',...basic};}
  if(!value||typeof value!=='object'||Array.isArray(value)||
     value.status!=='SUCCESS'||typeof value.response!=='string')
    return {gate:'ZC06C_HOLD',reason:'CLI_NON_SUCCESS',...basic};
  const exact=value.response===CONTRACT.answer||value.response===CONTRACT.answer+'\n';
  const reported=value.model===undefined?'NOT_REPORTED':
    value.model===CONTRACT.model?'PINNED_MODEL':'UNRECOGNIZED';
  const accepted=exact&&reported!=='UNRECOGNIZED';
  const usage=value.usage;
  const count=usage&&typeof usage==='object'&&
    Number.isSafeInteger(usage.total_tokens)&&usage.total_tokens>=0?
    usage.total_tokens:null;
  return {gate:accepted?'ZC06C_SINGLE_RESPONSE_OBSERVED':'ZC06C_HOLD',
    reason:!exact?'RESPONSE_MISMATCH':
      reported==='UNRECOGNIZED'?'MODEL_MISMATCH':'MATCHED_CHALLENGE',
    response_matched:exact,reported_model:reported,
    usage_total_tokens:count,tool_use_verified_absent:false,
    ...basic};
}

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// A detached Mac process is group leader. Terminate the entire group, not just
// its initial PID. A surviving group is an UNKNOWN outcome and never a PASS.
export async function supervisedRun({
 binary,args,cwd,env,timeoutMs=CONTRACT.timeoutMs,
 launch=nodeSpawn,sendSignal=process.kill,
}){
 let child;
 try {
  child=launch(binary,args,{
   cwd,env,shell:false,detached:true,windowsHide:true,
   stdio:['ignore','pipe','pipe'],
  });
 }catch{return {error:'SPAWN_FAILED',status:null};}
 const pid=child?.pid;
 if(!Number.isSafeInteger(pid)||pid<=1||
    !child.stdout||!child.stderr||
    typeof child.once!=='function')return {error:'SPAWN_UNOBSERVABLE',status:null};
 let out=[],bytes=0,overflow=false,stderrPresent=false;
 let closed=false;
 const ended=new Promise(resolve=>{
  let settled=false;
  const done=(status,signal,error)=>{
   if(settled)return;
   settled=true;closed=true;resolve({status,signal,error});
  };
  child.once('error',()=>done(null,null,'SPAWN_ERROR'));
  child.once('close',(status,signal)=>done(status,signal,null));
 });
 const groupGone=()=>{
  try{sendSignal(-pid,0);return false;}
  catch(e){return e?.code==='ESRCH';}
 };
 const stop=signal=>{
  try{sendSignal(-pid,signal);}catch{}
 };
 child.stdout.on('data',chunk=>{
  bytes+=chunk.length;
  if(bytes>32768){overflow=true;stop('SIGKILL');return;}
  out.push(Buffer.from(chunk));
 });
 child.stderr.on('data',chunk=>{if(chunk.length)stderrPresent=true;});
 let timer;
 const first=await Promise.race([
  ended,
  new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),timeoutMs);}),
 ]);
 clearTimeout(timer);
 let result=first;
 if(first.timeout){
  stop('SIGTERM');
  result=await Promise.race([ended,delay(1200).then(()=>({timeout:true}))]);
  if(result.timeout){
   stop('SIGKILL');
   result=await Promise.race([ended,delay(1200).then(()=>({timeout:true}))]);
  }
 }
 // A clean parent exit does not imply its entire process group exited.
 if(!groupGone()){
  stop('SIGTERM');
  await delay(150);
  if(!groupGone()){
   stop('SIGKILL');
   await delay(150);
  }
 }
 const groupExitObserved=groupGone();
 return {
  error:first.timeout?'TIMEOUT':overflow?'OUTPUT_LIMIT':
     result.timeout?'PROCESS_STILL_ALIVE':result.error||null,
  status:result.status??null,signal:result.signal??null,
  stdout:Buffer.concat(out).toString('utf8'),
  stderrPresent,groupExitObserved,exitObserved:closed,
 };
}

export async function runSingle({platform=process.platform,home=os.homedir(),io=fs,
  spawn=supervisedRun,temp=os.tmpdir(),env=process.env}={}) {
  if(platform!=='darwin')return hold('MAC_ONLY');
  if(process.getuid?.()===0)return hold('NO_ROOT');
  if(env.ZC06C_OVERAGES_OFF_CONFIRMED!=='YES')return hold('OVERAGES_OFF_NOT_RECONFIRMED');
  // Don't forward a separately configured direct-to-API billing environment.
  if(['GEMINI_API_KEY','GOOGLE_API_KEY','GOOGLE_APPLICATION_CREDENTIALS',
       'ANTHROPIC_API_KEY','OPENAI_API_KEY'].some(k=>Boolean(env[k])))
    return hold('ALTERNATE_PROVIDER_ENV_DETECTED');
  if(!inspectDenyPolicy({home,io}))return hold('EFFECTIVE_DENY_POLICY_NOT_CONFIGURED');
  const binary=path.join(home,'.local','bin','agy');
  try{
    const st=io.lstatSync(binary);
    if(!st.isFile()||st.isSymbolicLink()||!(st.mode&0o111))
      return hold('CLI_NOT_REGULAR_EXECUTABLE');
  }catch{return hold('CLI_UNAVAILABLE');}
  try{reserveOne(io,home);}
  catch{return hold('ONE_TIME_CLAIM_ALREADY_USED_OR_UNSAFE');}
  let workspace;
  try{
    workspace=io.mkdtempSync(path.join(temp,'zc06c-empty-'));
    io.chmodSync(workspace,0o500);
  }catch{return hold('ISOLATED_WORKSPACE_FAILED');}
  let child;
  try{
    child=await spawn({
      binary,args:ARGS,cwd:workspace,
      timeoutMs:CONTRACT.timeoutMs,
      env:safeEnvironment({home,tmp:temp,pathValue:env.PATH}),
    });
  }catch{child={error:true};}
  let empty=false;
  try{empty=io.readdirSync(workspace).length===0;}catch{}
  // Do not delete non-empty workspace; preserve evidence for investigation.
  if(empty){try{io.chmodSync(workspace,0o700);io.rmdirSync(workspace);}catch{}}
  return evaluate(child,empty);
}
export function direct(entry,url,io=fs){
 try{return typeof entry==='string'&&io.realpathSync(path.resolve(entry))===io.realpathSync(fileURLToPath(url));}
 catch{return false;}
}
if(direct(process.argv[1],import.meta.url)){
  const answer=process.argv.length===3&&process.argv[2]==='--once'?
    await runSingle():hold('ONLY_EXPLICIT_ONCE_SUPPORTED');
  process.stdout.write(JSON.stringify(answer)+'\n');
  if(answer.gate!=='ZC06C_SINGLE_RESPONSE_OBSERVED')process.exitCode=2;
}
