// ZC-MVP-A: Local Claim Controller & Crash-Safe State Ledger
// Manages atomic state transitions, single-instance mutual exclusion, and hash-chained journaling.
import fs from 'node:fs';
import path from 'node:path';
import { sha256 } from './zc-bridge-auth.mjs';

export const ALLOWED_TRANSITIONS = Object.freeze({
  QUEUED: Object.freeze(['CLAIMED']),
  CLAIMED: Object.freeze(['RUNNING', 'INTERRUPTED']),
  RUNNING: Object.freeze(['COMPLETED', 'FAILED', 'INTERRUPTED']),
  INTERRUPTED: Object.freeze(['BLOCKED']),
  FAILED: Object.freeze([]),
  COMPLETED: Object.freeze([]),
  BLOCKED: Object.freeze([])
});

const ACTIVE_STATES = new Set(['CLAIMED', 'RUNNING']);
const TERMINAL_STATES = new Set(['COMPLETED', 'FAILED', 'BLOCKED']);

export function transitionState(fromState, toState) {
  const allowed = ALLOWED_TRANSITIONS[fromState];
  if (!allowed || !allowed.includes(toState)) {
    throw new Error(`INVALID_STATE_TRANSITION: ${fromState} -> ${toState}`);
  }
  return toState;
}

export class LocalClaimController {
  #storageDir;
  #lockFile;
  #journalFile;
  #stateFile;
  #isLocked = false;
  #entries = new Map(); // task_id -> { task_id, state, attempts, events: [], last_digest }
  #chainHead = 'GENESIS';
  #seq = 0;

  constructor(options = {}) {
    this.#storageDir = options.storageDir || null;

    if (this.#storageDir) {
      if (!fs.existsSync(this.#storageDir)) {
        fs.mkdirSync(this.#storageDir, { recursive: true, mode: 0o700 });
      }
      this.#lockFile = path.join(this.#storageDir, 'bridge.lock');
      this.#journalFile = path.join(this.#storageDir, 'journal.ndjson');
      this.#stateFile = path.join(this.#storageDir, 'state.json');

      this.#acquireLock();
      this.#loadExistingState();
    }
  }

  #acquireLock() {
    if (!this.#lockFile) return;

    if (fs.existsSync(this.#lockFile)) {
      try {
        const content = fs.readFileSync(this.#lockFile, 'utf8').trim();
        const info = JSON.parse(content);
        // Check if process is still alive
        if (info && info.pid) {
          try {
            process.kill(info.pid, 0);
            // Process exists -> lock is held
            throw new Error('BRIDGE_BUSY_LOCK_HELD');
          } catch (e) {
            if (e.message === 'BRIDGE_BUSY_LOCK_HELD') throw e;
            // Process died -> stale lock
          }
        }
      } catch (err) {
        if (err.message === 'BRIDGE_BUSY_LOCK_HELD') throw err;
      }
    }

    try {
      const lockPayload = JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() });
      fs.writeFileSync(this.#lockFile, lockPayload, { flag: 'w', mode: 0o600 });
      this.#isLocked = true;
    } catch (err) {
      throw new Error(`LOCK_ACQUISITION_FAILED: ${err.message}`);
    }
  }

  #loadExistingState() {
    if (!this.#stateFile || !fs.existsSync(this.#stateFile)) return;

    try {
      const data = JSON.parse(fs.readFileSync(this.#stateFile, 'utf8'));
      if (data && Array.isArray(data.tasks)) {
        for (const t of data.tasks) {
          this.#entries.set(t.task_id, {
            task_id: t.task_id,
            state: t.state,
            attempts: t.attempts || 1,
            events: t.events || [t.state],
            last_digest: t.last_digest || 'GENESIS'
          });
        }
      }
      if (typeof data.chainHead === 'string') {
        this.#chainHead = data.chainHead;
      }
      if (Number.isSafeInteger(data.seq)) {
        this.#seq = data.seq;
      }
    } catch {
      throw new Error('CORRUPTED_STATE_FILE');
    }
  }

  #persist() {
    if (!this.#stateFile) return;

    const data = {
      chainHead: this.#chainHead,
      seq: this.#seq,
      updated_at: new Date().toISOString(),
      tasks: Array.from(this.#entries.values())
    };

    const tmpFile = `${this.#stateFile}.tmp.${Date.now()}`;
    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmpFile, this.#stateFile);
  }

  #appendJournal(task_id, event, detail = {}) {
    this.#seq += 1;
    const entryWithoutDigest = {
      seq: this.#seq,
      event,
      task_id,
      timestamp: new Date().toISOString(),
      previous_digest: this.#chainHead,
      detail
    };

    const digest = sha256(entryWithoutDigest);
    const fullEntry = { ...entryWithoutDigest, digest };
    this.#chainHead = digest;

    if (this.#journalFile) {
      fs.appendFileSync(this.#journalFile, JSON.stringify(fullEntry) + '\n', { mode: 0o600 });
    }

    return fullEntry;
  }

  /**
   * Attempts to claim a validated task.
   */
  claimTask(task) {
    const taskId = task.task_id;

    const existing = this.#entries.get(taskId);
    const currentAttempts = (existing?.attempts || 0) + 1;
    const maxAttempts = task.max_attempts || 3;

    // Check if task already seen and completed
    if (existing) {
      if (existing.state === 'COMPLETED') {
        throw new Error('TASK_ALREADY_SEEN');
      }
      if (ACTIVE_STATES.has(existing.state)) {
        throw new Error('TASK_ALREADY_ACTIVE');
      }
      if (currentAttempts > maxAttempts) {
        this.#appendJournal(taskId, 'claim.rejected', { reason: 'FAILED_MAX_RETRIES', attempts: currentAttempts });
        throw new Error('FAILED_MAX_RETRIES');
      }
    }

    // Check single active task rule
    for (const [id, entry] of this.#entries) {
      if (ACTIVE_STATES.has(entry.state)) {
        throw new Error('BRIDGE_BUSY');
      }
    }

    // State transition: QUEUED -> CLAIMED
    const nextState = transitionState('QUEUED', 'CLAIMED');
    const journalEntry = this.#appendJournal(taskId, 'task.claimed', {
      attempts: currentAttempts,
      max_attempts: maxAttempts,
      issue_number: task.issue_number,
      target_sha: task.target_sha
    });

    this.#entries.set(taskId, {
      task_id: taskId,
      state: nextState,
      attempts: currentAttempts,
      events: ['QUEUED', nextState],
      last_digest: journalEntry.digest
    });

    this.#persist();

    return Object.freeze({
      task_id: taskId,
      state: nextState,
      attempts: currentAttempts,
      digest: journalEntry.digest
    });
  }

