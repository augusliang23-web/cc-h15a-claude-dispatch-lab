// OFFLINE model only. No network, persistent service or live reservation adapter.
// Retained receipts are a simulated assumption, NOT a property of GitHub refs.
import { canonical,exact,identifier,hex,timestamp,fail } from './security.mjs';
import { validateManifest } from './reservation-readiness.mjs';
const hold=reason=>({status:'HOLD',reason,execution_allowed:false,automatic_retry:false});
const FAULTS=['none','failed-write','5xx','partial-write','timeout-after-success','5xx-after-success','revoke-after-success','edit-after-success'];
export class SimulatedReservationAuthority {
  #approvals=new Map();#revisions=new Map();#receipts=new Map();#used=new Set();#now;#calls=0;
  constructor(snapshot) {
    if((!exact(snapshot,['now','approvals','revisions']) && !exact(snapshot,['now','approvals','revisions','receipts'])) || !timestamp(snapshot.now) || !Array.isArray(snapshot.approvals) || !Array.isArray(snapshot.revisions) || (snapshot.receipts!==undefined && !Array.isArray(snapshot.receipts)))fail('INVALID_SIMULATOR_SNAPSHOT');
    this.#now=snapshot.now;
    for(const a of snapshot.approvals){if(!exact(a,['approval_id','status']) || !identifier(a.approval_id) || !['VALID','REVOKED','UNKNOWN'].includes(a.status) || this.#approvals.has(a.approval_id))fail('INVALID_SIMULATOR_SNAPSHOT');this.#approvals.set(a.approval_id,a.status);}
    for(const r of snapshot.revisions){if(!exact(r,['ref','digest']) || !this.#validRef(r.ref) || !hex(r.digest) || this.#revisions.has(r.ref))fail('INVALID_SIMULATOR_SNAPSHOT');this.#revisions.set(r.ref,r.digest);}
    for(const r of snapshot.receipts??[]){
      if(!exact(r,['manifest','phase','ref_digest']) || !['RESERVED','PARTIAL','FAILED'].includes(r.phase) || (r.ref_digest!==null && !hex(r.ref_digest)) || (r.phase!=='RESERVED' && r.ref_digest!==null))fail('INVALID_SIMULATOR_SNAPSHOT');
      const m=validateManifest(r.manifest),p=m.payload;
      if(this.#receipts.has(p.ref) || this.#used.has(p.approval.approval_id))fail('INVALID_SIMULATOR_SNAPSHOT');
      this.#receipts.set(p.ref,{manifest:m,phase:r.phase,ref_digest:r.ref_digest});this.#used.add(p.approval.approval_id);
    }
  }
  #validRef(ref){return typeof ref==='string' && /^refs\/heads\/cc-ag-claims\/v1\/[a-f0-9]{64}$/.test(ref);}
  get callCount(){return this.#calls;}
  snapshot(){return {now:this.#now,approvals:[...this.#approvals].map(([approval_id,status])=>({approval_id,status})),revisions:[...this.#revisions].map(([ref,digest])=>({ref,digest})),receipts:[...this.#receipts.values()].map(r=>structuredClone(r))};}
  approvalForSimulation(id,status){if(!this.#approvals.has(id) || !['VALID','REVOKED','UNKNOWN'].includes(status))fail('INVALID_SIMULATION_INPUT');this.#approvals.set(id,status);}
  revisionForSimulation(ref,value){if(!this.#revisions.has(ref) || !hex(value))fail('INVALID_SIMULATION_INPUT');this.#revisions.set(ref,value);}
  #current(p){return this.#approvals.get(p.approval.approval_id)==='VALID' && this.#revisions.get(p.ref)===p.approval.binding.issue_content_digest && Date.parse(this.#now)>=Date.parse(p.approval.not_before) && Date.parse(this.#now)<Date.parse(p.approval.expires_at) && Date.parse(p.created_at)<=Date.parse(this.#now);}
  create(input,{fault='none'}={}) {
    const m=validateManifest(input),p=m.payload;
    if(!FAULTS.includes(fault))fail('INVALID_SIMULATION_FAULT');this.#calls++;
    // Linearization point is this simulated server, not the clients' reads.
    if(this.#receipts.has(p.ref))return hold('CREATE_CONFLICT');
    if(this.#used.has(p.approval.approval_id))return hold('APPROVAL_REPLAYED');
    if(!this.#current(p))return hold('APPROVAL_OR_REVISION_NOT_CURRENT');
    // Model retains an intent/consumption receipt even on a failed/partial write.
    // Real GitHub does not provide this atomic tombstone and must not be inferred.
    const phase=['failed-write','5xx'].includes(fault)?'FAILED':fault==='partial-write'?'PARTIAL':'RESERVED';
    this.#receipts.set(p.ref,{manifest:m,phase,ref_digest:phase==='RESERVED'?m.immutable_evidence_digest:null});
    this.#used.add(p.approval.approval_id);
    if(['failed-write','5xx','partial-write','timeout-after-success','5xx-after-success'].includes(fault))return hold('SIMULATED_WRITE_OUTCOME_UNCERTAIN');
    if(fault==='revoke-after-success')this.approvalForSimulation(p.approval.approval_id,'REVOKED');
    if(fault==='edit-after-success')this.revisionForSimulation(p.ref,'0'.repeat(64));
    return {status:'SIMULATED_RESERVED',manifest_digest:m.immutable_evidence_digest,execution_allowed:false,automatic_retry:false};
  }
  observe(ref) {
    if(!this.#validRef(ref))fail('INVALID_SIMULATION_INPUT');
    const r=this.#receipts.get(ref);if(!r)return {kind:'MISSING_OR_INACCESSIBLE'};
    if(r.phase!=='RESERVED')return {kind:'UNCERTAIN'};
    if(r.ref_digest!==r.manifest.immutable_evidence_digest)return {kind:'INCONSISTENT'};
    if(!this.#current(r.manifest.payload))return {kind:'REVOKED_OR_EDITED'};
    return {kind:'RESERVED',manifest:structuredClone(r.manifest)};
  }
  tamperForSimulation(ref,operation) {
    const r=this.#receipts.get(ref);if(!r || !['overwrite','delete'].includes(operation))fail('INVALID_SIMULATION_INPUT');
    r.ref_digest=operation==='delete'?null:'f'.repeat(64);
  }
}
/** At most one local request. This class has no durable restart guarantee;
 * a restarted client must use the existing journal/recovery gate. Never retry
 * simply because this new object has no memory. Test fixtures only.
 */
export class OfflineReservationClient {
  #attempted=false;
  async attempt(authority,manifest,{fault='none'}={}) {
    if(this.#attempted)return hold('ATTEMPT_ALREADY_USED');this.#attempted=true;
    if(!(authority instanceof SimulatedReservationAuthority))return hold('SIMULATED_AUTHORITY_REQUIRED');
    if(fault==='network-before')return hold('SIMULATED_NETWORK_UNCERTAIN');
    try {
      const m=validateManifest(manifest);
      const result=authority.create(m,{fault});
      if(result.status!=='SIMULATED_RESERVED')return result;
      const observed=authority.observe(m.payload.ref);
      if(!exact(observed,['kind','manifest']) || observed.kind!=='RESERVED' || canonical(observed.manifest)!==canonical(m))return hold('POST_CREATE_EVIDENCE_UNCERTAIN');
      return result;
    }catch{return hold('SIMULATED_REQUEST_INVALID_OR_UNCERTAIN');}
  }
}
