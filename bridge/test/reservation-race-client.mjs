// Test-only bounded IPC client. No network/server or persistent background job.
let manifest;
process.on('message',m=>{
 if(m.type==='start'){manifest=m.manifest;process.send({type:'observe'});}
 else if(m.type==='observed')process.send({type:'create',manifest});
 else if(m.type==='created'){process.send({type:'result',result:m.result},()=>process.exit(0));}
});
