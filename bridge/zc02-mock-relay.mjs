// ZC-02: a single fixed GitHub Issue -> local MOCK receipt. Not an agent runner.
// No GitHub writes, model/CLI invocation, user instruction execution, or scheduling.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO = 'augusliang23-web/cc-h15a-claude-dispatch-lab';
export const ISSUE_NUMBER = 21;
export const ISSUE_ID = 6131475731;
export const ISSUE_NODE = 'I_kwDOVN9hnM8AAAABbXblEw';
export const TITLE = 'ZC-02 MOCK RELAY CANARY V1 — READ ONLY / NO AGENT';
export const EXPECTED = Object.freeze({
  contract_version: 'ZC02_MOCK_READ_V1',
  task_id: 'ZC-02-20261031-MAC-MOCK-01',
  repository: REPO,
  kind: 'synthetic_read_only_canary',
  execution_mode: 'MOCK_LOCAL_RECEIPT_ONLY',
  agent: 'none',
  model: 'none',
  status: 'QUEUED',
  allow_model_calls: false,
  allow_repo_writes: false,
  allow_github_writes: false,
  allow_scheduled_execution: false,
  allow_retries: false,
  success_marker: 'ZC02_MOCK_LOCAL_RECEIPT',
});
const API = `https://api.github.com/repos/${REPO}`;
const WEB = `https://github.com/${REPO}`;
const EXPECTED_BODY = JSON.stringify(EXPECTED, null, 2);
const id = EXPECTED.task_id;
const hold = code => ({status: 'HOLD', reason: code, execution_allowed: false, simulated: true});
const safe = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const eq = (a, b) => a === b;

export function verifyCanary(issue) {
  if (!safe(issue)) return hold('INVALID_GITHUB_ENVELOPE');
  if (!eq(issue.number, ISSUE_NUMBER) || !eq(issue.id, ISSUE_ID) ||
      !eq(issue.node_id, ISSUE_NODE) || !eq(issue.title, TITLE) ||
      !eq(issue.state, 'open') || issue.pull_request !== undefined ||
      !eq(issue.url, `${API}/issues/${ISSUE_NUMBER}`) ||
      !eq(issue.repository_url, API) || !eq(issue.html_url, `${WEB}/issues/${ISSUE_NUMBER}`) ||
      !eq(issue.user?.login, 'augusliang23-web')) return hold('ISSUE_IDENTITY_OR_STATE_CHANGED');
  if (issue.body !== EXPECTED_BODY) return hold('CANARY_BODY_CHANGED_OR_INVALID');
  return {status: 'VALID_MOCK_CANARY', execution_allowed: false, simulated: true};
}

export function fetchPinnedCanary({spawn = spawnSync} = {}) {
  // Only this hard-coded GET is possible. No URL, shell, token or command from Issue data.
  const args = ['api', '--hostname', 'github.com', '-X', 'GET',
    `repos/${REPO}/issues/${ISSUE_NUMBER}`];
  let result;
  try {
    result = spawn('gh', args, {
      cwd: os.homedir(), shell: false, encoding: 'utf8', timeout: 8000,
      maxBuffer: 65536, input: '', windowsHide: true,
      env: {...process.env, GH_PROMPT_DISABLED: '1', GIT_TERMINAL_PROMPT: '0'},
    });
  } catch { return {status: 'HOLD', reason: 'GITHUB_GET_FAILED'}; }
  if (!result || result.error || result.status !== 0 || result.signal ||
      typeof result.stdout !== 'string' || Buffer.byteLength(result.stdout) > 65536) {
    return {status: 'HOLD', reason: 'GITHUB_GET_FAILED'};
  }
  try { return {status: 'OBSERVED', issue: JSON.parse(result.stdout)}; }
  catch { return {status: 'HOLD', reason: 'INVALID_GITHUB_JSON'}; }
}

function prepareStateDir(dir) {
  if (typeof dir !== 'string' || !path.isAbsolute(dir) || !dir) throw Error('INVALID_STATE_DIR');
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink() ||
      (typeof process.getuid === 'function' && stat.uid !== process.getuid()) ||
      (stat.mode & 0o077) !== 0) throw Error('UNSAFE_STATE_DIR');
  return dir;
}

export function executeMock({issue, stateDir} = {}) {
  const check = verifyCanary(issue);
  if (check.status !== 'VALID_MOCK_CANARY') return check;
  let dir;
  try { dir = prepareStateDir(stateDir); }
  catch { return hold('LOCAL_STATE_UNSAFE_OR_UNAVAILABLE'); }
  const claimFile = path.join(dir, `${id}.claim.json`);
  const receiptFile = path.join(dir, `${id}.receipt.json`);
  const claim = {task_id: id, repository: REPO, issue_number: ISSUE_NUMBER,
    issue_node_id: ISSUE_NODE, mode: 'MOCK_ONLY', execution_allowed: false};
  // Create-once durable local reservation. A crash leaves an uncertain claim and
  // deliberately blocks future runs: there is NO retry/replay or automatic recovery.
  let fd;
  try {
    fd = fs.openSync(claimFile, 'wx', 0o600);
    fs.writeSync(fd, JSON.stringify(claim) + '\n');
    fs.fsyncSync(fd);
    fs.closeSync(fd); fd = undefined;
  } catch {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    return hold('ALREADY_CLAIMED_OR_CLAIM_UNCERTAIN');
  }
  const receipt = Object.freeze({
    status: 'MOCK_COMPLETED_LOCAL_ONLY', marker: EXPECTED.success_marker,
    task_id: id, issue_number: ISSUE_NUMBER, issue_node_id: ISSUE_NODE,
    agent_invoked: false, model_invoked: false, github_writes: false,
    project_writes: false, execution_allowed: false, simulated: true,
  });
  try {
    fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2) + '\n',
      {flag: 'wx', mode: 0o600});
  } catch { return hold('RECEIPT_WRITE_UNCERTAIN'); }
  return receipt;
}

export function runOnce({spawn = spawnSync, stateDir = path.join(os.homedir(), '.local', 'state', 'zc02-mock-relay')} = {}) {
  const fetched = fetchPinnedCanary({spawn});
  if (fetched.status !== 'OBSERVED') return hold(fetched.reason);
  return executeMock({issue: fetched.issue, stateDir});
}

// macOS may report /var via argv and /private/var via import.meta.url.
// Compare real file identities rather than lexical spellings of their paths.
// A failed resolution is never evidence that this module is the CLI entrypoint.
export function isDirectInvocation(entry = process.argv[1]) {
  if (typeof entry !== 'string' || entry.length === 0) return false;
  try {
    return fs.realpathSync(path.resolve(entry)) ===
      fs.realpathSync(fileURLToPath(import.meta.url));
  } catch { return false; }
}

if (isDirectInvocation()) {
  const answer = process.argv.length === 3 && process.argv[2] === '--once'
    ? runOnce() : hold('ONLY_EXPLICIT_ONCE_SUPPORTED');
  process.stdout.write(JSON.stringify(answer) + '\n');
  if (answer.status !== 'MOCK_COMPLETED_LOCAL_ONLY') process.exitCode = 2;
}
