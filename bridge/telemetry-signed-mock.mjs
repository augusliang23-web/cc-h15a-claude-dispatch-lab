// ZC-04B: OFFLINE ONLY verification model. No transport, credentials, model or IO.
// Public-key identity in tests is a fixture; no live Mac/GitHub attestation.
import {createHash, verify} from 'node:crypto';
export const VERSION='ZC04B_SIGNED_TELEMETRY_MOCK_V1';
export const REPOSITORY='augusliang23-web/cc-h15a-claude-dispatch-lab';
const KEY=['version','repository','task_id','attempt_id','producer','session_id',
  'sequence','observed_at','type','evidence_ref','prev_digest'];
const FULL=[...KEY,'digest','signature'];
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const HEX=/^[0-9a-f]{64}$/;
const ISO=/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
const TYPE={
  'mac-relay':new Set(['CLAIMED','RUNNING','HEARTBEAT','ARTIFACT_READY','HOLD','FAILED']),
  'codex-cloud':new Set(['REVIEWING','QA_PASSED','HOLD','FAILED']),
};
const names=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
const exact=(x,fields)=>names(x)&&Object.keys(x).length===fields.length&&
  fields.every(k=>Object.hasOwn(x,k));
const iso=x=>typeof x==='string'&&ISO.test(x)&&Number.isFinite(Date.parse(x))&&
  new Date(x).toISOString()===x;
const fail=()=>{throw Error('INVALID_SIGNED_EVENT');};
// Use one immutable primitive-only snapshot throughout validation and commit.
// Never call user-defined getters multiple times across signature verification.
function snapshotInput(input) {
  if (!exact(input, FULL)) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const clean = {};
  for (const key of FULL) {
    const item = descriptors[key];
    if (!item || !Object.hasOwn(item, 'value') || !item.enumerable) fail();
    const value = item.value;
    if (!(value === null || typeof value === 'string' || typeof value === 'number')) fail();
    clean[key] = value;
  }
  return Object.freeze(clean);
}
const payload=x=>JSON.stringify(Object.fromEntries(KEY.map(k=>[k,x[k]])));
const digest=s=>createHash('sha256').update(s,'utf8').digest('hex');
const error=(reason='UNVERIFIED_OR_REPLAY')=>({status:'HOLD',reason,simulated:true,accepted:false});
export function mockDigest(event){return digest(payload(event));}
// Non-authoritative test helper. Signature is defined over canonical fixed-order
// JSON of known fields + digest. Future transport must pin the exact bytes.
export function mockSignable(event) {
  return JSON.stringify(Object.fromEntries([...KEY,'digest'].map(k=>[k,event[k]])));
}
export class OfflineSignedTelemetryStore {
  #publicKeys;#task;#attempt;#seq=0;#digest=null;#at=null;
  #sessions=new Map();#seen=new Set();#count=0;
  constructor({publicKeys,task_id,attempt_id}) {
    if (!(publicKeys instanceof Map) || (typeof task_id!=='string'||!ID.test(task_id)) ||
        (typeof attempt_id!=='string'||!ID.test(attempt_id)) || publicKeys.size!==2) fail();
    for(const name of Object.keys(TYPE)){
      const key=publicKeys.get(name);
      if(!key||key.type!=='public'||key.asymmetricKeyType!=='ed25519')fail();
    }
    this.#publicKeys=new Map(publicKeys);this.#task=task_id;this.#attempt=attempt_id;
  }
  accept(rawEvent,{asOf}={}) {
    try{
      const event=snapshotInput(rawEvent);
      if(!iso(asOf)||
         Buffer.byteLength(JSON.stringify(event))>2048||
         event.version!==VERSION||event.repository!==REPOSITORY||
         event.task_id!==this.#task||event.attempt_id!==this.#attempt||
         !Object.hasOwn(TYPE,event.producer)||
         !TYPE[event.producer].has(event.type)||
         typeof event.session_id!=='string'||!ID.test(event.session_id)||
         !Number.isSafeInteger(event.sequence)||event.sequence!==this.#seq+1||
         !iso(event.observed_at)||Date.parse(event.observed_at)>Date.parse(asOf)||
         (this.#at!==null && Date.parse(event.observed_at)<this.#at)||
         (this.#seq===0?event.prev_digest!==null:event.prev_digest!==this.#digest)||
         typeof event.evidence_ref!=='string'||event.evidence_ref.length<5||
         event.evidence_ref.length>130||
         !/^[A-Za-z0-9._:/-]+$/.test(event.evidence_ref)||
         !HEX.test(event.digest)||event.digest!==mockDigest(event)||
         typeof event.signature!=='string'|| !/^[A-Za-z0-9+/]{86}==$/.test(event.signature)) fail();
      const oldSession=this.#sessions.get(event.producer);
      if(oldSession && oldSession!==event.session_id)fail();
      if(this.#seen.has(event.digest))fail();
      const sig=Buffer.from(event.signature,'base64');
      if(sig.byteLength!==64||
         !verify(null,Buffer.from(mockSignable(event),'utf8'),this.#publicKeys.get(event.producer),sig))
         fail();
      // No asynchronous gap between sequence/digest check and commit.
      this.#seq=event.sequence;this.#digest=event.digest;
      this.#at=Date.parse(event.observed_at);this.#count++;
      this.#seen.add(event.digest);this.#sessions.set(event.producer,event.session_id);
      return {status:'MOCK_ACCEPTED',accepted:true,simulated:true,
        sequence:this.#seq,digest:this.#digest};
    }catch{return error();}
  }
  snapshot(){
    return {status:'MOCK_EVIDENCE_ONLY',simulated:true,repository:REPOSITORY,
      task_id:this.#task,attempt_id:this.#attempt,accepted_count:this.#count,
      last_sequence:this.#seq,last_digest:this.#digest,
      real_github_writes:false,real_agent_activity_verified:false};
  }
}
