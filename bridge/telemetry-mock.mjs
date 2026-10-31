// ZC-04A: pure OFFLINE mock telemetry projection. No provider, network or IO.
export const VERSION = 'ZC04_TELEMETRY_MOCK_V1';
export const REPOSITORY = 'augusliang23-web/cc-h15a-claude-dispatch-lab';
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ACTIVE = new Set(['CLAIMED', 'RUNNING', 'REVIEWING']);
const NEXT = Object.freeze({
  QUEUED: ['CLAIMED', 'HOLD', 'FAILED'],
  CLAIMED: ['RUNNING', 'HOLD', 'FAILED'],
  RUNNING: ['ARTIFACT_READY', 'HOLD', 'FAILED'],
  ARTIFACT_READY: ['REVIEWING', 'HOLD', 'FAILED'],
  REVIEWING: ['QA_PASSED', 'HOLD', 'FAILED'],
  QA_PASSED: ['COMPLETED', 'HOLD', 'FAILED'],
  COMPLETED: [], HOLD: [], FAILED: [],
});
const RULES = Object.freeze({
  QUEUED: ['control-plane', 'github', 'ISSUE', /^issue:[1-9]\d{0,9}$/],
  CLAIMED: ['antigravity', 'mac-relay', 'LOCAL_CLAIM', /^claim:[A-Za-z0-9._-]{1,64}$/],
  RUNNING: ['antigravity', 'mac-relay', 'PROCESS', /^process:[A-Za-z0-9._-]{1,64}$/],
  ARTIFACT_READY: ['antigravity', 'github', 'COMMIT', /^sha:[0-9a-f]{40}$/],
  REVIEWING: ['codex', 'codex-cloud', 'REVIEW_RUNNING', /^review:[0-9a-f]{40}:[1-9]\d{0,12}$/],
  QA_PASSED: ['codex', 'codex-cloud', 'REVIEW_PASS', /^review:[0-9a-f]{40}:[1-9]\d{0,12}$/],
  COMPLETED: ['control-plane', 'github', 'RESULT_VERIFIED', /^result:[0-9a-f]{40}:[1-9]\d{0,12}$/],
});
const keys = (x, expected) => x !== null && typeof x === 'object' &&
  !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype &&
  Object.keys(x).length === expected.length && expected.every(k => Object.hasOwn(x, k));
const utc = s => typeof s === 'string' && ISO_UTC.test(s) &&
  Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const fail = () => { throw Error('INVALID_TELEMETRY'); };
