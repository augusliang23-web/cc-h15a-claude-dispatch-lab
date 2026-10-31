import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {C,eventAt,bodyFor,preflight,checkAck,ghArguments,runOnce,isDirectInvocation} from '../zc04b-one-shot-mac.mjs';
const now=new Date('2026-10-31T09:00:00.000Z'),nonce='a'.repeat(32);
const R='repos/'+C.repo;
const issue=()=>({number:30,state:'open',title:C.title,body:C.challenge+' '+C.main});
function fake(overrides={}){
 const posts=[];let receipt=null;const calls=[];
 function gh(method,route,data){
  calls.push(method);
  if(method==='POST'){
    if(route!==R+'/issues/30/comments')throw Error('WRONG_POST_DESTINATION');
    if(typeof data?.body!=='string'||!data.body.startsWith(C.marker))
      throw Error('WRONG_POST_PAYLOAD');
    posts.push({route,data});
    if(overrides.fail)throw Error('FAKE_NETWORK');
    receipt={id:98765432,body:data.body,user:{login:C.actor},
      created_at:'2026-10-31T09:00:01Z'};
    return overrides.badAck?{...receipt,body:'wrong'}:receipt;
  }
  if(route===R+'/issues/30')return overrides.issue??issue();
  if(route===R+'/git/ref/heads/main')return {object:{sha:overrides.sha??C.main}};
  if(route==='user')return {login:overrides.actor??C.actor};
  if(route===R+'/issues/30/comments?per_page=100')return overrides.comments??[];
  if(route===R+'/issues/comments/98765432')return receipt;
  throw Error('INVALID_ROUTE');
 }
 return {gh,calls,posts};
}
function isolated(fn){
 const home=fs.mkdtempSync(path.join(os.tmpdir(),'zc04b-local-'));
 fs.chmodSync(home,0o700);
 try{return fn(home)}finally{fs.rmSync(home,{recursive:true,force:true})}
}
const run=(home,api)=>runOnce({platform:'darwin',home,now,nonce,gh:api.gh});
test('B4-01 mac transport probe carries no Agent health claim',()=>{
 const e=eventAt(now,nonce);
 assert.equal(e.agent_health_verified,false);
 assert.equal(e.model_invoked,false);
 assert.ok(bodyFor(e).startsWith(C.marker));
 assert.throws(()=>eventAt(now,'invalid'));
});
test('B4-02 one fake POST and server readback',()=>isolated(home=>{
 const a=fake(),out=run(home,a);
 assert.equal(out.status,'MAC_TO_GITHUB_PROBE_VERIFIED');
 assert.deepEqual(a.calls,['GET','GET','GET','GET','POST','GET']);
 assert.equal(a.posts.length,1);
 assert.equal(a.posts[0].route,R+'/issues/30/comments');
 assert.equal(a.posts[0].data.body.includes(C.challenge),true);
}));
test('B4-03 claim forbids second post, even if server comments are absent',()=>isolated(home=>{
 const a=fake();assert.equal(run(home,a).status,'MAC_TO_GITHUB_PROBE_VERIFIED');
 assert.equal(run(home,a).status,'HOLD');
 assert.equal(a.posts.length,1);
}));
test('B4-04 ambiguous POST leaves non-reusable claim',()=>isolated(home=>{
 const a=fake({fail:true});assert.equal(run(home,a).reason,'POST_UNCERTAIN_DO_NOT_RETRY');
 assert.equal(run(home,fake()).status,'HOLD');
}));
test('B4-05 wrong actor, main, Issue and prior marker reject before POST',()=>isolated(home=>{
 for(const opts of [{actor:'other'},{sha:'f'.repeat(40)},
 {issue:{...issue(),title:'wrong'}},{comments:[{body:C.marker}]}]){
  const a=fake(opts);assert.equal(run(home,a).status,'HOLD');assert.equal(a.posts.length,0);
 }
}));
test('B4-06 wrong GitHub ACK never verifies and cannot retry',()=>isolated(home=>{
 const a=fake({badAck:true});
 assert.equal(run(home,a).reason,'POST_ACK_INVALID_DO_NOT_RETRY');
 assert.equal(run(home,fake()).status,'HOLD');
}));
test('B4-07 Linux guard rejects before GitHub',()=>isolated(home=>{
 const a=fake();
 assert.equal(runOnce({platform:'linux',home,gh:a.gh}).reason,'MACOS_REQUIRED');
 assert.equal(a.calls.length,0);
}));
test('B4-08 symlinked private state rejected without POST',()=>isolated(home=>{
 const other=path.join(home,'other');fs.mkdirSync(other,{mode:0o700});
 fs.symlinkSync(other,path.join(home,'.local'));
 const a=fake();assert.equal(run(home,a).status,'HOLD');
 assert.equal(a.posts.length,0);
}));
test('B4-09 exact schema/actor/Issue/ACK checks',()=>{
 const body=bodyFor(eventAt(now,nonce));
 const good={id:123,body,user:{login:C.actor},created_at:'2026-10-31T09:00:01Z'};
 assert.equal(checkAck(good,body),true);
 assert.equal(checkAck({...good,user:{login:'fake'}},body),false);
 assert.equal(preflight({issue:issue(),main:{object:{sha:C.main}},
 user:{login:C.actor},comments:[]}),true);
});

