// Real transport, GET-only observations. No executor, journal mutation, shell,
// live approval or claim writer is imported. All public results deny execution.
import { REPOSITORY } from './foundation.mjs';
import { bindIssue, digest, record, hex, validateBinding } from './security.mjs';
import { claimKey } from './claims.mjs';

const ROOT=`https://api.github.com/repos/${REPOSITORY}`;
const WEB=`https://github.com/${REPOSITORY}`;
const REPO_ID=1423925660, REPO_NODE='R_kgDOVN9hnA';
const MAX_BYTES=4*1024*1024, MAX_PAGES=5, MIN_REMAINING=20;
const pageURL=n=>`${ROOT}/issues?state=all&sort=created&direction=asc&per_page=100&page=${n}`;
const positive=n=>Number.isSafeInteger(n) && n>0;
const opaque=x=>typeof x==='string' && /^[A-Za-z0-9_+=/-]{1,256}$/.test(x);
class ReadError extends Error {}
const stop=code=>{throw new ReadError(code);};
const hold=reason=>({status:'HOLD',reason,execution_allowed:false});
const safe=e=>hold(e instanceof ReadError?e.message:'READ_FAILED');
const observed=fields=>({status:'READ_ONLY_OBSERVED',...fields,execution_allowed:false});
function githubTime(value) {
  if(typeof value!=='string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().replace('.000Z','Z')!==value)stop('INVALID_ISSUE_RESPONSE');
  return new Date(value).toISOString();
}
function nextPage(link,current,count) {
  if(!link) {if(count===100)stop('PAGINATION_AMBIGUOUS');return null;}
  let next=null,last=null; const relations=new Set();
  for(const part of link.split(',')) {
    const match=part.trim().match(/^<([^<>]+)>;\s*rel="(next|prev|first|last)"$/);
    if(!match || relations.has(match[2]))stop('INVALID_PAGINATION');
    relations.add(match[2]);
    let u;try{u=new URL(match[1]);}catch{stop('INVALID_PAGINATION');}
    const n=Number(u.searchParams.get('page'));
    const expected=new URL(pageURL(n));
    if(!positive(n) || u.origin!==expected.origin || u.pathname!==expected.pathname || u.username || u.password || u.hash || [...u.searchParams].length!==5 || ['state','sort','direction','per_page','page'].some(k=>u.searchParams.getAll(k).length!==1 || u.searchParams.get(k)!==expected.searchParams.get(k)))stop('INVALID_PAGINATION');
    if(match[2]==='first' && n!==1)stop('INVALID_PAGINATION');
    if(match[2]==='prev' && (current===1 || n!==current-1))stop('INVALID_PAGINATION');
    if(match[2]==='last') {if(n<current)stop('INVALID_PAGINATION');last=n;}
    if(match[2]==='next') {if(n!==current+1 || n>MAX_PAGES)stop('PAGINATION_LIMIT_OR_LOOP');next=n;}
  }
  if((last!==null && ((next===null && last>current) || (next!==null && last<next))) || (count===100 && next===null))stop('PAGINATION_AMBIGUOUS');
  return next;
}
function issueObservation(raw,expectedNumber) {
  if(!record(raw) || !positive(raw.id) || !positive(raw.number) || (expectedNumber!==undefined && raw.number!==expectedNumber) || !opaque(raw.node_id) || raw.repository_url!==ROOT || raw.url!==`${ROOT}/issues/${raw.number}` || !['open','closed'].includes(raw.state) || typeof raw.title!=='string' || !raw.title || Buffer.byteLength(raw.title)>1024 || (raw.body!==null && typeof raw.body!=='string'))stop('INVALID_ISSUE_RESPONSE');
  const created=githubTime(raw.created_at),updated=githubTime(raw.updated_at);
  if(Date.parse(updated)<Date.parse(created))stop('INVALID_ISSUE_RESPONSE');
  const pr=Object.hasOwn(raw,'pull_request');
  if(raw.html_url!==`${WEB}/${pr?'pull':'issues'}/${raw.number}` || (pr && (!record(raw.pull_request) || raw.pull_request.url!==`${ROOT}/pulls/${raw.number}`)))stop('INVALID_ISSUE_RESPONSE');
  const body=raw.body??'';
  const fields={issue_number:raw.number,issue_id:raw.node_id,issue_state:raw.state,updated_at:updated};
  if(pr)return {result:{...hold('PULL_REQUEST_EXCLUDED'),...fields},id:raw.id,pr:true};
  if(Buffer.byteLength(body)>16384)return {result:{...hold('TASK_BODY_TOO_LARGE'),...fields},id:raw.id};
  fields.revision_digest=digest({title:raw.title,body});
  let taskId=null;
  try {const p=JSON.parse(body);if(record(p) && typeof p.task_id==='string')taskId=p.task_id;}catch { /* non-contract Issue */ }
  let result;
  if(raw.state==='closed')result={...hold('ISSUE_CLOSED'),...fields};
  else {
    try {
      const binding=bindIssue({repository:REPOSITORY,issue_number:raw.number,issue_id:raw.node_id,state:raw.state,title:raw.title,body});
      result=observed({...fields,task_binding:binding,reason:'LIVE_ADMISSION_DISABLED'});
    }catch {result={...hold('TASK_SCHEMA_REJECTED'),...fields};}
  }
  return {result,id:raw.id,taskId};
}

/** Read-only API: readRepository(), readIssue(number, expectedPins), listIssues(),
 * observeClaimRef(binding). getToken is trusted caller configuration, not Issue
 * data. fetchImpl injection is for offline tests; no configurable host/path/method.
 * Every failure is sanitized and every method is a one-shot (no retry) read.
 */
export class ReadOnlyGitHub {
  #getToken; #fetch; #timeout;
  constructor({getToken,fetchImpl=globalThis.fetch,timeoutMs=5000}={}) {
    if(typeof getToken!=='function' || typeof fetchImpl!=='function' || !Number.isSafeInteger(timeoutMs) || timeoutMs<10 || timeoutMs>5000)stop('INVALID_READONLY_CONFIGURATION');
    this.#getToken=getToken;this.#fetch=fetchImpl;this.#timeout=timeoutMs;
  }
  async #request(url) {
    // Only internal, exact fixed paths can reach the transport.
    const path=url.startsWith(ROOT)?url.slice(ROOT.length):null;
    if(path!=='' && (path===null || (!/^\/issues(?:\/[1-9][0-9]*|\?state=all&sort=created&direction=asc&per_page=100&page=[1-5])$/.test(path) && !/^\/git\/ref\/heads\/cc-ag-claims\/v1\/[a-f0-9]{64}$/.test(path))))stop('ENDPOINT_NOT_ALLOWED');
    const controller=new AbortController(); let timer;
    const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ReadError('NETWORK_OR_TIMEOUT'));},this.#timeout);});
    const operation=async()=>{
      let token;try{token=await this.#getToken();}catch{stop('AUTHENTICATION_FAILED');}
      if(typeof token!=='string' || !/^[A-Za-z0-9_.-]{10,512}$/.test(token))stop('AUTHENTICATION_FAILED');
      if(controller.signal.aborted)stop('NETWORK_OR_TIMEOUT');
      let response;
      try {response=await this.#fetch(url,{method:'GET',redirect:'error',cache:'no-store',credentials:'omit',signal:controller.signal,headers:{accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',authorization:`Bearer ${token}`}});}catch{stop('NETWORK_OR_TIMEOUT');}
      if(response.status!==200) {
        const code=response.status===401?'AUTHENTICATION_FAILED':response.status===403?'FORBIDDEN_OR_RATE_LIMITED':response.status===404?'NOT_FOUND_OR_INACCESSIBLE':response.status===429?'RATE_LIMITED':response.status>=500?'GITHUB_UNAVAILABLE':'UNEXPECTED_HTTP_STATUS';
        stop(code);
      }
      if(response.url!==url || response.redirected)stop('UNTRUSTED_RESPONSE_ORIGIN');
      const h=response.headers, remaining=h.get('x-ratelimit-remaining'),limit=h.get('x-ratelimit-limit'),reset=h.get('x-ratelimit-reset'),requestId=h.get('x-github-request-id');
      if(!/^\d+$/.test(remaining??'') || !/^\d+$/.test(limit??'') || !/^\d+$/.test(reset??'') || !positive(Number(limit)) || !positive(Number(reset)) || Number(remaining)>Number(limit) || h.get('x-ratelimit-resource')!=='core')stop('RATE_LIMIT_EVIDENCE_MISSING');
      if(Number(remaining)<MIN_REMAINING)stop('RATE_LIMIT_HEADROOM_LOW');
      if(typeof requestId!=='string' || !/^[A-Za-z0-9:-]{1,128}$/.test(requestId))stop('RESPONSE_PROVENANCE_MISSING');
      if(!/^application\/(?:[a-z0-9.+-]+\+)?json(?:;|$)/i.test(h.get('content-type')??''))stop('INVALID_RESPONSE_TYPE');
      const length=h.get('content-length');
      if(length!==null && (!/^\d+$/.test(length) || Number(length)>MAX_BYTES))stop('RESPONSE_TOO_LARGE');
      let reader;const chunks=[];let bytes=0;
      try {
        reader=response.body.getReader();
        while(true) {
          const {done,value}=await reader.read();if(done)break;
          bytes+=value.byteLength;if(bytes>MAX_BYTES)stop('RESPONSE_TOO_LARGE');chunks.push(value);
        }
      }catch(e){if(reader)void reader.cancel().catch(()=>{});if(e instanceof ReadError)throw e;stop('PARTIAL_RESPONSE');}
      // GitHub may compress responses; encoded content-length then differs from
      // decoded bytes, so only enforce equality for identity/no content encoding.
      if(length!==null && !h.get('content-encoding') && Number(length)!==bytes)stop('PARTIAL_RESPONSE');
      let payload;try{payload=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{stop('INVALID_JSON_RESPONSE');}
      return {payload,link:h.get('link'),requestId,remaining:Number(remaining)};
    };
    try{return await Promise.race([operation(),deadline]);}finally{clearTimeout(timer);}
  }
  async #repository() {
    const r=await this.#request(ROOT),p=r.payload;
    if(!record(p) || p.id!==REPO_ID || p.node_id!==REPO_NODE || p.full_name!==REPOSITORY || p.private!==true || p.archived!==false || p.disabled!==false || p.url!==ROOT || p.html_url!==WEB)stop('REPOSITORY_IDENTITY_REJECTED');
    return observed({repository:REPOSITORY,repository_id:REPO_ID,repository_node_id:REPO_NODE,request_id:r.requestId,rate_remaining:r.remaining});
  }
  async readRepository() {try{return await this.#repository();}catch(e){return safe(e);}}
  async readIssue(number,pins={}) {
    try {
      if(!positive(number) || !record(pins) || Object.keys(pins).some(k=>!['expectedIssueId','expectedRevisionDigest'].includes(k)) || (Object.hasOwn(pins,'expectedIssueId') && !opaque(pins.expectedIssueId)) || (Object.hasOwn(pins,'expectedRevisionDigest') && !hex(pins.expectedRevisionDigest)))stop('INVALID_ISSUE_REQUEST');
      await this.#repository();const response=await this.#request(`${ROOT}/issues/${number}`);
      const {result}=issueObservation(response.payload,number);
      if(pins.expectedIssueId && result.issue_id!==pins.expectedIssueId)stop('ISSUE_IDENTITY_CHANGED');
      if(pins.expectedRevisionDigest && result.revision_digest!==pins.expectedRevisionDigest)stop('ISSUE_REVISION_CHANGED');
      return {...result,request_id:response.requestId,rate_remaining:response.remaining};
    }catch(e){return safe(e);}
  }
  async listIssues() {
    try {
      await this.#repository();const all=[];const ids=new Set(),nodes=new Set(),numbers=new Set();let page=1;
      while(page!==null) {
        const response=await this.#request(pageURL(page));
        if(!Array.isArray(response.payload) || response.payload.length>100)stop('INVALID_ISSUE_LIST');
        for(const raw of response.payload) {
          const item=issueObservation(raw);
          if(ids.has(item.id) || nodes.has(item.result.issue_id) || numbers.has(item.result.issue_number))stop('DUPLICATE_ISSUE_RESPONSE');
          ids.add(item.id);nodes.add(item.result.issue_id);numbers.add(item.result.issue_number);all.push(item);
        }
        page=nextPage(response.link,page,response.payload.length);
      }
      const candidates=all.filter(i=>!i.pr),counts=new Map();
      for(const i of candidates)if(i.taskId)counts.set(i.taskId,(counts.get(i.taskId)??0)+1);
      const items=candidates.map(i=>counts.get(i.taskId)>1?{...hold('DUPLICATE_TASK_ID'),issue_number:i.result.issue_number,issue_id:i.result.issue_id}:i.result);
      const valid=items.filter(i=>i.status==='READ_ONLY_OBSERVED').length;
      return observed({candidate_count:items.length,contract_valid_count:valid,rejected_count:items.length-valid,excluded_pr_count:all.length-candidates.length,items,next_eligible_task:null});
    }catch(e){return safe(e);}
  }
  async observeClaimRef(binding) {
    try {
      validateBinding(binding);await this.#repository();const ref=claimKey(binding),url=`${ROOT}/git/ref/${ref.slice(5)}`;
      const {payload:p}=await this.#request(url);
      if(!record(p) || p.ref!==ref || !opaque(p.node_id) || p.url!==`${ROOT}/git/refs/${ref.slice(5)}` || !record(p.object) || p.object.type!=='commit' || typeof p.object.sha!=='string' || !/^[a-f0-9]{40}$/.test(p.object.sha) || p.object.url!==`${ROOT}/git/commits/${p.object.sha}`)stop('CLAIM_REF_EVIDENCE_INVALID');
      return {...hold('CLAIM_MANIFEST_AND_PROTECTION_UNVERIFIED'),observation:'REF_PRESENT_UNVERIFIED_MANIFEST',ref,commit_sha:p.object.sha};
    }catch(e){return safe(e);}
  }
}
export function liveClaimPreflight() {
  return {...hold('LIVE_CLAIM_NOT_AUTHORIZED'),requirements:['INDEPENDENT_HUMAN_APPROVAL','IMMUTABLE_MANIFEST_AND_REF_PROTECTION','LAB_ONLY_LEAST_PRIVILEGE_CREDENTIAL','PROVEN_CONCURRENCY_AND_TIMEOUT_RECONCILIATION','JOURNAL_AND_AUTOMATION_GATE','EXPLICIT_ONE_SHOT_WRITE_AUTHORIZATION']};
}
