const defaultOrigins=['https://bruff-workspace.pages.dev','https://chatting-iabot-raul.infinitybruff.chatgpt.site'];
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const failure=(status,code,error,extra={})=>Object.assign(new Error(error),{status,code,extra});
const badPool=()=>failure(503,'AI_BANK_UNAVAILABLE','No se pudo verificar el banco de ejemplos. Vuelve a consultarlo.');
const badEngine=()=>failure(503,'AI_ENGINE_RESPONSE','El motor no devolvió una clasificación verificable. Inténtalo de nuevo.');
const stale=()=>failure(409,'AI_CONTEXT_CHANGED','El acceso, la configuración o los ejemplos han cambiado. Consulta de nuevo desde el chat actual.');
const retryAfter=response=>{const seconds=Number(response.headers.get('Retry-After'));return Number.isInteger(seconds)&&seconds>0&&seconds<=86400?seconds:60};

async function boundedText(body,limit,signal){
 if(!body)return '';
 const reader=body.getReader(),parts=[];let bytes=0;
 try{while(true){signal?.throwIfAborted();const {done,value}=await reader.read();signal?.throwIfAborted();if(done)break;bytes+=value.byteLength;if(bytes>limit){await reader.cancel();throw failure(413,'AI_BODY_TOO_LARGE','La solicitud supera el tamaño permitido.')}parts.push(value)}}finally{reader.releaseLock()}
 const joined=new Uint8Array(bytes);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.byteLength}return new TextDecoder('utf-8',{fatal:true}).decode(joined);
}
async function responseJson(response,signal,limit=8*1024*1024,invalid=badPool){
 try{return JSON.parse(await boundedText(response.body,limit,signal))}catch{signal.throwIfAborted();throw invalid()}
}
function sourceRow(row,creator){
 if(!object(row)||!uuid.test(row.id)||typeof row.english!=='string'||!row.english.trim()||row.english.length>10000||typeof row.spanish!=='string'||!row.spanish.trim()||row.spanish.length>10000||!Array.isArray(row.variables)||row.variables.length!==0)throw badPool();
 const source=row.source;
 if(!object(source)||source.kind!=='document'||source.verified!==true||source.modelId!==creator||!identifier(source.referenceId)||!identifier(source.version)||source.version==='0'||typeof source.label!=='string'||!source.label.trim()||source.label.length>200||/[\u0000-\u001f\u007f]/u.test(source.label)||'conversationId'in source||'messageId'in source||row.content!==undefined)throw badPool();
 return {id:row.id,english:row.english,spanish:row.spanish,variables:[],source:{kind:'document',modelId:creator,referenceId:source.referenceId,label:source.label,version:source.version,verified:true}};
}
function sameIdentity(value,actor,workspace,creator){return value?.actorId===actor&&value.workspaceId===workspace&&value.creatorId===creator}
function poolSnapshot(value,actor,workspace,creator){
 if(!sameIdentity(value,actor,workspace,creator))throw failure(403,'AI_ACCESS_CHANGED','No se pudo verificar el acceso al banco de esta modelo.');
 const settings=value.settings;
 if(!object(settings)||!['bank','semantic'].includes(settings.mode)||!Number.isInteger(settings.maxResults)||settings.maxResults<1||settings.maxResults>3||typeof settings.minScore!=='number'||!Number.isFinite(settings.minScore)||settings.minScore<0.5||settings.minScore>0.99||!Number.isInteger(settings.dailyLimit)||settings.dailyLimit<1||settings.dailyLimit>100||!Number.isSafeInteger(value.version)||value.version<0||!Number.isSafeInteger(value.approvedCount)||value.approvedCount<0||value.approvedCount>200||!Array.isArray(value.rows)||value.rows.length>200||value.rows.length>value.approvedCount||settings.mode==='semantic'&&value.rows.length!==value.approvedCount)throw badPool();
 const ids=new Set(),rows=value.rows.map(row=>{
  const candidate=sourceRow(row,creator);
  if(ids.has(candidate.id)||typeof row.trigger!=='string'||!row.trigger.trim()||row.trigger.length>2000)throw badPool();ids.add(candidate.id);
  return {...candidate,trigger:row.trigger};
 });
 return {version:value.version,approvedCount:value.approvedCount,settings:{mode:settings.mode,maxResults:settings.maxResults,minScore:settings.minScore,dailyLimit:settings.dailyLimit},rows};
}
function bankSnapshot(value,actor,workspace,creator,maxResults){
 if(!sameIdentity(value,actor,workspace,creator))throw stale();
 if(!['empty','connected'].includes(value?.status)||!Number.isSafeInteger(value.approvedCount)||value.approvedCount<0||!Array.isArray(value.rows)||value.rows.length>3||value.rows.length>value.approvedCount||value.status==='empty'&&(value.approvedCount!==0||value.rows.length))throw badPool();
 const ids=new Set(),rows=value.rows.map(row=>{const candidate=sourceRow(row,creator);if(ids.has(candidate.id))throw badPool();ids.add(candidate.id);return candidate});
 return {status:value.status,approvedCount:value.approvedCount,rows:rows.slice(0,maxResults)};
}
function rankSnapshot(value,length,minScore,maxResults){
 const rows=value?.result?.response;
 if(value?.success!==true||!Array.isArray(rows)||rows.length>Math.min(3,length))throw badEngine();
 const seen=new Set();for(const row of rows){if(!object(row)||!Number.isInteger(row.id)||row.id<0||row.id>=length||seen.has(row.id)||typeof row.score!=='number'||!Number.isFinite(row.score)||row.score<0||row.score>1)throw badEngine();seen.add(row.id)}
 return rows.filter(row=>row.score>=minScore).sort((a,b)=>b.score-a.score||a.id-b.id).slice(0,maxResults).map(row=>row.id);
}

