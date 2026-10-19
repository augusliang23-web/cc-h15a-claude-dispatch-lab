import test from 'node:test';
import assert from 'node:assert/strict';
import { ReadOnlyGitHub, liveClaimPreflight } from '../github-readonly.mjs';
import { task, setup } from './support.mjs';
const ROOT='https://api.github.com/repos/augusliang23-web/cc-h15a-claude-dispatch-lab';
const REPO={id:1423925660,node_id:'R_kgDOVN9hnA',full_name:'augusliang23-web/cc-h15a-claude-dispatch-lab',private:true,archived:false,disabled:false,url:ROOT,html_url:'https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab'};
const PAGE=n=>`${ROOT}/issues?state=all&sort=created&direction=asc&per_page=100&page=${n}`;
const raw=(changes={})=>({repository_url:ROOT,id:123456,node_id:'I_kwDOVN9hnM8AAAABYJf80A',number:101,state:'open',title:'Synthetic task',body:JSON.stringify(task()),url:`${ROOT}/issues/101`,html_url:'https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/issues/101',created_at:'2026-10-18T00:00:00Z',updated_at:'2026-10-19T00:00:00Z',...changes});
function response(url,body,{status=200,headers={}}={}) {
 const h={'content-type':'application/json','x-ratelimit-limit':'5000','x-ratelimit-remaining':'4990','x-ratelimit-reset':'2000000000','x-ratelimit-resource':'core','x-github-request-id':'TEST:REQUEST:1',...headers};
 const r=new Response([204,205,304].includes(status)?null:(typeof body==='string'?body:JSON.stringify(body)),{status,headers:h});Object.defineProperty(r,'url',{value:url});return r;
}
function fixture(routes={},options={}) {
 const calls=[];
 const fetchImpl=async(url,init)=>{calls.push({url,init});assert.equal(init.method,'GET');assert.equal(init.redirect,'error');assert.equal(Object.hasOwn(init,'body'),false);const handler=routes[url];if(handler instanceof Error)throw handler;if(typeof handler==='function')return handler(url,init);return response(url,url===ROOT?REPO:handler);};
 const client=new ReadOnlyGitHub({getToken:async()=>'TEST_ONLY_TOKEN',fetchImpl,...options});return {client,calls};
}