  /**
   * Advances the state of a claimed task (e.g. CLAIMED -> RUNNING -> COMPLETED / FAILED / INTERRUPTED).
   */
  advanceState(taskId, targetState, detail = {}) {
    const entry = this.#entries.get(taskId);
    if (!entry) {
      throw new Error(`UNKNOWN_TASK: ${taskId}`);
    }

    const fromState = entry.state;
    const nextState = transitionState(fromState, targetState);

    const journalEntry = this.#appendJournal(taskId, `task.${targetState.toLowerCase()}`, {
      fromState,
      nextState,
      ...detail
    });

    entry.state = nextState;
    entry.events.push(nextState);
    entry.last_digest = journalEntry.digest;

    this.#persist();

    return Object.freeze({
      task_id: taskId,
      fromState,
      state: nextState,
      digest: journalEntry.digest
    });
  }

  /**
   * Crash recovery: scans all tasks, and converts any incomplete active tasks (RUNNING/CLAIMED)
   * into INTERRUPTED -> BLOCKED to prevent runaway execution or duplicate dispatches.
   */
  recover() {
    const recovered = [];
    for (const [taskId, entry] of this.#entries) {
      if (entry.state === 'RUNNING') {
        this.advanceState(taskId, 'INTERRUPTED', { reason: 'CRASH_RECOVERY' });
        this.advanceState(taskId, 'BLOCKED', { reason: 'UNSAFE_CRASH_SUSPENDED' });
        recovered.push({ task_id: taskId, finalState: 'BLOCKED' });
      } else if (entry.state === 'CLAIMED') {
        this.advanceState(taskId, 'INTERRUPTED', { reason: 'UNCONFIRMED_CLAIM_ORPHAN' });
        this.advanceState(taskId, 'BLOCKED', { reason: 'CLAIM_TERMINATED' });
        recovered.push({ task_id: taskId, finalState: 'BLOCKED' });
      }
    }
    return recovered;
  }

  getTaskState(taskId) {
    const e = this.#entries.get(taskId);
    return e ? { ...e, events: [...e.events] } : null;
  }

  getChainHead() {
    return this.#chainHead;
  }

  getSequence() {
    return this.#seq;
  }

  close() {
    if (this.#isLocked && this.#lockFile && fs.existsSync(this.#lockFile)) {
      try {
        fs.unlinkSync(this.#lockFile);
      } catch {}
      this.#isLocked = false;
    }
  }
}
