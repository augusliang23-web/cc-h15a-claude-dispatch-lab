import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  REPO, ISSUE_NUMBER, ISSUE_ID, ISSUE_NODE, TITLE, EXPECTED,
  verifyCanary, fetchPinnedCanary, executeMock, runOnce, isDirectInvocation,
} from '../zc02-mock-relay.mjs';

const API = `https://api.github.com/repos/${REPO}`;
const WEB = `https://github.com/${REPO}`;
const makeIssue = (patch = {}) => ({
  id: ISSUE_ID, node_id: ISSUE_NODE, number: ISSUE_NUMBER,
  title: TITLE, body: JSON.stringify(EXPECTED, null, 2), state: 'open',
  url: `${API}/issues/${ISSUE_NUMBER}`, html_url: `${WEB}/issues/${ISSUE_NUMBER}`,
  repository_url: API, user: {login: 'augusliang23-web'}, ...patch,
});
const sandbox = () => fs.mkdtempSync(path.join(os.tmpdir(), 'zc02-mock-test-'));
function withDir(fn) {
  const dir = sandbox();
  try { return fn(dir); } finally { fs.rmSync(dir, {recursive: true, force: true}); }
}
const fileList = d => fs.readdirSync(d).sort();
const stub = issue => (cmd,args,options) => {
  assert.equal(cmd, 'gh');
  assert.deepEqual(args, ['api','--hostname','github.com','-X','GET',
    `repos/${REPO}/issues/${ISSUE_NUMBER}`]);
  assert.equal(options.shell, false);
  assert.equal(options.env.GH_PROMPT_DISABLED, '1');
  assert.equal(options.env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(options.input, '');
  return {status: 0, stdout: JSON.stringify(issue)};
};

test('Z01 pinned Issue 21 is observed but never authorizes real execution', () => {
  assert.deepEqual(verifyCanary(makeIssue()), {
    status: 'VALID_MOCK_CANARY', execution_allowed: false, simulated: true,
  });
});

for (const [name, patch] of [
  ['ZC-01 planning Issue', {number: 20}],
  ['other repo', {repository_url: 'https://api.github.com/repos/other/repo'}],
  ['spoofed issue ID', {node_id: 'I_attacker'}],
  ['modified title', {title: 'other'}],
  ['modified body', {body: JSON.stringify({...EXPECTED, allow_model_calls:true}, null, 2)}],
  ['edited JSON', {body: JSON.stringify(EXPECTED)}],
  ['closed', {state:'closed'}],
  ['PR-shaped', {pull_request: {url:'https://github.com/pull/21'}}],
  ['changed author', {user:{login:'other'}}],
  ['other URL', {url:'https://example.org'}],
]) test(`Z02 ${name} rejected without local writes`, () => withDir(dir => {
  const out = executeMock({issue: makeIssue(patch),stateDir:dir});
  assert.equal(out.status,'HOLD');assert.equal(out.execution_allowed,false);
  assert.deepEqual(fileList(dir),[]);
}));

test('Z03 exactly one permitted Issue GET, no shell/model/spawn other than gh', () => {
  const issue=makeIssue();
  const r=fetchPinnedCanary({spawn:stub(issue)});
  assert.equal(r.status,'OBSERVED');
  assert.equal(r.issue.node_id,ISSUE_NODE);
});

test('Z04 one fixed task creates one local claim and mock receipt, no remote write', () =>
  withDir(dir => {
    const out=runOnce({spawn:stub(makeIssue()),stateDir:dir});
    assert.equal(out.status,'MOCK_COMPLETED_LOCAL_ONLY');
    assert.equal(out.agent_invoked,false);
    assert.equal(out.model_invoked,false);
    assert.equal(out.github_writes,false);
    assert.equal(out.project_writes,false);
    assert.equal(out.execution_allowed,false);
    assert.equal(out.simulated,true);
    const files=fileList(dir);
    assert.deepEqual(files, [
      `${EXPECTED.task_id}.claim.json`,`${EXPECTED.task_id}.receipt.json`,
    ]);
    const saved=JSON.parse(fs.readFileSync(path.join(dir,files[1]),'utf8'));
    assert.deepEqual(saved,out);
    assert.equal(fs.statSync(path.join(dir,files[0])).mode & 0o077,0);
    const repeat=runOnce({spawn:stub(makeIssue()),stateDir:dir});
    assert.equal(repeat.status,'HOLD');
    assert.equal(repeat.reason,'ALREADY_CLAIMED_OR_CLAIM_UNCERTAIN');
    assert.deepEqual(fileList(dir),files);
  }));

test('Z05 a crashed claim without receipt never retries or invents success', () =>
  withDir(dir => {
    fs.writeFileSync(path.join(dir,`${EXPECTED.task_id}.claim.json`),'partial');
    const result=executeMock({issue:makeIssue(),stateDir:dir});
    assert.deepEqual(result, {
      status:'HOLD',reason:'ALREADY_CLAIMED_OR_CLAIM_UNCERTAIN',execution_allowed:false,simulated:true,
    });
    assert.equal(fileList(dir).length,1);
  }));

test('Z06 symlink state directory and unsuitable directory permissions HOLD', () =>
  withDir(root => {
    const allowed=path.join(root,'allowed');fs.mkdirSync(allowed,{mode:0o700});
    const link=path.join(root,'linked');fs.symlinkSync(allowed,link);
    assert.equal(executeMock({issue:makeIssue(),stateDir:link}).status,'HOLD');
    assert.deepEqual(fileList(allowed),[]);
    const open=path.join(root,'unsafe');fs.mkdirSync(open,{mode:0o777});fs.chmodSync(open,0o777);
    assert.equal(executeMock({issue:makeIssue(),stateDir:open}).status,'HOLD');
    assert.deepEqual(fileList(open),[]);
  }));

test('Z07 GitHub read failure/timeout/no JSON fails closed without local writes', () =>
  withDir(dir => {
    for (const broken of [
      () => ({status:1,stdout:'',stderr:'AUTH SECRET'}),
      () => ({status:null,signal:'SIGTERM',stdout:'',error:new Error('SECRET')}),
      () => ({status:0,stdout:'{oops'}),
      () => {throw new Error('SECRET');},
    ]) {
      const r=runOnce({spawn:broken,stateDir:dir});
      assert.equal(r.status,'HOLD');
      assert.equal(r.execution_allowed,false);
      assert.ok(!JSON.stringify(r).includes('SECRET'));
      assert.deepEqual(fileList(dir),[]);
    }
  }));


test('Z08 CLI entry identity accepts canonical and symlinked paths', () =>
  withDir(root => {
    const actual = fileURLToPath(new URL('../zc02-mock-relay.mjs', import.meta.url));
    const alias = path.join(root, 'linked-bridge');
    fs.symlinkSync(path.dirname(actual), alias, 'dir');
    assert.equal(isDirectInvocation(actual), true);
    assert.equal(isDirectInvocation(path.join(alias, path.basename(actual))), true);
    assert.equal(isDirectInvocation(path.join(root, 'missing.mjs')), false);
    assert.equal(isDirectInvocation(null), false);
  }));

test('Z09 symlinked CLI entry does not silently exit 0; rejects unsafe args offline', () =>
  withDir(root => {
    const actual = fileURLToPath(new URL('../zc02-mock-relay.mjs', import.meta.url));
    const alias = path.join(root, 'linked-bridge');
    fs.symlinkSync(path.dirname(actual), alias, 'dir');
    // Invalid CLI args must HOLD before any GitHub GET, local claim or model call.
    const result = spawnSync(process.execPath,
      [path.join(alias, path.basename(actual)), '--not-once'],
      {encoding: 'utf8', timeout: 4000, env: {
        ...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0',
      }});
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2);
    assert.deepEqual(JSON.parse(result.stdout), {
      status: 'HOLD', reason: 'ONLY_EXPLICIT_ONCE_SUPPORTED',
      execution_allowed: false, simulated: true,
    });
    assert.equal(result.stderr, '');
    assert.deepEqual(fileList(root), ['linked-bridge']);
  }));
