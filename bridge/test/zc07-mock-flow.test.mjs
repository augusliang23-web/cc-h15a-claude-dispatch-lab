import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
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

const rechain = r => {
  let previous='GENESIS';
  for(const e of r.trace) {
    e.previous=previous;
    const {digest,...unsigned}=e;
    e.digest=createHash('sha256').update(JSON.stringify(unsigned)).digest('hex');
    previous=e.digest;
  }
  r.trace_digest=previous;
  return r;
};

test('Z711 rehashed inconsistent CI and QA evidence cannot pass synthetic owner gate',()=>{
  const variations=[
    r=>{r.trace[3].detail.commit='SIMULATED-WRONG';},
    r=>{r.trace[3].detail.fail=1;},
    r=>{r.trace[3].detail.pass=0;},
    r=>{r.trace[3].detail.tests=0;},
    r=>{r.trace[4].detail.reviewed='SIMULATED-WRONG';},
    r=>{r.trace[4].detail.findings=99;},
    r=>{r.trace[5].detail.candidate='SIMULATED-WRONG';},
    r=>{r.trace[2].detail.commit='SIMULATED-WRONG';},
    r=>{r.trace[1].detail.tools_allowed=1;},
    r=>{r.trace[2].detail.patch_applied=true;},
    r=>{r.trace[5].detail.production_ready=true;},
  ];
  for(const change of variations) {
    const r=structuredClone(simulateZeroCopy());
    change(r);
    rechain(r);
    assert.equal(verifyTrace(r),false,'must reject digest-consistent forged passing evidence');
  }
});

test('Z712 rehashed actor spoof, extra keys and unsafe synthetic target are rejected',()=>{
  const variations=[
    r=>{r.trace[4].actor='mock-gemini';},
    r=>{r.trace[3].detail.unverified='pass';},
    r=>{r.trace[2].detail.target_path='../../.ssh/id_rsa';},
    r=>{r.trace[0].detail.task_id='!';},
    r=>{r.trace[1].detail.task_digest='f'.repeat(64);},
    r=>{r.requires_owner_approval=false;},
  ];
  for(const change of variations) {
    const r=structuredClone(simulateZeroCopy());
    change(r);
    rechain(r);
    assert.equal(verifyTrace(r),false);
  }
});

test('Z713 direct CLI via symlink alias enforces --demo and fail-closed --once',()=>{
  const dir=mkdtempSync(path.join(tmpdir(),'zc07-direct-alias-'));
  try {
    const alias=path.join(dir,'mock-entry.mjs');
    symlinkSync(fileURLToPath(new URL('../zc07-mock-flow.mjs',import.meta.url)),alias);
    for(const flag of ['--demo','--once']) {
      const r=spawnSync(process.execPath,[alias,flag],{encoding:'utf8',timeout:4000});
      assert.equal(r.error,undefined);
      assert.ok(r.stdout.trim(),'alias must run and report; no silent exit');
      const report=JSON.parse(r.stdout);
      noSideEffects(report);
      if(flag==='--demo') {
        assert.equal(r.status,0);
        assert.equal(report.gate,gate);
        assert.equal(verifyTrace(report),true);
      } else {
        assert.equal(r.status,2);
        assert.equal(report.reason,'ONLY_OFFLINE_DEMO_ALLOWED');
      }
    }
  } finally {
    rmSync(dir,{recursive:true,force:true});
  }
});

test('Z714 rehashed HOLD trace must preserve its own reason',()=>{
  const r=structuredClone(simulateZeroCopy({fault:'ci-fail'}));
  r.trace.at(-1).detail.reason='SYNTHETIC_QA_REJECTED';
  rechain(r);
  assert.equal(verifyTrace(r),false);
});
