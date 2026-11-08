import {ENGINE_VERSION,validUsage,validQuota} from '../bruff-drafts/usage.js';

// This module receives an authenticated, owner-scoped call closure. It has no
// credentials, fetch implementation, arbitrary RPC or fan-write operation.
const LIVE='/functions/v1/bruff-live',DRAFTS='/functions/v1/bruff-drafts';
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(value);
const sameId=(a,b)=>uuid(a)&&uuid(b)&&a.toLowerCase()===b.toLowerCase();
const numeric=value=>typeof value==='string'&&/^\d{1,24}$/u.test(value);
const rowId=value=>numeric(value)?value:Number.isSafeInteger(value)&&value>=0?String(value):null;
const clean=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const control=/[\u0000-\u001f\u007f]/u;
const link=/(?:https?:\/\/|data:|blob:|javascript:|www\.)[^\s<>]*/giu;
const hasLink=value=>{link.lastIndex=0;return link.test(value)};
const keys=(value,allowed)=>record(value)&&Object.keys(value).every(key=>allowed.includes(key));
const date=value=>typeof value==='string'&&Number.isFinite(Date.parse(value))?value:null;
const number=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0?value:null;
const integer=value=>Number.isSafeInteger(value)&&value>=0?value:null;
const bool=value=>typeof value==='boolean'?value:null;
const pick=(value,names)=>Object.fromEntries(names.map(name=>[name,value[name]]));
const USAGE=['status','promptTokens','completionTokens','calculatedNeurons','chargedNeurons'];
const QUOTA=['usageDay','resetsAt','modelQueries','modelDailyLimit','sharedBudgetNeurons','calculatedNeurons','reservedNeurons','chargedNeurons','remainingNeurons','observedRequests','reservedRequests'];
const MEMORY=['enabled','version','confirmedItems','usedConfirmedItems','messagesObserved','historyComplete','contextLimited'];

