import {scopeKey,validateSuggestions} from './chat-direct.js';

const abort=signal=>{if(signal?.aborted)throw Object.assign(new Error('Consulta cancelada.'),{name:'AbortError'})};
const unavailable=()=>new Error('No se pudo consultar el banco de ejemplos. Comprueba la conexión y vuelve a intentarlo.');
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
function identity(data,context){
 if(data?.actorId!==context.actor||data?.workspaceId!==context.workspace||data?.creatorId!==context.account)throw new Error('La sesión o la modelo han cambiado. Consulta de nuevo desde la conversación actual.');
}
// No provider key, full transcript, fan identifier or generation service is
// needed. PostgreSQL derives the actor from the existing authenticated session.
export function createChatDirectSource(client,{actor,workspace}){
 const check=request=>{
  const context=request?.context;
  if(!context||context.actor!==actor||context.workspace!==workspace||context.canRead!==true||context.canInsert!==true||scopeKey(context)!==request.scope||context.scope!==request.scope||context.revision!==request.revision)throw new Error('La conversación o sus permisos han cambiado.');
  abort(request.signal);return context;
 };
 const source=async request=>{
  const context=check(request),input=request.input;
  if(typeof input!=='string'||!input.trim()||input.length>2000)throw new Error('Consulta un mensaje de entre 1 y 2.000 caracteres.');
  const data=await read(client,'bruff_chat_direct_suggestions',{w:workspace,c:context.account,query:input},request.signal);check(request);identity(data,context);
  if(!data||!['connected','empty'].includes(data.status)||!Array.isArray(data.rows)||!Number.isSafeInteger(data.approvedCount)||data.approvedCount<0||data.status==='empty'&&(data.approvedCount!==0||data.rows.length))throw unavailable();
  const payload={scope:request.scope,revision:request.revision,candidates:data.rows};
  const candidates=validateSuggestions(payload,{scope:request.scope,revision:request.revision,allowedSourceModels:[context.account]});
  if(candidates.some(item=>item.source.kind!=='document'))throw unavailable();
  return {...payload,candidates,knowledge:{status:data.status,approvedCount:data.approvedCount}};
 };
 source.verify=async request=>{
  const context=check(request),candidate=request.candidate;
  if(candidate?.source?.kind!=='document'||candidate.source.modelId!==context.account)throw new Error('La referencia no pertenece a esta modelo.');
  const data=await read(client,'bruff_chat_direct_reference',{w:workspace,c:context.account,example_id:candidate.id,expected:candidate.source.version},request.signal);check(request);identity(data,context);
  if(data?.valid!==true)throw new Error('El ejemplo ha cambiado o fue retirado. Consulta de nuevo las referencias antes de preparar el mensaje.');
  return true;
 };
 return source;
}