test('G01 pinned private metadata and opaque Issue node identity observed without admission',async()=>{
 const {client,calls}=fixture({[`${ROOT}/issues/101`]:raw()});
 const r=await client.readIssue(101);assert.equal(r.status,'READ_ONLY_OBSERVED');
 assert.equal(r.issue_id,'I_kwDOVN9hnM8AAAABYJf80A');assert.equal(r.task_binding.issue_id,r.issue_id);
 assert.equal(r.execution_allowed,false);assert.equal(r.reason,'LIVE_ADMISSION_DISABLED');
 assert.equal(r.updated_at,'2026-10-19T00:00:00.000Z');assert.equal(calls.length,2);
 assert.ok(!JSON.stringify(r).includes('Synthetic task'));assert.ok(!JSON.stringify(r).includes('TEST_ONLY_TOKEN'));
 assert.deepEqual(calls.map(c=>c.url),[ROOT,`${ROOT}/issues/101`]);
});
for(const [name,patch] of [['wrong identity',{id:1}],['wrong node id',{node_id:'R_other'}],['wrong repo',{full_name:'other/repo'}],['public',{private:false}],['archived',{archived:true}],['disabled',{disabled:true}],['foreign url',{url:'https://evil.example/'}]])test(`G02 repo ${name} HOLD before Issue access`,async()=>{
 const {client,calls}=fixture({[ROOT]:()=>response(ROOT,{...REPO,...patch})});
 const r=await client.readIssue(101);assert.equal(r.status,'HOLD');assert.equal(calls.length,1);
});
test('G03 complete multi-page list excludes PRs and rejects duplicate task IDs across pages',async()=>{
 const pr=raw({id:3,node_id:'PR_issue_id',number:3,url:`${ROOT}/issues/3`,html_url:'https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/pull/3',pull_request:{url:`${ROOT}/pulls/3`}});pr.pull_request.url=`${ROOT}/pulls/3`;
 const b=raw({id:2345,node_id:'I_other',number:102,url:`${ROOT}/issues/102`,html_url:'https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/issues/102',body:JSON.stringify(task({issue_number:102}))});
 const {client,calls}=fixture({[PAGE(1)]:()=>response(PAGE(1),[raw(),pr],{headers:{link:`<${PAGE(2)}>; rel="next", <${PAGE(2)}>; rel="last"`}}),[PAGE(2)]:[b]});
 const r=await client.listIssues();assert.equal(r.status,'READ_ONLY_OBSERVED');assert.equal(r.candidate_count,2);assert.equal(r.excluded_pr_count,1);assert.equal(r.contract_valid_count,0);assert.equal(r.rejected_count,2);
 assert.ok(r.items.every(i=>i.reason==='DUPLICATE_TASK_ID'));assert.equal(r.next_eligible_task,null);assert.equal(calls.length,3);
});
for(const [name,issue] of [['closed',raw({state:'closed'})],['noncontract',raw({body:'Planning text SECRET'})],['PR',raw({html_url:'https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/pull/101',pull_request:{url:`${ROOT}/pulls/101`}})],['wrong URL',raw({url:'https://evil.example/issue/101'})],['missing identity',raw({node_id:undefined})]])test(`G04 ${name} never eligible or raw-logged`,async()=>{
 const {client}=fixture({[`${ROOT}/issues/101`]:issue});const r=await client.readIssue(101);assert.equal(r.status,'HOLD');assert.equal(r.execution_allowed,false);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('G05 exact expected node/revision detects edits or identity replacement',async()=>{
 const a=fixture({[`${ROOT}/issues/101`]:raw()});const first=await a.client.readIssue(101);
 const b=fixture({[`${ROOT}/issues/101`]:raw({title:'Edited'})});
 assert.equal((await b.client.readIssue(101,{expectedRevisionDigest:first.revision_digest})).reason,'ISSUE_REVISION_CHANGED');
 assert.equal((await a.client.readIssue(101,{expectedIssueId:'I_replaced'})).reason,'ISSUE_IDENTITY_CHANGED');
 assert.equal((await a.client.readIssue(101,{expectedRevisionDigest:first.revision_digest,expectedIssueId:first.issue_id})).status,'READ_ONLY_OBSERVED');
});
for(const [status,reason] of [[401,'AUTHENTICATION_FAILED'],[403,'FORBIDDEN_OR_RATE_LIMITED'],[404,'NOT_FOUND_OR_INACCESSIBLE'],[429,'RATE_LIMITED'],[500,'GITHUB_UNAVAILABLE'],[503,'GITHUB_UNAVAILABLE'],[301,'UNEXPECTED_HTTP_STATUS'],[304,'UNEXPECTED_HTTP_STATUS']])test(`G06 HTTP ${status} sanitized HOLD with no retry`,async()=>{
 const {client,calls}=fixture({[ROOT]:()=>response(ROOT,'SECRET token server error',{status})});
 const r=await client.readRepository();assert.equal(r.reason,reason);assert.equal(r.status,'HOLD');assert.equal(calls.length,1);assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('G07 timeout and network failures stop without retry or raw error',async()=>{
 for(const failure of [Error('SECRET host details'),()=>new Promise(()=>{})]) {
  const {client,calls}=fixture({[ROOT]:failure},{timeoutMs:10});const r=await client.readRepository();assert.equal(r.reason,'NETWORK_OR_TIMEOUT');assert.equal(calls.length,1);assert.ok(!JSON.stringify(r).includes('SECRET'));
 }
});
for(const [name,headers] of [['low quota',{'x-ratelimit-remaining':'2'}],['missing quota',{'x-ratelimit-remaining':''}],['wrong resource',{'x-ratelimit-resource':'search'}],['missing request id',{'x-github-request-id':''}],['nonjson',{'content-type':'text/html'}],['oversized',{'content-length':'99999999'}]])test(`G08 ${name} fails closed`,async()=>{
 const {client}=fixture({[ROOT]:()=>response(ROOT,REPO,{headers})});assert.equal((await client.readRepository()).status,'HOLD');
});
for(const link of [`<https://evil.example/?page=2>; rel="next"`,`<${ROOT}/../other/issues?page=2>; rel="next"`,`<${PAGE(1)}>; rel="next"`,`<${PAGE(2)}&token=SECRET>; rel="next"`,`garbage`,`<${PAGE(2)}>; rel="next", <${PAGE(3)}>; rel="next"`])test('G09 unsafe/ambiguous pagination link never followed',async()=>{
 const {client,calls}=fixture({[PAGE(1)]:()=>response(PAGE(1),[raw()],{headers:{link}})});
 assert.equal((await client.listIssues()).status,'HOLD');assert.equal(calls.length,2);
});
test('G10 later-page failure or duplicate issue identity discards complete batch',async()=>{
 for(const next of [()=>response(PAGE(2),'SECRET',{status:503}),()=>response(PAGE(2),[raw()])]) {
  const {client}=fixture({[PAGE(1)]:()=>response(PAGE(1),[raw()],{headers:{link:`<${PAGE(2)}>; rel="next"`}}),[PAGE(2)]:next});
  const r=await client.listIssues();assert.equal(r.status,'HOLD');assert.equal(Object.hasOwn(r,'items'),false);
 }
});
test('G11 invalid issue numbers/options reject before token/network',async()=>{
 const {client,calls}=fixture();for(const n of [0,-1,1.5,'12',true])assert.equal((await client.readIssue(n)).status,'HOLD');
 assert.equal((await client.readIssue(101,{url:'https://evil.example'})).status,'HOLD');assert.equal(calls.length,0);
});
test('G12 ref metadata is an observation only; missing or mutable evidence cannot authorize writes',async()=>{
 const f=setup(),binding=f.payload.binding;
 const {claimKey}=await import('../claims.mjs');const ref=claimKey(binding),url=`${ROOT}/git/ref/${ref.slice(5)}`;
 const sha='a'.repeat(40),refBody={ref,node_id:'REF_test',url:`${ROOT}/git/refs/${ref.slice(5)}`,object:{type:'commit',sha,url:`${ROOT}/git/commits/${sha}`}};
 for(const body of [refBody,{...refBody,ref:'refs/heads/other'},null]){
  const {client}=fixture({[url]:()=>response(url,body??{message:'not found'},{status:body?200:404})});
  const r=await client.observeClaimRef(binding);assert.equal(r.status,'HOLD');assert.equal(r.execution_allowed,false);
  if(body===refBody)assert.equal(r.observation,'REF_PRESENT_UNVERIFIED_MANIFEST');
 }
 const gate=liveClaimPreflight({approved:true,immutable:true,write_authorized:true});assert.equal(gate.status,'HOLD');assert.equal(gate.execution_allowed,false);
});
test('G13 malformed/truncated responses or redirect provenance HOLD',async()=>{
 for(const handler of [()=>response(ROOT,'{'),()=>response('https://evil.example/',REPO),()=>response(ROOT,[]),()=>response(ROOT,REPO,{headers:{'content-length':'999'}})]){
  const {client}=fixture({[ROOT]:handler});assert.equal((await client.readRepository()).status,'HOLD');
 }
});
test('G14 full page without pagination evidence or page budget exhaustion discards list',async()=>{
 const row=n=>raw({id:n,node_id:`I_${n}`,number:n,url:`${ROOT}/issues/${n}`,html_url:`https://github.com/augusliang23-web/cc-h15a-claude-dispatch-lab/issues/${n}`,body:'Planning only'});
 const a=fixture({[PAGE(1)]:Array.from({length:100},(_,i)=>row(i+1))});assert.equal((await a.client.listIssues()).reason,'PAGINATION_AMBIGUOUS');
 const routes={};for(let n=1;n<=5;n++)routes[PAGE(n)]=()=>response(PAGE(n),[row(n)],{headers:{link:`<${PAGE(n+1)}>; rel="next"`}});
 const b=fixture(routes);assert.equal((await b.client.listIssues()).status,'HOLD');assert.equal(b.calls.length,6);
 assert.ok(!b.calls.some(c=>c.url===PAGE(6)));
});
test('G15 deleted/inaccessible exact Issue and later-page low quota return no partial tasks',async()=>{
 const a=fixture({[`${ROOT}/issues/101`]:()=>response(`${ROOT}/issues/101`,{message:'private SECRET'},{status:404})});assert.equal((await a.client.readIssue(101)).reason,'NOT_FOUND_OR_INACCESSIBLE');
 const b=fixture({[PAGE(1)]:()=>response(PAGE(1),[raw()],{headers:{link:`<${PAGE(2)}>; rel="next"`}}),[PAGE(2)]:()=>response(PAGE(2),[],{headers:{'x-ratelimit-remaining':'0'}})});
 const r=await b.client.listIssues();assert.equal(r.reason,'RATE_LIMIT_HEADROOM_LOW');assert.equal(Object.hasOwn(r,'items'),false);
});
test('G16 absent/stale local auth never sends a request or exposes credential errors',async()=>{
 for(const getToken of [async()=>'',async()=>{throw Error('SECRET local auth');}]) {
  const {client,calls}=fixture({},{getToken});assert.equal((await client.readRepository()).reason,'AUTHENTICATION_FAILED');assert.equal(calls.length,0);
 }
});
test('G17 streamed errors, invalid UTF-8 and stalled bodies fail closed within deadline',async()=>{
 for(const stream of [
  ()=>new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{'));c.error(Error('SECRET stream'));}}),
  ()=>new ReadableStream({start(c){c.enqueue(new Uint8Array([123,34,120,34,58,34,255,34,125]));c.close();}}),
  ()=>new ReadableStream({start(){}}),
 ]){
  const {client}=fixture({[ROOT]:()=>{const r=response(ROOT,REPO);const s=new Response(stream(),{headers:r.headers});Object.defineProperty(s,'url',{value:ROOT});return s;}},{timeoutMs:10});
  const r=await client.readRepository();assert.equal(r.status,'HOLD');assert.ok(!JSON.stringify(r).includes('SECRET'));
 }
});
test('G18 GET adapter cannot be passed into mock claiming or clear live guards',async()=>{
 const {client,calls}=fixture();const {simulateClaim}=await import('../admission.mjs');
 const result=await simulateClaim({remote:client,journal:{load(){throw Error('must not load');}}});
 assert.equal(result.reason,'MOCK_PROVIDER_REQUIRED');assert.equal(calls.length,0);
 const {admitLive}=await import('../security.mjs');const {claimLive}=await import('../claims.mjs');const {executeLive}=await import('../foundation.mjs');
 for(const entry of [admitLive,claimLive,executeLive])assert.throws(()=>entry({approved:true,provider:client}));
});
for(const link of [
 `<${PAGE(3)}>; rel="last"`,
 `<${PAGE(2)}>; rel="first"`,
 `<${PAGE(2)}>; rel="prev"`,
 `<${PAGE(2)}>; rel="next", <${PAGE(1)}>; rel="last"`,
])test('G19 inconsistent pagination evidence rejects without reading a speculative next page',async()=>{
 const {client,calls}=fixture({[PAGE(1)]:()=>response(PAGE(1),[raw()],{headers:{link}})});
 const r=await client.listIssues();assert.equal(r.status,'HOLD');assert.equal(Object.hasOwn(r,'items'),false);assert.equal(calls.length,2);
});
