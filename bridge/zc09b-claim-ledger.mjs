// ZC-09B1: deterministic SYNTHETIC claim proposal, not a worker, lock, or database.
// No fs, network, GitHub, provider, platform or command invocation is reachable.
import {createHash} from 'node:crypto';

const PROTOCOL='ZC09B1_SYNTHETIC_V1';
const LAB='augusliang23-web/cc-h15a-claude-dispatch-lab';
const flags=Object.freeze({mode:'SYNTHETIC_OFFLINE_ONLY',actual_dispatch:false,
 provider_calls:0,github_writes:0,mac_writes:0,ready_to_merge:false,
 owner_approval_required:true,durable_claim:false});
const exact=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const id=x=>typeof x==='string'&&/^[a-z][a-z0-9-]{3,49}$/.test(x);
const date=x=>{
 if(typeof x!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(x))return NaN;
 const t=Date.parse(x);
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,19)===x.slice(0,19)?t:NaN;
};
const same=(x,y)=>x.taskId===y.taskId&&x.repo===y.repo&&x.pr===y.pr&&x.sha===y.sha;
const hash=s=>createHash('sha256').update(s).digest('hex');
const out=(gate,reason,proposed_ledger=null)=>({...flags,gate,reason,proposed_ledger});
const hold=r=>out('HOLD',r);
const taskOk=t=>exact(t,['taskId','repo','pr','sha'])&&id(t.taskId)&&
 t.repo===LAB&&Number.isInteger(t.pr)&&t.pr>=1&&t.pr<=9999999&&sha(t.sha);
const leaseOk=l=>l===null||(exact(l,['leaseId','claimEventId','expiresAt','sha'])&&
 typeof l.leaseId==='string'&&/^[a-f0-9]{64}$/.test(l.leaseId)&&
 id(l.claimEventId)&&Number.isFinite(date(l.expiresAt))&&sha(l.sha));
const proofOk=p=>exact(p,['source','ci','ciHead','ciCheckedAt','qa','qaHead','qaCheckedAt','findings','risk','permissionsChanged'])&&
 p.source==='SYNTHETIC_ONLY'&&['PASS','FAIL','UNKNOWN'].includes(p.ci)&&
 ['PASS','FAIL','UNKNOWN'].includes(p.qa)&&sha(p.ciHead)&&sha(p.qaHead)&&
 Number.isFinite(date(p.ciCheckedAt))&&Number.isFinite(date(p.qaCheckedAt))&&
 Number.isInteger(p.findings)&&p.findings>=0&&p.findings<=99&&
 ['LOW','MEDIUM','HIGH','SECURITY'].includes(p.risk)&&typeof p.permissionsChanged==='boolean';
const ledgerOk=l=>exact(l,['protocol','revision','task','maxClaims','maxLeaseSeconds','usedClaims','lastObservedAt','seenEvents','activeLease','terminalGate'])&&
 l.protocol===PROTOCOL&&taskOk(l.task)&&Number.isSafeInteger(l.revision)&&l.revision>=0&&
 Number.isInteger(l.maxClaims)&&l.maxClaims>=1&&l.maxClaims<=3&&
 Number.isInteger(l.maxLeaseSeconds)&&l.maxLeaseSeconds>=30&&l.maxLeaseSeconds<=600&&
 Number.isInteger(l.usedClaims)&&l.usedClaims>=0&&l.usedClaims<=l.maxClaims&&
 (l.lastObservedAt===null||Number.isFinite(date(l.lastObservedAt)))&&
 Array.isArray(l.seenEvents)&&l.seenEvents.length<=16&&
 l.seenEvents.every(id)&&new Set(l.seenEvents).size===l.seenEvents.length&&
 leaseOk(l.activeLease)&&['NONE','SAFETY_HOLD','READY_FOR_OWNER'].includes(l.terminalGate)&&
 (l.seenEvents.length===0)===(l.lastObservedAt===null)&&
 (l.activeLease===null||l.activeLease.sha===l.task.sha)&&
 (l.terminalGate==='NONE'||l.activeLease===null);
const eventOk=e=>exact(e,['protocol','eventId','kind','observedAt','task','proof','leaseId','completion'])&&
 e.protocol===PROTOCOL&&id(e.eventId)&&['CLAIM','COMPLETE','HALT'].includes(e.kind)&&
 Number.isFinite(date(e.observedAt))&&taskOk(e.task)&&proofOk(e.proof)&&
 (e.leaseId===null||(typeof e.leaseId==='string'&&/^[a-f0-9]{64}$/.test(e.leaseId)))&&
 (e.completion===null||['PASS','FAIL'].includes(e.completion))&&
 (e.kind==='COMPLETE'?e.leaseId!==null&&e.completion!==null:e.leaseId===null&&e.completion===null);

