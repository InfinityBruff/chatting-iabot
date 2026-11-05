const encoder=new TextEncoder();
const streamError=()=>Error('Typing stream unavailable');

// SSE frames may cross UTF-8/network chunks. Transport decoding belongs to the
// reader; this parser bounds unfinished lines and events and never replays IDs.
export function createTypingSSEParser({onEvent,maxEventBytes=8192,maxBufferBytes=16384}={}){
 if(typeof onEvent!=='function')throw new TypeError('Missing event consumer');
 const eventLimit=Math.max(1,Math.min(8192,maxEventBytes)),bufferLimit=Math.max(1,Math.min(16384,maxBufferBytes));
 let buffer='',data=[],bytes=0,first=true;
 function line(value){
  if(encoder.encode(value).byteLength>bufferLimit)throw streamError();
  if(value===''){
   if(data.length){const source=data.join('\n');data=[];bytes=0;let event;try{event=JSON.parse(source)}catch{return}if(event&&typeof event==='object'&&!Array.isArray(event))onEvent(event)}
   return;
  }
  if(value.startsWith(':'))return;
  const separator=value.indexOf(':'),field=separator<0?value:value.slice(0,separator);if(field!=='data')return;
  let content=separator<0?'':value.slice(separator+1);if(content.startsWith(' '))content=content.slice(1);
  bytes+=encoder.encode(content).byteLength+1;if(bytes>eventLimit)throw streamError();data.push(content);
 }
 function feed(chunk){
  if(typeof chunk!=='string'||encoder.encode(chunk).byteLength>65536)throw streamError();
  if(first&&chunk){first=false;if(chunk.charCodeAt(0)===0xfeff)chunk=chunk.slice(1)}
  buffer+=chunk;let start=0;
  for(let i=0;i<buffer.length;i++)if(buffer[i]==='\n'||buffer[i]==='\r'){
   if(buffer[i]==='\r'&&i===buffer.length-1)break;
   const end=i;if(buffer[i]==='\r'&&buffer[i+1]==='\n')i++;
   line(buffer.slice(start,end));start=i+1;
  }
  buffer=buffer.slice(start);if(encoder.encode(buffer).byteLength>bufferLimit)throw streamError();
 }
 return {feed,finish(){if(buffer.endsWith('\r'))feed('\n');buffer='';data=[];bytes=0}};
}

function timestamp(value){
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value))return null;
 const at=Date.parse(value);return Number.isFinite(at)&&new Date(at).toISOString().slice(0,19)===value.slice(0,19)?at:null;
}
const part=value=>typeof value==='string'&&value.trim()?value.trim():null;

