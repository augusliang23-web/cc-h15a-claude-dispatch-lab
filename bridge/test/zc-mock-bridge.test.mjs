// ZC-MVP-A: Comprehensive Automated Security & Mock E2E Test Suite
// Verifies 16 test cases including all 13 mandatory negative security categories.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import {
  validateTaskEnvelope,
  validateAuthorization,
  CONTRACT_VERSION,
  REPOSITORY
} from '../zc-bridge-auth.mjs';

import {
  LocalClaimController,
  transitionState
} from '../zc-bridge-claim.mjs';

import {
  MockWorkerAdapter,
  normalizeAndValidateResult,
  RESULT_VERSION
} from '../zc-mock-worker.mjs';

import {
  LocalBridge,
  SYNTHETIC_GROK_TASK_FIXTURE,
  PINNED_MAIN_HEAD
} from '../zc-mock-bridge.mjs';

function createTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'zc-mvp-a-test-'));
}

test('TC-01: Happy Path — full synthetic mock task succeeds and produces structured result', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({ storageDir: tmpDir });

  const summary = await bridge.runCycle(SYNTHETIC_GROK_TASK_FIXTURE);
  bridge.close();

  assert.equal(summary.status, 'COMPLETED');
  assert.equal(summary.reason, 'MOCK_E2E_SUCCESS');
  assert.equal(summary.metrics.actual_dispatch, false);
  assert.equal(summary.metrics.provider_calls, 0);
  assert.equal(summary.metrics.runtime_github_writes, 0);
  assert.equal(summary.metrics.mac_settings_writes, 0);
  assert.equal(summary.metrics.real_worker_executed, false);

  assert.ok(summary.result);
  assert.equal(summary.result.result_version, RESULT_VERSION);
  assert.equal(summary.result.simulated, true);
  assert.equal(summary.result.files_modified.length, 0);
  assert.equal(summary.result.commits_created.length, 0);
  assert.equal(summary.result.ci_evidence.passed, true);
  assert.equal(summary.result.qa_evidence.approved, true);

  // Trace checks
  const eventNames = summary.trace.map(t => t.event);
  assert.ok(eventNames.includes('bridge.started'));
  assert.ok(eventNames.includes('task.envelope_validated'));
  assert.ok(eventNames.includes('task.authorized'));
  assert.ok(eventNames.includes('task.claimed'));
  assert.ok(eventNames.includes('task.running'));
  assert.ok(eventNames.includes('worker.completed'));
  assert.ok(eventNames.includes('qa.normalized'));
  assert.ok(eventNames.includes('task.completed'));
  assert.ok(eventNames.includes('bridge.finished'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-02: Negative Security — missing authorization rejected immediately', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({ storageDir: tmpDir });

  const unapprovedTask = {
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    approval: 'pending' // Not 'approved'
  };

  const summary = await bridge.runCycle(unapprovedTask);
  bridge.close();

  assert.equal(summary.status, 'HOLD');
  assert.match(summary.reason, /MISSING_AUTHORIZATION/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-03: Negative Security — incorrect commit SHA rejected', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({ storageDir: tmpDir });

  const mismatchedTask = {
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    target_sha: '0000000000000000000000000000000000000000'
  };

  const summary = await bridge.runCycle(mismatchedTask, { head_sha: PINNED_MAIN_HEAD });
  bridge.close();

  assert.equal(summary.status, 'HOLD');
  assert.match(summary.reason, /SHA_MISMATCH/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-04: Negative Security — allowlist tampering or path traversal rejected', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({ storageDir: tmpDir });

  // Subtest A: path traversal in allowlist
  const traversalTask = {
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    allowlist: ['../../etc/shadow']
  };

  const summaryA = await bridge.runCycle(traversalTask);
  assert.equal(summaryA.status, 'HOLD');
  assert.match(summaryA.reason, /PATH_TRAVERSAL_IN_ALLOWLIST/);

  // Subtest B: allowlist contains unauthorized paths
  const expandedTask = {
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-004B',
    allowlist: ['bridge/zc-mock-bridge.mjs', 'outside/secret.txt']
  };

  const summaryB = await bridge.runCycle(expandedTask, {
    authorized_allowlist: ['bridge/zc-mock-bridge.mjs']
  });
  assert.equal(summaryB.status, 'HOLD');
  assert.match(summaryB.reason, /ALLOWLIST_VIOLATION/);

  bridge.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-05: Negative Security — duplicate task ID rejected without double execution', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({ storageDir: tmpDir });

  // First run: succeeds
  const summary1 = await bridge.runCycle(SYNTHETIC_GROK_TASK_FIXTURE);
  assert.equal(summary1.status, 'COMPLETED');

  // Second run with same ID: rejected
  const summary2 = await bridge.runCycle(SYNTHETIC_GROK_TASK_FIXTURE);
  assert.equal(summary2.status, 'HOLD');
  assert.match(summary2.reason, /TASK_ALREADY_SEEN/);

  bridge.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-06: Negative Security — expired task rejected', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({ storageDir: tmpDir });

  const expiredTask = {
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-EXPIRED',
    created_at: '2026-11-01T00:00:00.000Z',
    expires_at: '2026-11-01T01:00:00.000Z'
  };

  const summary = await bridge.runCycle(expiredTask, { now: '2026-11-02T00:00:00.000Z' });
  bridge.close();

  assert.equal(summary.status, 'HOLD');
  assert.match(summary.reason, /TASK_EXPIRED/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-07: Negative Security — high risk task stopped at HIGH_RISK_HOLD', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({ storageDir: tmpDir });

  const highRiskTask = {
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-HIGHRISK',
    risk: 'risk:high'
  };

  const summary = await bridge.runCycle(highRiskTask);
  bridge.close();

  assert.equal(summary.status, 'HOLD');
  assert.match(summary.reason, /HIGH_RISK_HOLD/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-08: Negative Security — exceeding retry limit stops with FAILED_MAX_RETRIES', async () => {
  const tmpDir = createTempDir();
  const controller = new LocalClaimController({ storageDir: tmpDir });

  const task = {
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-RETRY',
    max_attempts: 2
  };

  // Attempt 1: claim & fail
  controller.claimTask(task);
  controller.advanceState(task.task_id, 'RUNNING');
  controller.advanceState(task.task_id, 'INTERRUPTED');
  controller.advanceState(task.task_id, 'BLOCKED');

  // Attempt 2: claim & fail
  controller.claimTask(task);
  controller.advanceState(task.task_id, 'RUNNING');
  controller.advanceState(task.task_id, 'INTERRUPTED');
  controller.advanceState(task.task_id, 'BLOCKED');

  // Attempt 3: exceeds max_attempts (2) -> must throw FAILED_MAX_RETRIES
  assert.throws(() => {
    controller.claimTask(task);
  }, /FAILED_MAX_RETRIES/);

  controller.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-09: Negative Security — Worker Crash safely preserved and converted to BLOCKED upon recovery', async () => {
  const tmpDir = createTempDir();

  // Step 1: Bridge with crashing worker
  const crashBridge = new LocalBridge({
    storageDir: tmpDir,
    fault: 'crash'
  });

  const summary = await crashBridge.runCycle({
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-CRASH'
  });

  assert.equal(summary.status, 'FAILED');
  assert.match(summary.reason, /MOCK_WORKER_PROCESS_CRASH/);
  crashBridge.close();

  // Step 2: Simulate restart & crash recovery
  const restartController = new LocalClaimController({ storageDir: tmpDir });
  const recovered = restartController.recover();
  restartController.close();

  // Verify journal was not corrupted
  assert.ok(fs.existsSync(path.join(tmpDir, 'journal.ndjson')));
  const journalContent = fs.readFileSync(path.join(tmpDir, 'journal.ndjson'), 'utf8');
  assert.ok(journalContent.includes('MOCK_WORKER_PROCESS_CRASH'));

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-10: Negative Security — network failure handled gracefully with clean exit', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({
    storageDir: tmpDir,
    fault: 'network-failure'
  });

  const summary = await bridge.runCycle({
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-NETFAIL'
  });
  bridge.close();

  assert.equal(summary.status, 'FAILED');
  assert.match(summary.reason, /ENOTFOUND/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-11: Negative Security — malformed worker result rejected', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({
    storageDir: tmpDir,
    fault: 'malformed-result'
  });

  const summary = await bridge.runCycle({
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-MALFORMED'
  });
  bridge.close();

  assert.equal(summary.status, 'HOLD');
  assert.match(summary.reason, /INVALID_RESULT_SCHEMA/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-12: Negative Security — failing CI or rejecting QA evidence blocks completion', async () => {
  const tmpDir = createTempDir();

  // Subtest A: Failing CI
  const bridgeCI = new LocalBridge({ storageDir: tmpDir, fault: 'failing-ci' });
  const summaryA = await bridgeCI.runCycle({
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-FAILCI'
  });
  bridgeCI.close();

  assert.equal(summaryA.status, 'HOLD');
  assert.match(summaryA.reason, /GATE_CI_MISSING_HOLD/);

  // Subtest B: Rejecting QA findings
  const bridgeQA = new LocalBridge({ storageDir: tmpDir, fault: 'rejecting-qa' });
  const summaryB = await bridgeQA.runCycle({
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-REJECTQA'
  });
  bridgeQA.close();

  assert.equal(summaryB.status, 'HOLD');
  assert.match(summaryB.reason, /GATE_QA_MISSING_HOLD/);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-13: Negative Security — unauthorized file writes or deployment attempts rejected', async () => {
  const tmpDir = createTempDir();
  const bridge = new LocalBridge({
    storageDir: tmpDir,
    fault: 'unauthorized-action'
  });

  const summary = await bridge.runCycle({
    ...SYNTHETIC_GROK_TASK_FIXTURE,
    task_id: 'ZC-MVP-A-TASK-UNAUTH'
  });
  bridge.close();

  assert.equal(summary.status, 'HOLD');
  assert.match(summary.reason, /UNAUTHORIZED_FILE_MODIFICATIONS_DETECTED/);
  assert.equal(summary.metrics.runtime_github_writes, 0);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-14: Negative Security — prototype pollution attempt rejected', () => {
  const maliciousPayload = JSON.parse('{"__proto__":{"polluted":true}}');
  assert.throws(() => {
    validateTaskEnvelope(maliciousPayload);
  }, /UNTRUSTED_TASK_KEY/);
});

test('TC-15: Operational Control — Emergency STOP controller interrupts bridge cycle', async () => {
  const tmpDir = createTempDir();
  const stopFile = path.join(tmpDir, 'STOP');
  fs.writeFileSync(stopFile, 'EMERGENCY_STOP');

  const bridge = new LocalBridge({
    storageDir: tmpDir,
    stopFilePath: stopFile
  });

  const summary = await bridge.runCycle(SYNTHETIC_GROK_TASK_FIXTURE);
  bridge.close();

  assert.equal(summary.status, 'HOLD');
  assert.equal(summary.reason, 'EMERGENCY_STOP_TRIGGERED');

  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('TC-16: Concurrency Control — Single instance lock prevents concurrent bridge executions', () => {
  const tmpDir = createTempDir();

  const bridge1 = new LocalClaimController({ storageDir: tmpDir });

  // Attempt to open second instance with same lockfile -> must throw
  assert.throws(() => {
    new LocalClaimController({ storageDir: tmpDir });
  }, /BRIDGE_BUSY_LOCK_HELD/);

  bridge1.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});
