import {GENERATION_MODEL,OUTPUT_TOKENS,OUTPUT_SCHEMA,GenerationFailure,validatedPool,historySnapshot,buildGenerationContext,generationContextHash,generationMemoryMetadata,validatedFanMemory,buildPrompt,validateGeneratedOutput} from './generation.js';
import {ENGINE_VERSION,providerUsage,reservedUsage,validUsage,validQuota} from './usage.js';
const defaults=['https://bruff-workspace.pages.dev','https://chatting-iabot-raul.infinitybruff.chatgpt.site'];
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(x);
const fail=(status,code,message)=>new GenerationFailure(code,message,status);
const stale=()=>fail(409,'AI_CONTEXT_CHANGED','La conversación, el acceso o las fuentes cambiaron. Genera de nuevo antes de insertar.');
const unavailable=()=>fail(503,'AI_UNAVAILABLE','No se pudo comprobar el motor. No se ha preparado ningún envío.');
const providerUnavailable=()=>fail(503,'AI_PROVIDER','El proveedor de IA no está disponible en este momento. Vuelve a intentarlo más tarde.');
const retryAfter=r=>{const n=Number(r.headers.get('Retry-After'));return Number.isSafeInteger(n)&&n>0&&n<=86400?n:60};
async function json(response,limit,signal){
 const reader=response.body?.getReader();if(!reader)throw unavailable();
 let raw='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true}),cancel=()=>{void reader.cancel().catch(()=>{})};
 signal.addEventListener('abort',cancel,{once:true});
 try{signal.throwIfAborted();while(true){const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;size+=value.byteLength;if(size>limit){cancel();throw fail(413,'AI_SIZE','La consulta supera el tamaño permitido.')}raw+=decoder.decode(value,{stream:true})}return JSON.parse(raw+decoder.decode())}
 catch(e){signal.throwIfAborted();if(e instanceof GenerationFailure)throw e;throw unavailable()}
 finally{signal.removeEventListener('abort',cancel);reader.releaseLock()}
}
function canonical(data,{actor,w,c,fan,requestId,revision,hash},{cached=false}={}){
 if(data?.aiGenerated!==true||data.aiVerified!==false||!uuid(data.generationId)||!cached&&data.generationId!==requestId||data.actorId!==actor||data.workspaceId!==w||data.creatorId!==c||data.fanId!==fan||data.revision!==revision||data.contextHash!==hash||data.engineVersion!==ENGINE_VERSION||!validUsage(data.usage)||typeof data.expiresAt!=='string'||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now()||!Array.isArray(data.drafts)||data.drafts.length>3||!Array.isArray(data.unknowns)||data.unknowns.length>5||data.unknowns.some(x=>typeof x!=='string'||!x.trim()||x.length>160))throw stale();
 const ids=new Set();
 for(const d of data.drafts){if(!['1','2','3'].includes(d.id)||ids.has(d.id)||typeof d.english!=='string'||!d.english.trim()||d.english.length>700||typeof d.spanish!=='string'||!d.spanish.trim()||d.spanish.length>1000||!Array.isArray(d.exampleIds)||!d.exampleIds.length||d.exampleIds.some(x=>!uuid(x))||!Array.isArray(d.knowledgeIds)||d.knowledgeIds.some(x=>!uuid(x)))throw stale();ids.add(d.id)}
 return data;
}
export function createDraftsHandler({url,anonKey,serviceKey,cloudflareAccountId,cloudflareToken,freeTierConfirmed=false,fanMemoryEnabled=false,fetcher=fetch,origins=defaults,timeoutMs=30000,onConfigFailure=record=>console.error(JSON.stringify(record))}={}){
 let base;try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&['','/'].includes(u.pathname))base=u.origin}catch{}
 const usable=value=>typeof value==='string'&&!!value&&!/[\s,]/u.test(value),accountValid=value=>typeof value==='string'&&/^[a-f0-9]{32}$/u.test(value);
 const credentialStatus=value=>({rawPresent:value!==undefined&&value!==null,isString:typeof value==='string',usableRaw:usable(value),usableAfterTrim:typeof value==='string'&&usable(value.trim())});
 const configuration={serviceKey:credentialStatus(serviceKey),cloudflareToken:credentialStatus(cloudflareToken),cloudflareAccount:{rawPresent:cloudflareAccountId!==undefined&&cloudflareAccountId!==null,isString:typeof cloudflareAccountId==='string',validRaw:accountValid(cloudflareAccountId),validAfterTrim:typeof cloudflareAccountId==='string'&&accountValid(cloudflareAccountId.trim())},freeTierConfirmed:freeTierConfirmed===true};
 // Only the Cloudflare token accepts external paste whitespace. Internal
 // whitespace, commas, empty tokens and every other credential stay rejected.
 // Diagnostics still describe the original input using booleans only.
 const providerToken=typeof cloudflareToken==='string'?cloudflareToken.trim():cloudflareToken;
 const configured=configuration.serviceKey.usableRaw&&configuration.cloudflareAccount.validRaw&&usable(providerToken)&&configuration.freeTierConfirmed;
 return async request=>{
  const origin=request.headers.get('Origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origins.includes(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Access-Control-Expose-Headers':'Retry-After'}:{})};
  const reply=(status,value,extra={})=>new Response(value===undefined?null:JSON.stringify(value),{status,headers:{...headers,...extra}});
  if(origin&&!origins.includes(origin))return reply(403,{code:'AI_ORIGIN',error:'Origen no permitido.'});
  if(request.method==='OPTIONS')return reply(204);
  if(request.method!=='POST')return reply(405,{code:'AI_METHOD',error:'Usa una consulta manual desde BRUFF.'},{Allow:'POST, OPTIONS'});
  const authorization=request.headers.get('Authorization')||'';
  if(!/^Bearer [^\s,]+$/iu.test(authorization))return reply(401,{code:'AI_AUTH',error:'Vuelve a iniciar sesión.'});
  if(!base||!anonKey)return reply(503,{code:'AI_CONFIG',error:'El servicio todavía no está configurado.'});
  const timeout=Number.isSafeInteger(timeoutMs)?Math.max(1,Math.min(30000,timeoutMs)):30000,signal=AbortSignal.any([request.signal,AbortSignal.timeout(timeout)]);
  const authHeaders={apikey:anonKey,Authorization:authorization,'Content-Type':'application/json'};
  const call=async(path,body,service=false,callSignal=signal)=>{
   callSignal.throwIfAborted();
   const response=await fetcher(base+path,{method:body===undefined?'GET':'POST',headers:service?{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'}:authHeaders,redirect:'error',signal:callSignal,...(body===undefined?{}:{body:JSON.stringify(body)})});callSignal.throwIfAborted();
   if(!response.ok){
    if(response.status===429){const e=fail(429,'AI_LIMIT','Se ha alcanzado un límite temporal. Espera antes de volver a consultar.');e.retryAfter=retryAfter(response);throw e}
    if([401,403].includes(response.status))throw fail(response.status,'AI_ACCESS','La sesión o los permisos ya no permiten esta consulta.');
    if(response.status===409)throw stale();
    // PostgREST encodes CAS exceptions in JSON even when HTTP is 400.
    const error=await json(response,65536,callSignal);if(error?.code==='40001')throw stale();if(error?.code==='42501')throw fail(403,'AI_ACCESS','Acceso no permitido.');throw unavailable();
   }
   return json(response,path==='/auth/v1/user'?65536:2*1024*1024,callSignal);
  };
  let reservation=null,settlementAttempted=false,readQuota=null;
  const settle=async(usage,cleanup=false)=>{
   if(!reservation||settlementAttempted)return;
   settlementAttempted=true;
   // Cleanup has its own short deadline and can only attest accounting for the
   // existing reservation. It cannot read history, infer, or prepare a message.
   const cleanupSignal=cleanup?AbortSignal.timeout(2000):signal;
   const {actor,w,c,requestId}=reservation;
   const result=await call('/rest/v1/rpc/bruff_generation_usage',{w,c,request_id:requestId,actor,input_tokens:usage.promptTokens,output_tokens:usage.completionTokens},true,cleanupSignal);
   if(result?.actorId!==actor||result.workspaceId!==w||result.creatorId!==c||result.generationId!==requestId||result.engineVersion!==ENGINE_VERSION||!validUsage(result.usage)||result.usage.status!==usage.status||result.usage.promptTokens!==usage.promptTokens||result.usage.completionTokens!==usage.completionTokens)throw unavailable();
  };
  try{
   if(!/^application\/json(?:\s*;|$)/iu.test(request.headers.get('Content-Type')||''))throw fail(415,'AI_TYPE','Se requiere JSON.');
   let input;try{input=await json(request,4096,signal)}catch(error){if(error.status===413)throw error;signal.throwIfAborted();throw fail(400,'AI_INPUT','La consulta no contiene JSON válido.')}
   if(!input||Object.keys(input).some(k=>!['operation','workspace_id','creator_id','conversation_id','request_id','force'].includes(k))||!['generate','verify'].includes(input.operation)||Object.hasOwn(input,'force')&&(input.operation!=='generate'||typeof input.force!=='boolean')||![input.workspace_id,input.creator_id,input.request_id].every(uuid)||typeof input.conversation_id!=='string'||!/^\d{1,24}$/u.test(input.conversation_id))throw fail(400,'AI_INPUT','Revisa la modelo y la conversación seleccionadas.');
   const w=input.workspace_id.toLowerCase(),c=input.creator_id.toLowerCase(),requestId=input.request_id.toLowerCase(),fan=input.conversation_id;
   const user=await call('/auth/v1/user');
   if(!uuid(user?.id)||typeof user.email_confirmed_at!=='string'||!user.email_confirmed_at||user.is_anonymous===true)throw fail(401,'AI_AUTH','Se requiere una cuenta con correo confirmado.');
   const actor=user.id.toLowerCase(),scope={actor,w,c},rpc=(name,value)=>call('/rest/v1/rpc/'+name,value);
   readQuota=async()=>{
    const result=await rpc('bruff_generation_quota',{w,c});
    if(result?.actorId!==actor||result.workspaceId!==w||result.creatorId!==c||!validQuota(result.quota))throw unavailable();
    return result.quota;
   };
   const pool=validatedPool(await rpc('bruff_generation_pool',{w,c}),scope);
   if(pool.settings.enabled!==true)throw fail(409,'AI_DISABLED','La generación manual está desactivada para esta modelo.');
   if(!pool.examples.length)throw fail(409,'AI_SOURCES','Aprueba al menos un ejemplo de esta modelo antes de consultar la IA.');
   if(input.operation==='generate'&&!configured){try{onConfigFailure?.({event:'bruff_drafts_configuration',stage:'authenticated_generate',requirements:configuration})}catch{/* Diagnostics must never change authentication or the response. */}throw fail(503,'AI_CONFIG','Falta configurar el motor y confirmar el plan gratuito.')}
   const load=async()=>{const history=historySnapshot(await call('/functions/v1/bruff-live',{workspace_id:w,creator_id:c,operation:'messages',conversation_id:fan,background:true})),memory=fanMemoryEnabled?validatedFanMemory(await call('/functions/v1/bruff-memory',{operation:'fan_memory_read',workspace_id:w,creator_id:c,conversation_id:fan}),{actor,w,c,fan}):null;return buildGenerationContext(history,memory)};
   const context=await load(),hash=await generationContextHash(context),identity={actor,w,c,fan,requestId,revision:pool.revision,hash};
   const prompt=buildPrompt(pool,context);
   const recheck=async()=>{const fresh=validatedPool(await rpc('bruff_generation_pool',{w,c}),scope);if(fresh.revision!==pool.revision||await generationContextHash(await load())!==hash)throw stale()};
   if(input.operation==='verify'){
    const result=canonical(await rpc('bruff_generation_result',{w,c,request_id:requestId,fan}),identity);
    await recheck();
    return reply(200,{...result,requestId,engine:'generative',engineInvoked:false,reused:false,approvedCount:pool.approvedCount,valid:true,memoryContext:generationMemoryMetadata(context,prompt),quota:await readQuota()});
   }
   const claim=await rpc('bruff_generation_claim_v2',{w,c,request_id:requestId,fan,revision:pool.revision,context_hash:hash,engine_version:ENGINE_VERSION,force:input.force===true});
   if(claim?.actorId!==actor||claim.workspaceId!==w||claim.creatorId!==c||typeof claim.allowed!=='boolean'||typeof claim.reason!=='string')throw stale();
   if(!claim.allowed&&claim.reason==='cached'){
    const result=canonical(claim.cached,identity,{cached:true});
    await recheck();
    return reply(200,{...result,requestId,engine:'generative',engineInvoked:false,reused:true,approvedCount:pool.approvedCount,valid:true,memoryContext:generationMemoryMetadata(context,prompt),quota:await readQuota()});
   }
   if(!claim.allowed&&claim.reason==='pending'){const error=fail(409,'AI_PENDING','Ya hay una consulta en curso para este contexto. Espera antes de volver a consultarlo.');error.retryAfter=Number.isSafeInteger(claim.retryAfter)&&claim.retryAfter>0&&claim.retryAfter<=86400?claim.retryAfter:2;throw error}
   if(!claim.allowed){if(['model_daily_limit','global_daily_limit','actor_minute_limit'].includes(claim.reason)){const e=fail(429,'AI_LOCAL_LIMIT','Se alcanzó el límite gratuito reservado para los borradores.');e.retryAfter=claim.retryAfter||60;throw e}throw stale()}
   if(claim.reason!=='allowed')throw unavailable();
   reservation=identity;
   let provider;
   try{provider=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+cloudflareAccountId+'/ai/run/'+GENERATION_MODEL,{method:'POST',headers:{Authorization:'Bearer '+providerToken,'Content-Type':'application/json'},body:JSON.stringify({messages:prompt.messages,guided_json:OUTPUT_SCHEMA,max_tokens:OUTPUT_TOKENS,temperature:0.4}),redirect:'error',signal});signal.throwIfAborted()}
   catch{signal.throwIfAborted();throw providerUnavailable()}
   if(!provider.ok){
    if(provider.status===429){const e=fail(429,'AI_PROVIDER_LIMIT','La cuota gratuita o el límite del proveedor se ha agotado.');e.retryAfter=retryAfter(provider);throw e}
    if([401,403].includes(provider.status))throw fail(503,'AI_PROVIDER_AUTH','Cloudflare ha rechazado el token o los permisos de Workers AI. Revisa la configuración del motor.');
    if([400,404].includes(provider.status))throw fail(503,'AI_PROVIDER_REQUEST','Cloudflare ha rechazado la petición del modelo configurado. Revisa el contrato de Workers AI.');
    throw providerUnavailable();
   }
   let answer;try{answer=await json(provider,32768,signal)}catch(error){signal.throwIfAborted();if(error instanceof GenerationFailure&&error.code==='AI_SIZE')throw error;throw providerUnavailable()}
   // Account for observed inference even when the generated prose, references,
   // or later context checks fail. Missing usage keeps the full reservation.
   await settle(providerUsage(answer));
   if(answer?.success!==true)throw providerUnavailable();
   const content=answer.result?.response;
   let raw;
   if(typeof content==='string')try{raw=JSON.parse(content)}catch{throw fail(503,'AI_DRAFT_RESPONSE','La IA no devolvió el formato esperado. No se ha preparado ningún mensaje.')}
   else if(content!==null&&typeof content==='object'&&!Array.isArray(content)&&Object.getPrototypeOf(content)===Object.prototype)raw=content;
   else throw fail(503,'AI_DRAFT_RESPONSE','La IA no devolvió el formato esperado. No se ha preparado ningún mensaje.');
   const payload=validateGeneratedOutput(raw,prompt,pool);
   await recheck();
   // Fixed service routes only attest accounting and a validated result for an
   // existing user reservation. Neither can read sources/history or send.
   const saved=canonical(await call('/rest/v1/rpc/bruff_generation_commit',{w,c,request_id:requestId,actor,payload},true),identity);
   return reply(200,{...saved,requestId,engine:'generative',engineInvoked:true,reused:false,approvedCount:pool.approvedCount,valid:true,memoryContext:generationMemoryMetadata(context,prompt),quota:await readQuota()});
  }catch(error){
   if(reservation&&!settlementAttempted)try{await settle(reservedUsage(),true)}catch{/* Unknown consumption remains conservatively reserved in SQL. */}
   if(signal.aborted)return reply(request.signal.aborted?408:504,{code:'AI_CANCELLED',error:'La consulta se canceló o superó el tiempo permitido. No se ha enviado nada.'});
   const e=error instanceof GenerationFailure?error:unavailable();return reply(e.status,{code:e.code,error:e.message},e.retryAfter?{'Retry-After':String(Math.min(86400,Math.max(1,e.retryAfter)))}:{});
  }
 };
}