// Exactly one open chat owns this transient signal. No cache, persistence,
// scheduler or message delivery state is shared with the long-lived stream.
export function createFanTyping({actor,workspace,account,fan,request,cacheEpoch=()=>0,visible=()=>true,online=()=>true,now=Date.now,schedule=setTimeout,cancel=clearTimeout,random=Math.random}){
 if(![actor,workspace,account,fan].every(part)||typeof request!=='function')throw new TypeError('Invalid typing scope');
 const epoch=cacheEpoch(),listeners=new Set();let active=false,terminal=false,generation=0,job=null,retryTimer=null,expiryTimer=null,retryAt=0,failures=0,value=false,watermark=-Infinity,barrier=-Infinity;
 const emit=next=>{if(next===value)return;value=next;for(const listener of listeners)listener()};
 function clearTimer(kind){const timer=kind==='retry'?retryTimer:expiryTimer;if(timer!==null)cancel(timer);if(kind==='retry')retryTimer=null;else expiryTimer=null}
 function clear(){clearTimer('expiry');emit(false)}
 function close(token){if(!token)return;token.controller.abort();const body=token.reader||token.body;if(body&&!token.cancelled){token.cancelled=true;try{Promise.resolve(body.cancel()).catch(()=>{})}catch{}}}
 function revoke(){terminal=true;clearTimer('retry');clear();close(job)}
 function allowed(){if(cacheEpoch()!==epoch)revoke();return active&&!terminal}
 const current=token=>allowed()&&job===token&&token.generation===generation&&!token.controller.signal.aborted;
 function wake(){
  clearTimer('retry');if(!allowed()||job||!visible()||!online())return;
  retryTimer=schedule(()=>{retryTimer=null;return connect()},Math.min(2147483647,Math.max(0,retryAt-now())));
 }
 function event(token,data){
  if(!current(token)||!visible()||!online())return;
  if(data.type==='denied'){revoke();return}
  if(data.type==='unavailable'||data.type==='reconnect'){clear();close(token);return}
  if(data.type==='stopped'||data.type==='typing'&&data.typing===false){clear();return}
  if(data.type!=='typing'||data.typing!==true)return;
  const observed=data.observedAt===undefined?null:timestamp(data.observedAt),expires=data.expiresAt===undefined?null:timestamp(data.expiresAt);
  if(data.observedAt!==undefined&&observed===null||data.expiresAt!==undefined&&expires===null||observed===null&&expires===null)return;
  const at=now(),serverExpiry=expires??observed+6000,started=observed??serverExpiry-6000;
  if(serverExpiry<=at||serverExpiry>at+7000||started>at+1000||started<=barrier||serverExpiry<=watermark||observed!==null&&serverExpiry>observed+6000)return;
  watermark=serverExpiry;clearTimer('expiry');emit(true);
  expiryTimer=schedule(()=>{expiryTimer=null;allowed();emit(false)},Math.min(6000,serverExpiry-at));
 }
 async function connect(){
  if(!allowed()||job||!visible()||!online())return;if(retryAt>now()){wake();return}
  const token={generation,controller:new AbortController(),reader:null,cancelled:false,interrupted:false,at:now()};job=token;retryAt=0;let retryAfter=0;
  try{
   const response=await request({signal:token.controller.signal,active:()=>current(token)&&visible()&&online()});token.body=response?.body;
   if(job===token&&token.generation===generation&&cacheEpoch()===epoch&&[401,403].includes(response?.status)){terminal=true;return}
   if(!current(token)||!visible()||!online())return;
   if(response?.status!==200)throw Object.assign(streamError(),{status:response?.status,retryAfter:Number(response?.headers?.get('retry-after'))});
   if(response.headers?.get('content-type')?.split(';')[0].trim().toLowerCase()!=='text/event-stream'||!response.body?.getReader)throw streamError();
   const reader=response.body.getReader();token.reader=reader;
   const decoder=new TextDecoder('utf-8',{fatal:true}),parser=createTypingSSEParser({onEvent:data=>event(token,data)});
   while(current(token)&&visible()&&online()){
    const next=await reader.read();if(!current(token)||!visible()||!online())break;
    if(next.done){parser.feed(decoder.decode());parser.finish();break}
    parser.feed(decoder.decode(next.value,{stream:true}));
   }
  }catch(error){
   if(job===token&&token.generation===generation&&cacheEpoch()===epoch&&[401,403].includes(error?.status))terminal=true;
   if(current(token)){const seconds=Number(error?.retryAfter);if(Number.isFinite(seconds)&&seconds>0)retryAfter=seconds*1000}
  }finally{
   close(token);
   if(job===token){job=null;clear();if(allowed()){
    if(!token.interrupted){if(now()-token.at>=30000)failures=0;const backoff=[2000,5000,10000,30000][Math.min(failures++,3)],jitter=Number(random());retryAt=now()+Math.max(retryAfter,Math.round(backoff*(1+Math.max(0,Math.min(1,Number.isFinite(jitter)?jitter:.5))*.2)))}
    wake();
   }}
  }
 }
 return {
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},getSnapshot:()=>value,
  start(){if(active||terminal)return;active=true;generation++;wake()},
  stop(){active=false;generation++;clearTimer('retry');clear();if(job){job.interrupted=true;close(job)}},
  resume(){if(!allowed())return;if(!visible()||!online()){clearTimer('retry');clear();if(job){job.interrupted=true;close(job)}}else wake()},
  clear(){barrier=now();clear()},
 };
}
