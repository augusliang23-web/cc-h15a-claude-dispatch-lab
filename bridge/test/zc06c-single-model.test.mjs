import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {CONTRACT,ARGS,safeEnvironment,evaluate,runSingle} from '../zc06c-single-model.mjs';
const withHome=fn=>{
 const h=fs.mkdtempSync(path.join(os.tmpdir(),'zc06c-test-'));
 fs.chmodSync(h,0o700);
 try{
   fs.mkdirSync(path.join(h,'.local','bin'),{recursive:true,mode:0o700});
   fs.writeFileSync(path.join(h,'.local','bin','agy'),'#!/bin/sh\nexit 99\n',{mode:0o700});
   return fn(h);
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
test('C05 no actual model process without overages reconfirmation',()=>withHome(home=>{
 let n=0;
 const r=runSingle({platform:'darwin',home,env:{},spawn:()=>{n++;return fake();}});
 assert.equal(r.reason,'OVERAGES_OFF_NOT_RECONFIRMED');assert.equal(n,0);
}));
test('C06 alternate API environment blocks model invocation',()=>withHome(home=>{
 let count=0;
 const r=runSingle({platform:'darwin',home,
 env:{...env,GEMINI_API_KEY:'present'},spawn:()=>{count++;return fake();}});
 assert.equal(r.reason,'ALTERNATE_PROVIDER_ENV_DETECTED');assert.equal(count,0);
}));
test('C07 one local claim allows only ONE injected model process',()=>withHome(home=>{
 let count=0;const spawn=()=>{count++;return fake();};
 const first=runSingle({platform:'darwin',home,env,spawn});
 assert.equal(first.gate,'ZC06C_SINGLE_RESPONSE_OBSERVED');
 const second=runSingle({platform:'darwin',home,env,spawn});
 assert.equal(second.reason,'ONE_TIME_CLAIM_ALREADY_USED_OR_UNSAFE');
 assert.equal(count,1);
}));
test('C08 failed provider response is never retried',()=>withHome(home=>{
 let count=0;const spawn=()=>{count++;return {...fake(),status:1};};
 assert.equal(runSingle({platform:'darwin',home,env,spawn}).gate,'ZC06C_HOLD');
 assert.equal(runSingle({platform:'darwin',home,env,spawn}).gate,'ZC06C_HOLD');
 assert.equal(count,1);
}));
test('C09 symlinked CLI binary rejected',()=>withHome(home=>{
 const file=path.join(home,'.local','bin','agy');
 fs.unlinkSync(file);fs.symlinkSync('/bin/echo',file);
 let called=false;const spawn=()=>{called=true;return fake();};
 assert.equal(runSingle({platform:'darwin',home,env,spawn}).reason,'CLI_NOT_REGULAR_EXECUTABLE');
 assert.equal(called,false);
}));
test('C10 environment allowlist does not expose keys or GitHub credentials',()=>{
 const e=safeEnvironment({home:'/tmp/fake',tmp:'/tmp',pathValue:'/usr/bin'});
 assert.deepEqual(Object.keys(e).sort(),
 ['HOME','TMPDIR','PATH','LANG','LC_ALL','CI','NO_COLOR'].sort());
 assert.equal(e.GITHUB_TOKEN,undefined);
 assert.equal(e.GEMINI_API_KEY,undefined);
});
test('C11 Linux CI cannot initiate provider process',()=>{
 let count=0;
 assert.equal(runSingle({platform:'linux',spawn:()=>{count++;}}).reason,'MAC_ONLY');
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
