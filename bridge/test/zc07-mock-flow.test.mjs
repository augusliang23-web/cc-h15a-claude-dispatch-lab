import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {simulateZeroCopy,verifyTrace,DEMO_TASK} from '../zc07-mock-flow.mjs';

const gate='ZC07_MOCK_FLOW_PASS_NOT_LIVE_AUTHORIZED';
const noSideEffects=r=>{
  assert.equal(r.mode,'OFFLINE_SYNTHETIC_ONLY');
  assert.equal(r.provider_calls,0);
  assert.equal(r.github_writes,0);
  assert.equal(r.mac_settings_writes,0);
  assert.equal(r.real_pr_created,false);
  assert.equal(r.real_qa_requested,false);
  assert.equal(r.synthetic,true);
};

test('Z701 complete synthetic control-plane -> dispatch -> CI -> independent QA -> owner gate',()=>{
  const r=simulateZeroCopy();
  noSideEffects(r);
  assert.equal(r.gate,gate);
  assert.equal(r.requires_owner_approval,true);
  assert.equal(r.trace.length,6);
  assert.equal(verifyTrace(r),true);
  assert.equal(r.trace.at(-1).event,'gate.owner_review');
});
test('Z702 deterministic mock trace is repeatable without claiming real one-shot',()=>{
  const a=simulateZeroCopy(),b=simulateZeroCopy();
  assert.deepEqual(a,b);
  assert.ok(a.trace[2].detail.commit.startsWith('SIMULATED-'));
  noSideEffects(a);
});
test('Z703 synthetic CI failure holds and never proceeds to QA',()=>{
  const r=simulateZeroCopy({fault:'ci-fail'});
  noSideEffects(r);
  assert.equal(r.reason,'SYNTHETIC_CI_FAILED');
  assert.equal(verifyTrace(r),true);
  assert.ok(!r.trace.some(x=>x.event.startsWith('qa.')));
});
test('Z704 SHA mismatch holds and cannot claim independent review',()=>{
  const r=simulateZeroCopy({fault:'review-sha-mismatch'});
  noSideEffects(r);
  assert.equal(r.reason,'SYNTHETIC_QA_WRONG_SHA');
  assert.equal(verifyTrace(r),true);
  assert.ok(!r.trace.some(x=>x.event==='gate.owner_review'));
});
test('Z705 review rejection blocks owner-ready gate',()=>{
  const r=simulateZeroCopy({fault:'qa-reject'});
  noSideEffects(r);
  assert.equal(r.reason,'SYNTHETIC_QA_REJECTED');
  assert.equal(verifyTrace(r),true);
});
test('Z706 any unexpected fault fails closed',()=>{
  const r=simulateZeroCopy({fault:'use-real-provider'});
  noSideEffects(r);
  assert.equal(r.reason,'INVALID_TEST_FAULT');
  assert.equal(verifyTrace(r),true);
});
test('Z707 rejects real workspace, unsafe path and unknown keys',()=>{
  const cases=[
    {...DEMO_TASK,workspace:'augusliang23-web/pm-dashboard'},
    {...DEMO_TASK,target_path:'../../.ssh/id_rsa'},
    {...DEMO_TASK,target_path:'src/production.ts'},
    {...DEMO_TASK,extra:'surprise'},
    {...DEMO_TASK,task_id:'!'},
    {...DEMO_TASK,objective:'secret\nnew line'},
  ];
  for(const task of cases){
    const r=simulateZeroCopy({task});
    noSideEffects(r);
    assert.equal(r.reason,'INVALID_SYNTHETIC_TASK');
    assert.equal(verifyTrace(r),true);
  }
});
test('Z708 chain changes are detectable in event details',()=>{
  const r=structuredClone(simulateZeroCopy());
  assert.equal(verifyTrace(r),true);
  r.trace[3].detail.pass=999;
  assert.equal(verifyTrace(r),false);
});
test('Z709 raw objective and secrets never appear in report',()=>{
  const r=simulateZeroCopy({task:{...DEMO_TASK,
    objective:'SECRET_TEST_SENTINEL should never leave the task input'}});
  noSideEffects(r);
  assert.equal(r.gate,gate);
  assert.equal(JSON.stringify(r).includes('SECRET_TEST_SENTINEL'),false);
});
test('Z710 direct CLI --demo reports mock only; --once and unknown args fail closed',()=>{
  const file=new URL('../zc07-mock-flow.mjs',import.meta.url);
  for(const flag of ['--demo','--once','--model','']){
    const args=flag?[file.pathname,flag]:[file.pathname];
    const r=spawnSync(process.execPath,args,{encoding:'utf8',timeout:4000});
    assert.equal(r.error,undefined);
    const output=JSON.parse(r.stdout);
    noSideEffects(output);
    if(flag==='--demo'){
      assert.equal(r.status,0);
      assert.equal(output.gate,gate);
      assert.equal(verifyTrace(output),true);
    }else{
      assert.equal(r.status,2);
      assert.equal(output.reason,'ONLY_OFFLINE_DEMO_ALLOWED');
    }
  }
});