export class ChatRelayError extends Error{
 constructor(status,code,message,retryAfter){super(message);this.name='ChatRelayError';this.status=status;this.code=code;if(Number.isSafeInteger(retryAfter)&&retryAfter>0&&retryAfter<=86400)this.retryAfter=retryAfter}
}
const invalid=()=>new ChatRelayError(400,'CHAT_RELAY_INPUT','Revisa la agencia, la modelo y los argumentos de esta consulta.');
const unavailable=()=>new ChatRelayError(503,'CHAT_RELAY_UNAVAILABLE','No se pudo comprobar la respuesta de BRUFF. No se ha enviado ningún mensaje.');
const access=status=>new ChatRelayError(status,status===401?'CHAT_RELAY_AUTH':'CHAT_RELAY_ACCESS',status===401?'Vuelve a conectar tu sesión de propietario de BRUFF.':'Se requiere acceso vigente de propietario a esta agencia y modelo.');
const cancelled=()=>new ChatRelayError(408,'AI_CANCELLED','La consulta se ha cancelado. No se ha enviado ningún mensaje.');
const conflict=()=>new ChatRelayError(409,'AI_CONTEXT_CHANGED','El contexto o el borrador cambiaron o caducaron. Consulta de nuevo antes de elegir.');
function memoryProjection(value){
 if(!keys(value,MEMORY)||Object.keys(value).length!==MEMORY.length||typeof value.enabled!=='boolean'||typeof value.contextLimited!=='boolean')throw unavailable();
 if(!value.enabled){if(MEMORY.filter(key=>!['enabled','contextLimited'].includes(key)).some(key=>value[key]!==null)||value.contextLimited!==true)throw unavailable()}
 else if(integer(value.version)===null||integer(value.confirmedItems)===null||value.confirmedItems>100||integer(value.usedConfirmedItems)===null||value.usedConfirmedItems>12||value.usedConfirmedItems>value.confirmedItems||integer(value.messagesObserved)===null||value.messagesObserved>20000||typeof value.historyComplete!=='boolean')throw unavailable();
 return pick(value,MEMORY);
}
const ERROR_MESSAGES={
 AI_DISABLED:[409,'La generación manual está desactivada para esta modelo.'],
 AI_SOURCES:[409,'Faltan ejemplos aprobados para esta modelo.'],
 AI_HISTORY_EMPTY:[409,'No hay un mensaje recibido reciente disponible para esta consulta.'],
 AI_CONTEXT_CHANGED:[409,'El historial, las fuentes o el borrador cambiaron. Consulta de nuevo.'],
 AI_PENDING:[409,'Ya hay una consulta en curso para este contexto. Espera antes de volver a consultar.'],
 AI_CONFIG:[503,'Falta configurar el motor o confirmar el plan gratuito en BRUFF.'],
 AI_PROVIDER_AUTH:[503,'Cloudflare ha rechazado la autenticación o los permisos de Workers AI.'],
 AI_PROVIDER_REQUEST:[503,'El proveedor ha rechazado la petición del modelo configurado.'],
 AI_PROVIDER:[503,'El proveedor de IA no está disponible en este momento.'],
 AI_DRAFT_RESPONSE:[503,'La IA no devolvió un borrador válido para revisión.'],
 AI_UNAVAILABLE:[503,'No se pudo comprobar el motor de BRUFF.'],
 AI_HISTORY:[503,'No se pudo comprobar el historial de esta conversación.'],
 AI_LOCAL_LIMIT:[429,'Se ha alcanzado el presupuesto de generación de BRUFF.'],
 AI_PROVIDER_LIMIT:[429,'Se ha alcanzado un límite temporal del proveedor de IA.'],
 AI_LIMIT:[429,'Se ha alcanzado un límite temporal.'],
 AI_CANCELLED:[408,'La consulta se ha cancelado. No se ha enviado ningún mensaje.'],
 AI_CONTEXT_LIMIT:[413,'El contexto supera el tamaño permitido para esta consulta.'],
 AI_SIZE:[413,'La respuesta supera el tamaño permitido.'],
};
function upstreamError(response){
 if([401,403].includes(response.status))return access(response.status);
 const known=ERROR_MESSAGES[response.data?.code],retry=Number.isSafeInteger(response.retryAfter)?response.retryAfter:response.data?.retryAfter;
 const wait=Number.isSafeInteger(retry)&&retry>0&&retry<=86400?retry:undefined;
 if(known&&known[0]===response.status)return new ChatRelayError(response.status,response.data.code,known[1],wait??(response.status===429?60:undefined));
 if(response.status===429)return new ChatRelayError(429,'CHAT_RELAY_LIMIT','El proveedor ha limitado las consultas. Espera antes de volver a consultar.',wait??60);
 if(response.status===409)return conflict();
 if(response.status===400)return invalid();
 return unavailable();
}
function requestFor(operation,args,w,c){
 const operations={list:['query','cursor'],read:['fan_id','cursor'],generate:['fan_id','request_id','force','share_context'],verify:['fan_id','generation_id','draft_id']};
 if(!Object.hasOwn(operations,operation))throw invalid();const fields=operations[operation];
 if(!keys(args,['workspace_id','model_id',...fields])||!sameId(args.workspace_id,w)||!sameId(args.model_id,c))throw invalid();
 if(Object.hasOwn(args,'cursor')&&(typeof args.cursor!=='string'||!args.cursor.trim()||args.cursor.length>2048||control.test(args.cursor)||hasLink(args.cursor)))throw invalid();
 if(Object.hasOwn(args,'query')&&(typeof args.query!=='string'||!args.query.trim()||args.query.length>150||control.test(args.query)))throw invalid();
 const scope={workspace_id:w,creator_id:c};
 if(operation==='list')return {path:LIVE,body:{...scope,operation:'inbox',fast:true,background:true,...(args.query!==undefined?{query:args.query}:{}),...(args.cursor!==undefined?{cursor:args.cursor}:{})}};
 if(!numeric(args.fan_id))throw invalid();
 if(operation==='read')return {path:LIVE,body:{...scope,operation:'messages',conversation_id:args.fan_id,background:true,...(args.cursor!==undefined?{cursor:args.cursor}:{})}};
 if(operation==='generate'){
  if(args.share_context!==true||!uuid(args.request_id)||Object.hasOwn(args,'force')&&typeof args.force!=='boolean')throw invalid();
  return {path:DRAFTS,body:{...scope,operation:'generate',conversation_id:args.fan_id,request_id:args.request_id.toLowerCase(),force:args.force===true}};
 }
 if(!uuid(args.generation_id)||!['1','2','3'].includes(args.draft_id))throw invalid();
 return {path:DRAFTS,body:{...scope,operation:'verify',conversation_id:args.fan_id,request_id:args.generation_id.toLowerCase()}};
}
function optionalIdentity(data,{actor,w,c,fan}){
 if(!record(data))throw unavailable();
 for(const [key,expected]of [['actorId',actor],['workspaceId',w],['creatorId',c],['modelId',c]])if(Object.hasOwn(data,key)&&!sameId(data[key],expected))throw access(403);
 if(fan!==undefined&&Object.hasOwn(data,'fanId')&&data.fanId!==fan)throw access(403);
}
function page(data){
 if(!record(data)||typeof data.hasMore!=='boolean'||data.cursor!==null&&(typeof data.cursor!=='string'||!data.cursor||data.cursor.length>2048||control.test(data.cursor)||hasLink(data.cursor))||data.hasMore&&data.cursor===null)throw unavailable();
 return {cursor:data.cursor,hasMore:data.hasMore,partial:true};
}
function textProjection(value,max,budget){
 if(value===null||value===undefined)return {text:null,truncated:false};
 if(typeof value!=='string'||value.length>100000)throw unavailable();
 const redacted=value.replace(link,'[enlace omitido]').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu,'');
 const length=Math.min(max,budget.left);budget.left-=Math.min(redacted.length,length);
 return {text:redacted.slice(0,length),truncated:redacted.length>length};
}
function readProjection(operation,envelope,target){
 optionalIdentity(envelope,target);const data=envelope.data;optionalIdentity(data,target);const pagination=page(data),rows=data[operation==='list'?'conversations':'messages'];
 if(!Array.isArray(rows)||rows.length>200)throw unavailable();
 const budget={left:16000},seen=new Set();
 const result=rows.map(row=>{
  if(!record(row))throw unavailable();
  if(operation==='list'){
   const fanId=rowId(row.userId??row.id);if(!fanId||seen.has(fanId))throw unavailable();seen.add(fanId);
   const name=textProjection(row.name,160,{left:160}),username=textProjection(row.username,100,{left:100}),last=textProjection(row.lastMessage,240,budget);
   return {fanId,name:name.text,username:username.text,lastMessage:last.text,lastMessageTruncated:last.truncated,lastMessageAt:date(row.lastMessageTime),lastMessageFromModel:bool(row.lastMessageIsFromMe),unreadCount:integer(row.unreadCount)};
  }
  const id=rowId(row.id);if(!id||seen.has(id))throw unavailable();seen.add(id);const body=textProjection(row.text,4000,budget);
  return {id,text:body.text,textTruncated:body.truncated,isFromMe:bool(row.isFromMe),createdAt:date(row.createdAt),price:number(row.price),isTip:bool(row.isTip),isOpened:bool(row.isOpened),mediaCount:integer(row.mediaCount)};
 });
 return {actorId:target.actor,workspaceId:target.w,modelId:target.c,...(target.fan!==undefined?{fanId:target.fan}:{}),...pagination,observedAt:date(envelope.observedAt),[operation==='list'?'conversations':'messages']:result};
}
function canonicalProjection(operation,data,args,target,at){
 optionalIdentity(data,target);
 if(!sameId(data.actorId,target.actor)||!sameId(data.workspaceId,target.w)||!sameId(data.creatorId,target.c)||data.fanId!==target.fan||data.engine!=='generative'||data.valid!==true||data.aiGenerated!==true||data.aiVerified!==false||!uuid(data.generationId)||!uuid(data.requestId)||!date(data.expiresAt)||Date.parse(data.expiresAt)<=at||typeof data.revision!=='string'||!/^[a-f0-9]{32}$/u.test(data.revision)||typeof data.contextHash!=='string'||!/^[a-f0-9]{64}$/u.test(data.contextHash)||!Number.isSafeInteger(data.approvedCount)||data.approvedCount<1||!validUsage(data.usage)||!validQuota(data.quota)||!Array.isArray(data.drafts)||data.drafts.length>3||!Array.isArray(data.unknowns)||data.unknowns.length>5||data.unknowns.some(x=>!clean(x,160)||hasLink(x)))throw unavailable();
 if(operation==='generate'){
  if(data.requestId!==args.request_id.toLowerCase()||data.engineVersion!==ENGINE_VERSION||typeof data.reused!=='boolean'||data.engineInvoked!==!data.reused||(!data.reused||args.force===true)&&data.generationId!==data.requestId||args.force===true&&data.reused)throw unavailable();
 }else if(data.generationId!==args.generation_id.toLowerCase()||data.requestId!==data.generationId||![ENGINE_VERSION,'legacy-v1'].includes(data.engineVersion)||data.reused!==false||data.engineInvoked!==false)throw unavailable();
 const seen=new Set(),drafts=data.drafts.map(d=>{
  if(!record(d)||!['1','2','3'].includes(d.id)||seen.has(d.id)||!clean(d.english,700)||!clean(d.spanish,1000)||hasLink(d.english)||hasLink(d.spanish)||!Array.isArray(d.exampleIds)||d.exampleIds.length<1||d.exampleIds.length>6||!Array.isArray(d.knowledgeIds)||d.knowledgeIds.length>12||[...d.exampleIds,...d.knowledgeIds].some(x=>!uuid(x))||new Set(d.exampleIds).size!==d.exampleIds.length||new Set(d.knowledgeIds).size!==d.knowledgeIds.length)throw unavailable();
  seen.add(d.id);return {id:d.id,english:d.english,spanish:d.spanish,exampleIds:d.exampleIds.slice(),knowledgeIds:d.knowledgeIds.slice()};
 });
 const output={actorId:target.actor,workspaceId:target.w,modelId:target.c,fanId:target.fan,generationId:data.generationId,requestId:data.requestId,expiresAt:data.expiresAt,engineVersion:data.engineVersion,engineInvoked:data.engineInvoked,reused:data.reused,aiGenerated:true,aiVerified:false,requiresHumanReview:true,approvedCount:data.approvedCount,usage:pick(data.usage,USAGE),quota:pick(data.quota,QUOTA)};
 // Report only the server's bounded counts, never memory text or a fabricated
 // zero for older results that did not expose this diagnostic.
 if(Object.hasOwn(data,'memoryContext'))output.memoryContext=memoryProjection(data.memoryContext);
 if(operation==='generate')return {...output,drafts,unknowns:data.unknowns.slice()};
 const selectedDraft=drafts.find(d=>d.id===args.draft_id);if(!selectedDraft)throw conflict();
 return {...output,selectionValid:true,selectedDraft};
}

