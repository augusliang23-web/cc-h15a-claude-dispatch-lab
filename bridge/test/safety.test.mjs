import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('E offline admission runs with network and process launch trapped; live flags cannot enable it',()=>{
 const script=`
 import { syncBuiltinESMExports } from 'node:module';
 import cp from 'node:child_process';
 import http from 'node:http'; import https from 'node:https';
 import net from 'node:net'; import tls from 'node:tls'; import dns from 'node:dns';
 import assert from 'node:assert/strict';
 let calls=0; const denied=()=>{calls++;throw Error('FORBIDDEN_LIVE_SIDE_EFFECT');};
 for(const [module,names] of [[cp,['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']],[http,['request','get']],[https,['request','get']],[net,['connect','createConnection','createServer']],[tls,['connect','createServer']],[dns,['lookup','resolve']]])for(const name of names)module[name]=denied;
 globalThis.fetch=denied; syncBuiltinESMExports();
 const {setup,issue,NOW,sandbox}=await import('./bridge/test/support.mjs');
 const {MockGitHub,claimRequest,claimLive}=await import('./bridge/claims.mjs');
 const {Journal}=await import('./bridge/journal.mjs');
 const {simulateClaim,recover}=await import('./bridge/admission.mjs');
 const {admitLive}=await import('./bridge/security.mjs');
 const {executeLive}=await import('./bridge/foundation.mjs');
 process.env.CC_AG_LIVE='true';process.env.AGY_LIVE='true';
 await sandbox(async dir=>{
   const f=setup(),journal=new Journal(dir),remote=new MockGitHub({claims:[]},{task:issue(),attestation:f.attest()});
   await journal.initialize(claimRequest(f.payload,'mac','attempt'),NOW);
   assert.equal((await simulateClaim({journal,remote,verifier:f.verifier,now:NOW})).status,'MOCK_CLAIMED');
   assert.equal((await recover({journal,remote,verifier:f.verifier,now:NOW})).status,'HOLD');
 });
 for(const entry of [admitLive,claimLive,executeLive])assert.throws(()=>entry(issue()));
 assert.equal(calls,0);console.log('OFFLINE_NO_LIVE_SIDE_EFFECTS');
 `;
 const out=execFileSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8'});
 assert.equal(out.trim(),'OFFLINE_NO_LIVE_SIDE_EFFECTS');
});
