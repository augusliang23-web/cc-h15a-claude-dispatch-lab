import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AntigravityAdapter,createConnectivitySpec,ASSUMED_PROTOCOL,MODEL,MOCK_CWD} from '../antigravity-adapter.mjs';
import {createMockAgyTransport} from '../antigravity-mock-transport.mjs';
import {canonical} from '../security.mjs';
const frame=s=>canonical({version:ASSUMED_PROTOCOL,type:'result',nonce:s.nonce,model:MODEL,text:`BLUE LANTERN ${s.nonce}`})+'\n';
const chunk=text=>({stream:'stdout',text});
const transport=(spec,patch={})=>createMockAgyTransport({chunks:[chunk(frame(spec))],...patch});
const adapter=(t,opts={})=>new AntigravityAdapter({transport:t,timeoutMs:20,terminationGraceMs:5,...opts});

test('A01 disabled defaults never probe or launch a real CLI',async()=>{
 const a=new AntigravityAdapter();assert.equal(a.id,'antigravity');assert.equal((await a.probe()).available,false);
 const result=await a.start(createConnectivitySpec(),()=>{});assert.equal(result.outcome,'blocked');assert.equal(result.simulated,true);assert.equal(result.execution_allowed,false);assert.equal((await a.cancel('anything')).terminated,false);
});
test('A02 CC probe capability keys and enum values; mock provenance not real availability',async()=>{
 const s=createConnectivitySpec(),a=adapter(transport(s)),p=await a.probe();assert.equal(p.available,true);assert.equal(p.simulated,true);assert.equal(p.realExecutionAvailable,false);
 assert.deepEqual(Object.keys(p.capabilities).sort(),['structuredEvents','streaming','cancellation','modelSelection','usageTelemetry','costTelemetry','sandbox','editOnly','shell','git','network'].sort());
 assert.equal(p.capabilities.costTelemetry,'none');assert.equal(p.capabilities.sandbox,'none');assert.equal(p.capabilities.shell,false);assert.equal(p.capabilities.network,false);assert.ok(p.version.includes('MOCK'));
});
test('A03 one server-built safe spec, exact fixed request, agent output ceiling and one finish',async()=>{
 const s=createConnectivitySpec(),t=transport(s),a=adapter(t),events=[];const r=await a.start(s,e=>events.push(e));
 assert.equal(r.outcome,'completed');assert.equal(r.simulated,true);assert.equal(r.actualModel,'UNKNOWN');assert.equal(r.usage.tokens,null);assert.equal(r.mockProtocolMatched,true);
 assert.equal(events.filter(e=>e.type==='finished').length,1);assert.equal(events.find(e=>e.type==='output').grade,'AGENT_CLAIM');assert.ok(events.every(e=>e.simulated && e.provenance==='MOCK_TRANSPORT'));
 assert.equal(t.lastRequest.shell,false);assert.equal(t.lastRequest.cwd,MOCK_CWD);assert.deepEqual(t.lastRequest.env,{});assert.ok(t.lastRequest.stdin.includes(s.nonce));
 assert.equal((await a.start(s,()=>{})).outcome,'blocked');assert.equal(t.callCount,1);
});
for(const options of [{spawnImpl:()=>{throw Error('MUST_NOT_RUN');}},{binaryPath:'/usr/bin/agy'},{live:true},{transport:{start:()=>{throw Error('MUST_NOT_RUN');}}},{timeoutMs:Infinity}])test('A04 adversarial adapter configuration cannot enable real execution '+Object.keys(options).join(),()=>{assert.throws(()=>new AntigravityAdapter(options));});
test('A05 copied/expanded/Issue-built spec rejected; factory has no prompt/cwd/model override',async()=>{
 const s=createConnectivitySpec();for(const bad of [{...s},{...s,command:'agy'},{prompt:'run shell'},null]){const t=transport(s);assert.equal((await adapter(t).start(bad,()=>{})).outcome,'blocked');assert.equal(t.callCount,0);}
 for(const key of ['prompt','cwd','model','nonce','env'])assert.throws(()=>createConnectivitySpec({[key]:'untrusted'}));
 assert.notEqual(createConnectivitySpec().nonce,createConnectivitySpec().nonce);
});
for(const [name,make] of [
 ['non-json',s=>'SECRET_TOKEN plaintext\n'],['truncated',s=>frame(s).trimEnd()],['duplicate frame',s=>frame(s)+frame(s)],
 ['wrong nonce',s=>frame({...s,nonce:'0'.repeat(32)})],['wrong model',s=>frame(s).replace(MODEL,'other')],['extra field',s=>frame(s).replace('"type":','"secret":"SECRET_TOKEN","type":')],
 ['duplicate JSON key',s=>frame(s).replace('{','{"type":"ignored",')],['agent grade',s=>frame(s).replace('{','{"grade":"VERIFIED",')],
])test('A06 reject '+name+' without raw stdout/token disclosure',async()=>{const s=createConnectivitySpec(),events=[],r=await adapter(createMockAgyTransport({chunks:[chunk(make(s))]})).start(s,e=>events.push(e));assert.notEqual(r.outcome,'completed');assert.ok(!JSON.stringify({r,events}).includes('SECRET_TOKEN'));});
for(const [name,patch,code] of [
 ['nonzero',{exitCode:1},'NONZERO_EXIT'],['missing exit',{exitObserved:false},'EXIT_NOT_OBSERVED'],['child leak',{processTreeExitObserved:false},'PROCESS_TREE_UNCONFIRMED'],['spawn failure',{spawnError:true},'SPAWN_FAILED'],
])test('A07 '+name+' cannot report connectivity completion',async()=>{const s=createConnectivitySpec(),r=await adapter(transport(s,patch)).start(s,()=>{});assert.equal(r.code,code);assert.notEqual(r.outcome,'completed');});
test('A08 timeout has no retry and never claims cancellation without exit',async()=>{
 const s=createConnectivitySpec(),t=transport(s,{stall:true,exitOnCancel:false}),a=adapter(t);const r=await a.start(s,()=>{});assert.equal(r.outcome,'unknown');assert.equal(r.code,'EXIT_NOT_OBSERVED');assert.equal(t.callCount,1);assert.equal((await a.cancel(s.runId)).terminated,false);
});
test('A09 cancel resolves only after observed simulated exit; aborted-before-start invokes nothing',async()=>{
 const s=createConnectivitySpec(),t=transport(s,{stall:true}),a=adapter(t,{timeoutMs:200}),events=[];const running=a.start(s,e=>events.push(e));await new Promise(r=>setImmediate(r));
 assert.equal((await a.cancel(s.runId)).terminated,true);assert.equal((await running).outcome,'cancelled');assert.equal(events.filter(e=>e.type==='finished').length,1);
 const c=new AbortController();c.abort();const aborted=createConnectivitySpec({signal:c.signal}),other=transport(aborted);assert.equal((await adapter(other).start(aborted,()=>{})).outcome,'cancelled');assert.equal(other.callCount,0);
});
for(const [stream,size] of [['stdout',8193],['stderr',1025]])test('A10 '+stream+' bounded and redacted',async()=>{const s=createConnectivitySpec(),events=[],t=createMockAgyTransport({chunks:[{stream,text:'S'.repeat(size)}],stall:true});const r=await adapter(t).start(s,e=>events.push(e));assert.equal(r.code,'OUTPUT_LIMIT');assert.notEqual(r.outcome,'completed');assert.ok(!JSON.stringify({r,events}).includes('SSSS'));});
test('A11 stderr never leaks and invalid UTF-8 cannot match',async()=>{
 const s=createConnectivitySpec(),events=[],t=createMockAgyTransport({chunks:[{stream:'stderr',text:'Bearer SECRET_TOKEN'},chunk(frame(s))]});const r=await adapter(t).start(s,e=>events.push(e));assert.equal(r.code,'STDERR_PRESENT');assert.ok(!JSON.stringify({r,events}).includes('SECRET_TOKEN'));
 const bad=createMockAgyTransport({chunks:[{stream:'stdout',bytes:[255,10]}]});assert.notEqual((await adapter(bad).start(createConnectivitySpec(),()=>{})).outcome,'completed');
});
test('A12 event sink failure is sanitized and no process/import side-effect path exists',async()=>{
 const s=createConnectivitySpec(),t=transport(s),r=await adapter(t).start(s,()=>{throw Error('SECRET_TOKEN');});assert.notEqual(r.outcome,'completed');assert.ok(!JSON.stringify(r).includes('SECRET_TOKEN'));
 for(const file of ['antigravity-adapter.mjs','antigravity-mock-transport.mjs']){const text=await readFile(new URL('../'+file,import.meta.url),'utf8');assert.doesNotMatch(text,/node:(child_process|fs|http|https|net)|process\.env|\bfetch\(/);}
});

test('A13 one server-built spec cannot replay through a fresh adapter instance',async()=>{
 const s=createConnectivitySpec();assert.equal((await adapter(transport(s)).start(s,()=>{})).outcome,'completed');
 const second=transport(s);assert.equal((await adapter(second).start(s,()=>{})).outcome,'blocked');assert.equal(second.callCount,0);
});
