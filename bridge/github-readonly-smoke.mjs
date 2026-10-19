// Explicit manual developer command, excluded from CI. Credential arrives only
// over stdin (e.g. existing gh auth token pipe), never argv, disk or logs.
import { ReadOnlyGitHub, liveClaimPreflight } from './github-readonly.mjs';
import { REPOSITORY } from './foundation.mjs';
try {
  if(process.argv.length!==2)throw Error('UNSUPPORTED_ARGUMENT');
  const chunks=[];let bytes=0;
  for await(const chunk of process.stdin) {bytes+=chunk.length;if(bytes>1024)throw Error('INVALID_CREDENTIAL_INPUT');chunks.push(chunk);}
  const token=Buffer.concat(chunks).toString('utf8').trim();
  const client=new ReadOnlyGitHub({getToken:async()=>token});
  const observation=await client.readIssue(12,{expectedIssueId:'I_kwDOVN9hnM8AAAABYJf80A'});
  const pass=observation.reason==='TASK_SCHEMA_REJECTED' && observation.issue_id==='I_kwDOVN9hnM8AAAABYJf80A';
  console.log(JSON.stringify({mode:'MANUAL_READ_ONLY_GITHUB',smoke_status:pass?'PASS_READ_ONLY_REJECTION':'HOLD',repository:REPOSITORY,issue_number:12,issue_id:observation.issue_id??null,revision_digest:observation.revision_digest??null,reason:observation.reason,rate_remaining:observation.rate_remaining??null,request_id:observation.request_id??null,execution_allowed:false,live_claim_preflight:liveClaimPreflight().status},null,2));
  if(!pass)process.exitCode=1;
} catch {
  console.log(JSON.stringify({smoke_status:'HOLD',reason:'MANUAL_SMOKE_INPUT_FAILED',execution_allowed:false}));process.exitCode=1;
}
