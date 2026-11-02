// ZC-MVP-A: Task Envelope Validator & Authorization Scope Validator
// 100% offline synthetic validation. No network, no subprocess, no model calls.
import { createHash } from 'node:crypto';

export const REPOSITORY = 'augusliang23-web/cc-h15a-claude-dispatch-lab';
export const CONTRACT_VERSION = 'zc.task/v1';

const TASK_ID_REGEX = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const GIT_SHA_REGEX = /^[0-9a-f]{40}$/;
const SHA256_HEX_REGEX = /^[0-9a-f]{64}$/;

const ALLOWED_RISKS = Object.freeze(new Set(['risk:low', 'risk:medium', 'risk:high']));
const ALLOWED_TASK_TYPES = Object.freeze(new Set(['synthetic']));
const ALLOWED_MODELS = Object.freeze(new Set(['gemini-pro', 'gemini-3.8-flash-low']));
const ALLOWED_AGENTS = Object.freeze(new Set(['antigravity']));
const ALLOWED_APPROVALS = Object.freeze(new Set(['approved']));

const REQUIRED_TASK_KEYS = Object.freeze([
  'contract_version',
  'task_id',
  'repository',
  'issue_number',
  'agent',
  'model',
  'task_type',
  'execution_mode',
  'approval',
  'status',
  'target_sha',
  'scope_sha256',
  'allowlist',
  'risk',
  'max_attempts',
  'created_at',
  'expires_at'
]);

const isObject = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/**
 * Calculates SHA-256 hex digest of a string or JSON-serializable value.
 */
export function sha256(val) {
  return createHash('sha256')
    .update(typeof val === 'string' ? val : JSON.stringify(val))
    .digest('hex');
}

/**
 * Validates the raw Task Envelope against strict schema rules.
 * Rejects prototype pollution, unknown fields, malformed types, or oversized payloads.
 */
export function validateTaskEnvelope(raw) {
  if (typeof raw === 'string') {
    if (Buffer.byteLength(raw) > 16384) {
      throw new Error('OVERSIZED_TASK_PAYLOAD');
    }
    try {
      raw = JSON.parse(raw);
    } catch {
      throw new Error('INVALID_JSON_TASK');
    }
  }

  if (!isObject(raw)) {
    throw new Error('INVALID_TASK_OBJECT');
  }

  // Prototype pollution protection
  if (hasOwn(raw, '__proto__') || hasOwn(raw, 'constructor') || hasOwn(raw, 'prototype')) {
    throw new Error('UNTRUSTED_TASK_KEY');
  }

  // Exact keys enforcement
  const keys = Object.keys(raw);
  if (keys.length !== REQUIRED_TASK_KEYS.length || !REQUIRED_TASK_KEYS.every(k => hasOwn(raw, k))) {
    throw new Error('INVALID_TASK_SCHEMA');
  }

  // Field validations
  if (raw.contract_version !== CONTRACT_VERSION && raw.contract_version !== 'CC_AG_BRIDGE_V1') {
    throw new Error('INVALID_CONTRACT_VERSION');
  }

  if (typeof raw.task_id !== 'string' || !TASK_ID_REGEX.test(raw.task_id)) {
    throw new Error('INVALID_TASK_ID');
  }

  if (raw.repository !== REPOSITORY) {
    throw new Error('INVALID_REPOSITORY');
  }

  if (!Number.isSafeInteger(raw.issue_number) || raw.issue_number <= 0) {
    throw new Error('INVALID_ISSUE_NUMBER');
  }

  if (!ALLOWED_AGENTS.has(raw.agent)) {
    throw new Error('INVALID_AGENT');
  }

  if (!ALLOWED_MODELS.has(raw.model)) {
    throw new Error('INVALID_MODEL');
  }

  if (!ALLOWED_TASK_TYPES.has(raw.task_type)) {
    throw new Error('INVALID_TASK_TYPE');
  }

  if (raw.execution_mode !== 'mock-e2e' && raw.execution_mode !== 'dry-run') {
    throw new Error('INVALID_EXECUTION_MODE');
  }

  if (!ALLOWED_APPROVALS.has(raw.approval)) {
    throw new Error('MISSING_AUTHORIZATION');
  }

  if (raw.status !== 'QUEUED') {
    throw new Error('INVALID_INITIAL_STATUS');
  }

  if (typeof raw.target_sha !== 'string' || !GIT_SHA_REGEX.test(raw.target_sha)) {
    throw new Error('INVALID_TARGET_SHA');
  }

  if (typeof raw.scope_sha256 !== 'string' || !SHA256_HEX_REGEX.test(raw.scope_sha256)) {
    throw new Error('INVALID_SCOPE_SHA256');
  }

  if (!Array.isArray(raw.allowlist) || raw.allowlist.length === 0 || !raw.allowlist.every(p => typeof p === 'string')) {
    throw new Error('INVALID_ALLOWLIST');
  }

  // Path traversal check in allowlist
  for (const path of raw.allowlist) {
    if (path.startsWith('/') || path.includes('..') || path.includes('\\')) {
      throw new Error('PATH_TRAVERSAL_IN_ALLOWLIST');
    }
  }

  if (!ALLOWED_RISKS.has(raw.risk)) {
    throw new Error('INVALID_RISK_LABEL');
  }

  if (!Number.isSafeInteger(raw.max_attempts) || raw.max_attempts < 1 || raw.max_attempts > 5) {
    throw new Error('INVALID_MAX_ATTEMPTS');
  }

  for (const tKey of ['created_at', 'expires_at']) {
    if (typeof raw[tKey] !== 'string' || !Number.isFinite(Date.parse(raw[tKey])) || new Date(raw[tKey]).toISOString() !== raw[tKey]) {
      throw new Error(`INVALID_TIMESTAMP_${tKey.toUpperCase()}`);
    }
  }

  if (Date.parse(raw.expires_at) <= Date.parse(raw.created_at)) {
    throw new Error('INVALID_EXPIRY_CHRONOLOGY');
  }

  return Object.freeze(structuredClone(raw));
}

