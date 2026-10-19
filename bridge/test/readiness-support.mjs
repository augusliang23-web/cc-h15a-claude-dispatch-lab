import { setup,NOW } from './support.mjs';
import { claimKey } from '../claims.mjs';
import { digest } from '../security.mjs';
export function manifestFixture(owner='mac-A',attempt='attempt-A') {
 const approval=setup().payload,ref=claimKey(approval.binding);
 const payload={manifest_version:'CC_AG_CLAIM_MANIFEST_V1',repository:'augusliang23-web/cc-h15a-claude-dispatch-lab',repository_id:1423925660,repository_node_id:'R_kgDOVN9hnA',approval,task_key:ref.split('/').at(-1),ref,owner_id:owner,attempt_id:attempt,created_at:NOW};
 return {payload,immutable_evidence_digest:digest(payload)};
}
export function intentFixture(m=manifestFixture()) {
 const p=m.payload;
 return {intent_version:'CC_AG_SINGLE_WRITE_INTENT_V1',repository:p.repository,repository_id:p.repository_id,repository_node_id:p.repository_node_id,ref:p.ref,manifest_digest:m.immutable_evidence_digest,target_commit_sha:'b'.repeat(40),task_binding:p.approval.binding,approval_id:p.approval.approval_id,owner_id:p.owner_id,attempt_id:p.attempt_id,principal:{kind:'GitHubAppInstallation',app_id:101,installation_id:202,permissions:{metadata:'read',issues:'read',contents:'write'}},operation:'CREATE_REF',max_writes:1,automatic_retry:false,not_before:p.approval.not_before,expires_at:p.approval.expires_at,expected_side_effects:['ONE_LAB_REF_CREATE_NO_EXECUTION'],pre_read:'EXACT_REF_AND_MANIFEST',post_read:'EXACT_REF_AND_MANIFEST',cleanup:'RETAIN_NO_AUTOMATIC_DELETE'};
}
export const authorityFixture=m=>({now:NOW,approvals:[{approval_id:m.payload.approval.approval_id,status:'VALID'}],revisions:[{ref:m.payload.ref,digest:m.payload.approval.binding.issue_content_digest}]});
