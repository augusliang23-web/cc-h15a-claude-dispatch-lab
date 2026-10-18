import { canonical, digest, exact, identifier, validateApproval, fail } from './security.mjs';

export function claimKey(binding) {
  // One slot per repository/task ID, not per revision/approval/attempt/Issue.
  return `refs/heads/cc-ag-claims/v1/${digest({domain:'CC_AG_CLAIM_SLOT_V1',repository:binding.repository,task_id:binding.task_id})}`;
}
export function claimRequest(approval,owner,attempt_id) {
  const p=validateApproval(approval);
  return validateClaim({claim_version:'CC_AG_CLAIM_V1',claim_id:claimKey(p.binding),owner,attempt_id,approval:p});
}
export function validateClaim(c) {
  if (!exact(c,['claim_version','claim_id','owner','attempt_id','approval']) || c.claim_version!=='CC_AG_CLAIM_V1' || !identifier(c.owner) || !identifier(c.attempt_id)) fail('INVALID_CLAIM');
  validateApproval(c.approval);
  if (c.claim_id!==claimKey(c.approval.binding)) fail('INVALID_CLAIM_ID');
  return structuredClone(c);
}
/** GitHub provider interface (no live implementation):
 * readTask() -> exact Issue metadata; readApproval() -> attestation;
 * readClaim(exact id) -> validated manifest | null (authoritative absence);
 * readEvidence(exact id) -> execution evidence | null;
 * isConsumed(approval id) -> boolean;
 * attemptClaim(validated request) -> CLAIMED | CONFLICT | REPLAY.
 * Any exception/unknown response is uncertain and requires reconciliation.
 * A future provider must check full revision/approval and manifest, not a label.
 */
export class MockGitHub {
  #claims=new Map(); #used=new Set(); #task; #attestation; #evidence;
  constructor(snapshot={claims:[]}, {task=null,attestation=null,evidence=null}={}) {
    if (!exact(snapshot,['claims']) || !Array.isArray(snapshot.claims)) fail('INVALID_REMOTE_SNAPSHOT');
    for(const value of snapshot.claims) {
      const c=validateClaim(value);
      if(this.#claims.has(c.claim_id) || this.#used.has(c.approval.approval_id)) fail('INVALID_REMOTE_SNAPSHOT');
      this.#claims.set(c.claim_id,c); this.#used.add(c.approval.approval_id);
    }
    this.#task=structuredClone(task);this.#attestation=structuredClone(attestation);this.#evidence=structuredClone(evidence);
  }
  snapshot() { return {claims:[...this.#claims.values()].map(c=>structuredClone(c))}; }
  async readTask() { return structuredClone(this.#task); }
  async readApproval() { return structuredClone(this.#attestation); }
  async readClaim(id) { return structuredClone(this.#claims.get(id)??null); }
  async readEvidence() { return structuredClone(this.#evidence); }
  async isConsumed(id) { return this.#used.has(id); }
  async attemptClaim(request) {
    const c=validateClaim(request);
    // No await between comparison and insert: one authoritative in-memory server.
    // Independent instances are NOT distributed synchronization.
    if(this.#claims.has(c.claim_id)) return {status:'CONFLICT'};
    if(this.#used.has(c.approval.approval_id)) return {status:'REPLAY'};
    this.#claims.set(c.claim_id,c);this.#used.add(c.approval.approval_id);
    return {status:'CLAIMED',claim:structuredClone(c)};
  }
}
export const sameClaim = (a,b) => canonical(validateClaim(a))===canonical(validateClaim(b));
export function claimLive() { fail('LIVE_CLAIMING_DISABLED'); }
