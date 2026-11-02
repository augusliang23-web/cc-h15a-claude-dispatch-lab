// ZC-MVP-A: Main Local Bridge Mock Orchestrator
// Synthesizes Grok Task -> Mock GitHub Source -> Auth -> Claim -> Mock Worker -> QA -> Structured Result
import { fileURLToPath } from 'node:url';
import { realpathSync, existsSync } from 'node:fs';
import path from 'node:path';
import { validateTaskEnvelope, validateAuthorization, sha256 } from './zc-bridge-auth.mjs';
import { LocalClaimController } from './zc-bridge-claim.mjs';
import { MockWorkerAdapter, normalizeAndValidateResult } from './zc-mock-worker.mjs';

export const PINNED_MAIN_HEAD = 'b577bbae9e26c8751db9fe389753c4dda1b5cdac';

export const SYNTHETIC_GROK_TASK_FIXTURE = Object.freeze({
  contract_version: 'zc.task/v1',
  task_id: 'ZC-MVP-A-TASK-001',
  repository: 'augusliang23-web/cc-h15a-claude-dispatch-lab',
  issue_number: 45,
  agent: 'antigravity',
  model: 'gemini-pro',
  task_type: 'synthetic',
  execution_mode: 'mock-e2e',
  approval: 'approved',
  status: 'QUEUED',
  target_sha: PINNED_MAIN_HEAD,
  scope_sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  allowlist: Object.freeze([
    'bridge/zc-mock-bridge.mjs',
    'bridge/zc-bridge-auth.mjs',
    'bridge/zc-bridge-claim.mjs',
    'bridge/zc-mock-worker.mjs',
    'bridge/test/zc-mock-bridge.test.mjs',
    'docs/zc-mvp-a-mac-local-bridge.md',
    '.github/workflows/zc-mvp-a-ci.yml'
  ]),
  risk: 'risk:medium',
  max_attempts: 3,
  created_at: '2026-11-02T21:00:00.000Z',
  expires_at: '2026-11-03T21:00:00.000Z'
});

export class MockGitHubTaskSource {
  #tasks;
  constructor(tasks = [SYNTHETIC_GROK_TASK_FIXTURE]) {
    this.#tasks = tasks.map(t => structuredClone(t));
  }

  async fetchNextPending() {
    return this.#tasks.length > 0 ? this.#tasks.shift() : null;
  }
}

export class LocalBridge {
  #options;
  #claimController;
  #workerAdapter;
  #stopRequested = false;

  constructor(options = {}) {
    this.#options = options;
    this.#claimController = options.claimController || new LocalClaimController({ storageDir: options.storageDir });
    this.#workerAdapter = options.workerAdapter || new MockWorkerAdapter({ fault: options.fault, model: options.model });
    this.#stopRequested = Boolean(options.stopRequested);
  }

  requestStop() {
    this.#stopRequested = true;
  }

  /**
   * Runs the full end-to-end Local Bridge cycle for a task.
   */
  async runCycle(rawTask, context = {}) {
    const trace = [];
    const emit = (event, detail = {}) => {
      trace.push({
        seq: trace.length + 1,
        event,
        timestamp: new Date().toISOString(),
        detail
      });
    };

    const metrics = Object.freeze({
      actual_dispatch: false,
      provider_calls: 0,
      runtime_github_writes: 0,
      mac_settings_writes: 0,
      real_worker_executed: false
    });

    const finish = (status, reason, result = null) => {
      emit('bridge.finished', { status, reason });
      return Object.freeze({
        status,
        reason,
        task_id: rawTask?.task_id || 'UNKNOWN',
        metrics,
        result,
        trace,
        requires_owner_approval: true
      });
    };

    emit('bridge.started', { task_id: rawTask?.task_id });

    // Step 0: Emergency STOP / Pause Check
    if (this.#stopRequested || (this.#options.stopFilePath && existsSync(this.#options.stopFilePath))) {
      return finish('HOLD', 'EMERGENCY_STOP_TRIGGERED');
    }

    // Step 1: Task Envelope Validation
    let task;
    try {
      task = validateTaskEnvelope(rawTask);
      emit('task.envelope_validated', { task_id: task.task_id });
    } catch (err) {
      return finish('HOLD', `VALIDATION_FAILED: ${err.message}`);
    }

    // Step 2: Authorization & Scope Validation
    try {
      const authContext = {
        head_sha: context.head_sha || PINNED_MAIN_HEAD,
        authorized_allowlist: context.authorized_allowlist || task.allowlist,
        now: context.now || '2026-11-02T21:30:00.000Z'
      };
      validateAuthorization(task, authContext);
      emit('task.authorized', { task_id: task.task_id, target_sha: task.target_sha });
    } catch (err) {
      return finish('HOLD', `AUTHORIZATION_DENIED: ${err.message}`);
    }

    // Step 3: Local Claim Controller
    let claim;
    try {
      claim = this.#claimController.claimTask(task);
      emit('task.claimed', { task_id: task.task_id, attempts: claim.attempts });
    } catch (err) {
      return finish('HOLD', `CLAIM_FAILED: ${err.message}`);
    }

    // Step 4: Advance to RUNNING
    try {
      this.#claimController.advanceState(task.task_id, 'RUNNING');
      emit('task.running', { task_id: task.task_id });
    } catch (err) {
      return finish('HOLD', `RUNNING_TRANSITION_FAILED: ${err.message}`);
    }

    // Step 5: Mock Worker Execution
    let rawResult;
    try {
      rawResult = this.#workerAdapter.execute(task);
      emit('worker.completed', { task_id: task.task_id });
    } catch (err) {
      this.#claimController.advanceState(task.task_id, 'FAILED', { error: err.message });
      return finish('FAILED', `WORKER_EXECUTION_FAILED: ${err.message}`);
    }

    // Step 6: Mock QA Result Normalization
    let normalizedResult;
    try {
      normalizedResult = normalizeAndValidateResult(rawResult, task);
      emit('qa.normalized', { task_id: task.task_id, marker: normalizedResult.report_marker });
    } catch (err) {
      this.#claimController.advanceState(task.task_id, 'FAILED', { error: err.message });
      return finish('HOLD', `QA_EVIDENCE_REJECTED: ${err.message}`);
    }

    // Step 7: Final Completion
    this.#claimController.advanceState(task.task_id, 'COMPLETED', {
      report_marker: normalizedResult.report_marker
    });
    emit('task.completed', { task_id: task.task_id });

    return finish('COMPLETED', 'MOCK_E2E_SUCCESS', normalizedResult);
  }

  close() {
    this.#claimController.close();
  }
}

// Direct CLI execution guard for offline rehearsals
function isDirect() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(path.resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isDirect()) {
  const bridge = new LocalBridge();
  bridge.runCycle(SYNTHETIC_GROK_TASK_FIXTURE).then(summary => {
    process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
    bridge.close();
    if (summary.status !== 'COMPLETED') {
      process.exitCode = 1;
    }
  }).catch(err => {
    process.stderr.write(`Fatal bridge error: ${err.message}\n`);
    bridge.close();
    process.exitCode = 2;
  });
}
