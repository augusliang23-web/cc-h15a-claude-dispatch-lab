// Offline attestation verification. Trust configuration comes from the caller,
// never from GitHub content. No signing key or live provider is included.
import { createHash, verify as verifySignature } from 'node:crypto';
import { REPOSITORY, validateTask } from './foundation.mjs';
export const fail = code => { throw new Error(code); };
export const record = x => x!==null && typeof x==='object' && !Array.isArray(x) && Object.getPrototypeOf(x)===Object.prototype;
export const exact = (x,keys) => record(x) && Object.keys(x).length===keys.length && keys.every(k=>Object.hasOwn(x,k));
export const identifier = x => typeof x==='string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(x);
export const hex = x => typeof x==='string' && /^[0-9a-f]{64}$/.test(x);
export const timestamp = x => typeof x==='string' && Number.isFinite(Date.parse(x)) && new Date(x).toISOString()===x;

// This restricted format is NOT advertised as a full RFC 8785 implementation.
export function canonical(value) {
  if (value===null || typeof value==='boolean' || typeof value==='string') return JSON.stringify(value);
  if (typeof value==='number' && Number.isSafeInteger(value) && !Object.is(value,-0)) return JSON.stringify(value);
  if (Array.isArray(value)) return '['+Array.from(value,x=>canonical(x)).join(',')+']';
  if (record(value)) return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return fail('INVALID_CANONICAL_INPUT');
}
export const digest = value => createHash('sha256').update(canonical(value),'utf8').digest('hex');
export const BINDING_KEYS=['repository','issue_number','issue_id','task_id','contract_version','task_digest','issue_content_digest','agent','model','execution_mode'];
export function validateBinding(b) {
  if (!exact(b,BINDING_KEYS) || b.repository!==REPOSITORY || !Number.isSafeInteger(b.issue_number) || b.issue_number<1 || !identifier(b.issue_id) || !identifier(b.task_id) || b.contract_version!=='CC_AG_BRIDGE_V1' || !hex(b.task_digest) || !hex(b.issue_content_digest) || b.agent!=='antigravity' || b.model!=='gemini-3.8-flash-low' || b.execution_mode!=='dry-run') fail('INVALID_BINDING');
  return structuredClone(b);
}
export function bindIssue(i) {
  if (!exact(i,['repository','issue_number','issue_id','state','title','body']) || i.repository!==REPOSITORY || i.state!=='open' || !identifier(i.issue_id) || typeof i.title!=='string' || Buffer.byteLength(i.title)>1024 || typeof i.body!=='string' || Buffer.byteLength(i.body)>16384) fail('INVALID_ISSUE');
  let t; try {t=validateTask(JSON.parse(i.body));} catch {fail('INVALID_TASK');}
  if (t.issue_number!==i.issue_number) fail('ISSUE_NUMBER_MISMATCH');
  return validateBinding({repository:i.repository,issue_number:i.issue_number,issue_id:i.issue_id,task_id:t.task_id,contract_version:t.contract_version,task_digest:digest(t),issue_content_digest:digest({title:i.title,body:i.body}),agent:t.agent,model:t.model,execution_mode:t.execution_mode});
}
export const APPROVAL_KEYS=['approval_version','authority','approval_id','not_before','expires_at','binding'];
export function validateApproval(p) {
  if (!exact(p,APPROVAL_KEYS) || p.approval_version!=='CC_AG_APPROVAL_V1' || !identifier(p.authority) || !identifier(p.approval_id) || !timestamp(p.not_before) || !timestamp(p.expires_at) || Date.parse(p.not_before)>=Date.parse(p.expires_at)) fail('INVALID_APPROVAL');
  validateBinding(p.binding); return structuredClone(p);
}
/** ApprovalVerifier.verify(issue, attestation, ISO-now) -> verified payload.
 * Revocation/consumption sets are authoritative OFFLINE fixtures only.
 * A future provider must independently fetch current trusted status, fail closed.
 */
export class Ed25519ApprovalVerifier {
  #authorities; #revoked; #consumed;
  constructor({authorities,revoked,consumed}) {
    if (!(authorities instanceof Map) || !(revoked instanceof Set) || !(consumed instanceof Set)) fail('INVALID_TRUST_CONFIG');
    this.#authorities=new Map(authorities); this.#revoked=revoked; this.#consumed=consumed;
  }
  async verify(issue,attestation,now) {
    if (!timestamp(now) || !exact(attestation,['payload','signature'])) fail('MISSING_OR_INVALID_ATTESTATION');
    const p=validateApproval(attestation.payload);
    const key=this.#authorities.get(p.authority);
    if (!key || key.type!=='public' || key.asymmetricKeyType!=='ed25519') fail('UNKNOWN_AUTHORITY');
    if (typeof attestation.signature!=='string' || !/^[A-Za-z0-9+/]{86}==$/.test(attestation.signature)) fail('INVALID_SIGNATURE');
    let verified=false;
    try {verified=verifySignature(null,Buffer.from(canonical(p)),key,Buffer.from(attestation.signature,'base64'));} catch {fail('INVALID_SIGNATURE');}
    if (!verified) fail('INVALID_SIGNATURE');
    if (Date.parse(now)<Date.parse(p.not_before) || Date.parse(now)>=Date.parse(p.expires_at)) fail('APPROVAL_NOT_CURRENT');
    if (this.#revoked.has(p.approval_id)) fail('APPROVAL_REVOKED');
    if (this.#consumed.has(p.approval_id)) fail('APPROVAL_REPLAYED');
    if (canonical(bindIssue(issue))!==canonical(p.binding)) fail('APPROVAL_BINDING_MISMATCH');
    return p;
  }
}
export function admitLive() { fail('LIVE_ADMISSION_DISABLED'); }
