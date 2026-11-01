// ZC-09A: PURE OFFLINE Auto-Continue eligibility decisions.
// No worker launch, provider integration, GitHub write, agent or timer.
// "AUTO_RETRY_ELIGIBLE_MOCK" is a recommendation, NEVER a dispatch authorization.
import {createHash} from 'node:crypto';

const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Z][A-Z0-9-]{2,55}$/;
const REPO = /^augusliang23-web\/cc-h15a-claude-dispatch-lab$/;
const EVENT = /^[A-Za-z0-9._-]{4,96}$/;
const EXACT_POLICY_KEYS = ['mode','task','policy','evidence','history','now'];
const EXPECTED_TASK = ['id','repo','pr','head','paths','approval'];
const EXPECTED_POLICY = ['maxAttempts','attemptCostUsd','maxCostUsd','maxSeconds','maxAgeSeconds'];
const EXPECTED_EVIDENCE = ['eventId','observedAt','ci','qa'];
const EXPECTED_CI = ['head','status','checkedAt'];
const EXPECTED_QA = ['head','status','checkedAt','findings'];
const EXPECTED_HISTORY = ['attemptsUsed','costSpentUsd','elapsedSeconds','processedEventIds'];
const SEVERITIES = new Set(['P0','P1','P2','P3']);
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const exact = (value, keys) => obj(value) && Object.keys(value).length === keys.length &&
  Object.keys(value).every(k => keys.includes(k));
const iso = s => typeof s === 'string' && !Number.isNaN(Date.parse(s)) &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(s);
const money = n => typeof n === 'number' && Number.isFinite(n) &&
  n >= 0 && Number.isInteger(Math.round(n*100)) && Math.abs(n*100 - Math.round(n*100)) < 1e-7;
const sha = s => typeof s === 'string' && SHA.test(s);
const digest = o => createHash('sha256').update(JSON.stringify(o)).digest('hex');

const RESULT = Object.freeze({
  mode:'OFFLINE_SYNTHETIC_ONLY', actual_dispatch:false, provider_calls:0,
  github_writes:0, mac_writes:0, merger:false,
});
function answer(gate,reason,raw=null){
  const decision = raw ? digest({
    task:raw.task.id,head:raw.task.head,event:raw.evidence.eventId,
    attempts:raw.history.attemptsUsed,gate,reason,
  }) : null;
  return {...RESULT,gate,reason,decision_id:decision,
    owner_approval_required:true,ready_to_merge:false};
}
function valid(x) {
 if(!exact(x,EXACT_POLICY_KEYS) || x.mode!=='OFFLINE_SYNTHETIC_ONLY')return false;
 const {task:t,policy:p,evidence:e,history:h,now}=x;
 if(!exact(t,EXPECTED_TASK)||!ID.test(t.id)||!REPO.test(t.repo)||!Number.isSafeInteger(t.pr)||
    t.pr<1||!sha(t.head)||t.approval!=='SYNTHETIC_PREAPPROVED'||
    !Array.isArray(t.paths)||t.paths.length===0||t.paths.length>5||
    new Set(t.paths).size!==t.paths.length||
    !t.paths.every(s=>typeof s==='string'&&/^bridge\/fixture-[a-z0-9-]{1,32}\.mjs$/.test(s)))return false;
 if(!exact(p,EXPECTED_POLICY)||!Number.isSafeInteger(p.maxAttempts)||
    p.maxAttempts<1||p.maxAttempts>3||!money(p.attemptCostUsd)||
    p.attemptCostUsd<=0||p.attemptCostUsd>5||
    !money(p.maxCostUsd)||p.maxCostUsd<=0||p.maxCostUsd>10||
    !Number.isSafeInteger(p.maxSeconds)||p.maxSeconds<1||p.maxSeconds>3600||
    !Number.isSafeInteger(p.maxAgeSeconds)||p.maxAgeSeconds<1||p.maxAgeSeconds>300)return false;
 if(!exact(e,EXPECTED_EVIDENCE)||!EVENT.test(e.eventId)||!iso(e.observedAt)||
    !exact(e.ci,EXPECTED_CI)||!exact(e.qa,EXPECTED_QA)||
    !sha(e.ci.head)||!sha(e.qa.head)||
    !['SUCCESS','FAILURE','RUNNING','UNKNOWN'].includes(e.ci.status)||
    !['APPROVED','CHANGES_REQUESTED','NOT_RUN','RUNNING','UNKNOWN'].includes(e.qa.status)||
    !iso(e.ci.checkedAt)||!iso(e.qa.checkedAt)||
    !Array.isArray(e.qa.findings)||e.qa.findings.length>10||
    !e.qa.findings.every(f=>exact(f,['severity','category'])&&SEVERITIES.has(f.severity)&&
      ['functional','security','permissions','billing','scope'].includes(f.category)))return false;
 if(!exact(h,EXPECTED_HISTORY)||!Number.isSafeInteger(h.attemptsUsed)||
    h.attemptsUsed<0||h.attemptsUsed>3||!money(h.costSpentUsd)||
    h.costSpentUsd>10||!Number.isSafeInteger(h.elapsedSeconds)||
    h.elapsedSeconds<0||h.elapsedSeconds>3600||
    !Array.isArray(h.processedEventIds)||h.processedEventIds.length>50||
    new Set(h.processedEventIds).size!==h.processedEventIds.length||
    !h.processedEventIds.every(s=>typeof s==='string'&&EVENT.test(s))||
    !iso(now))return false;
 return true;
}

