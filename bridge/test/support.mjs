import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPairSync, sign } from 'node:crypto';
import * as s from '../security.mjs';
export const NOW='2026-10-19T01:00:00.000Z';
export const task=(changes={})=>({contract_version:'CC_AG_BRIDGE_V1',task_id:'AG2B2-test',repository:'augusliang23-web/cc-h15a-claude-dispatch-lab',issue_number:101,agent:'antigravity',model:'gemini-3.8-flash-low',task_type:'synthetic',execution_mode:'dry-run',approval:'approved',status:'QUEUED',...changes});
export const issue=(changes={})=>({repository:task().repository,issue_number:101,issue_id:'I_test_101',state:'open',title:'Synthetic task',body:JSON.stringify(task()),...changes});
export function setup() {
 const keys=generateKeyPairSync('ed25519');
 const revoked=new Set(),consumed=new Set();
 const verifier=new s.Ed25519ApprovalVerifier({authorities:new Map([['test-authority',keys.publicKey]]),revoked,consumed});
 const payload={approval_version:'CC_AG_APPROVAL_V1',authority:'test-authority',approval_id:'approval-1',not_before:'2026-10-19T00:00:00.000Z',expires_at:'2026-10-19T02:00:00.000Z',binding:s.bindIssue(issue())};
 const attest=(changes={})=>{const p={...payload,...changes};return {payload:p,signature:sign(null,Buffer.from(s.canonical(p)),keys.privateKey).toString('base64')};};
 return {verifier,attest,payload,revoked,consumed,now:NOW};
}

export async function sandbox(fn) { const dir=await fs.mkdtemp(join(tmpdir(),'ag2b2-'));try{return await fn(dir);}finally{await fs.rm(dir,{recursive:true,force:true});} }
