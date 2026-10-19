// CC-shaped lab adapter. Default disabled; only branded data-only mock transport.
// No real launcher, credential access, filesystem, network or activation switch.
import {randomBytes} from 'node:crypto';
import {canonical,exact,fail} from './security.mjs';
import {isMockAgyTransport} from './antigravity-mock-transport.mjs';
export const MODEL='gemini-3.8-flash-low';
export const ASSUMED_PROTOCOL='M2A_ASSUMED_V1';
export const MOCK_CWD='MOCK_ONLY_EMPTY_CWD_NOT_A_PROJECT';
const issued=new WeakSet(),consumed=new WeakSet();
export function createConnectivitySpec(options={}){
 if(!exact(options,[]) && !exact(options,['signal']))fail('INVALID_CONNECTIVITY_SPEC');
 if(Object.hasOwn(options,'signal') && !(options.signal instanceof AbortSignal))fail('INVALID_CONNECTIVITY_SPEC');
 const date=new Date().toISOString().slice(0,10).replaceAll('-',''),nonce=randomBytes(16).toString('hex');
 const spec=Object.freeze({runId:`RUN-${date}-${randomBytes(4).toString('hex')}`,taskId:`CC-${date}-${randomBytes(4).toString('hex')}`,worktreePath:MOCK_CWD,executionProfile:'FAST',nonce,prompt:`Connectivity test only. Return exactly BLUE LANTERN ${nonce}. No tools, files, commands, git, external requests or other actions.`,...options});
 issued.add(spec);return spec;
}
const capabilities=Object.freeze({structuredEvents:true,streaming:'none',cancellation:'signal',modelSelection:true,usageTelemetry:'none',costTelemetry:'none',sandbox:'none',editOnly:false,shell:false,git:false,network:false});
const absent=()=>({exitCode:null,signal:null,exitObserved:false,processTreeExitObserved:false});
export class AntigravityAdapter {
 id='antigravity';#transport;#timeout;#grace;#attempted=false;#active=null;
 constructor(options={}){
  if(!exact(options,Object.keys(options)) || Object.keys(options).some(k=>!['transport','timeoutMs','terminationGraceMs'].includes(k)) || (Object.hasOwn(options,'transport') && !isMockAgyTransport(options.transport)))fail('OFFLINE_MOCK_CONFIGURATION_REQUIRED');
  this.#timeout=options.timeoutMs??30000;this.#grace=options.terminationGraceMs??100;
  if(!Number.isInteger(this.#timeout) || this.#timeout<1 || this.#timeout>30000 || !Number.isInteger(this.#grace) || this.#grace<1 || this.#grace>1000)fail('INVALID_LIMIT');
  this.#transport=options.transport;Object.freeze(this);
 }
 async probe(){return {id:this.id,available:Boolean(this.#transport),version:'M2A-MOCK-ONLY-V1',...(!this.#transport?{reason:'REAL_AGY_DISABLED'}:{}),capabilities:{...capabilities},simulated:true,provenance:'MOCK_TRANSPORT',realExecutionAvailable:false,protocolVerified:false};}
 async #wait(handle){let timer;try{return await Promise.race([handle.done,new Promise(r=>{timer=setTimeout(()=>r(absent()),this.#grace);})]);}finally{clearTimeout(timer);}}
 async cancel(runId){const a=this.#active;if(!a || a.runId!==runId)return {terminated:false};a.cancelRequested=true;a.handle.cancel('cancel');const p=await this.#wait(a.handle);return {terminated:p.exitObserved===true && p.processTreeExitObserved===true};}
 async start(spec,emit){
  const base={requestedProfile:'FAST',requestedModel:MODEL,requestedEffort:null,actualModel:'UNKNOWN',sessionId:null,usage:{tokens:null,costUsd:null,grade:'UNAVAILABLE'},simulated:true,provenance:'MOCK_TRANSPORT',execution_allowed:false};
  const blocked=code=>({...base,outcome:'blocked',code,...absent(),mockProtocolMatched:false});
  if(this.#attempted)return blocked('ATTEMPT_ALREADY_USED');this.#attempted=true;
  if(!this.#transport)return blocked('REAL_AGY_DISABLED');
  if(!issued.has(spec) || typeof emit!=='function')return blocked('INVALID_SERVER_SPEC');
  if(consumed.has(spec))return blocked('SPEC_ALREADY_USED');consumed.add(spec);
  if(spec.signal?.aborted)return {...blocked('ABORTED_BEFORE_START'),outcome:'cancelled'};
  let stdout=[],stdoutBytes=0,stderrBytes=0,problem=null,handle,timer,emitFailed=false,cancelRequested=false;
  const send=event=>{try{emit({...event,grade:event.type==='output'?'AGENT_CLAIM':'RUNTIME_OBSERVED',simulated:true,provenance:'MOCK_TRANSPORT'});}catch{emitFailed=true;problem='EMIT_FAILED';handle?.cancel('emit');}};
  const trip=code=>{problem??=code;handle?.cancel(code);};
  const onStdout=chunk=>{stdoutBytes+=chunk.length;if(stdoutBytes>8192)return trip('OUTPUT_LIMIT');stdout.push(chunk);};
  const onStderr=chunk=>{stderrBytes+=chunk.length;if(stderrBytes>1024)trip('OUTPUT_LIMIT');};
  // Deliberately non-executable command/cwd. Flags and stdout schema are ASSUMED.
  const request={command:'MOCK_ONLY_AGY_NOT_EXECUTABLE',args:['--model='+MODEL,'--mode=plan','--output-format=json'],cwd:MOCK_CWD,env:{},shell:false,stdin:spec.prompt};
  try{handle=this.#transport.start(request,{onStdout,onStderr});}catch{return blocked('MOCK_TRANSPORT_FAILED');}
  const active={runId:spec.runId,handle,cancelRequested:false};this.#active=active;
  const onAbort=()=>{cancelRequested=true;handle.cancel('cancel');};spec.signal?.addEventListener('abort',onAbort,{once:true});if(spec.signal?.aborted)onAbort();
  send({type:'started',runId:spec.runId,requestedModel:MODEL});if(emitFailed)handle.cancel('emit');
  let proc;
  try{
   const deadline=new Promise(resolve=>{timer=setTimeout(async()=>{problem??='TIMEOUT';handle.cancel('timeout');resolve(await this.#wait(handle));},this.#timeout);});
   proc=await Promise.race([handle.done,deadline]);
  }finally{clearTimeout(timer);spec.signal?.removeEventListener('abort',onAbort);this.#active=null;}
  let parsed=null;
  try{
   const raw=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(stdout));
   if(!raw.endsWith('\n') || raw.indexOf('\n')!==raw.length-1 || Buffer.byteLength(raw)>4096)throw Error();
   const line=raw.slice(0,-1);parsed=JSON.parse(line);
   // Exact canonical framing rejects duplicate keys, extra frames/fields/prose.
   if(canonical(parsed)!==line || !exact(parsed,['model','nonce','text','type','version']) || parsed.version!==ASSUMED_PROTOCOL || parsed.type!=='result' || parsed.nonce!==spec.nonce || parsed.model!==MODEL || parsed.text!==`BLUE LANTERN ${spec.nonce}`)throw Error();
  }catch{parsed=null;}
  let code=null,outcome='unknown';
  if(proc.spawnError){code='SPAWN_FAILED';outcome='blocked';}
  else if(!proc.exitObserved)code='EXIT_NOT_OBSERVED';
  else if(!proc.processTreeExitObserved)code='PROCESS_TREE_UNCONFIRMED';
  else if(problem)code=problem;
  else if(cancelRequested || active.cancelRequested || proc.terminateReason==='cancel')outcome='cancelled';
  else if(proc.exitCode!==0){code='NONZERO_EXIT';outcome='failed';}
  else if(stderrBytes)code='STDERR_PRESENT';
  else if(!parsed)code='ASSUMED_PROTOCOL_MISMATCH';
  else outcome='completed';
  if(outcome==='completed')send({type:'output',message:parsed.text,reportedModel:parsed.model});
  if(emitFailed){outcome='unknown';code='EMIT_FAILED';}
  if(code)send({type:'error',code,message:'Offline connectivity fixture did not establish a clean matching outcome.'});
  send({type:'finished',outcome,exitCode:proc.exitCode});
  if(emitFailed){outcome='unknown';code='EMIT_FAILED';}
  return {...base,outcome,code,exitCode:proc.exitCode,signal:proc.signal,exitObserved:proc.exitObserved,processTreeExitObserved:proc.processTreeExitObserved,timeout:problem==='TIMEOUT',stdoutBytes,stderrBytes,mockProtocolMatched:outcome==='completed'};
 }
}
Object.freeze(AntigravityAdapter.prototype);
