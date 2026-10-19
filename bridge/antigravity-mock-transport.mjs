// Sealed DATA-ONLY offline fixture. No executable/function injection or real I/O.
import {exact,fail} from './security.mjs';
const instances=new WeakSet(),KEY=Symbol('offline-fixture');
export const isMockAgyTransport=value=>instances.has(value);
class MockAgyTransport {
 #script;#calls=0;#request=null;
 constructor(key,script){if(key!==KEY)fail('MOCK_TRANSPORT_REQUIRED');this.#script=script;instances.add(this);Object.freeze(this);}
 get callCount(){return this.#calls;}
 get lastRequest(){return structuredClone(this.#request);}
 start(request,{onStdout,onStderr}){
  if(this.#calls++)fail('MOCK_ATTEMPT_ALREADY_USED');this.#request=structuredClone(request);
  const s=this.#script;let settled=false,timer,resolveDone;
  const done=new Promise(r=>{resolveDone=r;});
  const settle=(cancelReason=null)=>{if(settled)return;settled=true;clearTimeout(timer);resolveDone({spawnError:s.spawnError,exitCode:cancelReason?null:s.exitCode,signal:cancelReason?'SIGTERM':null,exitObserved:s.exitObserved,processTreeExitObserved:s.processTreeExitObserved,terminateReason:cancelReason});};
  const handle={done,cancel:reason=>{if(s.exitOnCancel)settle(reason);}};
  queueMicrotask(()=>{
   if(settled)return;
   if(!s.spawnError)for(const c of s.chunks){if(settled)break;(c.stream==='stdout'?onStdout:onStderr)(Object.hasOwn(c,'text')?Buffer.from(c.text):Buffer.from(c.bytes));}
   if(!s.stall && !settled)timer=setTimeout(()=>settle(),s.delayMs);
  });return Object.freeze(handle);
 }
}
Object.freeze(MockAgyTransport.prototype);
export function createMockAgyTransport(input){
 if(!input || !Array.isArray(input.chunks) || input.chunks.length>64 || !exact(input,Object.keys(input)) || Object.keys(input).some(k=>!['chunks','exitCode','exitObserved','processTreeExitObserved','spawnError','stall','exitOnCancel','delayMs'].includes(k)))fail('INVALID_MOCK_SCRIPT');
 const s={exitCode:0,exitObserved:true,processTreeExitObserved:true,spawnError:false,stall:false,exitOnCancel:true,delayMs:0,...input};
 if(!Number.isInteger(s.exitCode) || s.exitCode<0 || s.exitCode>255 || !['exitObserved','processTreeExitObserved','spawnError','stall','exitOnCancel'].every(k=>typeof s[k]==='boolean') || !Number.isInteger(s.delayMs) || s.delayMs<0 || s.delayMs>100)fail('INVALID_MOCK_SCRIPT');
 for(const c of s.chunks){if((!exact(c,['stream','text']) && !exact(c,['stream','bytes'])) || !['stdout','stderr'].includes(c.stream))fail('INVALID_MOCK_SCRIPT');
  if(Object.hasOwn(c,'text')?(typeof c.text!=='string' || Buffer.byteLength(c.text)>16384):(!Array.isArray(c.bytes) || c.bytes.length>16384 || !c.bytes.every(n=>Number.isInteger(n) && n>=0 && n<=255)))fail('INVALID_MOCK_SCRIPT');
 }return new MockAgyTransport(KEY,structuredClone(s));
}
