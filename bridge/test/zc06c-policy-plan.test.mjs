import test from 'node:test';
import assert from 'node:assert/strict';
import {REQUIRED_DENY} from '../zc06c-single-model.mjs';
import {
 planRestrictedPolicy,assessTransition,verifyRestore,
} from '../zc06c-policy-plan.mjs';

const original=JSON.stringify({
 colorScheme:'dark',notifications:true,
 toolPermission:'request-review',
 permissions:{allow:['command(git status)'],ask:['command(npm)']},
 extra:{nickname:'synthetic fixture'}
},null,2)+'\n';

test('P01 pure offline plan preserves unrelated settings and all deny actions',()=>{
 const p=planRestrictedPolicy(original);
 assert.equal(p.gate,'ZC06C_OFFLINE_POLICY_PLAN_ONLY');
 const edited=JSON.parse(p.temporaryText);
 const source=JSON.parse(original);
 assert.deepEqual(edited.extra,source.extra);
 assert.deepEqual(edited.permissions.allow,source.permissions.allow);
 assert.deepEqual(edited.permissions.ask,source.permissions.ask);
 assert.equal(edited.colorScheme,source.colorScheme);
 assert.equal(edited.toolPermission,'strict');
 assert.equal(edited.useG1Credits,false);
 assert.equal(edited.allowNonWorkspaceAccess,false);
 for(const rule of REQUIRED_DENY)assert.ok(edited.permissions.deny.includes(rule));
 assert.equal(p.required_deny_count,REQUIRED_DENY.length);
});
test('P02 no temporary settings bytes or secrets in serialized output',()=>{
 const secret='SYNTHETIC_NOT_REAL_TOKEN_abcdefghij';
 const p=planRestrictedPolicy(JSON.stringify({custom:{private:secret}}));
 assert.equal(p.gate,'ZC06C_OFFLINE_POLICY_PLAN_ONLY');
 assert.equal(p.temporaryText.includes(secret),true);
 assert.equal(JSON.stringify(p).includes(secret),false);
 assert.equal(Object.keys(p).includes('temporaryText'),false);
});
test('P03 repeated deny rules deduplicated without removing unrelated deny',()=>{
 const input=JSON.stringify({permissions:{deny:[
  REQUIRED_DENY[0],'command(custom)',REQUIRED_DENY[0]
 ]}});
 const p=planRestrictedPolicy(input);
 assert.equal(p.gate,'ZC06C_OFFLINE_POLICY_PLAN_ONLY');
 const list=JSON.parse(p.temporaryText).permissions.deny;
 assert.equal(list.filter(x=>x===REQUIRED_DENY[0]).length,1);
 assert.ok(list.includes('command(custom)'));
});
test('P04 non-default billing provider cannot be silently changed',()=>{
 for(const data of [
  {modelProvider:'gemini'},
  {useG1Credits:true},
  {allowNonWorkspaceAccess:true},
  {toolPermission:'always-proceed'},
  {toolPermission:'proceed-in-sandbox'},
 ]){
  assert.equal(planRestrictedPolicy(JSON.stringify(data)).gate,'ZC06C_PLAN_HOLD');
 }
});
test('P05 invalid config and permission arrays never produce a usable plan',()=>{
 for(const txt of ['', '[]','null','{bad}', JSON.stringify({permissions:{deny:'*'}}),
    JSON.stringify({permissions:{allow:[123]}}),JSON.stringify({permissions:{ask:[null]}}),
    JSON.stringify({__proto__:'not-present',constructor:{unsafe:1}})]){
  assert.equal(planRestrictedPolicy(txt).gate,'ZC06C_PLAN_HOLD');
 }
});
test('P06 concurrent modification aborts rather than overwrites',()=>{
 const p=planRestrictedPolicy(original);
 assert.equal(assessTransition({
  currentText:original,expectedSha256:p.original_sha256,
  targetSha256:p.temporary_sha256
 }).gate,'ZC06C_SOURCE_UNCHANGED');
 assert.equal(assessTransition({
  currentText:original+' ',expectedSha256:p.original_sha256,
  targetSha256:p.temporary_sha256
 }).reason,'CONCURRENT_OR_UNKNOWN_SETTINGS_CHANGE');
});
test('P07 restricted bytes are detected but not changed by plan',()=>{
 const p=planRestrictedPolicy(original);
 const result=assessTransition({
  currentText:p.temporaryText,expectedSha256:p.original_sha256,
  targetSha256:p.temporary_sha256
 });
 assert.equal(result.gate,'ZC06C_RESTRICTED_BYTES_PRESENT');
 assert.equal(result.settings_changed,false);
});
test('P08 full byte-by-byte restoration not only logical JSON equivalence',()=>{
 const changed=JSON.stringify(JSON.parse(original));
 assert.equal(verifyRestore(original,original).gate,
  'ZC06C_EXACT_RESTORE_BYTES_CONFIRMED');
 assert.equal(verifyRestore(original,changed).gate,'ZC06C_RESTORE_MISMATCH');
});
test('P09 invalid transition digests fail closed',()=>{
 assert.equal(assessTransition({currentText:'{}',expectedSha256:'short',
  targetSha256:'short'}).gate,'ZC06C_PLAN_HOLD');
});
test('P10 planner never reads local settings, creates files or launches CLI',()=>{
 const p=planRestrictedPolicy('{"toolPermission":"strict"}');
 assert.equal(p.model_called,false);
 assert.equal(p.settings_changed,false);
 assert.equal(Object.hasOwn(p,'temporaryText'),true);
 assert.equal(JSON.parse(p.temporaryText).permissions.deny.length,REQUIRED_DENY.length);
});
