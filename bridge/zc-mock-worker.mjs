// ZC-MVP-A: Mock Antigravity Worker Adapter & Mock QA Normalizer
// 100% offline synthetic execution. Pure mock data, zero model/CLI calls, zero external writes.
import { randomUUID } from 'node:crypto';
import { sha256 } from './zc-bridge-auth.mjs';

export const RESULT_VERSION = 'CC_AG_RESULT_V1';
const REPORT_MARKER_REGEX = /^CC_AG_BRIDGE_V1_MOCK_[0-9a-f-]{36}$/;

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const REQUIRED_RESULT_KEYS = Object.freeze([
  'result_version',
  'task_id',
  'issue_number',
  'agent',
  'model',
  'execution_status',
  'started_at',
  'finished_at',
  'result',
  'error_code',
  'files_modified',
  'commits_created',
  'report_marker',
  'simulated',
  'ci_evidence',
  'qa_evidence'
]);

export class MockWorkerAdapter {
  #fault;
  #config;

  constructor(options = {}) {
    this.#fault = options.fault || 'none';
    this.#config = Object.freeze({
      adapter: 'mock-antigravity',
      live_execution_enabled: false,
      model: options.model || 'gemini-pro',
      provider_calls: 0,
      runtime_github_writes: 0,
      mac_settings_writes: 0
    });
  }

  getConfiguration() {
    return this.#config;
  }

  execute(task) {
    if (!task || typeof task.task_id !== 'string') {
      throw new Error('INVALID_WORKER_TASK_INPUT');
    }

    // Fault injection for testing
    if (this.#fault === 'crash') {
      throw new Error('MOCK_WORKER_PROCESS_CRASH');
    }

    if (this.#fault === 'network-failure') {
      const err = new Error('getaddrinfo ENOTFOUND mock-task-source.internal');
      err.code = 'ENOTFOUND';
      throw err;
    }

    if (this.#fault === 'timeout') {
      throw new Error('WORKER_EXECUTION_TIMEOUT');
    }

    if (this.#fault === 'unauthorized-action') {
      // Simulate attempting unauthorized file writes or deployment
      return {
        result_version: RESULT_VERSION,
        task_id: task.task_id,
        issue_number: task.issue_number,
        agent: task.agent,
        model: task.model,
        execution_status: 'COMPLETED',
        started_at: new Date().toISOString(),
        finished_at: new Date().toISOString(),
        result: 'UNAUTHORIZED_MERGE_ATTEMPTED',
        error_code: 'UNAUTHORIZED_ACTION',
        files_modified: ['/etc/passwd'], // Illegal write
        commits_created: ['deadbeef'],
        report_marker: `CC_AG_BRIDGE_V1_MOCK_${randomUUID()}`,
        simulated: true,
        ci_evidence: { passed: true, sha: task.target_sha },
        qa_evidence: { approved: true, findings: 0, sha: task.target_sha }
      };
    }

    if (this.#fault === 'malformed-result') {
      // Return missing fields
      return {
        task_id: task.task_id,
        status: 'OK'
      };
    }

    const startedAt = new Date().toISOString();
    const finishedAt = new Date().toISOString();
    const reportMarker = `CC_AG_BRIDGE_V1_MOCK_${randomUUID()}`;

    // Synthetic CI & QA outcomes
    const ciEvidence = this.#fault === 'failing-ci'
      ? { passed: false, run_id: 1001, sha: task.target_sha, failed_tests: 1 }
      : { passed: true, run_id: 1001, sha: task.target_sha, passed_tests: 42 };

    const qaEvidence = this.#fault === 'rejecting-qa'
      ? { approved: false, findings: 2, sha: task.target_sha, reviewer: 'mock-codex' }
      : { approved: true, findings: 0, sha: task.target_sha, reviewer: 'mock-codex' };

    return Object.freeze({
      result_version: RESULT_VERSION,
      task_id: task.task_id,
      issue_number: task.issue_number,
      agent: task.agent,
      model: task.model,
      execution_status: 'COMPLETED',
      started_at: startedAt,
      finished_at: finishedAt,
      result: 'BLUE LANTERN SYNTHETIC SUCCESS',
      error_code: null,
      files_modified: [],
      commits_created: [],
      report_marker: reportMarker,
      simulated: true,
      ci_evidence: Object.freeze(ciEvidence),
      qa_evidence: Object.freeze(qaEvidence)
    });
  }
}

/**
 * Normalizes and validates the execution result.
 * Enforces CI and QA evidence integrity, fail-closed on unauthorized file modifications or missing proofs.
 */
export function normalizeAndValidateResult(result, expectedTask = {}) {
  if (!isObject(result)) {
    throw new Error('INVALID_RESULT_SCHEMA: Not an object');
  }

  const keys = Object.keys(result);
  if (keys.length !== REQUIRED_RESULT_KEYS.length || !REQUIRED_RESULT_KEYS.every(k => hasOwn(result, k))) {
    throw new Error('INVALID_RESULT_SCHEMA: Missing or extraneous keys');
  }

  if (result.result_version !== RESULT_VERSION) {
    throw new Error(`INVALID_RESULT_VERSION: ${result.result_version}`);
  }

  if (result.simulated !== true) {
    throw new Error('NON_SIMULATED_RESULT_FORBIDDEN');
  }

  if (expectedTask.task_id && result.task_id !== expectedTask.task_id) {
    throw new Error('RESULT_TASK_ID_MISMATCH');
  }

  if (expectedTask.issue_number && result.issue_number !== expectedTask.issue_number) {
    throw new Error('RESULT_ISSUE_NUMBER_MISMATCH');
  }

  // Strict zero-modification guarantee in mock mode
  if (!Array.isArray(result.files_modified) || result.files_modified.length !== 0) {
    throw new Error('UNAUTHORIZED_FILE_MODIFICATIONS_DETECTED');
  }

  if (!Array.isArray(result.commits_created) || result.commits_created.length !== 0) {
    throw new Error('UNAUTHORIZED_COMMITS_DETECTED');
  }

  if (typeof result.report_marker !== 'string' || !REPORT_MARKER_REGEX.test(result.report_marker)) {
    throw new Error('INVALID_REPORT_MARKER');
  }

  // Timestamps
  for (const tKey of ['started_at', 'finished_at']) {
    if (typeof result[tKey] !== 'string' || !Number.isFinite(Date.parse(result[tKey])) || new Date(result[tKey]).toISOString() !== result[tKey]) {
      throw new Error(`INVALID_TIMESTAMP_${tKey.toUpperCase()}`);
    }
  }

  if (Date.parse(result.finished_at) < Date.parse(result.started_at)) {
    throw new Error('INVALID_RESULT_CHRONOLOGY');
  }

  // Mandatory CI Evidence Validation
  if (!isObject(result.ci_evidence) || result.ci_evidence.passed !== true) {
    throw new Error('GATE_CI_MISSING_HOLD');
  }

  // Mandatory Codex QA Evidence Validation
  if (!isObject(result.qa_evidence) || result.qa_evidence.approved !== true || result.qa_evidence.findings > 0) {
    throw new Error('GATE_QA_MISSING_HOLD');
  }

  // Binding SHA validation
  if (expectedTask.target_sha) {
    if (result.ci_evidence.sha !== expectedTask.target_sha || result.qa_evidence.sha !== expectedTask.target_sha) {
      throw new Error('EVIDENCE_SHA_MISMATCH');
    }
  }

  return Object.freeze(structuredClone(result));
}
