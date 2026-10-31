import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {CONTRACT,ARGS,safeEnvironment,evaluate,runSingle,supervisedRun,REQUIRED_DENY,inspectDenyPolicy} from '../zc06c-single-model.mjs';
const withHome=async fn=>{
 const h=fs.mkdtempSync(path.join(os.tmpdir(),'zc06c-test-'));
 fs.chmodSync(h,0o700);
 try{
   fs.mkdirSync(path.join(h,'.local','bin'),{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(h,'.local','bin','agy'),'#!/bin/sh\nexit 99\n',{mode:0o700});
   const settings=path.join(h,'.gemini','antigravity-cli');
   fs.mkdirSync(settings,{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(settings,'settings.json'),
      JSON.stringify({toolPermission:'request-review',
        permissions:{deny:[...REQUIRED_DENY]}}),{mode:0o600});
   return await fn(h);
 }finally{fs.rmSync(h,{recursive:true,force:true});}
};
const env={ZC06C_OVERAGES_OFF_CONFIRMED:'YES',PATH:process.env.PATH||'/usr/bin:/bin'};
const fake=(ans=CONTRACT.answer)=>({
 status:0,stdout:JSON.stringify({status:'SUCCESS',response:ans,usage:{total_tokens:123}}),
 stderr:'',signal:null,error:null
});
test('C01 fixed args pin model, plan mode, sandbox and timeout',()=>{
 assert.deepEqual(ARGS.slice(2,5),['--model','gemini-3.8-flash-low','--output-format']);
 assert.ok(ARGS.includes('--sandbox'));assert.ok(ARGS.includes('--mode=plan'));
 assert.equal(ARGS.includes('--dangerously-skip-permissions'),false);
 assert.ok(ARGS.includes('40s'));
});
test('C02 synthetic exact-response success does not claim billing or Agent health',()=>{
 const x=evaluate(fake(),true);
 assert.equal(x.gate,'ZC06C_SINGLE_RESPONSE_OBSERVED');
 assert.equal(x.billing_attested,false);
 assert.equal(x.tool_use_verified_absent,false);
 assert.equal(x.agent_health_verified,false);
});
test('C03 mismatch/nonzero/non-json/timeouts fail closed',()=>{
 for(const x of [fake('other'),{...fake(),status:1},{...fake(),stdout:'bad'},
  {...fake(),error:new Error('timeout')}]){
   assert.equal(evaluate(x,true).gate,'ZC06C_HOLD');
 }
});
test('C04 workspace changes reject successful model content',()=>{
 assert.equal(evaluate(fake(),false).reason,'WORKSPACE_CHANGED');
});
test('C05 no actual model process without overages reconfirmation',()=>withHome(async home=>{
 let n=0;
 const r=await runSingle({platform:'darwin',home,env:{},spawn:()=>{n++;return fake();}});
 assert.equal(r.reason,'OVERAGES_OFF_NOT_RECONFIRMED');assert.equal(n,0);
}));
test('C06 alternate API environment blocks model invocation',()=>withHome(home=>{
 let count=0;
 const r=await runSingle({platform:'darwin',home,
 env:{...env,GEMINI_API_KEY:'present'},spawn:()=>{count++;return fake();}});
 assert.equal(r.reason,'ALTERNATE_PROVIDER_ENV_DETECTED');assert.equal(count,0);
}));
test('C07 one local claim allows only ONE injected model process',()=>withHome(home=>{
 let count=0;const spawn=()=>{count++;return fake();};
 const first=await runSingle({platform:'darwin',home,env,spawn});
 assert.equal(first.gate,'ZC06C_SINGLE_RESPONSE_OBSERVED');
 const second=await runSingle({platform:'darwin',home,env,spawn});
 assert.equal(second.reason,'ONE_TIME_CLAIM_ALREADY_USED_OR_UNSAFE');
 assert.equal(count,1);
}));
test('C08 failed provider response is never retried',()=>withHome(home=>{
 let count=0;const spawn=()=>{count++;return {...fake(),status:1};};
 assert.equal((await runSingle({platform:'darwin',home,env,spawn})).gate,'ZC06C_HOLD');
 assert.equal((await runSingle({platform:'darwin',home,env,spawn})).gate,'ZC06C_HOLD');
 assert.equal(count,1);
}));
test('C09 symlinked CLI binary rejected',()=>withHome(home=>{
 const file=path.join(home,'.local','bin','agy');
 fs.unlinkSync(file);fs.symlinkSync('/bin/echo',file);
 let called=false;const spawn=()=>{called=true;return fake();};
 assert.equal((await runSingle({platform:'darwin',home,env,spawn})).reason,'CLI_NOT_REGULAR_EXECUTABLE');
 assert.equal(called,false);
}));
test('C10 environment allowlist does not expose keys or GitHub credentials',()=>{
 const e=safeEnvironment({home:'/tmp/fake',tmp:'/tmp',pathValue:'/usr/bin'});
 assert.deepEqual(Object.keys(e).sort(),
 ['HOME','TMPDIR','PATH','LANG','LC_ALL','CI','NO_COLOR'].sort());
 assert.equal(e.GITHUB_TOKEN,undefined);
 assert.equal(e.GEMINI_API_KEY,undefined);
});
test('C11 Linux CI cannot initiate provider process',async()=>{
 let count=0;
 assert.equal((await runSingle({platform:'linux',spawn:()=>{count++;}})).reason,'MAC_ONLY');
 assert.equal(count,0);
});
test('C12 CLI direct entry without --once never calls provider',()=>{
 const script=new URL('../zc06c-single-model.mjs',import.meta.url);
 const x=spawnSync(process.execPath,[script.pathname,'--invalid'],{encoding:'utf8',timeout:5000});
 assert.equal(x.status,2);
 assert.match(x.stdout,/ONLY_EXPLICIT_ONCE_SUPPORTED/);
});
test('C13 model quota not invented if provider omits token usage',()=>{
 const out=evaluate({status:0,stdout:JSON.stringify({status:'SUCCESS',response:CONTRACT.answer})},true);
 assert.equal(out.usage_total_tokens,null);
 assert.equal(out.reported_model,'NOT_REPORTED');
});

test('C14 P1: missing deny is HOLD without executing any provider',()=>withHome(home=>{
 const config=path.join(home,'.gemini','antigravity-cli','settings.json');
 fs.writeFileSync(config,'{}',{mode:0o600});
 let count=0;
 const output=runSingle({platform:'darwin',home,env,spawn:()=>{count++;return fake();}});
 assert.equal(output.reason,'EFFECTIVE_DENY_POLICY_NOT_CONFIGURED');
 assert.equal(count,0);
}));
test('C15 P1: all major tool classes require explicit Deny',()=>withHome(home=>{
 const config=path.join(home,'.gemini','antigravity-cli','settings.json');
 for(const omitted of REQUIRED_DENY){
  fs.writeFileSync(config,JSON.stringify({permissions:{
   deny:REQUIRED_DENY.filter(x=>x!==omitted)}}));
  assert.equal(inspectDenyPolicy({home}),false,omitted);
 }
}));
test('C16 P2: provider-reported arbitrary model text is not emitted',()=>{
 const privateText='private/path/token=XYZ';
 const input={...fake(),stdout:JSON.stringify({
   status:'SUCCESS',response:CONTRACT.answer,model:privateText
 })};
 const r=evaluate(input,true);
 assert.equal(r.gate,'ZC06C_HOLD');
 assert.equal(r.reason,'MODEL_MISMATCH');
 assert.equal(JSON.stringify(r).includes(privateText),false);
});
test('C17 P2: world-writable HOME cannot be used as Claim parent',()=>withHome(home=>{
 fs.chmodSync(home,0o777);
 let calls=0;
 const r=await runSingle({platform:'darwin',home,env,spawn:()=>{calls++;return fake();}});
 assert.equal(r.gate,'ZC06C_HOLD');
 assert.equal(r.reason,'ONE_TIME_CLAIM_ALREADY_USED_OR_UNSAFE');
 assert.equal(calls,0);
 fs.chmodSync(home,0o700);
}));
test('C18 policy rejects unsafe billing provider config',()=>withHome(home=>{
 const config=path.join(home,'.gemini','antigravity-cli','settings.json');
 fs.writeFileSync(config,JSON.stringify({
  modelProvider:'gemini',permissions:{deny:REQUIRED_DENY}
 }));
 assert.equal(inspectDenyPolicy({home}),false);
}));

function fakeProcess(p=700001){
 const child=new EventEmitter();
 child.pid=p;
 child.stdout=new EventEmitter();
 child.stderr=new EventEmitter();
 return child;
}
test('C19 supervisor clean close with group exit confirms process exit',async()=>{
 const child=fakeProcess();
 const launch=()=>{
  setImmediate(()=>{
   child.stdout.emit('data',Buffer.from(JSON.stringify({
    status:'SUCCESS',response:CONTRACT.answer})));
   child.emit('close',0,null);
  });
  return child;
 };
 const sendSignal=()=>{const e=new Error('no group');e.code='ESRCH';throw e;};
 const r=await supervisedRun({binary:'/not/used',args:[],cwd:'/tmp',
   env:{},launch,sendSignal,timeoutMs:250});
 assert.equal(r.error,null);
 assert.equal(r.groupExitObserved,true);
 assert.equal(r.exitObserved,true);
 assert.equal(r.status,0);
});
test('C20 timeout triggers process-group termination and never reports success',async()=>{
 const child=fakeProcess(700002);
 let terminated=false,signalled=[];
 const launch=()=>child;
 const sendSignal=(pid,signal)=>{
  if(signal===0){
   if(terminated){const e=new Error('gone');e.code='ESRCH';throw e;}
   return;
  }
  signalled.push(signal);
  terminated=true;
  setImmediate(()=>child.emit('close',null,'SIGTERM'));
 };
 const r=await supervisedRun({binary:'/not/used',args:[],cwd:'/tmp',
  env:{},launch,sendSignal,timeoutMs:15});
 assert.equal(r.error,'TIMEOUT');
 assert.ok(signalled.includes('SIGTERM'));
 assert.equal(r.groupExitObserved,true);
 assert.equal(evaluate(r,true).gate,'ZC06C_HOLD');
});
test('C21 a surviving process group is not a validated clean exit',async()=>{
 const child=fakeProcess(700003);
 const launch=()=>{
  setImmediate(()=>child.emit('close',0,null));
  return child;
 };
 const signals=[];
 const sendSignal=(pid,sig)=>{if(sig!==0)signals.push(sig);};
 const r=await supervisedRun({binary:'/not/used',args:[],cwd:'/tmp',
  env:{},launch,sendSignal,timeoutMs:500});
 assert.equal(r.groupExitObserved,false);
 assert.ok(signals.includes('SIGKILL'));
 assert.equal(evaluate(r,true).gate,'ZC06C_HOLD');
});
test('C22 oversized CLI output is stopped and HOLD',async()=>{
 const child=fakeProcess(700004);
 let gone=false;
 const launch=()=>{
  setImmediate(()=>{
   child.stdout.emit('data',Buffer.alloc(32769,0x78));
   child.emit('close',null,'SIGKILL');
  });
  return child;
 };
 const sendSignal=(pid,sig)=>{
  if(sig===0){if(gone){const e=new Error('gone');e.code='ESRCH';throw e;}return;}
  if(sig==='SIGKILL')gone=true;
 };
 const r=await supervisedRun({binary:'/not/used',args:[],cwd:'/tmp',
  env:{},launch,sendSignal,timeoutMs:500});
 assert.equal(r.error,'OUTPUT_LIMIT');
 assert.equal(evaluate(r,true).gate,'ZC06C_HOLD');
});