export function proposeClaimTransition(input) {
 if(!exact(input,['ledger','event','expectedRevision','now']))return hold('INVALID_ENVELOPE');
 const {ledger:l,event:e,expectedRevision:expected,now}=input;
 if(!ledgerOk(l)||!eventOk(e)||!Number.isSafeInteger(expected)||
    !Number.isFinite(date(now)))return hold('INVALID_ENVELOPE');
 if(expected!==l.revision)return hold('REVISION_CONFLICT');
 if(!same(l.task,e.task))return hold('IMMUTABLE_SCOPE_MISMATCH');
 if(l.terminalGate!=='NONE')return hold('STICKY_TERMINAL_GATE');
 if(l.seenEvents.includes(e.eventId))return hold('DUPLICATE_EVENT');
 const at=date(e.observedAt),clock=date(now),last=date(l.lastObservedAt);
 if((l.lastObservedAt!==null&&at<=last))return hold('SUPERSEDED_EVENT');
 if(at>clock||clock-at>300_000)return hold('STALE_OR_FUTURE_EVENT');
 if(l.seenEvents.length>=16)return hold('EVENT_HISTORY_FULL');
 const p=e.proof;
 const ciTime=date(p.ciCheckedAt),qaTime=date(p.qaCheckedAt);
 if(ciTime>at||qaTime>at||at-ciTime>300_000||at-qaTime>300_000)
   return hold('STALE_OR_FUTURE_PROOF');
 const advance=(terminalGate=l.terminalGate,activeLease=l.activeLease,usedClaims=l.usedClaims)=>({
  ...l,revision:l.revision+1,lastObservedAt:e.observedAt,
  seenEvents:[...l.seenEvents,e.eventId],terminalGate,activeLease,usedClaims
 });
 // Safety stops are sticky; on explicit HALT or unsafe evidence, never claim another worker.
 if(e.kind==='HALT'||p.risk==='HIGH'||p.risk==='SECURITY'||
    p.permissionsChanged||p.findings>0)
   return out('HOLD','SAFETY_GATE',advance('SAFETY_HOLD',null));
 if(p.ciHead!==l.task.sha||p.qaHead!==l.task.sha)
   return hold('EXACT_HEAD_MISMATCH');
 if(p.ci!=='PASS'||p.qa!=='PASS')return hold('CI_QA_NOT_VERIFIED');
 if(e.kind==='CLAIM') {
  if(l.activeLease!==null)return hold('ACTIVE_OR_EXPIRED_LEASE_REQUIRES_RECONCILIATION');
  if(l.usedClaims>=l.maxClaims)return hold('ATTEMPT_CAP_REACHED');
  const leaseId=hash([PROTOCOL,l.task.taskId,l.task.sha,e.eventId,l.revision].join('|'));
  const expiresAt=new Date(at+l.maxLeaseSeconds*1000).toISOString().replace('.000Z','Z');
  return out('MOCK_CLAIM_PROPOSED','REVISION_PINNED_NOT_DURABLE',
    advance('NONE',{leaseId,claimEventId:e.eventId,expiresAt,sha:l.task.sha},l.usedClaims+1));
 }
 if(e.kind==='COMPLETE') {
  if(l.activeLease===null)return hold('NO_ACTIVE_LEASE');
  if(e.leaseId!==l.activeLease.leaseId)return hold('LEASE_MISMATCH');
  if(at>date(l.activeLease.expiresAt))return hold('EXPIRED_LEASE_REQUIRES_RECONCILIATION');
  return e.completion==='PASS'
   ?out('READY_FOR_OWNER','SYNTHETIC_COMPLETION_NEVER_MERGE',advance('READY_FOR_OWNER',null))
   :out('MOCK_RETRY_ALLOWED','FAILURE_RECORDED_NO_DISPATCH',advance('NONE',null));
 }
 return hold('UNKNOWN_EVENT');
}

export const SYNTHETIC_FIXTURE=Object.freeze({
 ledger:{
  protocol:PROTOCOL,revision:0,
  task:{taskId:'zc09b1-fixture',repo:LAB,pr:39,sha:'a'.repeat(40)},
  maxClaims:2,maxLeaseSeconds:120,usedClaims:0,
  lastObservedAt:null,seenEvents:[],activeLease:null,terminalGate:'NONE'
 },
 event:{
  protocol:PROTOCOL,eventId:'event-0001',kind:'CLAIM',
  observedAt:'2026-11-01T01:01:00Z',
  task:{taskId:'zc09b1-fixture',repo:LAB,pr:39,sha:'a'.repeat(40)},
  proof:{source:'SYNTHETIC_ONLY',ci:'PASS',ciHead:'a'.repeat(40),
   ciCheckedAt:'2026-11-01T01:00:30Z',qa:'PASS',qaHead:'a'.repeat(40),
   qaCheckedAt:'2026-11-01T01:00:40Z',findings:0,risk:'LOW',permissionsChanged:false},
  leaseId:null,completion:null
 },
 expectedRevision:0,now:'2026-11-01T01:01:05Z'
});