test('B4-10 symlinked HOME ancestor never permits a write',()=>isolated(root=>{
 const a=path.join(root,'A'),b=path.join(root,'B');
 fs.mkdirSync(a,{mode:0o700});fs.mkdirSync(b,{mode:0o700});
 const alias=path.join(root,'HOME_ALIAS');fs.symlinkSync(a,alias);
 const one=fake();
 assert.equal(run(alias,one).status,'HOLD');
 assert.equal(one.posts.length,0);
 fs.unlinkSync(alias);fs.symlinkSync(b,alias);
 const two=fake();
 assert.equal(run(alias,two).status,'HOLD');
 assert.equal(two.posts.length,0);
}));
test('B4-11 all live gh arguments are pinned to github.com and Issue #30',()=>{
 for(const method of ['GET','POST']){
  const route=method==='POST'?R+'/issues/30/comments':'user';
  const args=ghArguments(method,route,method==='POST'?{body:C.marker}:undefined);
  assert.deepEqual(args.slice(0,3),['api','--hostname','github.com']);
 }
 assert.throws(()=>ghArguments('POST',R+'/issues/31/comments',{body:C.marker}));
 assert.throws(()=>ghArguments('POST','repos/other/repo/issues/30/comments',{body:C.marker}));
 assert.throws(()=>ghArguments('PATCH',R+'/issues/30/comments',{body:C.marker}));
});

test('B4-12 direct CLI with aliased ancestor never exits silently',()=>isolated(home=>{
 const original=fileURLToPath(new URL('../zc04b-one-shot-mac.mjs',import.meta.url));
 const alias=path.join(home,'source-alias');
 fs.symlinkSync(path.dirname(original),alias,'dir');
 const aliasedEntry=path.join(alias,path.basename(original));
 assert.equal(isDirectInvocation(aliasedEntry,new URL('../zc04b-one-shot-mac.mjs',import.meta.url)),true);
 const res=spawnSync(process.execPath,[aliasedEntry,'--invalid'],{
   encoding:'utf8',timeout:5000,env:process.env
 });
 assert.equal(res.error,undefined);
 assert.equal(res.status,2,JSON.stringify({stdout:res.stdout,stderr:res.stderr}));
 assert.match(res.stdout,/"reason":"ONLY_EXPLICIT_ONCE_SUPPORTED"/);
 assert.match(res.stdout,/"status":"HOLD"/);
}));
test('B4-13 executable CLI guard rejects missing and unrelated entrypoints',()=>{
 const url=new URL('../zc04b-one-shot-mac.mjs',import.meta.url);
 assert.equal(isDirectInvocation(undefined,url),false);
 assert.equal(isDirectInvocation(path.join(os.tmpdir(),'non-existent-probe-script'),url),false);
});
