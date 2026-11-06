import {scopeKey,validateSuggestions,validateChatDirectSuggestions} from './chat-direct.js';
import {generationDiagnosticError,generationRequestError} from './chat-direct-diagnostics.js';

const abort=signal=>{if(signal?.aborted)throw Object.assign(new Error('Consulta cancelada.'),{name:'AbortError'})};
const unavailable=()=>new Error('No se pudo consultar el banco de ejemplos. Comprueba la conexión y vuelve a intentarlo.');
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
export function validateGenerationQuota(value){
 const fields=['modelQueries','modelDailyLimit','sharedBudgetNeurons','calculatedNeurons','reservedNeurons','chargedNeurons','remainingNeurons','observedRequests','reservedRequests'];
 if(!value||!fields.every(key=>natural(value[key]))||value.modelDailyLimit<1||value.modelDailyLimit>1000||value.sharedBudgetNeurons!==7500||value.reservedNeurons!==value.reservedRequests*600||value.chargedNeurons!==value.calculatedNeurons+value.reservedNeurons||value.remainingNeurons!==Math.max(0,value.sharedBudgetNeurons-value.chargedNeurons)||typeof value.usageDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(value.usageDay)||typeof value.resetsAt!=='string')throw generationDiagnosticError('unavailable');
 const start=Date.parse(value.usageDay+'T00:00:00.000Z');
 if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==value.usageDay||Date.parse(value.resetsAt)!==start+86400000)throw generationDiagnosticError('unavailable');
 return {usageDay:value.usageDay,resetsAt:value.resetsAt,...Object.fromEntries(fields.map(key=>[key,value[key]]))};
}
export function validateGenerationUsage(value){
 if(!value||!['observed','reserved'].includes(value.status)||!natural(value.chargedNeurons)||value.chargedNeurons<1)throw generationDiagnosticError('unavailable');
 if(value.status==='reserved'){
  if(value.promptTokens!==null||value.completionTokens!==null||value.calculatedNeurons!==null||value.chargedNeurons!==600)throw generationDiagnosticError('unavailable');
 }else{
  if(!natural(value.promptTokens)||value.promptTokens<1||value.promptTokens>1000000||!natural(value.completionTokens)||value.completionTokens>1000000)throw generationDiagnosticError('unavailable');
  const calculated=Math.max(1,Number((BigInt(value.promptTokens)*31876n+BigInt(value.completionTokens)*50488n+999999n)/1000000n));
  if(value.calculatedNeurons!==calculated||value.chargedNeurons!==calculated)throw generationDiagnosticError('unavailable');
 }
 return {status:value.status,promptTokens:value.promptTokens,completionTokens:value.completionTokens,calculatedNeurons:value.calculatedNeurons,chargedNeurons:value.chargedNeurons};
}
function rpcError(error){
 if(error?.name==='AbortError')return error;
 if(error?.code==='42501'||error?.status===401||error?.status===403)return new Error('No tienes acceso al banco de esta modelo. Revisa tu sesión y permisos.');
 if(error?.code==='PGRST202'||error?.code==='42883')return new Error('La base de ejemplos todavía no está habilitada en Supabase.');
 return unavailable();
}
async function read(client,name,args,signal){
 abort(signal);let request=client.rpc(name,args);if(signal&&typeof request.abortSignal==='function')request=request.abortSignal(signal);
 const {data,error}=await request;abort(signal);if(error)throw rpcError(error);return data;
}
async function engineRead(client,context,query,signal){
 abort(signal);
 const {data,error}=await client.functions.invoke('bruff-ai',{body:{workspace_id:context.workspace,creator_id:context.account,query,request_id:crypto.randomUUID()},signal});
 abort(signal);
 if(error){
  const status=error.context?.status||error.status;
  if(status===401||status===403)throw rpcError({status});
  if(status===429)throw new Error('Se alcanzó el límite del motor. Espera antes de volver a consultar.');
  if(status===409)throw new Error('La configuración o las referencias cambiaron. Consulta de nuevo los ejemplos.');
  if(status===503)throw new Error('El motor solicitado todavía no está disponible. Revisa su conexión y configuración.');
  throw unavailable();
 }
 if(!data||!['bank','semantic'].includes(data.engine)||data.configured!==true||typeof data.engineInvoked!=='boolean')throw unavailable();
 return data;
}
function identity(data,context){
 if(data?.actorId!==context.actor||data?.workspaceId!==context.workspace||data?.creatorId!==context.account)throw new Error('La sesión o la modelo han cambiado. Consulta de nuevo desde la conversación actual.');
}
async function generationPool(client,context,signal){
 abort(signal);let call=client.rpc('bruff_generation_pool',{w:context.workspace,c:context.account});if(signal&&typeof call.abortSignal==='function')call=call.abortSignal(signal);
 const {data,error}=await call;abort(signal);
 // Staged deployment only: a genuinely absent new RPC keeps the old bank.
 // Revocation, outages and malformed configuration never become a fallback.
 if(error){if(['PGRST202','42883'].includes(error.code))return null;throw generationDiagnosticError(error.code==='42501'||[401,403].includes(error.status)?'access':'unavailable')}
 if(data?.actorId!==context.actor||data.workspaceId!==context.workspace||data.creatorId!==context.account)throw generationDiagnosticError('access');
 if(typeof data?.settings?.enabled!=='boolean'||!Number.isSafeInteger(data.version)||data.version<0||!Number.isSafeInteger(data.approvedCount)||data.approvedCount<0)throw generationDiagnosticError('unavailable');
 return data;
}
async function generatedRead(client,context,operation,requestId,signal,force=false){
 abort(signal);
 const {data,error}=await client.functions.invoke('bruff-drafts',{body:{operation,workspace_id:context.workspace,creator_id:context.account,conversation_id:context.fanId,request_id:requestId,...(operation==='generate'?{force}: {})},signal});abort(signal);
 if(error)throw await generationRequestError(error,signal);
 identity(data,context);
 if(data?.engine!=='generative'||data.valid!==true||data.aiGenerated!==true||data.aiVerified!==false||!uuid(data.generationId)||data.requestId!==requestId||data.fanId!==context.fanId||typeof data.revision!=='string'||!/^[a-f0-9]{32}$/u.test(data.revision)||typeof data.contextHash!=='string'||!/^[a-f0-9]{64}$/u.test(data.contextHash)||typeof data.expiresAt!=='string'||!Number.isFinite(Date.parse(data.expiresAt))||Date.parse(data.expiresAt)<=Date.now()||!Array.isArray(data.drafts)||data.drafts.length>3||!Array.isArray(data.unknowns)||data.unknowns.length>5||data.unknowns.some(x=>typeof x!=='string'||!x.trim()||x.length>160)||!Number.isSafeInteger(data.approvedCount)||data.approvedCount<1)throw unavailable();
 if(operation==='generate'){
  if(data.engineVersion!=='bruff-drafts-v2'||typeof data.reused!=='boolean'||data.engineInvoked!==!data.reused||(!data.reused||force)&&data.generationId!==requestId||force&&data.reused)throw unavailable();
 }else if(!['bruff-drafts-v2','legacy-v1'].includes(data.engineVersion)||data.reused!==false||data.engineInvoked!==false||data.generationId!==requestId)throw unavailable();
 return {...data,usage:validateGenerationUsage(data.usage),quota:validateGenerationQuota(data.quota)};
}
function generatedCandidate(draft,data,account){return {id:'gen.'+data.generationId+'.'+draft.id,english:draft.english,spanish:draft.spanish,variables:[],aiGenerated:true,aiVerified:false,generationId:data.generationId,expiresAt:data.expiresAt,exampleIds:draft.exampleIds,knowledgeIds:draft.knowledgeIds,source:{kind:'generated',modelId:account,verified:false,label:'Borrador IA · Revisión humana',version:data.revision}}}
// Secrets and transcript reads stay on the server. The browser supplies only
// its already-authorized active conversation ID to the manual draft endpoint.
export function createChatDirectSource(client,{actor,workspace,engineEndpoint=false,generationEndpoint=false}){
 const check=request=>{
  const context=request?.context;
  if(!context||context.actor!==actor||context.workspace!==workspace||context.canRead!==true||context.canInsert!==true||scopeKey(context)!==request.scope||context.scope!==request.scope||context.revision!==request.revision)throw new Error('La conversación o sus permisos han cambiado.');
  abort(request.signal);return context;
 };
 const source=async request=>{
  const context=check(request);
  const mode=request.mode??(generationEndpoint?'generative':'bank');
  if(!['generative','bank'].includes(mode))throw new Error('Elige Crear con IA o Buscar ejemplos.');
  if(mode==='generative'){
   if(!generationEndpoint)throw generationDiagnosticError('rpc_missing');
   let pool;
   try{pool=await generationPool(client,context,request.signal)}catch(error){abort(request.signal);if(error.diagnostic)throw error;throw generationDiagnosticError('unavailable')}
   check(request);
   if(!pool)throw generationDiagnosticError('rpc_missing');
   if(pool.settings.enabled!==true)throw generationDiagnosticError('disabled');
   if(pool.approvedCount===0)throw generationDiagnosticError('no_sources');
    if(request.force!==undefined&&typeof request.force!=='boolean')throw generationDiagnosticError('unavailable');
    const data=await generatedRead(client,context,'generate',crypto.randomUUID(),request.signal,request.force===true);check(request);
    const payload={scope:request.scope,revision:request.revision,candidates:data.drafts.map(d=>generatedCandidate(d,data,context.account))};
    const candidates=validateChatDirectSuggestions(payload,{scope:request.scope,revision:request.revision,allowedSourceModels:[context.account]});
    return {...payload,candidates,quota:data.quota,knowledge:{status:'connected',approvedCount:data.approvedCount,engine:'generative',engineInvoked:data.engineInvoked,reused:data.reused,engineVersion:data.engineVersion,generationId:data.generationId,expiresAt:data.expiresAt,usage:data.usage,unknowns:data.unknowns}};
  }
  const fallback=(context.messages||[]).filter(m=>m?.isFromMe===false&&!m.delivery&&typeof m.text==='string'&&m.text.trim()).sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0)||String(b.id).localeCompare(String(a.id),undefined,{numeric:true}))[0]?.text;
  const input=typeof request.input==='string'&&!request.input.trim()&&generationEndpoint?fallback:request.input;
  if(typeof input!=='string'||!input.trim()||input.length>2000)throw new Error('Consulta un mensaje de entre 1 y 2.000 caracteres.');
  const data=engineEndpoint?await engineRead(client,context,input,request.signal):await read(client,'bruff_chat_direct_suggestions',{w:workspace,c:context.account,query:input},request.signal);check(request);identity(data,context);
  if(!data||!['connected','empty'].includes(data.status)||!Array.isArray(data.rows)||!Number.isSafeInteger(data.approvedCount)||data.approvedCount<0||data.status==='empty'&&(data.approvedCount!==0||data.rows.length))throw unavailable();
  const payload={scope:request.scope,revision:request.revision,candidates:data.rows};
  const candidates=validateSuggestions(payload,{scope:request.scope,revision:request.revision,allowedSourceModels:[context.account]});
  if(candidates.some(item=>item.source.kind!=='document'))throw unavailable();
  return {...payload,candidates,knowledge:{status:data.status,approvedCount:data.approvedCount,engine:data.engine||'bank',engineInvoked:data.engineInvoked===true}};
 };
 source.readQuota=async request=>{
  const context=check(request);
  abort(request.signal);let call=client.rpc('bruff_generation_quota',{w:workspace,c:context.account});if(request.signal&&typeof call.abortSignal==='function')call=call.abortSignal(request.signal);
  const {data,error}=await call;check(request);
  if(error)throw generationDiagnosticError(error.code==='42501'||[401,403].includes(error.status)?'access':'unavailable');
  if(data?.actorId!==context.actor||data.workspaceId!==context.workspace||data.creatorId!==context.account)throw generationDiagnosticError('access');
  return validateGenerationQuota(data.quota);
 };
 source.verify=async request=>{
  const context=check(request),candidate=request.candidate;
  if(candidate?.aiGenerated===true){
   validateChatDirectSuggestions({scope:request.scope,revision:request.revision,candidates:[candidate]},{scope:request.scope,revision:request.revision,allowedSourceModels:[context.account]});
   const data=await generatedRead(client,context,'verify',candidate.generationId,request.signal);check(request);
   const raw=data.drafts.find(d=>'gen.'+data.generationId+'.'+d.id===candidate.id),canonical=raw&&generatedCandidate(raw,data,context.account);
   if(!canonical||JSON.stringify(canonical)!==JSON.stringify({id:candidate.id,english:candidate.english,spanish:candidate.spanish,variables:candidate.variables,aiGenerated:candidate.aiGenerated,aiVerified:candidate.aiVerified,generationId:candidate.generationId,expiresAt:candidate.expiresAt,exampleIds:candidate.exampleIds,knowledgeIds:candidate.knowledgeIds,source:candidate.source}))throw new Error('El borrador cambió o caducó. Genera de nuevo antes de insertarlo.');
   return true;
  }
  if(candidate?.source?.kind!=='document'||candidate.source.modelId!==context.account)throw new Error('La referencia no pertenece a esta modelo.');
  const data=await read(client,'bruff_chat_direct_reference',{w:workspace,c:context.account,example_id:candidate.id,expected:candidate.source.version},request.signal);check(request);identity(data,context);
  if(data?.valid!==true)throw new Error('El ejemplo ha cambiado o fue retirado. Consulta de nuevo las referencias antes de preparar el mensaje.');
  return true;
 };
 return source;
}
