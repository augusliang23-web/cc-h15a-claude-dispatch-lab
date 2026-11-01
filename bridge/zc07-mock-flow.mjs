// ZC-07: Pure, synthetic Zero-Copy control-flow rehearsal.
// NO provider, filesystem, GitHub API, Git CLI, network or Mac configuration use.
// All PRs, commits, CI outcomes and Codex verdicts below are explicitly MOCKED.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const hash = value => createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(value))
  .digest('hex');
const MODES = Object.freeze({
  mode: 'OFFLINE_SYNTHETIC_ONLY',
  provider_calls: 0,
  github_writes: 0,
  mac_settings_writes: 0,
  real_pr_created: false,
  real_qa_requested: false,
});
const allowedFaults = new Set(['none','ci-fail','qa-reject','review-sha-mismatch']);
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const isObject = o => o !== null && typeof o === 'object' && !Array.isArray(o);
const keysExactly = (o,keys) => Object.keys(o).length === keys.length &&
  Object.keys(o).every(k => keys.includes(k));
const safeTask = task => isObject(task) &&
  keysExactly(task,['task_id','workspace','objective','target_path']) &&
  typeof task.task_id === 'string' &&
  /^[A-Z][A-Z0-9-]{2,49}$/.test(task.task_id) &&
  task.workspace === 'synthetic-only' &&
  typeof task.objective === 'string' &&
  task.objective.length >= 1 && task.objective.length <= 240 &&
  !/[\r\n\x00-\x1f]/.test(task.objective) &&
  typeof task.target_path === 'string' &&
  /^docs\/fixture-[a-z0-9-]{1,40}\.md$/.test(task.target_path);

export const DEMO_TASK = Object.freeze({
  task_id:'ZC07-DEMO-001',
  workspace:'synthetic-only',
  objective:'Demonstrate a fixture-only task through a simulated independent QA gate',
  target_path:'docs/fixture-demo.md',
});

export function simulateZeroCopy({task=DEMO_TASK,fault='none'}={}) {
  const trace=[];
  let previous='GENESIS';
  const emit=(event,actor,detail={})=>{
    const e={seq:trace.length+1,event,actor,previous,detail};
    const digest=hash(e);
    trace.push({...e,digest});
    previous=digest;
  };
  const finish=(gate,reason)=>{
    if(gate!=='ZC07_MOCK_FLOW_PASS_NOT_LIVE_AUTHORIZED')
      emit('gate.hold','mock-control-plane',{reason});
    return Object.freeze({...MODES,gate,reason,trace,
      trace_digest:previous,synthetic:true,
      requires_owner_approval:true});
  };
  if(!safeTask(task))return finish('ZC07_MOCK_HOLD','INVALID_SYNTHETIC_TASK');
  if(!allowedFaults.has(fault))return finish('ZC07_MOCK_HOLD','INVALID_TEST_FAULT');
  if(own(task,'__proto__')||own(task,'constructor')||own(task,'prototype'))
    return finish('ZC07_MOCK_HOLD','UNTRUSTED_TASK_KEY');
  const taskProof=hash(task);
  emit('task.accepted','mock-control-plane',{task_id:task.task_id,task_digest:taskProof});
  emit('dispatch.accepted','mock-gemini',{task_digest:taskProof,tools_allowed:0});
  const candidate='SIMULATED-'+hash(taskProof+':fixture-candidate').slice(0,16);
  emit('candidate.proposed','mock-gemini',{commit: candidate,patch_applied:false,
    target_path:task.target_path,pr:'SIMULATED_ONLY'});
  if(fault==='ci-fail') {
    emit('ci.failed','mock-github',{commit:candidate,tests:1,fail:1});
    return finish('ZC07_MOCK_HOLD','SYNTHETIC_CI_FAILED');
  }
  emit('ci.passed','mock-github',{commit:candidate,tests:1,pass:1,fail:0});
  const reviewed=fault==='review-sha-mismatch'?'SIMULATED-WRONG-SHA':candidate;
  if(reviewed!==candidate){
    emit('qa.mismatch','mock-codex',{candidate,reviewed});
    return finish('ZC07_MOCK_HOLD','SYNTHETIC_QA_WRONG_SHA');
  }
  if(fault==='qa-reject'){
    emit('qa.rejected','mock-codex',{reviewed,findings:1});
    return finish('ZC07_MOCK_HOLD','SYNTHETIC_QA_REJECTED');
  }
  emit('qa.approved','mock-codex',{reviewed,findings:0});
  emit('gate.owner_review','mock-control-plane',{candidate,
    production_ready:false,provider_verified:false});
  return finish('ZC07_MOCK_FLOW_PASS_NOT_LIVE_AUTHORIZED','SYNTHETIC_ONLY');
}

export function verifyTrace(envelope) {
  if(!isObject(envelope)||envelope.mode!==MODES.mode ||
    envelope.provider_calls!==0||envelope.github_writes!==0||
    envelope.mac_settings_writes!==0||envelope.real_pr_created!==false||
    envelope.real_qa_requested!==false||envelope.synthetic!==true||
    !Array.isArray(envelope.trace))return false;
  let previous='GENESIS';
  for(let i=0;i<envelope.trace.length;i++){
    const e=envelope.trace[i];
    if(!isObject(e)||!keysExactly(e,
      ['seq','event','actor','previous','detail','digest']) ||
      e.seq!==i+1||e.previous!==previous||
      typeof e.event!=='string'||typeof e.actor!=='string'||
      !isObject(e.detail))return false;
    const {digest,...unsigned}=e;
    if(digest!==hash(unsigned))return false;
    previous=digest;
  }
  if(envelope.trace_digest!==previous)return false;
  const events=envelope.trace.map(e=>e.event);
  if(envelope.gate==='ZC07_MOCK_FLOW_PASS_NOT_LIVE_AUTHORIZED')
    return JSON.stringify(events)===JSON.stringify([
      'task.accepted','dispatch.accepted','candidate.proposed',
      'ci.passed','qa.approved','gate.owner_review']) &&
      envelope.reason==='SYNTHETIC_ONLY';
  return envelope.gate==='ZC07_MOCK_HOLD' &&
    events.at(-1)==='gate.hold';
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const arg=process.argv.length===3?process.argv[2]:'';
  const output=arg==='--demo'
    ?simulateZeroCopy()
    :{...MODES,synthetic:true,requires_owner_approval:true,gate:'ZC07_MOCK_HOLD',
      reason:'ONLY_OFFLINE_DEMO_ALLOWED',trace:[],trace_digest:'GENESIS'};
  process.stdout.write(JSON.stringify(output)+'\n');
  if(output.gate!=='ZC07_MOCK_FLOW_PASS_NOT_LIVE_AUTHORIZED')process.exitCode=2;
}