/**
 * Validates authorization scope against expected runtime context.
 * Enforces exact commit binding, allowlist subset, expiry TTL, and risk boundaries.
 */
export function validateAuthorization(task, context = {}) {
  const t = validateTaskEnvelope(task);

  const nowIso = context.now || new Date().toISOString();
  const nowMs = Date.parse(nowIso);

  // Expiration check
  if (Date.parse(t.expires_at) <= nowMs) {
    throw new Error('TASK_EXPIRED');
  }

  // Exact commit SHA binding
  if (context.head_sha) {
    if (t.target_sha.toLowerCase() !== context.head_sha.toLowerCase()) {
      throw new Error('SHA_MISMATCH');
    }
  }

  // Scope digest binding
  if (context.expected_scope_sha256) {
    if (t.scope_sha256 !== context.expected_scope_sha256) {
      throw new Error('SCOPE_DIGEST_MISMATCH');
    }
  }

  // Allowlist confinement
  if (context.authorized_allowlist && Array.isArray(context.authorized_allowlist)) {
    const authSet = new Set(context.authorized_allowlist);
    for (const p of t.allowlist) {
      if (!authSet.has(p)) {
        throw new Error('ALLOWLIST_VIOLATION');
      }
    }
  }

  // High risk boundary check -> requires manual human hold
  if (t.risk === 'risk:high') {
    throw new Error('HIGH_RISK_HOLD');
  }

  // Verification of synthetic signature/proof if provided
  if (context.require_synthetic_proof) {
    if (!context.synthetic_proof || context.synthetic_proof.task_id !== t.task_id || !context.synthetic_proof.valid) {
      throw new Error('INVALID_SYNTHETIC_PROOF');
    }
  }

  return Object.freeze({
    authorized: true,
    task_id: t.task_id,
    target_sha: t.target_sha,
    risk: t.risk,
    checked_at: nowIso
  });
}
