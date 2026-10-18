// Offline AG2B-1 foundation. No network, subprocess, credentials or durable writes.
import { randomUUID } from 'node:crypto';

export const REPOSITORY = 'augusliang23-web/cc-h15a-claude-dispatch-lab';
const FIXED = Object.freeze({ contract_version:'CC_AG_BRIDGE_V1', repository:REPOSITORY, agent:'antigravity', model:'gemini-3.8-flash-low', task_type:'synthetic', execution_mode:'dry-run', approval:'approved', status:'QUEUED' });
const TASK_KEYS = [...Object.keys(FIXED),'task_id','issue_number'];
const ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype;
const exactKeys = (x, keys) => record(x) && Object.keys(x).length === keys.length && keys.every(k => Object.hasOwn(x,k));
const fail = code => { throw new Error(code); };
const issueNumber = n => Number.isSafeInteger(n) && n > 0;

export function validateTask(value) {
  if (!exactKeys(value,TASK_KEYS)) fail('INVALID_TASK_SCHEMA');
  for (const [key,expected] of Object.entries(FIXED)) if (value[key] !== expected) fail(`INVALID_${key.toUpperCase()}`);
  if (typeof value.task_id !== 'string' || !ID.test(value.task_id)) fail('INVALID_TASK_ID');
  if (!issueNumber(value.issue_number)) fail('INVALID_ISSUE_NUMBER');
  return Object.freeze({...value});
}

const TRANSITIONS = Object.freeze({QUEUED:['CLAIMED'],CLAIMED:['RUNNING'],RUNNING:['COMPLETED','FAILED','INTERRUPTED'],INTERRUPTED:['BLOCKED']});
export function transition(from,to) {
  if (!Object.hasOwn(TRANSITIONS,from) || !TRANSITIONS[from].includes(to)) fail('INVALID_STATE_TRANSITION');
  return to;
}
const active = events => ['CLAIMED','RUNNING','INTERRUPTED'].includes(events.at(-1));

