import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {startPreview} from '../local-preview/server.mjs';
async function withApp(fn){const dir=await fs.mkdtemp(join(tmpdir(),'preview-http-'));let app;try{app=await startPreview({directory:join(dir,'private')});await fn(app);}finally{await app?.stop();await fs.rm(dir,{recursive:true,force:true});}}
async function login(app){const r=await fetch(app.origin+'/session',{method:'POST',headers:{origin:app.origin,'content-type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
const post=(app,path,cookie,body,origin=app.origin)=>fetch(app.origin+path,{method:'POST',headers:{origin,'content-type':'application/json',cookie},body:JSON.stringify(body)});

test('H01 loopback ephemeral listener, fixed static assets and defensive headers',()=>withApp(async app=>{
 assert.equal(app.address.address,'127.0.0.1');const r=await fetch(app.origin);assert.equal(r.status,200);
 assert.match(r.headers.get('content-security-policy'),/default-src 'none'/);assert.equal(r.headers.get('cache-control'),'no-store');
 const html=await r.text();assert.match(html,/LOCAL PREVIEW/);assert.ok(!html.includes(app.launchToken));
 assert.equal((await fetch(app.origin+'/../ledger.json')).status,404);
 assert.equal((await fetch(app.origin+'/api/state')).status,403);
}));
test('H02 exact Host, Origin and JSON guards reject cross-site writes / login',()=>withApp(async app=>{
 const r=await fetch(app.origin+'/session',{method:'POST',headers:{origin:'https://evil.invalid','content-type':'application/json'},body:JSON.stringify({token:app.launchToken})});assert.equal(r.status,403);
 const hostStatus=await new Promise((resolve,reject)=>{const r=http.get(app.origin,{headers:{host:'evil.invalid'}},res=>{res.resume();resolve(res.statusCode);});r.on('error',reject);});assert.equal(hostStatus,403);
 assert.equal((await fetch(app.origin+'/session',{method:'POST',body:JSON.stringify({token:app.launchToken})})).status,403);
 assert.equal((await fetch(app.origin+'/session',{method:'POST',headers:{origin:app.origin,'content-type':'text/plain'},body:'{}'})).status,415);
}));
test('H03 launch capability one use; session cookie and CSRF required',()=>withApp(async app=>{
 const cookie=await login(app);assert.equal((await post(app,'/session',cookie,{token:app.launchToken})).status,403);
 assert.equal((await post(app,'/api/refresh',cookie,{})).status,403);
 const r=await fetch(app.origin+'/api/state',{headers:{cookie}});const v=await r.json();
 assert.equal((await post(app,'/api/refresh',cookie,{csrf:v.csrf},'https://evil.invalid')).status,403);
 const refreshed=await post(app,'/api/refresh',cookie,{csrf:v.csrf});assert.equal(refreshed.status,200);assert.equal((await refreshed.json()).preview.source,'SYNTHETIC_FIXTURE');
}));
test('H04 decision records once, rejects replay and never enables execution',()=>withApp(async app=>{
 const cookie=await login(app),initial=await (await fetch(app.origin+'/api/state',{headers:{cookie}})).json();
 const v=await (await post(app,'/api/refresh',cookie,{csrf:initial.csrf})).json();
 const body={csrf:v.csrf,decision:'LOCAL_PREVIEW_APPROVED',review_id:v.review_id,sequence:v.sequence};
 const approved=await post(app,'/api/decision',cookie,body);assert.equal(approved.status,200);const result=await approved.json();assert.equal(result.history.length,1);assert.equal(result.execution_allowed,false);
 assert.equal((await post(app,'/api/decision',cookie,body)).status,409);
}));
test('H05 bounded bodies, forbidden verbs and paths cannot mutate',()=>withApp(async app=>{
 const cookie=await login(app);
 assert.equal((await post(app,'/api/refresh',cookie,{padding:'x'.repeat(5000)})).status,413);
 assert.equal((await fetch(app.origin+'/api/decision',{method:'PUT',headers:{origin:app.origin,cookie}})).status,405);
 assert.equal((await fetch(app.origin+'/api/stop',{headers:{cookie}})).status,404);
 assert.equal((await post(app,'/api/claim',cookie,{})).status,404);
}));
test('H06 authenticated shutdown ends foreground listener',()=>withApp(async app=>{
 const cookie=await login(app),v=await (await fetch(app.origin+'/api/state',{headers:{cookie}})).json();
 assert.equal((await post(app,'/api/stop',cookie,{csrf:v.csrf})).status,200);await app.stopped;
 await assert.rejects(()=>fetch(app.origin));
}));

test('H07 top-level browser navigation may load public shell but cross-site API is forbidden',()=>withApp(async app=>{
 const r=await fetch(app.origin,{headers:{'sec-fetch-site':'cross-site'}});assert.equal(r.status,200);
 const cookie=await login(app);assert.equal((await fetch(app.origin+'/api/state',{headers:{cookie,'sec-fetch-site':'cross-site'}})).status,403);
}));

test('H08 page reload invalidates old display proof and needs deliberate Refresh',()=>withApp(async app=>{
 const cookie=await login(app),initial=await (await fetch(app.origin+'/api/state',{headers:{cookie}})).json();
 const v=await (await post(app,'/api/refresh',cookie,{csrf:initial.csrf})).json();assert.equal(v.can_decide,true);
 const reopened=await (await post(app,'/api/start',cookie,{csrf:v.csrf})).json();assert.equal(reopened.can_decide,false);
 assert.equal((await post(app,'/api/decision',cookie,{csrf:v.csrf,decision:'LOCAL_PREVIEW_APPROVED',sequence:v.sequence,review_id:v.review_id})).status,409);
}));