export function decideAutoContinue(x) {
 if(!valid(x))return answer('HOLD','INVALID_OFFLINE_ENVELOPE');
 const {task:t,policy:p,evidence:e,history:h}=x;
 const xNow=Date.parse(x.now);
 if(h.processedEventIds.includes(e.eventId))return answer('HOLD','DUPLICATE_EVENT',x);
 if(e.ci.head!==t.head||e.qa.head!==t.head)return answer('HOLD','EXACT_HEAD_MISMATCH',x);
 for(const time of [e.observedAt,e.ci.checkedAt,e.qa.checkedAt]){
   const age=xNow-Date.parse(time);
   if(age < -30_000 || age>p.maxAgeSeconds*1000)
     return answer('HOLD','STALE_OR_FUTURE_EVIDENCE',x);
 }
 if(e.ci.status==='UNKNOWN'||e.qa.status==='UNKNOWN')
   return answer('HOLD','UNVERIFIED_EXTERNAL_STATE',x);
 if(e.qa.findings.some(f=>f.severity!=='P3' || f.category!=='functional'))
   return answer('HOLD','HUMAN_REVIEW_SECURITY_OR_P2',x);
 if(e.ci.status==='RUNNING'||e.qa.status==='RUNNING')
   return answer('WAITING_EVIDENCE','RUNNING_REPORTED_BY_FIXTURE_NOT_VERIFIED',x);
 if(e.ci.status==='SUCCESS' && e.qa.status==='APPROVED' && e.qa.findings.length===0)
   return answer('READY_FOR_OWNER','CI_AND_QA_SYNTHETIC_PASS_NO_MERGE',x);
 if(e.ci.status==='SUCCESS' && e.qa.status==='APPROVED')
   return answer('HOLD','QA_APPROVAL_WITH_FINDINGS',x);
 const eligible=e.ci.status==='FAILURE'&&e.qa.status==='NOT_RUN'&&e.qa.findings.length===0 ||
     e.ci.status==='SUCCESS'&&e.qa.status==='CHANGES_REQUESTED'&&e.qa.findings.length>0;
 if(!eligible)return answer('HOLD','CONTRADICTORY_CI_QA_STATE',x);
 if(h.attemptsUsed>=p.maxAttempts)return answer('HOLD','RETRY_ATTEMPT_CAP_REACHED',x);
 if(Math.round((h.costSpentUsd+p.attemptCostUsd)*100)>Math.round(p.maxCostUsd*100))
   return answer('HOLD','COST_CAP_REACHED',x);
 if(h.elapsedSeconds>=p.maxSeconds)return answer('HOLD','TIME_CAP_REACHED',x);
 return answer('AUTO_RETRY_ELIGIBLE_MOCK','BOUNDED_OFFLINE_RETRY_RECOMMENDATION',x);
}

export const FIXTURE = Object.freeze({
 mode:'OFFLINE_SYNTHETIC_ONLY',
 task:{id:'ZC09-DEMO-001',repo:'augusliang23-web/cc-h15a-claude-dispatch-lab',
   pr:99,head:'0123456789abcdef0123456789abcdef01234567',
   paths:['bridge/fixture-demo.mjs'],approval:'SYNTHETIC_PREAPPROVED'},
 policy:{maxAttempts:2,attemptCostUsd:0.25,maxCostUsd:0.5,maxSeconds:300,maxAgeSeconds:300},
 evidence:{eventId:'event-0001',observedAt:'2026-11-01T02:00:00Z',
   ci:{head:'0123456789abcdef0123456789abcdef01234567',status:'FAILURE',checkedAt:'2026-11-01T02:00:00Z'},
   qa:{head:'0123456789abcdef0123456789abcdef01234567',status:'NOT_RUN',checkedAt:'2026-11-01T02:00:00Z',findings:[]}},
 history:{attemptsUsed:0,costSpentUsd:0,elapsedSeconds:10,processedEventIds:[]},
 now:'2026-11-01T02:00:15Z',
});
