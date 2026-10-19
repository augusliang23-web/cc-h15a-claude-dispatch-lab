// Manually started foreground loopback UI. No GitHub writer/provider/process API.
import http from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PreviewLedger} from './ledger.mjs';
import {ReviewSession,fixtureSource} from './review.mjs';
import {exact} from '../bridge/security.mjs';
const token=()=>randomBytes(32).toString('hex');
const equal=(a,b)=>typeof a==='string' && typeof b==='string' && a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
const headers={'connection':'close','cache-control':'no-store','content-security-policy':"default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",'x-content-type-options':'nosniff','referrer-policy':'no-referrer','cross-origin-resource-policy':'same-origin','x-frame-options':'DENY','permissions-policy':'camera=(), microphone=(), geolocation=()'};
export async function startPreview({directory,source=fixtureSource(),clock,port=0}={}){
 if(!Number.isSafeInteger(port) || port<0 || port>65535)throw Error('INVALID_PORT');
 const assets=new Map(await Promise.all([['/','index.html','text/html; charset=utf-8'],['/app.js','app.js','text/javascript; charset=utf-8'],['/style.css','style.css','text/css; charset=utf-8']].map(async([path,file,type])=>[path,{body:await readFile(new URL(file,import.meta.url)),type}])));
 let ledger,review,blocked=false;
 try{ledger=await PreviewLedger.open(directory);review=new ReviewSession({ledger,source,clock});}catch{blocked=true;}
 let launchToken=token(),session=null,csrf=token(),origin,stopping=false,stopPromise;
 let resolveStopped;const stopped=new Promise(r=>{resolveStopped=r;});
 const state=async()=>({...blocked?{status:'LEDGER_HOLD',preview:null,can_decide:false,review_id:null,sequence:0,history:[],execution_allowed:false}:await review.view(),csrf});
 const respond=(res,status,value,type='application/json; charset=utf-8')=>{res.writeHead(status,{...headers,'content-type':type});res.end(type.startsWith('application/json')?JSON.stringify(value):value);};
 async function body(req){
  if(req.headers['content-type']!=='application/json')throw {status:415};
  if(req.headers['content-length'] && (!/^\d+$/.test(req.headers['content-length']) || Number(req.headers['content-length'])>4096))throw {status:413};
  const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>4096)throw {status:413};chunks.push(c);}
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}catch{throw {status:400};}
 }
 const server=http.createServer({maxHeaderSize:8192},async(req,res)=>{
  try{
   if(req.headers.host!==origin.slice(7) || (req.headers.origin && req.headers.origin!==origin))return respond(res,403,{error:'REQUEST_FORBIDDEN'});
   if(stopping)return respond(res,409,{error:'STOPPING'});
   if(!['GET','POST'].includes(req.method))return respond(res,405,{error:'METHOD_FORBIDDEN'});
   if(req.method==='GET' && assets.has(req.url)){const a=assets.get(req.url);return respond(res,200,a.body,a.type);}
   const routes=['/session','/api/state','/api/start','/api/refresh','/api/decision','/api/stop'];
   if(!routes.includes(req.url) || (req.method==='GET' && req.url!=='/api/state') || (req.method==='POST' && req.url==='/api/state'))return respond(res,404,{error:'NOT_FOUND'});
   if(req.method==='POST' && req.headers.origin!==origin)return respond(res,403,{error:'ORIGIN_REQUIRED'});
   if(req.headers['sec-fetch-site'] && !['same-origin','none'].includes(req.headers['sec-fetch-site']))return respond(res,403,{error:'CROSS_SITE_API_FORBIDDEN'});
   const b=req.method==='POST'?await body(req):null;
   if(req.url==='/session'){
    if(session || !exact(b,['token']) || !equal(b.token,launchToken))return respond(res,403,{error:'SESSION_FORBIDDEN'});
    session=token();launchToken=null;res.setHeader('set-cookie',`cc_preview=${session}; HttpOnly; SameSite=Strict; Path=/`);
    return respond(res,200,{status:'LOCAL_SESSION_ONLY'});
   }
   if(!session || req.headers.cookie!==`cc_preview=${session}`)return respond(res,403,{error:'SESSION_REQUIRED'});
   if(req.method==='GET')return respond(res,200,await state());
   if(!equal(b?.csrf,csrf))return respond(res,403,{error:'CSRF_REQUIRED'});
   if(req.url==='/api/stop'){
    if(!exact(b,['csrf']))return respond(res,400,{error:'INVALID_REQUEST'});
    respond(res,200,{status:'STOPPED',execution_allowed:false});void stop();return;
   }
   if(blocked)return respond(res,409,{error:'LEDGER_HOLD'});
   if(req.url==='/api/start'){
    if(!exact(b,['csrf']))return respond(res,400,{error:'INVALID_REQUEST'});
    review.beginPage();return respond(res,200,await state());
   }
   if(req.url==='/api/refresh'){
    if(!exact(b,['csrf']))return respond(res,400,{error:'INVALID_REQUEST'});
    await review.refresh();return respond(res,200,await state());
   }
   const {csrf:_,...input}=b;await review.decide(input);return respond(res,200,await state());
  }catch(e){respond(res,[400,413,415].includes(e.status)?e.status:409,{error:'REQUEST_BLOCKED_OR_UNCERTAIN'});}
 });
 server.requestTimeout=5000;server.headersTimeout=5000;server.keepAliveTimeout=1000;server.maxRequestsPerSocket=100;
 server.on('clientError',(_e,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n'));
 async function stop(){if(stopPromise)return stopPromise;stopping=true;
  stopPromise=new Promise(resolve=>server.close(async()=>{try{await ledger?.close();}finally{resolve();resolveStopped();}}));server.closeIdleConnections();return stopPromise;
 }
 try{await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});}catch{await ledger?.close();throw Error('LOOPBACK_LISTEN_FAILED');}
 const address=server.address();origin=`http://127.0.0.1:${address.port}`;
 return {origin,address,launchToken,stop,stopped};
}