const allowed = new Set(['control-plane/github', 'antigravity/mac-relay', 'codex/codex-cloud']);
const blocked = () => ({
  status: 'HOLD', reason: 'INVALID_TELEMETRY', stage: 'UNVERIFIED',
  health: 'UNKNOWN', simulated: true, task_id: null,
  agents: {antigravity: 'UNVERIFIED', codex: 'UNVERIFIED'},
});
export function projectTelemetry(events, {asOf, staleAfterMs = 120000, noProgressAfterMs = 300000} = {}) {
  try {
    if (!utc(asOf) || !Number.isSafeInteger(staleAfterMs) ||
        staleAfterMs < 1000 || staleAfterMs > 86400000 ||
        !Number.isSafeInteger(noProgressAfterMs) ||
        noProgressAfterMs < staleAfterMs || noProgressAfterMs > 86400000 ||
        !Array.isArray(events) || events.length < 1 || events.length > 100 ||
        Buffer.byteLength(JSON.stringify(events)) > 65536) fail();
    let stage = null, task = null, previousAt = null, lastSeen = null;
    let lastProgress = null, artifactSha = null, reviewRef = null, passRef = null;
    let seenHeartbeat = false, heartbeatCount = 0, proofCount = 0;
    const asOfMs = Date.parse(asOf);
    for (let i = 0; i < events.length; i++) {
      const e = events[i];
      if (!keys(e, ['version', 'repository', 'task_id', 'sequence',
        'at', 'actor', 'source', 'type', 'proof']) ||
        e.version !== VERSION || e.repository !== REPOSITORY ||
        typeof e.task_id !== 'string' || !TASK_ID.test(e.task_id) ||
        (task !== null && e.task_id !== task) ||
        e.sequence !== i + 1 || !utc(e.at) ||
        Date.parse(e.at) > asOfMs ||
        (previousAt !== null && Date.parse(e.at) < previousAt) ||
        !keys(e.proof, ['kind', 'ref']) ||
        typeof e.proof.ref !== 'string') fail();
      if (task === null) task = e.task_id;
      previousAt = Date.parse(e.at);
      lastSeen = e.at;
      if (e.type === 'HEARTBEAT') {
        if (!['RUNNING', 'REVIEWING'].includes(stage) ||
            !allowed.has(e.actor + '/' + e.source) ||
            (stage === 'RUNNING' && (e.actor !== 'antigravity' ||
              e.source !== 'mac-relay' || e.proof.kind !== 'PROCESS' ||
              !/^process:[A-Za-z0-9._-]{1,64}$/.test(e.proof.ref))) ||
            (stage === 'REVIEWING' && (e.actor !== 'codex' ||
              e.source !== 'codex-cloud' || e.proof.kind !== 'REVIEW_RUNNING' ||
              e.proof.ref !== reviewRef))) fail();
        seenHeartbeat = true;
        heartbeatCount++;
        continue; // Heartbeat never advances a work milestone.
      }
      if (e.type === 'HOLD' || e.type === 'FAILED') {
        if (stage === null || ['HOLD', 'FAILED', 'COMPLETED'].includes(stage) ||
            !allowed.has(e.actor + '/' + e.source) ||
            e.proof.kind !== 'ERROR' ||
            !/^error:[A-Z_]{3,40}$/.test(e.proof.ref)) fail();
      } else {
        const r = RULES[e.type];
        if (!r || e.actor !== r[0] || e.source !== r[1] ||
            e.proof.kind !== r[2] || !r[3].test(e.proof.ref)) fail();
      }
      if (stage === null && e.type !== 'QUEUED') fail();
      if (stage !== null && !NEXT[stage].includes(e.type)) fail();
      if (e.type === 'ARTIFACT_READY') artifactSha = e.proof.ref.slice(4);
      if (e.type === 'REVIEWING') {
        if (!artifactSha || e.proof.ref.split(':')[1] !== artifactSha) fail();
        reviewRef = e.proof.ref;
      }
      if (e.type === 'QA_PASSED') {
        if (!reviewRef || e.proof.ref !== reviewRef) fail();
        passRef = e.proof.ref;
      }
      if (e.type === 'COMPLETED' &&
          (!passRef || e.proof.ref !== 'result:' + passRef.slice(7))) fail();
      stage = e.type;
      lastProgress = e.at;
      proofCount++;
      seenHeartbeat = false;
    }
    const age = asOfMs - Date.parse(lastSeen);
    const progressAge = asOfMs - Date.parse(lastProgress);
    let health = 'OBSERVED_ONLY';
    if (ACTIVE.has(stage)) {
      health = age > staleAfterMs ? 'STALLED' :
        seenHeartbeat && progressAge > noProgressAfterMs ? 'ALIVE_NO_PROGRESS' : 'ACTIVE';
    } else if (['FAILED', 'HOLD'].includes(stage)) health = 'NEEDS_ATTENTION';
    else if (stage === 'COMPLETED') health = 'COMPLETED_VERIFIED_IN_FIXTURE';
    const devState = ['QUEUED'].includes(stage) ? 'WAITING' :
      ['CLAIMED', 'RUNNING'].includes(stage) ? stage :
      stage === 'HOLD' || stage === 'FAILED' ? 'UNKNOWN_AFTER_STOP' : 'ARTIFACT_RECORDED';
    const qaState = ['REVIEWING', 'QA_PASSED'].includes(stage) ? stage :
      stage === 'COMPLETED' ? 'REVIEW_PASSED' :
      stage === 'HOLD' || stage === 'FAILED' ? 'UNKNOWN_AFTER_STOP' : 'WAITING';
    return {
      status: 'MOCK_OBSERVED', simulated: true, task_id: task, stage,
      health, as_of: asOf, last_seen_at: lastSeen, last_progress_at: lastProgress,
      heartbeat_count: heartbeatCount, milestone_proof_count: proofCount,
      agents: {antigravity: devState, codex: qaState},
      notes: ['HEARTBEAT_IS_NOT_WORK_PROGRESS', 'PROOFS_ARE_SIMULATED_NOT_VERIFIED_LIVE'],
    };
  } catch { return blocked(); }
}