export async function runChatRelay({operation,args,actor,w,c,call,recheckOwner,now=Date.now}={}){
 if(![actor,w,c].every(uuid)||typeof call!=='function'||typeof recheckOwner!=='function')throw unavailable();
 const target={actor:actor.toLowerCase(),w:w.toLowerCase(),c:c.toLowerCase(),...(operation!=='list'?{fan:args?.fan_id}:{})};
 const request=requestFor(operation,args,target.w,target.c);let response,failure;
 try{response=await call(request.path,request.body)}catch(error){failure=error}
 // Always recheck, including failed/cancelled relays. A target read/send grant
 // cannot preserve this owner's MCP access after their role changes.
 try{if(await recheckOwner()===false)throw access(403)}catch(error){if([401,403].includes(error?.status))throw access(error.status);if(error?.name==='AbortError')throw cancelled();throw unavailable()}
 if(failure)throw failure.name==='AbortError'?cancelled():unavailable();
 if(!record(response)||typeof response.ok!=='boolean'||!Number.isInteger(response.status)||response.status<100||response.status>599||response.ok!==(response.status>=200&&response.status<300))throw unavailable();
 if(!response.ok)throw upstreamError(response);
 if(['list','read'].includes(operation))return readProjection(operation,response.data,target);
 const at=typeof now==='function'?now():now;if(!Number.isFinite(at))throw unavailable();
 return canonicalProjection(operation,response.data,args,target,at);
}
