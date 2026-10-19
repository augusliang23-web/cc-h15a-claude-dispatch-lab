import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ReadOnlyGitHub} from '../bridge/github-readonly.mjs';
import {REPOSITORY} from '../bridge/foundation.mjs';
import {PreviewLedger} from '../local-preview/ledger.mjs';
import {ReviewSession,githubSource} from '../local-preview/review.mjs';
const ROOT=`https://api.github.com/repos/${REPOSITORY}`;
async function run(fn){const root=await fs.mkdtemp(join(tmpdir(),'preview-source-'));const l=await PreviewLedger.open(join(root,'private'));try{await fn(l);}finally{await l.close();await fs.rm(root,{recursive:true,force:true});}}
function readerFixture(){
 const calls=[];let planning=false,offline=false;
 const task={contract_version:'CC_AG_BRIDGE_V1',repository:REPOSITORY,agent:'antigravity',model:'gemini-3.8-flash-low',task_type:'synthetic',execution_mode:'dry-run',approval:'approved',status:'QUEUED',task_id:'SOURCE-TEST',issue_number:101};
 const reader=new ReadOnlyGitHub({getToken:()=> 'offline-fixture-token',fetchImpl:async(url,options)=>{
  calls.push({url,method:options.method});assert.equal(options.method,'GET');if(offline)throw Error('SECRET_UNTRUSTED_TEXT');
  const payload=url===ROOT?{id:1423925660,node_id:'R_kgDOVN9hnA',full_name:REPOSITORY,private:true,archived:false,disabled:false,url:ROOT,html_url:`https://github.com/${REPOSITORY}`}:{id:123,number:101,node_id:'I_SOURCE_TEST_101',state:'open',title:'<script>PRIVATE_UNTRUSTED_TITLE</script>',body:planning?'Planning only PRIVATE_UNTRUSTED_BODY':JSON.stringify(task),repository_url:ROOT,url:`${ROOT}/issues/101`,html_url:`https://github.com/${REPOSITORY}/issues/101`,created_at:'2026-10-19T01:00:00Z',updated_at:'2026-10-19T01:00:00Z'};
  return {status:200,url,redirected:false,headers:new Headers({'content-type':'application/json','x-ratelimit-remaining':'100','x-ratelimit-limit':'5000','x-ratelimit-reset':'1792371600','x-ratelimit-resource':'core','x-github-request-id':'OFFLINE:FIXTURE'}),body:new Response(JSON.stringify(payload)).body};
 }});
 return {reader,calls,planning:()=>{planning=true;},offline:()=>{offline=true;}};
}
test('S01 existing GET-only adapter verifies pinned Issue again before local preview decision',()=>run(async ledger=>{
 const f=readerFixture(),review=new ReviewSession({ledger,source:githubSource(f.reader,101,'I_SOURCE_TEST_101')});await review.refresh();const v=await review.view();assert.equal(v.can_decide,true);assert.equal(v.preview.source,'GITHUB_READ_ONLY');
 const out=await review.decide({decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id});assert.equal(out.execution_allowed,false);assert.equal(f.calls.length,4);assert.ok(!JSON.stringify(out).includes('PRIVATE_UNTRUSTED'));assert.ok(f.calls.every(c=>c.method==='GET' && [ROOT,ROOT+'/issues/101'].includes(c.url)));
}));
test('S02 planning/noncontract Issue is rejected rather than locally approved',()=>run(async ledger=>{
 const f=readerFixture();f.planning();const review=new ReviewSession({ledger,source:githubSource(f.reader,101,'I_SOURCE_TEST_101')});await review.refresh();const v=await review.view();assert.equal(v.can_decide,false);assert.equal(v.preview,null);assert.ok(!JSON.stringify(v).includes('PRIVATE_UNTRUSTED'));
}));
test('S03 network loss during decision preserves non-authoritative cached preview and zero history',()=>run(async ledger=>{
 const f=readerFixture(),review=new ReviewSession({ledger,source:githubSource(f.reader,101,'I_SOURCE_TEST_101')});await review.refresh();const v=await review.view();f.offline();
 await assert.rejects(()=>review.decide({decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id}));const out=await review.view();assert.equal(out.can_decide,false);assert.ok(out.preview);assert.equal(out.history.length,0);assert.ok(!JSON.stringify(out).includes('SECRET_'));
}));