// This isolated endpoint only ranks approved non-explicit examples. It has no
// service-role key, OnlyFans/OFMAPI credentials, tools, send path or generation.
export function createAiHandler({url,anonKey,cloudflareAccountId,cloudflareToken,freeTierConfirmed=false,fetcher=fetch,origins=defaultOrigins,timeoutMs=20000}={}){
 let authUrl;try{const parsed=new URL(url);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&parsed.pathname==='/')authUrl=parsed.origin}catch{}
 const allowedOrigins=new Set(origins),configured=typeof cloudflareAccountId==='string'&&/^[0-9a-f]{32}$/i.test(cloudflareAccountId)&&typeof cloudflareToken==='string'&&cloudflareToken.length>0&&cloudflareToken.length<=4096&&!/\s/.test(cloudflareToken)&&freeTierConfirmed===true;
 return async request=>{
  const origin=request.headers.get('origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(allowedOrigins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS','Access-Control-Expose-Headers':'Retry-After'}:{})};
  const reply=(status,body)=>{if(Number.isInteger(body.retryAfter)&&body.retryAfter>0)headers['Retry-After']=String(body.retryAfter);return new Response(JSON.stringify(body),{status,headers})};
  if(origin&&!allowedOrigins.has(origin))return reply(403,{code:'AI_ORIGIN_DENIED',error:'Origen no permitido.'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{code:'AI_METHOD',error:'Método no permitido.'});
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))return reply(401,{code:'AI_AUTH_REQUIRED',error:'Vuelve a iniciar sesión.'});
  if(!authUrl||!anonKey)return reply(503,{code:'AI_AUTH_UNAVAILABLE',error:'No se pudo verificar el servicio de acceso.'});
  const limit=Number.isFinite(timeoutMs)?Math.min(20000,Math.max(1,timeoutMs)):20000,signal=AbortSignal.any([request.signal,AbortSignal.timeout(limit)]);
  const authHeaders={apikey:anonKey,Authorization:authorization,'Content-Type':'application/json'};
  const rpc=async(name,body)=>{
   signal.throwIfAborted();const response=await fetcher(authUrl+'/rest/v1/rpc/'+name,{method:'POST',headers:authHeaders,body:JSON.stringify(body),signal,redirect:'error'});signal.throwIfAborted();
   if(!response.ok){if([401,403].includes(response.status))throw failure(response.status,'AI_ACCESS_DENIED','No tienes acceso al banco de esta modelo. Revisa tu sesión y permisos.');if(response.status===429)throw failure(429,'AI_BANK_LIMIT','El banco ha limitado las consultas. Espera antes de volver a consultar.',{retryAfter:retryAfter(response)});throw badPool()}
   return responseJson(response,signal);
  };
  try{
   if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))throw failure(415,'AI_CONTENT_TYPE','La solicitud debe contener datos JSON.');
   let input;try{input=JSON.parse(await boundedText(request.body,12288,signal))}catch(error){if(error.status)throw error;signal.throwIfAborted();throw failure(400,'AI_INPUT','Revisa los datos de la consulta.')}
   if(!object(input)||Object.keys(input).some(key=>!['workspace_id','creator_id','query','request_id'].includes(key))||!uuid.test(input.workspace_id)||!uuid.test(input.creator_id)||!uuid.test(input.request_id)||typeof input.query!=='string'||!input.query.trim()||input.query.length>2000)throw failure(400,'AI_INPUT','Consulta un mensaje de entre 1 y 2.000 caracteres y una modelo válida.');
   const userResponse=await fetcher(authUrl+'/auth/v1/user',{headers:authHeaders,signal,redirect:'error'});signal.throwIfAborted();
   if(!userResponse.ok)throw failure([401,403].includes(userResponse.status)?401:503,'AI_AUTH_UNAVAILABLE',[401,403].includes(userResponse.status)?'Vuelve a iniciar sesión.':'No se pudo verificar tu sesión. Vuelve a intentarlo.');
   const identity=await responseJson(userResponse,signal,65536,()=>failure(503,'AI_AUTH_UNAVAILABLE','No se pudo verificar tu sesión. Vuelve a intentarlo.'));if(!uuid.test(identity.id)||!identity.email_confirmed_at)throw failure(401,'AI_AUTH_REQUIRED','La sesión no está confirmada. Vuelve a iniciar sesión.');
   const workspace=input.workspace_id.toLowerCase(),creator=input.creator_id.toLowerCase(),requestId=input.request_id.toLowerCase(),args={w:workspace,c:creator};
   const first=poolSnapshot(await rpc('bruff_ai_pool',args),identity.id,workspace,creator),mode=first.settings.mode;
   const result=(value,engineInvoked=false)=>reply(200,{...value,actorId:identity.id,workspaceId:workspace,creatorId:creator,engine:mode,configured:true,engineInvoked});
   const recheck=async()=>{
    let current;try{current=poolSnapshot(await rpc('bruff_ai_pool',args),identity.id,workspace,creator)}catch(error){if([401,403].includes(error.status))throw stale();throw error}
    if(current.version!==first.version||JSON.stringify(current.settings)!==JSON.stringify(first.settings))throw stale();return current;
   };
   if(mode==='bank'){
    const bank=bankSnapshot(await rpc('bruff_chat_direct_suggestions',{...args,query:input.query}),identity.id,workspace,creator,first.settings.maxResults);
    await recheck();return result(bank);
   }
   if(!configured)throw failure(503,'AI_NOT_CONFIGURED','El motor semántico todavía no está configurado en el plan gratuito. Se conserva el banco; no se ha consultado ningún motor.',{engine:'semantic',configured:false});
   if(!first.rows.length)return result({status:'empty',approvedCount:0,rows:[]});
   const claim=await rpc('bruff_ai_claim',{...args,request_id:requestId});
   if(!sameIdentity(claim,identity.id,workspace,creator))throw stale();
   if(claim?.allowed!==true){
    if(['bank','duplicate'].includes(claim?.reason))throw failure(409,'AI_REQUEST_CHANGED',claim.reason==='duplicate'?'Esta consulta ya fue reservada. Inicia una nueva consulta manual.':'La configuración ha cambiado. Consulta de nuevo.');
    if(['model_daily_limit','workspace_daily_limit','actor_minute_limit'].includes(claim?.reason)){const wait=Number.isInteger(claim.retryAfter)&&claim.retryAfter>0&&claim.retryAfter<=86400?claim.retryAfter:60;throw failure(429,'AI_LOCAL_LIMIT','Se ha alcanzado el límite de consultas semánticas. Espera antes de consultar otra vez.',{retryAfter:wait})}
    throw badPool();
   }
   if(claim.reason!=='allowed')throw badPool();
   signal.throwIfAborted();
   const response=await fetcher('https://api.cloudflare.com/client/v4/accounts/'+cloudflareAccountId+'/ai/run/@cf/baai/bge-reranker-base',{method:'POST',headers:{Authorization:'Bearer '+cloudflareToken,'Content-Type':'application/json'},body:JSON.stringify({query:input.query,contexts:first.rows.map(row=>({text:row.trigger})),top_k:3}),signal,redirect:'error'});signal.throwIfAborted();
   if(!response.ok)throw response.status===429?failure(429,'AI_ENGINE_LIMIT','El motor gratuito ha limitado las consultas. Espera antes de volver a consultar.',{retryAfter:retryAfter(response)}):failure(503,'AI_ENGINE_UNAVAILABLE','No se pudo consultar el motor semántico. No se han generado ni enviado mensajes.');
   const indices=rankSnapshot(await responseJson(response,signal,65536,badEngine),first.rows.length,first.settings.minScore,first.settings.maxResults);
   const current=await recheck();
   const byId=new Map(current.rows.map(row=>[row.id,row]));
   const rows=indices.map(index=>{const original=first.rows[index],latest=byId.get(original.id);if(!latest||latest.source.version!==original.source.version||JSON.stringify(latest)!==JSON.stringify(original))throw stale();return sourceRow(original,creator)});
   signal.throwIfAborted();return result({status:current.approvedCount===0?'empty':'connected',approvedCount:current.approvedCount,rows},true);
  }catch(error){
   if(request.signal.aborted)return reply(499,{code:'AI_CANCELLED',error:'Consulta cancelada.'});
   if(signal.aborted)return reply(504,{code:'AI_TIMEOUT',error:'La consulta ha tardado demasiado. Puedes volver a intentarlo manualmente.'});
   if(error.status&&error.code)return reply(error.status,{code:error.code,error:error.message,...error.extra});
   return reply(503,{code:'AI_UNAVAILABLE',error:'No se pudo completar la consulta. No se ha generado ni enviado ningún mensaje.'});
  }
 };
}
