// Pure proposal/fixture validation. No signer, network, writer or execution path.
import { REPOSITORY } from './foundation.mjs';
import { canonical,digest,exact,hex,identifier,timestamp,validateApproval,fail } from './security.mjs';
import { claimKey } from './claims.mjs';
import { validateJournal } from './journal.mjs';
const REPO_ID=1423925660,REPO_NODE='R_kgDOVN9hnA';
const hold=reason=>({status:'HOLD',reason,execution_allowed:false,automatic_retry:false});
const MANIFEST_KEYS=['manifest_version','repository','repository_id','repository_node_id','approval','task_key','ref','owner_id','attempt_id','created_at'];
export function validateManifest(m) {
  if(!exact(m,['payload','immutable_evidence_digest']) || !exact(m.payload,MANIFEST_KEYS) || !hex(m.immutable_evidence_digest))fail('INVALID_MANIFEST');
  const p=m.payload;validateApproval(p.approval);
  if(p.manifest_version!=='CC_AG_CLAIM_MANIFEST_V1' || p.repository!==REPOSITORY || p.repository_id!==REPO_ID || p.repository_node_id!==REPO_NODE || !identifier(p.owner_id) || !identifier(p.attempt_id) || !timestamp(p.created_at) || p.ref!==claimKey(p.approval.binding) || p.task_key!==p.ref.split('/').at(-1) || Date.parse(p.created_at)<Date.parse(p.approval.not_before) || Date.parse(p.created_at)>=Date.parse(p.approval.expires_at) || digest(p)!==m.immutable_evidence_digest)fail('INVALID_MANIFEST');
  return structuredClone(m);
}
const INTENT_KEYS=['intent_version','repository','repository_id','repository_node_id','ref','manifest_digest','target_commit_sha','task_binding','approval_id','owner_id','attempt_id','principal','operation','max_writes','automatic_retry','not_before','expires_at','expected_side_effects','pre_read','post_read','cleanup'];
/** Validates a proposed intent's shape/binding, NOT its human authorization,
 * target Git object's contents, principal privileges or live readiness.
 */
export function validateWriteIntent(i,manifest,now) {
  const m=validateManifest(manifest).payload;
  if(!exact(i,INTENT_KEYS) || i.intent_version!=='CC_AG_SINGLE_WRITE_INTENT_V1' || i.repository!==m.repository || i.repository_id!==m.repository_id || i.repository_node_id!==m.repository_node_id || i.ref!==m.ref || i.manifest_digest!==manifest.immutable_evidence_digest || typeof i.target_commit_sha!=='string' || !/^[a-f0-9]{40}$/.test(i.target_commit_sha) || canonical(i.task_binding)!==canonical(m.approval.binding) || i.approval_id!==m.approval.approval_id || i.owner_id!==m.owner_id || i.attempt_id!==m.attempt_id || i.operation!=='CREATE_REF' || i.max_writes!==1 || i.automatic_retry!==false || i.pre_read!=='EXACT_REF_AND_MANIFEST' || i.post_read!=='EXACT_REF_AND_MANIFEST' || i.cleanup!=='RETAIN_NO_AUTOMATIC_DELETE' || !Array.isArray(i.expected_side_effects) || canonical(i.expected_side_effects)!==canonical(['ONE_LAB_REF_CREATE_NO_EXECUTION']))fail('INVALID_WRITE_INTENT');
  if(!exact(i.principal,['kind','app_id','installation_id','permissions']) || i.principal.kind!=='GitHubAppInstallation' || !Number.isSafeInteger(i.principal.app_id) || i.principal.app_id<1 || !Number.isSafeInteger(i.principal.installation_id) || i.principal.installation_id<1 || !exact(i.principal.permissions,['metadata','issues','contents']) || canonical(i.principal.permissions)!==canonical({metadata:'read',issues:'read',contents:'write'}))fail('INVALID_WRITE_PRINCIPAL');
  if(!timestamp(now) || !timestamp(i.not_before) || !timestamp(i.expires_at) || Date.parse(i.not_before)<Date.parse(m.approval.not_before) || Date.parse(i.expires_at)>Date.parse(m.approval.expires_at) || Date.parse(i.not_before)>=Date.parse(i.expires_at) || Date.parse(now)<Date.parse(i.not_before) || Date.parse(now)>=Date.parse(i.expires_at))fail('INVALID_WRITE_WINDOW');
  return structuredClone(i);
}
/** Injectable observation interface; statuses are test inputs, not real Mac,
 * credential or remote-proof detectors. Never changes a journal or clears HOLD.
 */
export function assessRecovery({manifest,journal_status,journal,availability,credential_state,approval_state,current_issue_digest,remote,now}={}) {
  let m,r;
  try {m=validateManifest(manifest).payload;}catch {return hold('MANIFEST_UNTRUSTED');}
  if(availability!=='available')return hold('MAC_UNAVAILABLE_OR_UNVERIFIED');
  if(credential_state!=='readable')return hold('CREDENTIAL_UNAVAILABLE_OR_UNVERIFIED');
  if(journal_status!=='OK')return hold('JOURNAL_UNTRUSTED');
  try {r=validateJournal(journal);}catch {return hold('JOURNAL_UNTRUSTED');}
  if(canonical(r.claim.approval)!==canonical(m.approval) || r.claim.claim_id!==m.ref || r.claim.owner!==m.owner_id || r.claim.attempt_id!==m.attempt_id)return hold('LOCAL_BINDING_MISMATCH');
  if(r.state==='COMPLETED')return hold('ALREADY_COMPLETED');
  if(['RECONCILE_REQUIRED','UNCERTAIN','BLOCKED'].includes(r.recovery_status) || r.state==='FAILED')return hold('STICKY_JOURNAL_RESTRICTION');
  if(r.state==='RUNNING' || r.state==='INTERRUPTED')return hold('EXECUTION_MAY_HAVE_STARTED');
  if(!timestamp(now) || Date.parse(now)<Date.parse(m.approval.not_before) || Date.parse(now)>=Date.parse(m.approval.expires_at) || approval_state!=='VALID')return hold('APPROVAL_NOT_CURRENT_OR_UNVERIFIED');
  if(current_issue_digest!==m.approval.binding.issue_content_digest)return hold('ISSUE_REVISION_CHANGED_OR_UNVERIFIED');
  if(!exact(remote,['kind','manifest']) || remote.kind!=='RESERVED')return hold('REMOTE_OWNERSHIP_UNPROVEN');
  let observed;try{observed=validateManifest(remote.manifest);}catch{return hold('REMOTE_OWNERSHIP_UNPROVEN');}
  if(canonical(observed)!==canonical(manifest))return hold('REMOTE_OWNER_OR_ATTEMPT_MISMATCH');
  return hold('OWNERSHIP_OBSERVED_RECONCILIATION_REQUIRED');
}
export function firstWriteGate() {
  return {...hold('LIVE_WRITE_NOT_AUTHORIZED'),requirements:['INDEPENDENT_APPROVAL_AND_WITHDRAWAL_VERIFIED','REAL_TASK_AND_MANIFEST_COMMIT_PINNED','LAB_ONLY_PRINCIPAL_VERIFIED','IMMUTABILITY_DELETION_REPLAY_PROTECTION_PROVEN','CONCURRENCY_AND_TIMEOUT_RECONCILIATION_ACCEPTED','JOURNAL_TIME_AVAILABILITY_AUTOMATION_ACCEPTED','EXPLICIT_EXACT_ONE_WRITE_AUTHORIZATION']};
}
