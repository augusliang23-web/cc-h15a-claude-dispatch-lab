// ZC-09B2: Linux /tmp synthetic fixture only. Never a production claim authority.
// No provider, model, network, GitHub, macOS or background execution.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash,randomBytes} from 'node:crypto';

const PROTOCOL='ZC09B2_SYNTHETIC_FIXTURE_V1';
const REPO='augusliang23-web/cc-h15a-claude-dispatch-lab';
const FILE='ledger.json',LOCK='.cas-lock';
const flags=Object.freeze({mode:'SYNTHETIC_LINUX_TEMP_ONLY',actual_dispatch:false,
 provider_calls:0,github_writes:0,mac_writes:0,durable_live_claim:false,
 ready_to_merge:false,owner_approval_required:true});
const result=(gate,reason,ledger=null)=>({...flags,gate,reason,ledger});
const hold=reason=>result('HOLD',reason);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const shape=(v,keys)=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&
 Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const sha=x=>typeof x==='string'&&/^[a-f0-9]{40}$/.test(x);
const eventId=x=>typeof x==='string'&&/^[a-z][a-z0-9-]{3,49}$/.test(x);
const time=x=>{
 if(typeof x!=='string'||! /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(x))return NaN;
 const t=Date.parse(x);
 return Number.isFinite(t)&&new Date(t).toISOString().slice(0,19)===x.slice(0,19)?t:NaN;
};
const taskOk=t=>shape(t,['taskId','repo','pr','sha'])&&eventId(t.taskId)&&
 t.repo===REPO&&Number.isInteger(t.pr)&&t.pr===42&&sha(t.sha);
const leaseOk=l=>l===null||(shape(l,['leaseId','claimEventId','expiresAt','sha'])&&
 typeof l.leaseId==='string'&&/^[a-f0-9]{64}$/.test(l.leaseId)&&
 eventId(l.claimEventId)&&Number.isFinite(time(l.expiresAt))&&sha(l.sha));
const ledgerOk=l=>shape(l,['protocol','task','revision','seenEvents','lastObservedAt',
 'terminalGate','usedClaims','maxClaims','activeLease'])&&l.protocol===PROTOCOL&&
 taskOk(l.task)&&Number.isSafeInteger(l.revision)&&l.revision>=0&&l.revision<=16&&
 Array.isArray(l.seenEvents)&&l.seenEvents.length===l.revision&&
 l.seenEvents.every(eventId)&&new Set(l.seenEvents).size===l.seenEvents.length&&
 (l.lastObservedAt===null?l.revision===0:Number.isFinite(time(l.lastObservedAt))&&l.revision>0)&&
 ['NONE','SAFETY_HOLD','READY_FOR_OWNER'].includes(l.terminalGate)&&
 Number.isInteger(l.maxClaims)&&l.maxClaims>=1&&l.maxClaims<=3&&
 Number.isInteger(l.usedClaims)&&l.usedClaims>=0&&l.usedClaims<=l.maxClaims&&
 l.usedClaims<=l.revision&&leaseOk(l.activeLease)&&
 (l.activeLease===null||(l.usedClaims>0&&l.seenEvents.includes(l.activeLease.claimEventId)&&
 l.activeLease.sha===l.task.sha&&l.terminalGate==='NONE'))&&
 (l.terminalGate==='NONE'||l.activeLease===null);

