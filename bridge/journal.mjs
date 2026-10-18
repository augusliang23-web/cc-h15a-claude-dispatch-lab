import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonical,digest,exact,timestamp,hex,fail } from './security.mjs';
import { validateClaim } from './claims.mjs';
import { transition } from './foundation.mjs';

const RECOVERY={QUEUED:['READY','CLAIM_PENDING','RECONCILE_REQUIRED'],CLAIMED:['CLAIM_CONFIRMED','RECONCILE_REQUIRED'],RUNNING:['EXECUTING','UNCERTAIN'],COMPLETED:['COMPLETED'],FAILED:['BLOCKED'],INTERRUPTED:['UNCERTAIN'],BLOCKED:['BLOCKED']};
export function validateJournal(r) {
  if (!exact(r,['journal_version','sequence','claim','state','history','recovery_status','updated_at']) || r.journal_version!=='CC_AG_JOURNAL_V1' || !Number.isSafeInteger(r.sequence) || r.sequence<0 || !timestamp(r.updated_at) || !Object.hasOwn(RECOVERY,r.state) || !RECOVERY[r.state].includes(r.recovery_status) || !Array.isArray(r.history) || r.history.length<1 || r.history.length>r.sequence+1 || r.history.length>10) fail('INVALID_JOURNAL_RECORD');
  validateClaim(r.claim);
  let previous=null;
  for(const e of r.history) {
    if(!exact(e,['state','at']) || !timestamp(e.at) || Date.parse(e.at)>Date.parse(r.updated_at)) fail('INVALID_JOURNAL_RECORD');
    if(previous) {transition(previous.state,e.state);if(Date.parse(e.at)<Date.parse(previous.at))fail('INVALID_JOURNAL_RECORD');}
    else if(e.state!=='QUEUED') fail('INVALID_JOURNAL_RECORD');
    previous=e;
  }
  if(previous.state!==r.state) fail('INVALID_JOURNAL_RECORD');
  return structuredClone(r);
}

/** One explicitly initialized attempt per private local directory.
 * initialize(claim, now), load(), update(expectedSequence, patch, now).
 * io is the Node filesystem interface, injectable for failure testing.
 * Errors are fixed codes: never include paths, raw filesystem errors or data.
 */
