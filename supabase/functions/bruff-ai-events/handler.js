// OFMAPI envelope/signature contract: https://www.ofmapi.com/docs/webhooks
// This receiver authenticates and queues metadata. It never reads a fan,
// invokes an AI, registers a webhook or sends a message.
const MAX_BYTES=256*1024,encoder=new TextEncoder();
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);
const account=value=>typeof value==='string'&&/^acct_[A-Za-z0-9_-]{1,123}$/u.test(value);
const secret=value=>typeof value==='string'&&!!value.trim()&&value.length<=4096&&!/[\u0000-\u001f\u007f]/u.test(value);
const numeric=value=>typeof value==='string'&&/^\d{1,24}$/u.test(value)?BigInt(value).toString():Number.isSafeInteger(value)&&value>=0?String(value):null;
class EventError extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code}}
const invalid=()=>new EventError(400,'EVENT_INVALID','El evento no tiene un formato válido.');
const signatureError=()=>new EventError(401,'EVENT_SIGNATURE','No se pudo verificar la firma del evento.');
function timestamp(value,now){
 if(typeof value!=='string')throw invalid();
 const m=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/u.exec(value);
 if(!m)throw invalid();
 const [y,month,day,hour,minute,second]=m.slice(1,7).map(Number),calendar=new Date(Date.UTC(y,month-1,day));
 const parsed=Date.parse(value);
 if(calendar.getUTCFullYear()!==y||calendar.getUTCMonth()!==month-1||calendar.getUTCDate()!==day||hour>23||minute>59||second>59||!Number.isFinite(parsed)||parsed>now+300000)throw invalid();
 return new Date(parsed).toISOString();
}
function envelope(raw,now){
 if(!record(raw)||typeof raw.event!=='string'||raw.event.length>100||!/^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/u.test(raw.event)||!uuid(raw.event_id)||!account(raw.account_id)||!['ws','reconcile'].includes(raw.source))throw invalid();
 const common={event_id:raw.event_id.toLowerCase(),account_id:raw.account_id,occurred_at:timestamp(raw.occurred_at,now),ingested_at:timestamp(raw.ingested_at,now),source:raw.source};
 if(!['messages.received','messages.sent'].includes(raw.event))return null;
 const payload=raw.payload;if(!record(payload)||!record(payload.message))throw invalid();
 const fan=numeric(payload.conversation_id),from=numeric(payload.from_user_id),message=numeric(payload.id),nested=numeric(payload.message.id);
 if(fan===null||from===null||message===null||nested!==message||payload.via!==undefined&&payload.via!==raw.source)throw invalid();
 const direction=raw.event==='messages.received'?'received':'sent';
 if(direction==='received'?from!==fan:from===fan)throw invalid();
 // message.user is the recipient for live sent messages, not their author.
 // Body text, HTML, media, URLs and arbitrary user objects are discarded.
 return {...common,fan_id:fan,message_id:message,direction};
}
function signature(value,now){
 if(typeof value!=='string'||value.length>512)throw signatureError();
 const parts=value.split(',').map(x=>x.trim());if(parts.length!==2)throw signatureError();
 const entries=parts.map(x=>/^([a-z0-9]+)=([^\s,]+)$/u.exec(x));if(entries.some(x=>!x)||new Set(entries.map(x=>x[1])).size!==2)throw signatureError();
 const fields=Object.fromEntries(entries.map(x=>[x[1],x[2]]));
 if(Object.keys(fields).some(x=>!['t','v1'].includes(x))||!/^[1-9]\d{0,11}$/u.test(fields.t||'')||!/^[a-f0-9]{64}$/iu.test(fields.v1||''))throw signatureError();
 const seconds=Number(fields.t);if(!Number.isSafeInteger(seconds)||Math.abs(now-seconds*1000)>300000)throw signatureError();
 return {stamp:fields.t,bytes:Uint8Array.from(fields.v1.match(/../gu),x=>Number.parseInt(x,16))};
}
async function readBody(request,timeout){
 const declared=request.headers.get('content-length');if(declared!==null&&(!/^\d+$/u.test(declared)||Number(declared)>MAX_BYTES))throw new EventError(413,'EVENT_SIZE','El evento supera el tamaño permitido.');
 const reader=request.body?.getReader();if(!reader)throw invalid();
 const signal=AbortSignal.any([request.signal,AbortSignal.timeout(timeout)]),chunks=[];let bytes=0;
 const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true});
 try{
  signal.throwIfAborted();while(true){const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;bytes+=value.byteLength;if(bytes>MAX_BYTES){cancel();throw new EventError(413,'EVENT_SIZE','El evento supera el tamaño permitido.')}chunks.push(value)}
  const body=new Uint8Array(bytes);let at=0;for(const chunk of chunks){body.set(chunk,at);at+=chunk.byteLength}return body;
 }catch(error){if(signal.aborted)throw new EventError(408,'EVENT_TIMEOUT','No se pudo completar la lectura del evento.');if(error instanceof EventError)throw error;throw invalid()}
 finally{signal.removeEventListener('abort',cancel);reader.releaseLock()}
}
export function createAiEventsHandler({webhookSecret,previousWebhookSecret,enabled=false,enqueue,now=Date.now,readTimeoutMs=5000}={}){
 const configured=secret(webhookSecret)&&(previousWebhookSecret===undefined||previousWebhookSecret===null||previousWebhookSecret===''||secret(previousWebhookSecret))&&typeof enqueue==='function';
 const secrets=[webhookSecret,...(secret(previousWebhookSecret)?[previousWebhookSecret]:[])];
 const timeout=Number.isSafeInteger(readTimeoutMs)&&readTimeoutMs>0&&readTimeoutMs<=5000?readTimeoutMs:5000;
 return async request=>{
  const reply=(status,data)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...(status===405?{Allow:'POST'}:{})}});
  if(request.method!=='POST')return reply(405,{code:'EVENT_METHOD',error:'Solo se admite POST.'});
  if(enabled!==true)return reply(503,{code:'EVENT_DISABLED',error:'La recepción automática está desactivada.'});
  if(!configured)return reply(503,{code:'EVENT_CONFIG',error:'La recepción de eventos todavía no está configurada.'});
  if(!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('content-type')||''))return reply(415,{code:'EVENT_TYPE',error:'Se requiere application/json.'});
  try{
   const at=typeof now==='function'?now():now;if(!Number.isFinite(at))throw new EventError(503,'EVENT_CONFIG','No se pudo comprobar la hora del servidor.');
   const header=request.headers.get('X-OFMAPI-Signature'),signed=signature(header,at),body=await readBody(request,timeout),verifiedAt=typeof now==='function'?now():now;
   if(!Number.isFinite(verifiedAt))throw new EventError(503,'EVENT_CONFIG','No se pudo comprobar la hora del servidor.');
   signature(header,verifiedAt);
   const prefix=encoder.encode(signed.stamp+'.'),input=new Uint8Array(prefix.length+body.length);input.set(prefix);input.set(body,prefix.length);
   // Every configured key is verified, without early success or string equality.
   const checks=await Promise.all(secrets.map(async value=>{const key=await crypto.subtle.importKey('raw',encoder.encode(value),{name:'HMAC',hash:'SHA-256'},false,['verify']);return crypto.subtle.verify('HMAC',key,signed.bytes,input)}));
   if(checks.reduce((result,valid)=>result|Number(valid),0)!==1)throw signatureError();
   let raw;try{raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body))}catch{throw invalid()}
   const event=envelope(raw,verifiedAt);if(!event)return reply(200,{accepted:false,queued:false});
   if(request.signal.aborted)throw new EventError(408,'EVENT_TIMEOUT','La recepción se ha cancelado.');
   let result;try{result=await enqueue(event)}catch{throw new EventError(503,'EVENT_QUEUE','No se pudo confirmar la recepción. El proveedor puede reintentar.');}
   if(!record(result)||typeof result.accepted!=='boolean'||typeof result.queued!=='boolean'||!result.accepted&&result.queued)throw new EventError(503,'EVENT_QUEUE','No se pudo confirmar la recepción. El proveedor puede reintentar.');
   return reply(result.accepted&&result.queued?202:200,{accepted:result.accepted,queued:result.queued});
  }catch(error){const safe=error instanceof EventError?error:new EventError(503,'EVENT_UNAVAILABLE','No se pudo verificar o registrar el evento.');return reply(safe.status,{code:safe.code,error:safe.message})}
 };
}
