import {createTursoMemoryStore} from './turso-store.js';
import {extractScriptProgress} from './progress.js';

const origins=['https://bruff-workspace.pages.dev','https://chatting-iabot-raul.infinitybruff.chatgpt.site'];
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const error=(status,code,message)=>Object.assign(Error(message),{status,code});
const unavailable=()=>error(503,'MEMORY_UNAVAILABLE','No se pudo comprobar la memoria en la nube. Se conserva el seguimiento guardado.');
const access=()=>error(403,'MEMORY_ACCESS','La sesión o los permisos ya no permiten consultar esta modelo.');
async function json(response,limit,signal){
 const reader=response.body?.getReader();if(!reader)throw unavailable();let size=0,text='';const decoder=new TextDecoder('utf-8',{fatal:true});
 const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true});
 try{signal.throwIfAborted();while(true){const part=await reader.read();signal.throwIfAborted();if(part.done)break;size+=part.value.byteLength;if(size>limit){cancel();throw error(413,'MEMORY_SIZE','La consulta supera el tamaño permitido.')}text+=decoder.decode(part.value,{stream:true})}return JSON.parse(text+decoder.decode())}
 catch(e){signal.throwIfAborted();if(e.code==='MEMORY_SIZE')throw e;throw unavailable()}
 finally{signal.removeEventListener('abort',cancel);reader.releaseLock()}
}
const username=x=>typeof x==='string'&&/^[A-Za-z0-9_.-]{1,100}$/u.test(x.replace(/^@/u,''))?x.replace(/^@/u,'').toLowerCase():null;
function page(value){
 const d=value?.data;
 if(!d||!Array.isArray(d.messages)||d.messages.length>200||typeof d.hasMore!=='boolean'||d.cursor!==null&&(typeof d.cursor!=='string'||!d.cursor||d.cursor.length>2048)||d.hasMore&&!d.cursor)throw unavailable();
 return d;
}

