// ZC-06A read-only executable metadata. Never launch Antigravity or any process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function inspect({platform=process.platform,home=os.homedir(),io=fs}={}){
 const report={gate:'ZC06A_LOCAL_METADATA_ONLY',platform:platform==='darwin'?'MACOS':'OTHER',
   binary:'UNKNOWN',symlink:'UNKNOWN',settings:'NOT_INSPECTED',
   model_invoked:false,agent_invoked:false,authentication_verified:false,
   billing_verified:false,model_support_verified:false,permissions_verified:false,
   ready_for_execution:false};
 if(platform!=='darwin'){report.binary='BLOCKED_NON_MAC';return report;}
 if(typeof home!=='string'||!path.isAbsolute(home)){report.binary='INVALID_HOME';return report;}
 const binary=path.join(home,'.local','bin','agy');
 try{
  const st=io.lstatSync(binary);
  report.symlink=st.isSymbolicLink()?'YES':'NO';
  report.binary=st.isSymbolicLink()?'SYMLINK_PRESENT_UNTRUSTED':
   st.isFile()&&Boolean(st.mode&0o111)?'EXECUTABLE_FILE_PRESENT_UNTRUSTED':'NOT_EXECUTABLE';
 }catch{report.binary='NOT_FOUND_OR_INACCESSIBLE';}
 return report;
}
export function direct(entry,url,io=fs){
 try{return typeof entry==='string'&&io.realpathSync(path.resolve(entry))===io.realpathSync(fileURLToPath(url));}
 catch{return false;}
}
if(direct(process.argv[1],import.meta.url)){
 const r=process.argv.length===3&&process.argv[2]==='--inspect'?
   inspect():{gate:'HOLD_INVALID_ARGUMENT',model_invoked:false,ready_for_execution:false};
 process.stdout.write(JSON.stringify(r)+'\n');
 if(r.gate!=='ZC06A_LOCAL_METADATA_ONLY')process.exitCode=2;
}
