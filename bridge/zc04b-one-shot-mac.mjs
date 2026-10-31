// One human-initiated Mac transport probe; NEVER Agent execution or polling.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import {pathToFileURL} from 'node:url';
export const C=Object.freeze({
  repo:'augusliang23-web/cc-h15a-claude-dispatch-lab',
  issue:30,task:'ZC04B-MAC-ONESHOT-20261031-A1',
  challenge:'ZC04B-PROBE-20261031-B577BBAE-A1',
  main:'b577bbae9e26c8751db9fe389753c4dda1b5cdac',
  marker:'<!-- ZC04B_MAC_PROBE_V1 -->',
  title:'ZC-04B-LIVE-01 — SINGLE Mac → GitHub probe receiver (one comment only)',
  actor:'augusliang23-web'
});
const R='repos/'+C.repo;
const hold=reason=>({status:'HOLD',reason,agent_invoked:false,model_invoked:false,agent_health_verified:false});
export function eventAt(when,nonce) {
  if(!(when instanceof Date)||!Number.isFinite(when.getTime())||!/^[0-9a-f]{32}$/.test(nonce))
    throw Error('INVALID_EVENT');
  return {version:'ZC04B_MAC_PROBE_V1',repository:C.repo,issue:C.issue,task:C.task,
    challenge:C.challenge,main_sha:C.main,platform:'darwin',
    observed_at:when.toISOString(),nonce,kind:'ONE_SHOT_TRANSPORT_PROBE',
    agent_invoked:false,model_invoked:false,agent_health_verified:false};
}
export function bodyFor(e){return C.marker+'\n'+'~~~json\n'+JSON.stringify(e)+'\n~~~';}
export function preflight(x) {
  return !!(x.issue?.number===C.issue&&x.issue.state==='open'&&x.issue.title===C.title&&
    typeof x.issue.body==='string'&&x.issue.body.includes(C.challenge)&&
    x.issue.body.includes(C.main)&&!x.issue.pull_request&&
    x.main?.object?.sha===C.main&&x.user?.login===C.actor&&
    Array.isArray(x.comments)&&x.comments.length<100&&
    x.comments.every(c=>typeof c.body==='string'&&!c.body.includes(C.marker)));
}
export function checkAck(x,body,id=null) {
  return !!(Number.isSafeInteger(x?.id)&&x.id>0&&x.body===body&&
    x.user?.login===C.actor&&typeof x.created_at==='string'&&
    Number.isFinite(Date.parse(x.created_at))&&(id===null||x.id===id));
}
function syncDir(dir,io) {
  const fd=io.openSync(dir,'r');
  try{io.fsyncSync(fd)}finally{io.closeSync(fd)}
}
// Inspect each raw path component BEFORE canonicalization. macOS system
// /var and /tmp root-owned aliases are the only accepted symlink ancestors.
function checkedHome(home,io) {
  if(typeof home!=='string'||!path.isAbsolute(home)||
     path.normalize(home)!==home||home===path.parse(home).root)
    throw Error('INVALID_HOME');
  let current=path.parse(home).root;
  const components=home.slice(current.length).split(path.sep);
  for(const segment of components){
    const next=path.join(current,segment),st=io.lstatSync(next);
    if(st.isSymbolicLink()){
      const canonical=io.realpathSync(next);
      const alias=(next==='/var'&&canonical==='/private/var')||
                  (next==='/tmp'&&canonical==='/private/tmp');
      if(process.platform!=='darwin'||!alias||st.uid!==0)
        throw Error('UNTRUSTED_HOME_SYMLINK');
      const privateDir=io.lstatSync('/private'),target=io.lstatSync(canonical);
      if(!privateDir.isDirectory()||privateDir.uid!==0||
         !target.isDirectory()||target.uid!==0)
        throw Error('UNSAFE_SYSTEM_ALIAS');
      current=canonical;
    } else {
      if(!st.isDirectory())throw Error('NON_DIRECTORY_ANCESTOR');
      current=next;
    }
  }
  return current;
}
function reserve(home,e,io) {
  const base=checkedHome(home,io),uid=process.getuid?.();
  const own=io.lstatSync(base);
  if(!own.isDirectory()||own.isSymbolicLink()||
    (uid!==undefined&&own.uid!==uid)||(own.mode&0o022)!==0)throw Error('UNSAFE_HOME');
  let dir=base;
  for(const [i,name] of ['.local','state','zc04b-oneshot'].entries()){
    const next=path.join(dir,name);let st;
    try{st=io.lstatSync(next)}catch(err){
      if(err.code!=='ENOENT')throw err;
      io.mkdirSync(next,{mode:0o700});syncDir(dir,io);st=io.lstatSync(next);
    }
    if(!st.isDirectory()||st.isSymbolicLink()||
       (uid!==undefined&&st.uid!==uid)||(st.mode&0o022)!==0||
       (i===2&&(st.mode&0o077)!==0))throw Error('UNSAFE_STATE');
    dir=next;
  }
  const file=path.join(dir,C.task+'.claim.json');
  let fd;
  try{
    fd=io.openSync(file,'wx',0o600);
    const data=Buffer.from(JSON.stringify({task:C.task,nonce:e.nonce,
      result:'UNCERTAIN_DO_NOT_RETRY'})+'\n');
    let at=0;
    while(at<data.length){
      const n=io.writeSync(fd,data,at,data.length-at,at);
      if(!Number.isSafeInteger(n)||n<=0)throw Error('SHORT_WRITE');
      at+=n;
    }
    io.fsyncSync(fd);io.closeSync(fd);fd=undefined;syncDir(dir,io);
  }finally{if(fd!==undefined){try{io.closeSync(fd)}catch{}}}
}
export function ghArguments(method,route,data) {
  const allowedGet=new Set([
    R+'/issues/'+C.issue,R+'/git/ref/heads/main','user',
    R+'/issues/'+C.issue+'/comments?per_page=100',
  ]);
  const receiptGet=route.startsWith(R+'/issues/comments/') &&
    /^[1-9][0-9]*$/.test(route.slice((R+'/issues/comments/').length));
  const allowedPost=method==='POST'&&route===R+'/issues/'+C.issue+'/comments'&&
    data&&typeof data.body==='string'&&data.body.startsWith(C.marker);
  if(!((method==='GET'&&data===undefined&&(allowedGet.has(route)||receiptGet))||
        allowedPost))throw Error('UNAUTHORIZED_GITHUB_ROUTE');
  const args=['api','--hostname','github.com','-X',method,route];
  if(data!==undefined)args.push('--input','-');
  return args;
}
function liveGh(method,route,data) {
  const args=ghArguments(method,route,data);
  return JSON.parse(execFileSync('gh',args,{encoding:'utf8',timeout:20000,
    maxBuffer:1048576,stdio:['pipe','pipe','pipe'],
    ...(data===undefined?{}:{input:JSON.stringify(data)})}));
}
export function runOnce({platform=process.platform,home=os.homedir(),
  now=new Date(),nonce=randomBytes(16).toString('hex'),gh=liveGh,io=fs}={}) {
  if(platform!=='darwin')return hold('MACOS_REQUIRED');
  if(process.getuid?.()===0)return hold('ROOT_DENIED');
  let pre;
  try{pre={issue:gh('GET',R+'/issues/'+C.issue),
    main:gh('GET',R+'/git/ref/heads/main'),user:gh('GET','user'),
    comments:gh('GET',R+'/issues/'+C.issue+'/comments?per_page=100')}}
  catch{return hold('PREFLIGHT_GITHUB_UNAVAILABLE')}
  if(!preflight(pre))return hold('PREFLIGHT_NOT_MATCHED_OR_ALREADY_USED');
  let e;
  try{e=eventAt(now,nonce);reserve(home,e,io)}
  catch{return hold('LOCAL_ONE_TIME_CLAIM_UNAVAILABLE_OR_USED')}
  const body=bodyFor(e);
  let posted;
  try{posted=gh('POST',R+'/issues/'+C.issue+'/comments',{body})}
  catch{return hold('POST_UNCERTAIN_DO_NOT_RETRY')}
  if(!checkAck(posted,body))return hold('POST_ACK_INVALID_DO_NOT_RETRY');
  let read;
  try{read=gh('GET',R+'/issues/comments/'+posted.id)}
  catch{return hold('READBACK_UNCERTAIN_DO_NOT_RETRY')}
  if(!checkAck(read,body,posted.id))return hold('READBACK_INVALID_DO_NOT_RETRY');
  return {status:'MAC_TO_GITHUB_PROBE_VERIFIED',issue:C.issue,comment_id:posted.id,
    comment_url:'https://github.com/'+C.repo+'/issues/'+C.issue+
      '#issuecomment-'+posted.id,created_at:read.created_at,
    agent_invoked:false,model_invoked:false,agent_health_verified:false};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const answer=process.argv.length===3&&process.argv[2]==='--once'?
    runOnce():hold('ONLY_EXPLICIT_ONCE_SUPPORTED');
  process.stdout.write(JSON.stringify(answer)+'\n');
  if(answer.status!=='MAC_TO_GITHUB_PROBE_VERIFIED')process.exitCode=2;
}