export class Journal {
  #dir; #io;
  constructor(directory,{io=fs}={}) {this.#dir=directory;this.#io=io;}
  async #directory() {
    try {
      const s=await this.#io.lstat(this.#dir);
      if(!s.isDirectory() || s.isSymbolicLink() || (s.mode&0o777)!==0o700 || (process.getuid && s.uid!==process.getuid())) fail('UNSAFE_JOURNAL_DIRECTORY');
    } catch {fail('UNSAFE_JOURNAL_DIRECTORY');}
  }
  async #exists(path) {
    try {await this.#io.lstat(path);return true;}catch(e){if(e.code==='ENOENT')return false;fail('JOURNAL_READ_FAILED');}
  }
  async #readUnlocked() {
    let handle;
    try {
      handle=await this.#io.open(join(this.#dir,'attempt.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
      const stat=await handle.stat();
      if(!stat.isFile() || stat.nlink!==1 || stat.size>65536 || (stat.mode&0o777)!==0o600 || (process.getuid && stat.uid!==process.getuid())) fail('INVALID_JOURNAL_RECORD');
      const envelope=JSON.parse(await handle.readFile('utf8'));
      if(!exact(envelope,['record','checksum']) || !hex(envelope.checksum) || digest(envelope.record)!==envelope.checksum) fail('INVALID_JOURNAL_RECORD');
      return validateJournal(envelope.record);
    } catch(e) { if(e.code==='ENOENT')fail('JOURNAL_MISSING');fail('JOURNAL_INVALID'); }
    finally {if(handle)await handle.close().catch(()=>{});}
  }
  async load() {
    await this.#directory();
    if(await this.#exists(join(this.#dir,'writer.lock')))fail('JOURNAL_LOCKED');
    const r=await this.#readUnlocked();
    // A writer beginning during the read makes this snapshot uncertain.
    if(await this.#exists(join(this.#dir,'writer.lock')))fail('JOURNAL_LOCKED');
    return r;
  }
  async #withLock(operation) {
    await this.#directory(); let lock;
    try {lock=await this.#io.open(join(this.#dir,'writer.lock'),'wx',0o600);}
    catch {fail('JOURNAL_LOCKED');}
    let persisting=false;
    const persist=async r=>{
      persisting=true;
      const temp=join(this.#dir,`.attempt-${randomUUID()}.tmp`);let handle;
      try {
        // Sync intent marker before any data mutation.
        await lock.sync();await this.#syncDirectory();
        handle=await this.#io.open(temp,'wx',0o600);
        await handle.writeFile(canonical({record:r,checksum:digest(r)}),'utf8');
        await handle.sync();await handle.close();handle=null;
        await this.#io.rename(temp,join(this.#dir,'attempt.json'));
        await this.#syncDirectory();
      } catch {fail('JOURNAL_WRITE_UNCERTAIN');}
      finally {if(handle)await handle.close().catch(()=>{});}
    };
    try {
      const r=await operation(persist);
      await lock.close();lock=null;
      await this.#io.unlink(join(this.#dir,'writer.lock'));
      // Data + rename already synced. No unlock fsync: losing this deletion
      // after a crash may resurrect a HOLD marker, never permission to replay.
      return r;
    } catch(e) {
      if(lock)await lock.close().catch(()=>{});
      // Before persistence, validation errors are safe to unlock. Any write or
      // sync uncertainty retains the marker and requires manual reconciliation.
      if(!persisting)await this.#io.unlink(join(this.#dir,'writer.lock')).catch(()=>{});
      if(persisting)fail('JOURNAL_WRITE_UNCERTAIN');
      if(['JOURNAL_MISSING','JOURNAL_INVALID','JOURNAL_EXISTS','STALE_JOURNAL','INVALID_STATE_TRANSITION','INVALID_JOURNAL_UPDATE','TERMINAL_JOURNAL'].includes(e.message))throw e;
      fail('JOURNAL_OPERATION_FAILED');
    }
  }
  async #syncDirectory() {const h=await this.#io.open(this.#dir,'r');try{await h.sync();}finally{await h.close();}}
  async initialize(claim,now) {
    const r=validateJournal({journal_version:'CC_AG_JOURNAL_V1',sequence:0,claim:validateClaim(claim),state:'QUEUED',history:[{state:'QUEUED',at:now}],recovery_status:'READY',updated_at:now});
    return this.#withLock(async persist=>{
      if(await this.#exists(join(this.#dir,'attempt.json')))fail('JOURNAL_EXISTS');
      await persist(r);return r;
    });
  }
  async update(expectedSequence,patch,now) {
    if(!exact(patch,['recovery_status']) && !exact(patch,['state','recovery_status']))fail('INVALID_JOURNAL_UPDATE');
    return this.#withLock(async persist=>{
      const r=await this.#readUnlocked();
      if(r.sequence!==expectedSequence)fail('STALE_JOURNAL');
      if(['COMPLETED','FAILED','BLOCKED'].includes(r.state))fail('TERMINAL_JOURNAL');
      if(!timestamp(now) || Date.parse(now)<Date.parse(r.updated_at))fail('INVALID_JOURNAL_UPDATE');
      const next={...r,sequence:r.sequence+1,updated_at:now,recovery_status:patch.recovery_status};
      if(Object.hasOwn(patch,'state')) {
        next.state=transition(r.state,patch.state);next.history=[...r.history,{state:next.state,at:now}];
      } else if(r.state==='QUEUED' && r.recovery_status!=='READY' && patch.recovery_status==='READY')fail('INVALID_JOURNAL_UPDATE');
      try {validateJournal(next);}catch {fail('INVALID_JOURNAL_UPDATE');}
      await persist(next);return next;
    });
  }
}
