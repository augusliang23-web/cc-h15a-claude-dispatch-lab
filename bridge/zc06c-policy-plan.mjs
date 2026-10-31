// ZC-06C: offline, pure policy-change planner. ZERO OS configuration writes.
// This module MUST NOT read ~/.gemini, run AgY, or touch external services.
import {createHash} from 'node:crypto';
import {REQUIRED_DENY} from './zc06c-single-model.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const denied=(reason)=>Object.freeze({gate:'ZC06C_PLAN_HOLD',reason,settings_changed:false,model_called:false});
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);

export function planRestrictedPolicy(originalBytes) {
 if(!Buffer.isBuffer(originalBytes)||originalBytes.length<2||
    originalBytes.length>131072)return denied('INVALID_SETTINGS_BYTES');
 let original;
 try{
  const decoder=new TextDecoder('utf-8',{fatal:true});
  original=JSON.parse(decoder.decode(originalBytes));
 }
 catch{return denied('INVALID_SETTINGS_JSON');}
 if(!record(original)||own(original,'__proto__')||
    own(original,'constructor')||own(original,'prototype'))
   return denied('UNSAFE_SETTINGS_OBJECT');
 // Do not automatically switch providers, entitlements or non-workspace grants.
 if(![undefined,''].includes(original.modelProvider)||
    original.useG1Credits===true||
    original.allowNonWorkspaceAccess===true||
    ![undefined,'strict','request-review'].includes(original.toolPermission))
   return denied('UNSAFE_BASELINE_SETTINGS');
 const permissions=original.permissions===undefined?{}:original.permissions;
 if(!record(permissions)||own(permissions,'__proto__')||
    own(permissions,'constructor')||own(permissions,'prototype'))
   return denied('UNSAFE_PERMISSIONS_OBJECT');
 for(const name of ['allow','ask','deny']) {
  if(permissions[name]!==undefined&&
     (!Array.isArray(permissions[name])||
      permissions[name].some(x=>typeof x!=='string'||x.length>1024)))
    return denied('UNSAFE_RULE_ARRAY');
 }
 // The planner does not remove other rules; Deny must outrank Allow in the
 // installed CLI. This requires independent runtime verification.
 const restricted={
  ...original,
  toolPermission:'strict',
  allowNonWorkspaceAccess:false,
  useG1Credits:false,
  permissions:{...permissions,
   deny:[...new Set([...(permissions.deny||[]),...REQUIRED_DENY])]},
 };
 const temporaryBytes=Buffer.from(JSON.stringify(restricted,null,2)+'\n','utf8');
 const plan={
  gate:'ZC06C_OFFLINE_POLICY_PLAN_ONLY',
  settings_changed:false,model_called:false,
  original_sha256:digest(originalBytes),
  temporary_sha256:digest(temporaryBytes),
  original_bytes:originalBytes.length,
  temporary_bytes:temporaryBytes.length,
  required_deny_count:REQUIRED_DENY.length,
 };
 // Internal-only non-enumerable field, omitted by JSON.stringify and default
 // inspection. Still sensitive if the caller explicitly reads it.
 Object.defineProperty(plan,'temporaryBytes',{
  value:Buffer.from(temporaryBytes),enumerable:false,writable:false,
 });
 return Object.freeze(plan);
}

// Does not write anything. A changed settings digest is a STOP, not an
// invitation to overwrite concurrent work.
export function assessTransition({
 currentBytes,expectedSha256,targetSha256
}={}){
 if(!Buffer.isBuffer(currentBytes)||!(/^[0-9a-f]{64}$/).test(expectedSha256||'')||
    !(/^[0-9a-f]{64}$/).test(targetSha256||''))
   return denied('INVALID_TRANSITION_INPUT');
 const observed=digest(currentBytes);
 if(observed===expectedSha256)return Object.freeze({
  gate:'ZC06C_SOURCE_UNCHANGED',settings_changed:false,
  model_called:false,
 });
 if(observed===targetSha256)return Object.freeze({
  gate:'ZC06C_RESTRICTED_BYTES_PRESENT',settings_changed:false,
  model_called:false,
 });
 return denied('CONCURRENT_OR_UNKNOWN_SETTINGS_CHANGE');
}
export function verifyRestore(originalBytes,restoredBytes) {
 if(!Buffer.isBuffer(originalBytes)||!Buffer.isBuffer(restoredBytes))
   return denied('RESTORE_BYTES_UNAVAILABLE');
 return Object.freeze({
  gate:originalBytes.equals(restoredBytes)?
    'ZC06C_EXACT_RESTORE_BYTES_CONFIRMED':'ZC06C_RESTORE_MISMATCH',
  restored_exactly:originalBytes.equals(restoredBytes),
  settings_changed:false,
  model_called:false,
 });
}
