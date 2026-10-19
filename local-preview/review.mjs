// No live approval or writer. Source is trusted local configuration, never UI input.
import {randomBytes} from 'node:crypto';
import {REPOSITORY} from '../bridge/foundation.mjs';
import {bindIssue,canonical,exact,timestamp,validateBinding,fail} from '../bridge/security.mjs';
import {DECISIONS,identity} from './ledger.mjs';
const freshID=()=>randomBytes(24).toString('hex');
export function fixtureSource(){
 const task={contract_version:'CC_AG_BRIDGE_V1',repository:REPOSITORY,agent:'antigravity',model:'gemini-3.8-flash-low',task_type:'synthetic',execution_mode:'dry-run',approval:'approved',status:'QUEUED',task_id:'LOCAL-PREVIEW-DEMO',issue_number:101};
 const binding=bindIssue({repository:REPOSITORY,issue_number:101,issue_id:'I_LOCAL_SYNTHETIC_101',state:'open',title:'Synthetic local preview',body:JSON.stringify(task)});
 return {kind:'SYNTHETIC_FIXTURE',read:async()=>({status:'READ_ONLY_OBSERVED',task_binding:structuredClone(binding),execution_allowed:false})};
}
// Explicit developer seam using the existing GET-only adapter, not UI-supplied URLs.
export function githubSource(reader,number,issueId){
 if(!Number.isSafeInteger(number) || number<1 || typeof issueId!=='string')fail('SOURCE_INVALID');
 return {kind:'GITHUB_READ_ONLY',read:pins=>reader.readIssue(number,{expectedIssueId:issueId,...(pins?{expectedRevisionDigest:pins.issue_content_digest}:{})})};
}
export class ReviewSession {
 #ledger;#source;#clock;#preview=null;#fresh=false;#reviewID=null;#reason='RESTART_REQUIRES_REFRESH';#busy=false;#lastTime='';#clockHold=false;
 constructor({ledger,source,clock=()=>new Date().toISOString()}){this.#ledger=ledger;this.#source=source;this.#clock=clock;}
 #now(){const now=this.#clock();if(!timestamp(now) || now<this.#lastTime){this.#clockHold=true;fail('CLOCK_UNTRUSTED');}this.#lastTime=now;return now;}
 async #read(pins){
  if(!['SYNTHETIC_FIXTURE','GITHUB_READ_ONLY'].includes(this.#source.kind))fail('SOURCE_UNVERIFIED');
  const r=await this.#source.read(pins);
  if(r.status!=='READ_ONLY_OBSERVED' || r.execution_allowed!==false)fail('SOURCE_UNAVAILABLE');
  const binding=validateBinding(r.task_binding);
  if(pins && canonical(pins)!==canonical(binding))fail('REVISION_CHANGED');return binding;
 }
 async #exclusive(fn){if(this.#busy)fail('REQUEST_CONFLICT');this.#busy=true;try{return await fn();}finally{this.#busy=false;}}
 beginPage(){if(this.#busy)fail('REQUEST_CONFLICT');this.#fresh=false;this.#reviewID=null;this.#reason='PAGE_RELOAD_REQUIRES_REFRESH';}
 async refresh(){return this.#exclusive(async()=>{
  this.#fresh=false;this.#reviewID=null;
  try{const binding=await this.#read(),at=this.#now();await this.#ledger.snapshot();
   this.#preview={binding,source:this.#source.kind,observed_at:at};this.#fresh=!this.#clockHold;this.#reviewID=freshID();this.#reason='REVIEW_READY';
  }catch{this.#reason='SOURCE_OR_LEDGER_UNAVAILABLE_HOLD';}
  return this.view();
 });}
 async view(){
  let history=[];try{history=await this.#ledger.snapshot();
   if(!this.#preview && history.length){const e=history.at(-1);this.#preview={binding:e.binding,source:e.source,observed_at:e.observed_at};}
   const now=this.#now();
   if(history.length && now<history.at(-1).at)this.#clockHold=true;
   if(this.#preview && Date.parse(now)-Date.parse(this.#preview.observed_at)>120000){this.#fresh=false;this.#reason='PREVIEW_STALE_REFRESH_REQUIRED';}
  }catch{this.#fresh=false;this.#reason='LEDGER_OR_CLOCK_HOLD';}
  if(this.#clockHold){this.#fresh=false;this.#reason='CLOCK_UNTRUSTED';}
  const previous=this.#preview?history.find(e=>identity(e.binding,e.source)===identity(this.#preview.binding,this.#preview.source)):null;
  return {status:this.#fresh && previous?previous.decision:this.#reason,preview:this.#preview,can_decide:this.#fresh && !previous,review_id:this.#reviewID,sequence:history.length,history,execution_allowed:false};
 }
 async decide(input){return this.#exclusive(async()=>{
  const v=await this.view();
  if(!exact(input,['decision','sequence','review_id']) || !DECISIONS.includes(input.decision) || !v.can_decide || input.review_id!==this.#reviewID || input.sequence!==v.sequence)fail('DECISION_BLOCKED');
  // Consume the display proof before asynchronous recheck; failures need Refresh.
  this.#fresh=false;this.#reviewID=null;
  try{await this.#read(this.#preview.binding);const now=this.#now();
   if(this.#clockHold || Date.parse(now)-Date.parse(this.#preview.observed_at)>120000)fail('PREVIEW_STALE');
   await this.#ledger.append(input.sequence,input.decision,this.#preview.binding,this.#preview.source,this.#preview.observed_at,now);
   this.#reason=input.decision;return this.view();
  }catch{this.#reason='DECISION_RECHECK_FAILED_HOLD';fail('DECISION_RECHECK_FAILED_HOLD');}
 });}
}