// Only direct child of this runner's temporary directory is accepted.
const guardRoot=root=>{
 if(process.platform!=='linux'||typeof process.getuid!=='function')
  throw Error('LINUX_FIXTURE_ONLY');
 if(typeof root!=='string'||root.length>512||!path.isAbsolute(root))
  throw Error('INVALID_FIXTURE_PATH');
 const base=fs.realpathSync(os.tmpdir()),dir=path.resolve(root);
 if(path.dirname(dir)!==base||!/^zc09b2-fixture-[A-Za-z0-9_-]{5,80}$/.test(path.basename(dir)))
  throw Error('OUTSIDE_FIXTURE_ROOT');
 if(fs.realpathSync(dir)!==dir)throw Error('SYMLINKED_FIXTURE_ROOT');
 const st=fs.lstatSync(dir);
 if(!st.isDirectory()||st.isSymbolicLink()||st.uid!==process.getuid()||
    (st.mode&0o777)!==0o700)throw Error('UNTRUSTED_FIXTURE_ROOT');
 return dir;
};
const dirSync=dir=>{const fd=fs.openSync(dir,'r');
 try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
};
const safeFile=file=>{
 const st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid()||
    (st.mode&0o777)!==0o600||st.size<=0||st.size>16384)
  throw Error('UNTRUSTED_LEDGER_FILE');
};
const writeExclusive=(file,bytes)=>{
 const fd=fs.openSync(file,fs.constants.O_WRONLY|fs.constants.O_CREAT|
  fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
 try{
  fs.fchmodSync(fd,0o600);
  let offset=0;
  while(offset<bytes.length){
   const written=fs.writeSync(fd,bytes,offset,bytes.length-offset,offset);
   if(written<=0)throw Error('SHORT_WRITE');
   offset+=written;
  }
  fs.fsyncSync(fd);
 }finally{fs.closeSync(fd);}
};
const pack=ledger=>{
 const payload=JSON.stringify(ledger);
 return Buffer.from(JSON.stringify({protocol:PROTOCOL,ledger,digest:hash(payload)})+'\n');
};
const unpack=raw=>{
 if(raw.length>16384)throw Error('OVERSIZED_RECORD');
 const data=JSON.parse(raw.toString('utf8'));
 if(!shape(data,['protocol','ledger','digest'])||data.protocol!==PROTOCOL||
    typeof data.digest!=='string'||! /^[a-f0-9]{64}$/.test(data.digest)||
    data.digest!==hash(JSON.stringify(data.ledger))||!ledgerOk(data.ledger))
   throw Error('INVALID_LEDGER_RECORD');
 return data.ledger;
};
const rawRead=(dir,locked=false)=>{
 const entries=fs.readdirSync(dir).sort();
 const expected=locked?[LOCK,FILE].sort():[FILE];
 if(JSON.stringify(entries)!==JSON.stringify(expected))throw Error('UNEXPECTED_FIXTURE_ENTRIES');
 safeFile(path.join(dir,FILE));
 return unpack(fs.readFileSync(path.join(dir,FILE)));
};
const sameTask=(a,b)=>a.taskId===b.taskId&&a.repo===b.repo&&a.pr===b.pr&&a.sha===b.sha;
// JSON object insertion order has no semantic meaning for a validated lease.
const sameLease=(a,b)=>a===b||(a!==null&&b!==null&&
 ['leaseId','claimEventId','expiresAt','sha'].every(k=>a[k]===b[k]));
const validAdvance=(a,b,clock)=>{
 if(!ledgerOk(b)||!sameTask(a.task,b.task)||a.protocol!==b.protocol||
    a.maxClaims!==b.maxClaims||b.revision!==a.revision+1||
    b.seenEvents.length!==a.seenEvents.length+1||
    a.seenEvents.some((x,i)=>b.seenEvents[i]!==x)||
    !eventId(b.seenEvents.at(-1))||a.seenEvents.includes(b.seenEvents.at(-1))||
    time(b.lastObservedAt)<=time(a.lastObservedAt)||time(b.lastObservedAt)>clock||
    (a.terminalGate!=='NONE'&&b.terminalGate!==a.terminalGate)||
    (a.terminalGate!=='NONE')||b.usedClaims<a.usedClaims||
    b.usedClaims>a.usedClaims+1)return false;
 if(a.activeLease!==null){
  if(b.activeLease!==null&&!sameLease(a.activeLease,b.activeLease))return false;
  if(b.usedClaims!==a.usedClaims)return false;
 }else if(b.activeLease!==null){
  if(b.usedClaims!==a.usedClaims+1||
     b.activeLease.claimEventId!==b.seenEvents.at(-1)||
     time(b.activeLease.expiresAt)<=clock)return false;
 }else if(b.usedClaims!==a.usedClaims)return false;
 if(b.terminalGate==='READY_FOR_OWNER'&&
    !(a.activeLease!==null&&b.activeLease===null))return false;
 return true;
};
const classification=e=>{
 if(e?.code==='EEXIST')return 'LOCK_OR_FILE_EXISTS';
 return 'UNTRUSTED_OR_IO_FAILURE';
};

// Caller must itself make a fresh private temporary fixture root with mkdtemp.
// This INIT cannot overwrite an existing record, and never starts a worker.
export function initializeFixture({root,ledger}={}){
 try{
  const dir=guardRoot(root);
  if(!ledgerOk(ledger)||ledger.revision!==0||ledger.usedClaims!==0||
     ledger.terminalGate!=='NONE'||ledger.activeLease!==null)return hold('INVALID_INITIAL_LEDGER');
  if(fs.readdirSync(dir).length!==0)return hold('FIXTURE_NOT_EMPTY');
  writeExclusive(path.join(dir,FILE),pack(ledger));
  dirSync(dir);
  return result('FIXTURE_INITIALIZED','OFFLINE_ONLY',structuredClone(ledger));
 }catch(e){return hold(classification(e));}
}
export function inspectFixture({root}={}){
 try{
  const dir=guardRoot(root);
  return result('FIXTURE_READ_ONLY','NOT_AN_AGENT_STATUS',structuredClone(rawRead(dir)));
 }catch(e){return hold(e?.message==='UNEXPECTED_FIXTURE_ENTRIES'?'UNKNOWN_STAGING_OR_LOCK':
  'UNTRUSTED_OR_IO_FAILURE');}
}

// Honest-process file-level CAS, strictly scoped to disposable Linux temp fixture.
// A same-UID malicious process can alter names in the directory: NOT a security
// boundary and NEVER acceptable as production durable claim storage.
export function compareAndSwapFixture({root,expectedRevision,proposedLedger,now,phaseHook}={}){
 let dir,lock,locked=false,stage;
 try{
  dir=guardRoot(root);
  if(!Number.isSafeInteger(expectedRevision)||expectedRevision<0||
     !Number.isFinite(time(now))||!ledgerOk(proposedLedger)||
     (phaseHook!==undefined&&typeof phaseHook!=='function'))return hold('INVALID_PROPOSAL');
  lock=path.join(dir,LOCK);
  const fd=fs.openSync(lock,fs.constants.O_WRONLY|fs.constants.O_CREAT|
    fs.constants.O_EXCL|fs.constants.O_NOFOLLOW,0o600);
  locked=true;
  try{fs.fchmodSync(fd,0o600);fs.fsyncSync(fd);}
  finally{fs.closeSync(fd);}
  dirSync(dir);
  const current=rawRead(dir,true);
  if(current.revision!==expectedRevision||!validAdvance(current,proposedLedger,time(now))){
   // Known rejection before staging can safely release our own fixture lock.
   // No ledger bytes have changed; a separate caller can retry from readback.
   fs.unlinkSync(lock);
   dirSync(dir);
   locked=false;
   return hold(current.revision!==expectedRevision?'REVISION_CONFLICT':'INVALID_TRANSITION');
  }
  const fresh=pack(proposedLedger);
  stage=path.join(dir,'stage-'+randomBytes(12).toString('hex')+'.tmp');
  writeExclusive(stage,fresh);
  dirSync(dir);
  phaseHook?.('AFTER_DURABLE_STAGE');
  fs.renameSync(stage,path.join(dir,FILE));
  dirSync(dir);
  // Normal cooperative completion only. A crash leaves LOCK and must be
  // reconciled manually; never delete unknown stages on next invocation.
  fs.unlinkSync(lock);
  dirSync(dir);
  return result('FIXTURE_CAS_COMMITTED','OFFLINE_ONLY',structuredClone(proposedLedger));
 }catch(e){
  // Preserve lock and any temporary stage following all errors after acquire.
  // On clean revision conflict this is conservative but intentionally blocks
  // automatic recovery/looping until reviewed.
  if(locked)return hold('TRANSACTION_UNCERTAIN_LOCK_RETAINED');
  if(e?.code==='EEXIST')return hold('LOCK_BUSY_OR_EXISTING_RECORD');
  return hold('UNTRUSTED_OR_IO_FAILURE');
 }
}
export const FIXTURE_LEDGER=Object.freeze({
 protocol:PROTOCOL,
 task:{taskId:'zc09b2-fixture',repo:REPO,pr:42,sha:'a'.repeat(40)},
 revision:0,seenEvents:[],lastObservedAt:null,terminalGate:'NONE',
 usedClaims:0,maxClaims:2,activeLease:null
});