// Mock-only ownership model. Snapshots are test inputs, never trusted live admission.
export class MockOwnership {
  #entries;
  constructor(history = []) {
    if (!Array.isArray(history)) fail('INVALID_HISTORY');
    const seen = new Set(); let activeCount = 0;
    this.#entries = history.map(entry => {
      if (!exactKeys(entry,['task_id','events']) || typeof entry.task_id !== 'string' || !ID.test(entry.task_id) || seen.has(entry.task_id) || !Array.isArray(entry.events) || entry.events.length < 2 || entry.events[0] !== 'QUEUED') fail('INVALID_HISTORY');
      seen.add(entry.task_id);
      for (let i=1;i<entry.events.length;i++) transition(entry.events[i-1],entry.events[i]);
      if (active(entry.events)) activeCount++;
      return {task_id:entry.task_id,events:[...entry.events]};
    });
    if (activeCount>1) fail('MULTIPLE_ACTIVE_TASKS');
  }
  snapshot() { return this.#entries.map(e=>({task_id:e.task_id,events:[...e.events]})); }
  claim(input) {
    const task=validateTask(input);
    if (this.#entries.some(e=>e.task_id===task.task_id)) fail('TASK_ALREADY_SEEN');
    if (this.#entries.some(e=>active(e.events))) fail('BRIDGE_BUSY');
    this.#entries.push({task_id:task.task_id,events:['QUEUED',transition('QUEUED','CLAIMED')]});
  }
  advance(id,state) {
    const entry=this.#entries.find(e=>e.task_id===id);
    if (!entry) fail('UNKNOWN_TASK');
    entry.events.push(transition(entry.events.at(-1),state));
  }
  recover() {
    for (const e of this.#entries) {
      if (e.events.at(-1)==='RUNNING') this.advance(e.task_id,'INTERRUPTED');
      if (e.events.at(-1)==='INTERRUPTED') this.advance(e.task_id,'BLOCKED');
      // CLAIMED is uncertain: keep reserved; manual reconciliation required.
    }
    return this.snapshot();
  }
}

export class FixtureQueueReader {
  #response;
  constructor(response) { this.#response=structuredClone(response); }
  async readPending() { return structuredClone(this.#response); }
}
const empty = () => ({status:'HOLD',candidate_count:0,valid_count:0,rejected_count:0,rejections:[],next_eligible_task:null});
const UNAVAILABLE = new Set(['offline','asleep','restarted','network-unavailable','github-unavailable','cli-unavailable','authentication-expired']);

export async function dryRun(reader,{availability='available',history=[]}={}) {
  let response;
  try { response=await reader.readPending(); } catch { return {...empty(),reason:'QUEUE_READ_FAILED'}; }
  if (!exactKeys(response,['repository','issues']) || response.repository!==REPOSITORY || !Array.isArray(response.issues) || response.issues.length>1000) return {...empty(),reason:'INVALID_QUEUE_RESPONSE'};
  let previous;
  try { previous=new Set(new MockOwnership(history).snapshot().map(e=>e.task_id)); }
  catch { return {...empty(),reason:'INVALID_HISTORY'}; }
  const parsed=response.issues.map(issue=>{
    try {
      if (!record(issue) || typeof issue.body!=='string' || Buffer.byteLength(issue.body)>16384) return null;
      return JSON.parse(issue.body);
    } catch { return null; }
  });
  const counts=new Map();
  for (const p of parsed) if (record(p) && typeof p.task_id==='string') counts.set(p.task_id,(counts.get(p.task_id)||0)+1);
  const valid=[]; const rejections=[];
  response.issues.forEach((issue,index)=>{
    let reason=null; let task;
    const p=parsed[index];
    if (record(p) && counts.get(p.task_id)>1) reason='DUPLICATE_TASK_ID';
    else {
      try {
        task=validateTask(p);
        if (!record(issue) || issue.state!=='open' || Object.hasOwn(issue,'pull_request') || issue.number!==task.issue_number) fail('INVALID_ISSUE_ENVELOPE');
        if (previous.has(task.task_id)) fail('TASK_ALREADY_SEEN');
      } catch (error) { reason=error.message; }
    }
    // Never echo bodies, titles, unknown IDs or external exception messages.
    if (reason) rejections.push({candidate_index:index,reason}); else valid.push(task);
  });
  valid.sort((a,b)=>a.issue_number-b.issue_number || a.task_id.localeCompare(b.task_id));
  const result={status:'READY_FOR_REVIEW',candidate_count:response.issues.length,valid_count:valid.length,rejected_count:rejections.length,rejections,next_eligible_task:valid[0]||null};
  if (availability!=='available') {
    return {...result,status:'HOLD',next_eligible_task:null,reason:UNAVAILABLE.has(availability)?`AVAILABILITY_${availability.toUpperCase().replaceAll('-','_')}`:'INVALID_AVAILABILITY'};
  }
  // Even a different candidate cannot bypass an existing active reservation.
  if (new MockOwnership(history).snapshot().some(e=>active(e.events))) return {...result,status:'HOLD',next_eligible_task:null,reason:'BRIDGE_BUSY'};
  return result;
}

export function executeLive() { fail('LIVE_EXECUTION_DISABLED'); }
export function claimLive() { fail('LIVE_CLAIMING_DISABLED'); }

const RESULT_KEYS=['result_version','task_id','issue_number','agent','model','execution_status','started_at','finished_at','result','error_code','files_modified','commits_created','report_marker','simulated'];
export function validateResult(r) {
  if (!exactKeys(r,RESULT_KEYS) || r.result_version!=='CC_AG_RESULT_V1' || r.simulated!==true || typeof r.task_id!=='string' || !ID.test(r.task_id) || !issueNumber(r.issue_number) || r.agent!=='antigravity' || r.model!=='gemini-3.8-flash-low' || r.execution_status!=='COMPLETED' || r.result!=='BLUE LANTERN' || r.error_code!==null || !Array.isArray(r.files_modified) || r.files_modified.length!==0 || !Array.isArray(r.commits_created) || r.commits_created.length!==0 || typeof r.report_marker!=='string' || !/^CC_AG_BRIDGE_V1_MOCK_[0-9a-f-]{36}$/.test(r.report_marker)) fail('INVALID_RESULT');
  for (const key of ['started_at','finished_at']) if (typeof r[key]!=='string' || !Number.isFinite(Date.parse(r[key])) || new Date(r[key]).toISOString()!==r[key]) fail('INVALID_RESULT');
  if (Date.parse(r.finished_at)<Date.parse(r.started_at)) fail('INVALID_RESULT');
  return structuredClone(r);
}

// No executable path, command, prompt, mode switch, or process launcher exists.
export class MockAntigravityAdapter {
  validateConfiguration() { return Object.freeze({adapter:'mock',live_execution_enabled:false}); }
  prepareTask(input) { return validateTask(input); }
  executeTask(input) {
    const task=validateTask(input); const now=new Date().toISOString();
    return validateResult({result_version:'CC_AG_RESULT_V1',task_id:task.task_id,issue_number:task.issue_number,agent:task.agent,model:task.model,execution_status:'COMPLETED',started_at:now,finished_at:now,result:'BLUE LANTERN',error_code:null,files_modified:[],commits_created:[],report_marker:`CC_AG_BRIDGE_V1_MOCK_${randomUUID()}`,simulated:true});
  }
  collectResult(result) { return validateResult(result); }
}
