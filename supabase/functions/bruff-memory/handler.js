import {createTursoMemoryStore} from './turso-store.js';
import {extractScriptProgress} from './progress.js';
import {createCatalogRecommendation} from './recommendation.js';
import {createCommerceStore} from './commerce-store.js';
import {extractPaidUnlockEvidence,reconcilePurchaseEvents,validatePlanInput,normalizeCommerceEvidence} from './commerce.js';
import {createFanMemoryStore} from './fan-memory-store.js';
import {createFanContext,syncFanContext,editFanContext} from './fan-context.js';

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
export function createMemoryHandler({url,anonKey,tursoUrl,tursoToken,catalogBatch,enabled=false,fetcher=fetch,store:injectedStore,commerceStore:injectedCommerce,fanMemoryStore:injectedFanMemory,timeoutMs=30000,now=()=>Date.now()}={}){
 let base;try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&['','/'].includes(u.pathname))base=u.origin}catch{}
 let store=injectedStore;try{if(!store&&enabled)store=createTursoMemoryStore({url:tursoUrl,token:tursoToken,fetcher})}catch{/* Configuration errors stay generic and never expose a credential. */}
 let commerceStore=injectedCommerce;try{if(!commerceStore&&enabled)commerceStore=createCommerceStore({url:tursoUrl,token:tursoToken,fetcher})}catch{/* Read-only rollout may expose a separately unavailable commerce section. */}
 let fanMemoryStore=injectedFanMemory;try{if(!fanMemoryStore&&enabled)fanMemoryStore=createFanMemoryStore({url:tursoUrl,token:tursoToken,fetcher})}catch{/* Fan context is independent of the catalog batch. */}
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
   let input;try{input=await json(request,65536,signal)}catch(e){if(e.code==='MEMORY_SIZE')throw e;throw error(400,'MEMORY_INPUT','La consulta no contiene JSON válido.')}
   if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['operation','workspace_id','creator_id','conversation_id','scan','folder_id','media_id','proposal_id','plan','edit'].includes(k))||!['read','sync','recommend','verify_recommendation','save_plan','fan_memory_read','fan_memory_sync','fan_memory_edit'].includes(input.operation)||![input.workspace_id,input.creator_id].every(uuid)||typeof input.conversation_id!=='string'||!(/^[1-9]\d{0,23}$/u).test(input.conversation_id)||input.scan!==undefined&&(!['sync','fan_memory_sync'].includes(input.operation)||!['recent','older'].includes(input.scan))||input.operation==='save_plan'&&(!input.plan||typeof input.plan!=='object'||Array.isArray(input.plan))||input.operation!=='save_plan'&&input.plan!==undefined||input.operation==='fan_memory_edit'&&(!input.edit||typeof input.edit!=='object'||Array.isArray(input.edit))||input.operation!=='fan_memory_edit'&&input.edit!==undefined)throw error(400,'MEMORY_INPUT','Revisa la modelo y el fan seleccionados.');
   const recommending=['recommend','verify_recommendation'].includes(input.operation);
   if(input.folder_id!==undefined&&(!recommending||typeof input.folder_id!=='string'||!input.folder_id||input.folder_id!==input.folder_id.trim()||input.folder_id.length>256||/[\u0000-\u001f\u007f]/u.test(input.folder_id))||input.media_id!==undefined&&(!recommending||input.folder_id===undefined||typeof input.media_id!=='string'||!(/^[1-9]\d{0,23}$/u).test(input.media_id))||input.operation==='verify_recommendation'&&!hash(input.proposal_id)||input.proposal_id!==undefined&&input.operation!=='verify_recommendation')throw error(400,'MEMORY_INPUT','Revisa la selección del catálogo.');
   const user=await call('/auth/v1/user');
   if(!uuid(user?.id)||typeof user.email_confirmed_at!=='string'||!user.email_confirmed_at||user.is_anonymous===true)throw error(401,'MEMORY_AUTH','Se requiere una cuenta con correo confirmado.');
   const actorId=user.id.toLowerCase(),workspaceId=input.workspace_id.toLowerCase(),creatorId=input.creator_id.toLowerCase(),fanId=input.conversation_id;
   const authorize=async()=>{const binding=await call('/rest/v1/rpc/bruff_live_authorize',{w:workspaceId,c:creatorId,p:'read'});if(typeof binding!=='string'||!/^acct_[A-Za-z0-9_-]{1,150}$/u.test(binding))throw access();return binding};
   const binding=await authorize();
   if(input.operation.startsWith('fan_memory_')){
    if(!enabled||!fanMemoryStore)throw error(503,'MEMORY_CONTEXT_CONFIG','La memoria contextual todavía no está conectada.');
    const resolve=async()=>{const value=await call('/rest/v1/rpc/bruff_fan_memory_scope',{w:workspaceId,c:creatorId});if(value?.actorId!==actorId||value.workspaceId!==workspaceId||value.creatorId!==creatorId||value.binding!==binding||!uuid(value.ownerId))throw access();return value};
    const resolved=await resolve(),scope={ownerId:resolved.ownerId,actorId,workspaceId,creatorId,binding,fanId};
    const check=async()=>{if(await authorize()!==binding||(await resolve()).ownerId!==scope.ownerId)throw access();signal.throwIfAborted()};
    const ownerCheck=async()=>{if(actorId!==scope.ownerId)throw access();const value=await call('/rest/v1/rpc/bruff_ai_models',{w:workspaceId});if(value?.actorId!==actorId||!Array.isArray(value.workspaces)||!value.workspaces.some(item=>item?.id===workspaceId&&Array.isArray(item.models)&&item.models.some(model=>model?.id===creatorId)))throw access()};
    let record=await fanMemoryStore.read(scope,signal);
    if(input.operation==='fan_memory_edit'){
     const next=editFanContext(scope,record,input.edit);await check();await ownerCheck();await check();record=await fanMemoryStore.write(scope,record.memory.version,next,signal);await check();await ownerCheck();
    }else if(input.operation==='fan_memory_sync'){
     const older=input.scan==='older'&&record.scan.pages>0;
     if(!older||!record.scan.historyComplete&&!record.scan.contextLimited){
      const cursor=older?record.scan.cursor:null;if(older&&!cursor)throw error(409,'MEMORY_SCAN','Actualiza los mensajes recientes antes de ampliar la memoria.');
      const data=page(await call('/functions/v1/bruff-live',{workspace_id:workspaceId,creator_id:creatorId,operation:'messages',conversation_id:fanId,background:true,...(cursor?{cursor}:{})},2*1024*1024));
      const next=await syncFanContext(scope,record,data,{scan:older?'older':'recent',now:now()});await check();record=await fanMemoryStore.write(scope,record.memory.version,next,signal);
     }
    }
    await check();const value=await createFanContext(scope,record,{actorId});signal.throwIfAborted();return reply(200,value);
   }
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
   const commerceUnavailable=()=>error(503,'MEMORY_COMMERCE','Compras y orden temporalmente no disponibles');
   const ownerCheck=async()=>{
    if(actorId!==catalog.ownerId)throw access();
    const models=await call('/rest/v1/rpc/bruff_ai_models',{w:workspaceId});
    if(models?.actorId!==actorId||!Array.isArray(models.workspaces)||!models.workspaces.some(item=>item?.id===workspaceId&&Array.isArray(item.models)&&item.models.some(model=>model?.id===creatorId)))throw access();
   };
   if(input.operation==='save_plan'){
    const value=validatePlanInput(catalog,input.plan);if(!commerceStore)throw commerceUnavailable();
    await check();await ownerCheck();await check();signal.throwIfAborted();
    await commerceStore.savePlan(scope,input.plan.expectedVersion,value,signal);
    await check();await ownerCheck();await check();
   }
   let progress=await store.readProgress(scope,signal);
   let commerceError;
   if(input.operation==='sync'||recommending){
    const older=input.scan==='older'&&progress.scan.version>0;
    if(!older||!progress.scan.historyComplete){
     const cursor=older?progress.scan.cursor:null;
     if(older&&!cursor)throw error(409,'MEMORY_SCAN','Vuelve a consultar los mensajes recientes antes de ampliar el historial.');
     const data=page(await call('/functions/v1/bruff-live',{workspace_id:workspaceId,creator_id:creatorId,operation:'messages',conversation_id:fanId,background:true,...(cursor?{cursor}:{})},2*1024*1024));
     if(data.hasMore&&data.cursor===cursor)throw error(409,'MEMORY_CURSOR','La fuente ha repetido la página. El avance anterior se conserva.');
     const observations=extractScriptProgress({catalog,messages:data.messages});
     const openedEvidence=extractPaidUnlockEvidence({catalog,messages:data.messages});
     await check();signal.throwIfAborted();
     // An atomic observation insert completes before its pagination checkpoint.
     // A failed/CAS-conflicting checkpoint can safely be retried: facts dedupe.
     await store.writeObservations(scope,observations,signal);
     await check();
     // The opened contract needs the raw page's explicit non-tip flag. Persist
     // it before consuming an older cursor, so an outage cannot lose that proof.
     if(openedEvidence.length)try{
      if(!commerceStore)throw commerceUnavailable();
      await commerceStore.writeEvidence(scope,openedEvidence,signal);await check();
     }catch(e){
      if(signal.aborted||[401,403].includes(e.status))throw e;
      if(recommending)throw commerceUnavailable();
      commerceError='Compras y orden temporalmente no disponibles';
     }
     const at=new Date(now()).toISOString(),prior=progress.scan,initial=prior.version===0;
     const next={cursor:older||initial?data.hasMore?data.cursor:null:prior.cursor,historyComplete:older||initial?!data.hasMore:prior.historyComplete,recentCheckedAt:older?prior.recentCheckedAt:at,historyCheckedAt:older||initial?at:prior.historyCheckedAt,pages:older?prior.pages+1:initial?1:prior.pages};
     if(!commerceError)await store.saveScan(scope,prior.version,next,signal);
     progress=await store.readProgress(scope,signal);
    }
   }
   let commerce;
   try{
    if(!commerceStore||commerceError)throw commerceUnavailable();
    const plans=await commerceStore.readPlans(scope,signal);
    if(input.operation==='sync'||recommending){
     const events=await commerceStore.readEvents(scope,signal),records=reconcilePurchaseEvents({observations:progress.observations,events,fanId});
     if(records.length){await check();signal.throwIfAborted();await commerceStore.writeEvidence(scope,records,signal);await check()}
    }
    const records=await commerceStore.readEvidence(scope,signal);
    if(!Array.isArray(plans)||plans.length>100||!Array.isArray(records)||records.length>5000)throw commerceUnavailable();
    commerce={plans:plans.map(plan=>{
     if(!Number.isSafeInteger(plan?.version)||plan.version<1||!hash(plan.planHash)||typeof plan.approvedAt!=='string'||!Number.isFinite(Date.parse(plan.approvedAt))||plan.binding!==binding)throw commerceUnavailable();
     const value=validatePlanInput(catalog,{folderId:plan.folderId,expectedVersion:plan.version-1,steps:plan.steps,confirmed:true});
     return {folderId:value.folderId,version:plan.version,planHash:plan.planHash,approvedAt:plan.approvedAt,steps:value.steps};
    }),evidence:records.map(row=>{if(!hash(row?.id)||typeof row.observedAt!=='string'||!Number.isFinite(Date.parse(row.observedAt)))throw commerceUnavailable();return{id:row.id,...normalizeCommerceEvidence(row),observedAt:row.observedAt}}),refundStatus:'unknown'};
   }catch(e){
    if(signal.aborted||[401,403].includes(e.status))throw e;
    if(recommending||input.operation==='save_plan')throw commerceUnavailable();
    commerceError='Compras y orden temporalmente no disponibles';
   }
   let proposal;
   if(recommending){
    proposal=await createCatalogRecommendation({catalog,observations:progress.observations,commerce,scope,folderId:input.folder_id,mediaId:input.media_id});
    if(input.operation==='verify_recommendation'&&proposal?.id!==input.proposal_id)throw error(409,'MEMORY_PROPOSAL_CHANGED','La propuesta o el seguimiento han cambiado. Revisa una nueva propuesta antes de preparar el contenido.');
   }
   await check();signal.throwIfAborted();
   return reply(200,{actorId,workspaceId,creatorId,fanId,catalog,progress,observedAt:new Date(now()).toISOString(),sendsEnabled:false,...(commerce?{commerce}:{}),...(commerceError?{commerceError}:{}),...(recommending?{proposal}:{})});
  }catch(e){
   if(signal.aborted)return reply(request.signal.aborted?408:504,{code:'MEMORY_CANCELLED',error:'La consulta se canceló o superó el tiempo permitido. No se ha enviado nada.'});
   const status=e.code==='MEMORY_CONFLICT'?409:e.code==='MEMORY_CONFIG'?503:e.code==='MEMORY_STORE'?503:e.status||503;
   return reply([400,401,403,409,413,415,429,503].includes(status)?status:503,{code:typeof e.code==='string'&&/^MEMORY_[A-Z_]+$/u.test(e.code)?e.code:'MEMORY_UNAVAILABLE',error:e.code==='MEMORY_CONFLICT'?'Otra sesión actualizó el seguimiento. Vuelve a consultarlo.':e.code==='MEMORY_STORE'?'No se pudo comprobar la memoria en la nube. Se conserva el avance anterior.':e.status?e.message:'No se pudo comprobar el catálogo o su seguimiento. No se ha preparado ningún envío.'},e.retryAfter?{'Retry-After':String(e.retryAfter)}:{});
  }
 };
}
