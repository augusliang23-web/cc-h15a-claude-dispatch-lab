import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {spawnSync} from 'node:child_process';
import {
 createSyntheticFixture,simulateSyntheticApply,recoverSyntheticFixture,
 disposeSyntheticFixture
} from '../zc06c-crossprocess-fixture.mjs';

const moduleUrl=new URL('../zc06c-crossprocess-fixture.mjs',import.meta.url).href;
function child(mode,root) {
 const functionName=mode==='apply'?'simulateSyntheticApply':'recoverSyntheticFixture';
 const body='import {'+functionName+'} from '+JSON.stringify(moduleUrl)+';'+
  'const result='+functionName+'(process.argv[1]);'+
  'process.stdout.write(JSON.stringify(result)+"\\n");'+
  (mode==='apply'?
   'process.exit(result.gate==="ZC06C_CROSSPROC_SYNTHETIC_APPLIED"?77:3);':
   'process.exit(result.gate==="ZC06C_CROSSPROC_EXACT_BYTES_RESTORED"?0:4);');
 return spawnSync(process.execPath,['--input-type=module','-e',body,root],{
  encoding:'utf8',timeout:5000,env:{PATH:process.env.PATH||'/usr/bin:/bin',LANG:'C'},
  maxBuffer:4096,shell:false});
}
function fixture(fn){
 const state=createSyntheticFixture();
 assert.equal(state.gate,'ZC06C_CROSSPROC_FIXTURE_CREATED');
 try{return fn(state.root);}
 finally{assert.equal(disposeSyntheticFixture(state.root),true);}
}
test('CP01 separate processes apply and recover identical original bytes',()=>fixture(root=>{
 const backup=fs.readFileSync(root+'/backup.original');
 const first=child('apply',root);
 assert.equal(first.status,77);
 assert.equal(JSON.parse(first.stdout).model_called,false);
 assert.equal(fs.readFileSync(root+'/settings.synthetic.json').equals(backup),false);
 const second=child('recover',root);
 assert.equal(second.status,0);
 const output=JSON.parse(second.stdout);
 assert.equal(output.gate,'ZC06C_CROSSPROC_EXACT_BYTES_RESTORED');
 assert.equal(output.reason,'RECOVERED_FROM_BACKUP');
 assert.equal(output.settings_modified,false);
 assert.equal(fs.readFileSync(root+'/settings.synthetic.json').equals(backup),true);
}));
test('CP02 unattempted settings are already original in fresh separate recovery',()=>fixture(root=>{
 const second=child('recover',root);
 assert.equal(second.status,0);
 assert.equal(JSON.parse(second.stdout).reason,'ORIGINAL_PRESENT');
}));
test('CP03 concurrent synthetic changes never overwritten by a fresh recovery process',()=>fixture(root=>{
 assert.equal(child('apply',root).status,77);
 fs.writeFileSync(root+'/settings.synthetic.json','{"external":true}\n');
 const changed=fs.readFileSync(root+'/settings.synthetic.json');
 const second=child('recover',root);
 assert.equal(second.status,4);
 assert.equal(JSON.parse(second.stdout).reason,'CONCURRENT_OR_UNKNOWN_SETTINGS_CHANGE');
 assert.equal(fs.readFileSync(root+'/settings.synthetic.json').equals(changed),true);
}));
test('CP04 corrupt backup cannot be used for restoration after separate-process apply',()=>fixture(root=>{
 assert.equal(child('apply',root).status,77);
 fs.writeFileSync(root+'/backup.original',Buffer.from('corrupt fixture'));
 const second=child('recover',root);
 assert.equal(second.status,4);
 assert.equal(JSON.parse(second.stdout).reason,'BACKUP_CHANGED');
}));
test('CP05 malformed journal fails closed and preserves modified synthetic settings',()=>fixture(root=>{
 assert.equal(child('apply',root).status,77);
 const before=fs.readFileSync(root+'/settings.synthetic.json');
 fs.writeFileSync(root+'/journal.json',Buffer.from('{invalid'));
 const second=child('recover',root);
 assert.equal(second.status,4);
 assert.equal(JSON.parse(second.stdout).reason,'RECOVERY_UNCERTAIN');
 assert.equal(fs.readFileSync(root+'/settings.synthetic.json').equals(before),true);
}));
test('CP06 cannot recover a different folder under real HOME',()=>{
 const second=child('recover',process.env.HOME||'/Users/unknown');
 assert.equal(second.status,4);
 const output=JSON.parse(second.stdout);
 assert.equal(output.reason,'UNTRUSTED_FIXTURE_ROOT');
 assert.equal(output.model_called,false);
});
test('CP07 duplicate synthetic apply fails without replay',()=>fixture(root=>{
 assert.equal(child('apply',root).status,77);
 const after=fs.readFileSync(root+'/settings.synthetic.json');
 const again=child('apply',root);
 assert.equal(again.status,3);
 assert.equal(JSON.parse(again.stdout).reason,'NOT_PREPARED');
 assert.equal(fs.readFileSync(root+'/settings.synthetic.json').equals(after),true);
}));
test('CP08 symlinked marker invalidates synthetic recovery',()=>fixture(root=>{
 assert.equal(child('apply',root).status,77);
 fs.renameSync(root+'/synthetic.fixture',root+'/original.marker');
 fs.symlinkSync(root+'/original.marker',root+'/synthetic.fixture');
 const result=child('recover',root);
 assert.equal(result.status,4);
 assert.equal(JSON.parse(result.stdout).reason,'RECOVERY_UNCERTAIN');
 // Repair only the synthetic fixture marker so its strict dispose guard can run.
 fs.unlinkSync(root+'/synthetic.fixture');
 fs.renameSync(root+'/original.marker',root+'/synthetic.fixture');
}));
