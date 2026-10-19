// Local display-click audit only. No authority, credentials or execution Journal.
import * as fs from 'node:fs/promises';
import {constants} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {canonical,digest,exact,hex,timestamp,validateBinding,fail} from '../bridge/security.mjs';
export const DECISIONS=['LOCAL_PREVIEW_APPROVED','LOCAL_PREVIEW_REJECTED'];
export const identity=(binding,source)=>digest({binding,source});
const ZERO='0'.repeat(64);
function validate(record){
 if(!exact(record,['version','events']) || record.version!=='CC_LOCAL_PREVIEW_V1' || !Array.isArray(record.events) || record.events.length>500)fail('LEDGER_INVALID');
 let previous=ZERO,at='';const seen=new Set();
 record.events.forEach((e,n)=>{
  if(!exact(e,['sequence','decision','binding','source','observed_at','at','previous']) || e.sequence!==n+1 || !DECISIONS.includes(e.decision) || !['SYNTHETIC_FIXTURE','GITHUB_READ_ONLY'].includes(e.source) || !timestamp(e.at) || !timestamp(e.observed_at) || e.observed_at>e.at || Date.parse(e.at)-Date.parse(e.observed_at)>120000 || e.at<at || e.previous!==previous)fail('LEDGER_INVALID');
  validateBinding(e.binding);const key=identity(e.binding,e.source);if(seen.has(key))fail('LEDGER_INVALID');seen.add(key);previous=digest(e);at=e.at;
 });return record;
}
export class PreviewLedger {
 #dir;#lease;#record;#uncertain=false;#closed=false;#tail=Promise.resolve();
 static async open(directory){
  const l=new PreviewLedger();l.#dir=directory;let created=false;
  try {await fs.mkdir(directory,{mode:0o700});created=true;}catch(e){if(e.code!=='EEXIST')fail('LEDGER_DIRECTORY_UNSAFE');}
  const s=await fs.lstat(directory);
  if(!s.isDirectory() || s.isSymbolicLink() || (s.mode&0o777)!==0o700 || (process.getuid && s.uid!==process.getuid()))fail('LEDGER_DIRECTORY_UNSAFE');
  try{l.#lease=await fs.open(join(directory,'session.lock'),'wx',0o600);}catch{fail('LEDGER_LOCKED');}
  try {
   await l.#lease.sync();await l.#syncDir();
   if(created){l.#record={version:'CC_LOCAL_PREVIEW_V1',events:[]};await l.#persist(l.#record);}
   else {l.#record=await l.#read();}
   return l;
  }catch {l.#uncertain=true;await l.close();fail('LEDGER_INVALID_OR_INTERRUPTED');}
 }
 async #file(name){
  let h;try{h=await fs.open(join(this.#dir,name),constants.O_RDONLY|constants.O_NOFOLLOW);const s=await h.stat();
   if(!s.isFile() || s.nlink!==1 || s.size>1024*1024 || (s.mode&0o777)!==0o600 || (process.getuid && s.uid!==process.getuid()))fail('LEDGER_INVALID');
   return JSON.parse(await h.readFile('utf8'));
  }finally{if(h)await h.close();}
 }
 async #read(){const data=await this.#file('ledger.json'),anchor=await this.#file('checkpoint.json');
  if(!exact(data,['record','checksum']) || !hex(data.checksum) || digest(data.record)!==data.checksum || !exact(anchor,['sequence','checksum']) || anchor.sequence!==data.record.events?.length || anchor.checksum!==data.checksum)fail('LEDGER_INVALID');
  return validate(data.record);
 }
 async #syncDir(){const h=await fs.open(this.#dir,'r');try{await h.sync();}finally{await h.close();}}
 async #atomic(name,value){const path=join(this.#dir,`.${randomUUID()}.tmp`);const h=await fs.open(path,'wx',0o600);
  try{await h.writeFile(canonical(value));await h.sync();}finally{await h.close();}
  await fs.rename(path,join(this.#dir,name));await this.#syncDir();
 }
 async #persist(record){
  try {const checksum=digest(record);await this.#atomic('ledger.json',{record,checksum});await this.#atomic('checkpoint.json',{sequence:record.events.length,checksum});}
  catch{this.#uncertain=true;fail('LEDGER_WRITE_UNCERTAIN');}
 }
 #serial(fn){const result=this.#tail.then(fn);this.#tail=result.catch(()=>{});return result;}
 snapshot(){return this.#serial(()=>this.#snapshot());}
 async #snapshot(){
  if(this.#uncertain || this.#closed)fail('LEDGER_HOLD');
  // Re-read both files; external edits or partial rollback invalidate this session.
  try{const r=await this.#read();if(canonical(r)!==canonical(this.#record))fail('LEDGER_CHANGED');return structuredClone(r.events);}
  catch{this.#uncertain=true;fail('LEDGER_HOLD');}
 }
 append(expectedSequence,decision,binding,source,observed_at,at){return this.#serial(async()=>{
  const events=await this.#snapshot();
  if(expectedSequence!==events.length)fail('STALE_SEQUENCE');
  const record={version:'CC_LOCAL_PREVIEW_V1',events:[...events,{sequence:events.length+1,decision,binding:validateBinding(binding),source,observed_at,at,previous:events.length?digest(events.at(-1)):ZERO}]};
  validate(record);await this.#persist(record);this.#record=record;return this.#snapshot();
 });}
 async close(){await this.#tail;if(this.#closed)return;this.#closed=true;if(this.#lease){await this.#lease.close();if(!this.#uncertain){await fs.unlink(join(this.#dir,'session.lock'));await this.#syncDir();}}}
}
