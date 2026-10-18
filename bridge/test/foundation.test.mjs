import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import * as b from '../foundation.mjs';

const repository = 'augusliang23-web/cc-h15a-claude-dispatch-lab';
const task = (changes = {}) => ({ contract_version: 'CC_AG_BRIDGE_V1', task_id: 'AG2B-test-1', repository, issue_number: 101, agent: 'antigravity', model: 'gemini-3.8-flash-low', task_type: 'synthetic', execution_mode: 'dry-run', approval: 'approved', status: 'QUEUED', ...changes });
const issue = (changes = {}, envelope = {}) => ({ number: 101, state: 'open', body: JSON.stringify(task(changes)), ...envelope });
const reader = (issues) => new b.FixtureQueueReader({ repository, issues });
const preview = (issues, options) => b.dryRun(reader(issues), options);

test('T01 valid task accepted and preview selects it', async () => {
  const r = await preview([issue()]);
  assert.equal(r.status, 'READY_FOR_REVIEW');
  assert.equal(r.candidate_count, 1); assert.equal(r.valid_count, 1);
  assert.equal(r.rejected_count, 0); assert.equal(r.next_eligible_task.task_id, 'AG2B-test-1');
});
for (const [name, changes] of [
  ['T02 unauthorized repository', { repository: 'other/repo' }],
  ['T03 unknown agent', { agent: 'claude' }],
  ['T04 missing approval', { approval: undefined }],
  ['unknown version', { contract_version: 'CC_AG_BRIDGE_V2' }],
  ['live mode', { execution_mode: 'live' }],
  ['unknown model', { model: 'other' }],
  ['invalid issue number', { issue_number: 0 }],
  ['fractional issue number', { issue_number: 1.5 }],
  ['boolean issue number', { issue_number: true }],
  ['unapproved', { approval: 'pending' }],
  ['command extension', { command: 'touch /tmp/never' }],
  ['unsafe identifier', { task_id: '\u001b[31msecret' }],
  ['nonqueued task', { status: 'RUNNING' }],
]) test(`${name} rejected`, async () => {
  const r = await preview([issue(changes)]);
  assert.equal(r.rejected_count, 1); assert.equal(r.next_eligible_task, null);
});
test('T05 all copies of duplicate IDs rejected, including an unapproved copy', async () => {
  const r = await preview([issue(), issue({ approval: 'pending' })]);
  assert.equal(r.valid_count, 0); assert.equal(r.rejected_count, 2);
  assert.ok(r.rejections.every(x => x.reason === 'DUPLICATE_TASK_ID'));
});
test('T06 only approved state transitions accepted', () => {
  for (const [from, to] of [['QUEUED','CLAIMED'],['CLAIMED','RUNNING'],['RUNNING','COMPLETED'],['RUNNING','FAILED'],['RUNNING','INTERRUPTED'],['INTERRUPTED','BLOCKED']]) assert.equal(b.transition(from,to),to);
  for (const [from,to] of [['QUEUED','COMPLETED'],['COMPLETED','RUNNING'],['INTERRUPTED','RUNNING'],['FAILED','QUEUED'],['unknown','CLAIMED']]) assert.throws(() => b.transition(from,to));
});
test('T07 offline/asleep/network/CLI/auth unavailability leaves task queued', async () => {
  for (const availability of ['offline','asleep','network-unavailable','github-unavailable','cli-unavailable','authentication-expired','restarted']) {
    const r = await preview([issue()], { availability });
    assert.equal(r.status,'HOLD'); assert.equal(r.next_eligible_task,null);
    assert.equal(r.valid_count,1);
    assert.equal(r.reason, `AVAILABILITY_${availability.toUpperCase().replaceAll('-','_')}`);
  }
});
test('T08 restart retains completed history and prevents reexecution', async () => {
  const l = new b.MockOwnership(); l.claim(task()); l.advance('AG2B-test-1','RUNNING'); l.advance('AG2B-test-1','COMPLETED');
  const restored = new b.MockOwnership(JSON.parse(JSON.stringify(l.snapshot())));
  restored.recover();
  assert.throws(() => restored.claim(task()));
  const r = await preview([issue()], { history: restored.snapshot() });
  assert.equal(r.next_eligible_task,null); assert.equal(r.rejections[0].reason,'TASK_ALREADY_SEEN');
  assert.equal(restored.snapshot()[0].events.at(-1),'COMPLETED');
});
test('T09 running/interrupted recovery blocks without auto-retry', () => {
  for (const state of ['RUNNING','INTERRUPTED']) {
    const l = new b.MockOwnership([{task_id:'AG2B-test-1',events: state === 'RUNNING' ? ['QUEUED','CLAIMED','RUNNING'] : ['QUEUED','CLAIMED','RUNNING','INTERRUPTED']}]);
    l.recover(); assert.equal(l.snapshot()[0].events.at(-1),'BLOCKED');
    assert.throws(() => l.claim(task()));
  }
  const l = new b.MockOwnership(); l.claim(task()); l.recover();
  assert.equal(l.snapshot()[0].events.at(-1),'CLAIMED');
  assert.throws(() => l.claim(task({task_id:'second'})));
});
test('mock ownership allows only one active task and protects history', () => {
  const l = new b.MockOwnership(); l.claim(task());
  assert.throws(() => l.claim(task({task_id:'second'})));
  const copy = l.snapshot(); copy[0].events.push('COMPLETED');
  assert.equal(l.snapshot()[0].events.at(-1),'CLAIMED');
  assert.throws(() => l.advance('AG2B-test-1','COMPLETED'));
  assert.throws(() => new b.MockOwnership([{task_id:'x',events:['COMPLETED']}]));
  assert.throws(() => new b.MockOwnership([{task_id:'x',events:['QUEUED','CLAIMED']},{task_id:'y',events:['QUEUED','CLAIMED']}]));
});
test('T10 GitHub read errors safe-stop without exposing error or partial tasks', async () => {
  const r = await b.dryRun({ async readPending(){throw Error('token SECRET');} });
  assert.equal(r.status,'HOLD'); assert.equal(r.next_eligible_task,null);
  assert.equal(r.reason,'QUEUE_READ_FAILED'); assert.ok(!JSON.stringify(r).includes('SECRET'));
});
test('malformed reader/history/envelope fail closed', async () => {
  for (const envelope of [{number:102},{pull_request:{}},{state:'closed'},{body:'not JSON'},{body:'null'},{body:'[]'}]) {
    const r = await preview([issue({},envelope)]); assert.equal(r.next_eligible_task,null);
  }
  assert.equal((await b.dryRun({readPending:async()=>({repository,issues:null})})).status,'HOLD');
  assert.equal((await preview([issue()],{history:[{task_id:'x',events:[]}]})).status,'HOLD');
  assert.equal((await preview([issue()],{availability:'unknown'})).status,'HOLD');
  assert.equal((await b.dryRun(new b.FixtureQueueReader({repository:'other/repo',issues:[]}))).status,'HOLD');
});
test('T11 malicious issue body cannot execute commands or leak raw content', async () => {
  const dir = await mkdtemp(join(tmpdir(),'ag2b1-'));
  try {
    const target = join(dir,'pwned');
    for (const body of [`$(touch ${target})`, JSON.stringify(task({command:`touch ${target}`})), JSON.stringify(task({task_id:`$(touch ${target})`}))]) {
      const r = await preview([issue({}, {body})]);
      assert.equal(r.next_eligible_task,null); assert.ok(!JSON.stringify(r).includes(target));
    }
    await assert.rejects(access(target));
  } finally { await rm(dir,{recursive:true,force:true}); }
});
test('T12 mock adapter yields strict simulated result with unique marker in temporary fixture', async () => {
  const a = new b.MockAntigravityAdapter(); assert.equal(a.validateConfiguration().live_execution_enabled,false);
  const prepared = a.prepareTask(task()); const result = a.collectResult(a.executeTask(prepared));
  assert.equal(result.result,'BLUE LANTERN'); assert.equal(result.execution_status,'COMPLETED');
  assert.equal(result.simulated,true); assert.deepEqual(result.files_modified,[]); assert.deepEqual(result.commits_created,[]);
  assert.equal(result.error_code,null); assert.equal(result.task_id,'AG2B-test-1'); assert.equal(result.issue_number,101);
  assert.ok(Date.parse(result.finished_at)>=Date.parse(result.started_at));
  assert.notEqual(result.report_marker,a.executeTask(prepared).report_marker);
  assert.throws(() => a.collectResult({...result,simulated:false}));
  assert.throws(() => a.collectResult({...result,command:'run'}));
  assert.throws(() => a.executeTask(task({agent:'other'})));
  const dir = await mkdtemp(join(tmpdir(),'ag2b1-result-'));
  try { const path=join(dir,'result.json'); await writeFile(path,JSON.stringify(result)); assert.deepEqual(JSON.parse(await readFile(path,'utf8')),result); }
  finally { await rm(dir,{recursive:true,force:true}); }
});
test('T13 live execution and real claiming are unconditionally disabled', () => {
  assert.throws(() => b.executeLive(task()), /LIVE_EXECUTION_DISABLED/);
  assert.throws(() => b.claimLive(task()), /LIVE_CLAIMING_DISABLED/);
});
test('T14 dry-run performs reads only and never advances task state', async () => {
  let reads=0; const writes=[]; const i=issue(); const before=JSON.stringify(i);
  const source={readPending:async()=>{reads++;return {repository,issues:[i]};}, claim:()=>writes.push('claim'),update:()=>writes.push('update'),comment:()=>writes.push('comment')};
  const r=await b.dryRun(source); assert.equal(r.next_eligible_task.status,'QUEUED');
  assert.equal(reads,1); assert.deepEqual(writes,[]); assert.equal(JSON.stringify(i),before);
});
test('T15 all existing Claude workflows byte-identical to recorded baseline', async () => {
  const files=['h15a-1-zero-copy.yml','h15a-2-claude-oauth.yml','h15a-4a-issue-pr-bridge.yml','h15a-4c-issue-opened-canary.yml'];
  for (const name of files) {
    const path=`.github/workflows/${name}`;
    assert.deepEqual(await readFile(path),execFileSync('git',['show',`ac71eda90e128cd9e4d337c3fe4e927747461f21:${path}`]));
  }
});
test('fixture CLI reports counts and handles invalid inputs without leaking content', () => {
  const r=JSON.parse(execFileSync(process.execPath,['bridge/dry-run.mjs'],{encoding:'utf8'}));
  assert.equal(r.candidate_count,3); assert.equal(r.valid_count,1); assert.equal(r.rejected_count,2);
  assert.equal(r.next_eligible_task.task_id,'AG2B-fixture-1');
  assert.throws(()=>execFileSync(process.execPath,['bridge/dry-run.mjs','--live'],{stdio:'pipe'}));
});
test('result contract rejects coerced identifiers and malformed timestamps', () => {
  const r=new b.MockAntigravityAdapter().executeTask(task());
  for (const changes of [{task_id:null},{task_id:123},{task_id:'abc\n'},{started_at:'yesterday'},{finished_at:'2000-01-01T00:00:00.000Z'},{files_modified:['secret']},{commits_created:['abc']},{report_marker:'x'},{error_code:'secret'}]) assert.throws(()=>b.validateResult({...r,...changes}));
});
test('task identifier rejects trailing newline', async () => {
  assert.equal((await preview([issue({task_id:'abc\n'})])).next_eligible_task,null);
});
test('existing active reservation prevents selecting another task', async () => {
  const history=[{task_id:'old-task',events:['QUEUED','CLAIMED']}];
  const r=await preview([issue()],{history});
  assert.equal(r.status,'HOLD'); assert.equal(r.reason,'BRIDGE_BUSY'); assert.equal(r.next_eligible_task,null);
});
