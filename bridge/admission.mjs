// Testable OFFLINE integration. No executor is imported or called.
import { canonical } from './security.mjs';
import { MockGitHub,sameClaim,validateClaim } from './claims.mjs';

const hold=reason=>({status:'HOLD',reason,execution_allowed:false});
const usable=(remote,availability)=>!(remote instanceof MockGitHub)?hold('MOCK_PROVIDER_REQUIRED'):availability!=='available'?hold('UNAVAILABLE'):null;
async function currentApproval(remote,verifier,record,now) {
  const i=await remote.readTask();
  const proof=await remote.readApproval();
  const p=await verifier.verify(i,proof,now);
  if(canonical(p)!==canonical(record.claim.approval))throw Error('APPROVAL_MISMATCH');
  return p;
}
async function rememberHold(journal,r,now,reason) {
  try {
    if(r.state==='QUEUED')await journal.update(r.sequence,{recovery_status:'RECONCILE_REQUIRED'},now);
    return hold(reason);
  }catch {return hold('JOURNAL_UNTRUSTED');}
}
async function uncertain(journal) {
  try {const r=await journal.load();if(r.state==='QUEUED')await journal.update(r.sequence,{recovery_status:'RECONCILE_REQUIRED'},r.updated_at);}catch { /* durable failure itself blocks further use */ }
  return hold('CLAIM_OUTCOME_UNCERTAIN');
}

/** simulateClaim requires an explicitly initialized Journal and a shared mock
 * authority. Success reserves and records only; execution_allowed is always false.
 * No recovery path calls attemptClaim, and no failure retries a request.
 */
export async function simulateClaim({journal,remote,verifier,now,availability='available'}) {
  const blocked=usable(remote,availability);if(blocked)return blocked;
  let r;
  try {r=await journal.load();}catch {return hold('JOURNAL_UNTRUSTED');}
  if(r.state!=='QUEUED' || r.recovery_status!=='READY')return hold('RECONCILIATION_REQUIRED');
  try {
    await currentApproval(remote,verifier,r,now);
    const existing=await remote.readClaim(r.claim.claim_id);
    if(existing!==null)return hold('EXISTING_CLAIM');
    if(await remote.readEvidence(r.claim.claim_id)!==null)return rememberHold(journal,r,now,'PRIOR_EXECUTION_EVIDENCE');
    if(await remote.isConsumed(r.claim.approval.approval_id)!==false)return hold('APPROVAL_REPLAYED');
  }catch {return hold('ADMISSION_EVIDENCE_INVALID');}
  try {r=await journal.update(r.sequence,{recovery_status:'CLAIM_PENDING'},now);}
  catch {return hold('JOURNAL_UNTRUSTED');}
  try {
    const reply=await remote.attemptClaim(r.claim);
    if(reply?.status!=='CLAIMED' || !sameClaim(reply.claim,r.claim))return uncertain(journal);
    const observed=await remote.readClaim(r.claim.claim_id);
    if(observed===null || !sameClaim(observed,r.claim))return uncertain(journal);
    // Recheck exact Issue revision and attestation after reservation. A stale
    // approval/revocation/revision leaves a reservation but no execution permission.
    await currentApproval(remote,verifier,r,now);
    r=await journal.update(r.sequence,{state:'CLAIMED',recovery_status:'CLAIM_CONFIRMED'},now);
    return {status:'MOCK_CLAIMED',execution_allowed:false,claim_id:r.claim.claim_id};
  }catch {return uncertain(journal);}
}

/** R01–R12: conservative inspection/reconciliation; never admission or retry.
 * Remote execution evidence is read but not automatically promoted to success.
 * Only the old approved state transitions are used; recovery_status is separate.
 */
export async function recover({journal,remote,verifier,now,availability='available'}) {
  const blocked=usable(remote,availability);if(blocked)return blocked;
  let r;
  try {r=await journal.load();}catch {return hold('JOURNAL_UNTRUSTED');}
  if(r.state==='COMPLETED')return hold('ALREADY_COMPLETED');
  if(['BLOCKED','FAILED'].includes(r.state))return hold('EXPLICIT_RECONCILIATION_REQUIRED');
  if(['RUNNING','INTERRUPTED'].includes(r.state)) {
    try {
      if(r.state==='RUNNING')r=await journal.update(r.sequence,{state:'INTERRUPTED',recovery_status:'UNCERTAIN'},now);
      await journal.update(r.sequence,{state:'BLOCKED',recovery_status:'BLOCKED'},now);
    }catch {return hold('JOURNAL_UNTRUSTED');}
    return hold('EXECUTION_UNCERTAIN');
  }
  try {
    const c=await remote.readClaim(r.claim.claim_id);
    const evidence=await remote.readEvidence(r.claim.claim_id);
    if(c!==null) {
      validateClaim(c);
      if(!sameClaim(c,r.claim))return hold('CLAIM_MISMATCH');
      if(evidence!==null)return hold('REMOTE_EXECUTION_EVIDENCE_REQUIRES_REVIEW');
      // A request might have succeeded before local recording. Preserve remote
      // ownership but require new explicit reconciliation/authorization to proceed.
      if(r.state==='QUEUED')await journal.update(r.sequence,{state:'CLAIMED',recovery_status:'RECONCILE_REQUIRED'},now);
      return hold('CLAIMED_REQUIRES_AUTHORIZATION');
    }
    if(evidence!==null)return rememberHold(journal,r,now,'INCONSISTENT_REMOTE_EVIDENCE');
    if(r.state!=='QUEUED' || r.recovery_status!=='READY')return hold('CLAIM_UNCERTAIN');
    await currentApproval(remote,verifier,r,now);
    if(await remote.isConsumed(r.claim.approval.approval_id)!==false)return hold('APPROVAL_REPLAYED');
    // Safe queue observation only. No claim is attempted and nothing executes.
    return {status:'QUEUED',execution_allowed:false};
  }catch {return hold('RECOVERY_EVIDENCE_UNAVAILABLE');}
}
