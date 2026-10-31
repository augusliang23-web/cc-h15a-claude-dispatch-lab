import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspect} from '../zc06a-metadata.mjs';
const withHome=f=>{const d=fs.mkdtempSync(path.join(os.tmpdir(),'zc06a-test-'));
 try{f(d)}finally{fs.rmSync(d,{recursive:true,force:true})}};
test('A01 no binary returns unknown instead of ready',()=>withHome(home=>{
 const r=inspect({platform:'darwin',home});
 assert.equal(r.binary,'NOT_FOUND_OR_INACCESSIBLE');assert.equal(r.ready_for_execution,false);
}));
test('A02 executable file is untrusted and not invoked',()=>withHome(home=>{
 const p=path.join(home,'.local','bin');fs.mkdirSync(p,{recursive:true});
 fs.writeFileSync(path.join(p,'agy'),'not a real agent',{mode:0o700});
 const r=inspect({platform:'darwin',home});
 assert.equal(r.binary,'EXECUTABLE_FILE_PRESENT_UNTRUSTED');
 assert.equal(r.model_invoked,false);assert.equal(r.billing_verified,false);
}));
test('A03 symlink remains untrusted',()=>withHome(home=>{
 const p=path.join(home,'.local','bin');fs.mkdirSync(p,{recursive:true});
 const f=path.join(p,'agy');fs.symlinkSync('/tmp/unknown-test-binary',f);
 const r=inspect({platform:'darwin',home});assert.equal(r.symlink,'YES');
 assert.equal(r.ready_for_execution,false);
}));
test('A04 non-Mac inspection blocks',()=>{
 const r=inspect({platform:'linux',home:'/tmp'});
 assert.equal(r.binary,'BLOCKED_NON_MAC');assert.equal(r.model_invoked,false);
});
test('A05 no local paths or setting values in result',()=>withHome(home=>{
 const s=JSON.stringify(inspect({platform:'darwin',home}));
 assert.equal(s.includes(home),false);
 assert.equal(s.includes('settings.json'),false);
}));