// This gateway has no provider write credential, AI client or send operation.
// Turso stores only server-read message/media metadata, never conversation text.
export function createMemoryHandler({url,anonKey,tursoUrl,tursoToken,catalogBatch,enabled=false,fetcher=fetch,store:injectedStore,timeoutMs=30000,now=()=>Date.now()}={}){
 let base;try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&['','/'].includes(u.pathname))base=u.origin}catch{}
 let store=injectedStore;try{if(!store&&enabled)store=createTursoMemoryStore({url:tursoUrl,token:tursoToken,fetcher})}catch{/* Configuration errors stay generic and never expose a credential. */}
 const profileCache=new Map();
 return async request=>{
  const origin=request.headers.get('Origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origins.includes(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'Retry-After'}:{})};
  const reply=(status,value,extra={})=>new Response(value===undefined?null:JSON.stringify(value),{status,headers:{...headers,...extra}});
  if(origin&&!origins.includes(origin))return reply(403,{code:'MEMORY_ORIGIN',error:'Origen no permitido.'});
  if(request.method==='OPTIONS')return reply(204);
  if(request.method!=='POST')return reply(405,{code:'MEMORY_METHOD',error:'Usa la consulta de memoria de BRUFF.'},{Allow:'POST, OPTIONS'});
  const authorization=request.headers.get('Authorization')||'';
  if(!/^Bearer [^\s,]+$/iu.test(authorization))return reply(401,{code:'MEMORY_AUTH',error:'Vuelve a iniciar sesión.'});
  if(!base||!anonKey)return reply(503,{code:'MEMORY_CONFIG',error:'La memoria todavía no está configurada.'});
  const signal=AbortSignal.any([request.signal,AbortSignal.timeout(Math.max(1,Math.min(30000,timeoutMs)))]),authHeaders={apikey:anonKey,Authorization:authorization,'Content-Type':'application/json'};
  const call=async(path,body,limit=65536)=>{
   signal.throwIfAborted();const r=await fetcher(base+path,{method:body===undefined?'GET':'POST',headers:authHeaders,redirect:'error',signal,...(body===undefined?{}:{body:JSON.stringify(body)})});signal.throwIfAborted();
   if(!r.ok){
    if([401,403].includes(r.status))throw access();
    if(r.status===429){const e=error(429,'MEMORY_LIMIT','El proveedor ha limitado las lecturas. Espera antes de actualizar.');e.retryAfter=Math.min(86400,Math.max(1,Number(r.headers.get('Retry-After'))||60));throw e}
    const detail=await json(r,65536,signal);if(detail?.code==='42501')throw access();throw unavailable();
   }
   return json(r,limit,signal);
  };
  try{
   if(!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('Content-Type')||''))throw error(415,'MEMORY_TYPE','Se requiere JSON.');
   let input;try{input=await json(request,2048,signal)}catch(e){if(e.code==='MEMORY_SIZE')throw e;throw error(400,'MEMORY_INPUT','La consulta no contiene JSON válido.')}
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['operation','workspace_id','creator_id','conversation_id','scan'].includes(k))||!['read','sync'].includes(input.operation)||![input.workspace_id,input.creator_id].every(uuid)||typeof input.conversation_id!=='string'||!(/^[1-9]\d{0,23}$/u).test(input.conversation_id)||input.scan!==undefined&&(input.operation!=='sync'||!['recent','older'].includes(input.scan)))throw error(400,'MEMORY_INPUT','Revisa la modelo y el fan seleccionados.');
   const user=await call('/auth/v1/user');
   if(!uuid(user?.id)||typeof user.email_confirmed_at!=='string'||!user.email_confirmed_at||user.is_anonymous===true)throw error(401,'MEMORY_AUTH','Se requiere una cuenta con correo confirmado.');
   const actorId=user.id.toLowerCase(),workspaceId=input.workspace_id.toLowerCase(),creatorId=input.creator_id.toLowerCase(),fanId=input.conversation_id;
   const authorize=async()=>{const binding=await call('/rest/v1/rpc/bruff_live_authorize',{w:workspaceId,c:creatorId,p:'read'});if(typeof binding!=='string'||!/^acct_[A-Za-z0-9_-]{1,150}$/u.test(binding))throw access();return binding};
   const binding=await authorize();
   if(!enabled||!store||!hash(catalogBatch))throw error(503,'MEMORY_CONFIG','El catálogo y el seguimiento aún no están conectados en el servidor.');
   const catalog=await store.readCatalog({workspaceId,creatorId,batchHash:catalogBatch},signal);
   if(!catalog||catalog.workspaceId!==workspaceId||catalog.creatorId!==creatorId||catalog.batchHash!==catalogBatch||!uuid(catalog.ownerId)||!username(catalog.sourceUsername))throw error(409,'MEMORY_CATALOG','El catálogo no corresponde a la modelo conectada. El propietario debe revisar su vinculación.');
   const check=async()=>{if(await authorize()!==binding)throw access()};
   // Validate the live account against the reviewed catalog on each connection.
   // This cache never stores authorization, fan IDs or transcript data.
   const profileKey=JSON.stringify([workspaceId,creatorId,binding,catalogBatch,username(catalog.sourceUsername)]),checked=profileCache.get(profileKey);
   if(!Number.isFinite(checked)||now()-checked>=120000||now()<checked){
    const profile=await call('/functions/v1/bruff-live',{workspace_id:workspaceId,creator_id:creatorId,operation:'profile'});
    if(username(profile?.data?.username)!==username(catalog.sourceUsername))throw error(409,'MEMORY_BINDING','La cuenta actual no coincide con el catálogo revisado. No se mezclará su seguimiento.');
    await check();profileCache.delete(profileKey);profileCache.set(profileKey,now());while(profileCache.size>32)profileCache.delete(profileCache.keys().next().value);
   }
   const scope={ownerId:catalog.ownerId,workspaceId,creatorId,binding,fanId,batchHash:catalogBatch,actorId};
   let progress=await store.readProgress(scope,signal);
   if(input.operation==='sync'){
    const older=input.scan==='older'&&progress.scan.version>0;
    if(!older||!progress.scan.historyComplete){
     const cursor=older?progress.scan.cursor:null;
     if(older&&!cursor)throw error(409,'MEMORY_SCAN','Vuelve a consultar los mensajes recientes antes de ampliar el historial.');
     const data=page(await call('/functions/v1/bruff-live',{workspace_id:workspaceId,creator_id:creatorId,operation:'messages',conversation_id:fanId,background:true,...(cursor?{cursor}:{})},2*1024*1024));
     if(data.hasMore&&data.cursor===cursor)throw error(409,'MEMORY_CURSOR','La fuente ha repetido la página. El avance anterior se conserva.');
     const observations=extractScriptProgress({catalog,messages:data.messages});
     await check();signal.throwIfAborted();
     // An atomic observation insert completes before its pagination checkpoint.
     // A failed/CAS-conflicting checkpoint can safely be retried: facts dedupe.
     await store.writeObservations(scope,observations,signal);
     await check();
     const at=new Date(now()).toISOString(),prior=progress.scan,initial=prior.version===0;
     const next={cursor:older||initial?data.hasMore?data.cursor:null:prior.cursor,historyComplete:older||initial?!data.hasMore:prior.historyComplete,recentCheckedAt:older?prior.recentCheckedAt:at,historyCheckedAt:older||initial?at:prior.historyCheckedAt,pages:older?prior.pages+1:initial?1:prior.pages};
     await store.saveScan(scope,prior.version,next,signal);
     progress=await store.readProgress(scope,signal);
    }
   }
   await check();signal.throwIfAborted();
   return reply(200,{actorId,workspaceId,creatorId,fanId,catalog,progress,observedAt:new Date(now()).toISOString(),sendsEnabled:false});
  }catch(e){
   if(signal.aborted)return reply(request.signal.aborted?408:504,{code:'MEMORY_CANCELLED',error:'La consulta se canceló o superó el tiempo permitido. No se ha enviado nada.'});
   const status=e.code==='MEMORY_CONFLICT'?409:e.code==='MEMORY_CONFIG'?503:e.code==='MEMORY_STORE'?503:e.status||503;
   return reply([400,401,403,409,413,415,429,503].includes(status)?status:503,{code:typeof e.code==='string'&&/^MEMORY_[A-Z_]+$/u.test(e.code)?e.code:'MEMORY_UNAVAILABLE',error:e.code==='MEMORY_CONFLICT'?'Otra sesión actualizó el seguimiento. Vuelve a consultarlo.':e.code==='MEMORY_STORE'?'No se pudo comprobar la memoria en la nube. Se conserva el avance anterior.':e.status?e.message:'No se pudo comprobar el catálogo o su seguimiento. No se ha preparado ningún envío.'},e.retryAfter?{'Retry-After':String(e.retryAfter)}:{});
  }
 };
}
