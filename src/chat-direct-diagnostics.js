// Only local, allowlisted explanations reach the operator. Never display raw
// provider responses, database messages, secrets or transcript fragments.
const messages={pending:'Ya hay una consulta en curso para este contexto. Espera antes de volver a intentarlo; no se repetirá automáticamente.',disabled:'La generación con IA está desactivada para esta modelo. El propietario debe habilitarla en Generación.',no_sources:'Esta modelo todavía no tiene ejemplos aprobados. Revisa y aprueba sus fuentes antes de generar respuestas.',rpc_missing:'La generación manual todavía no está habilitada en el servicio.',config:'El motor todavía no tiene una configuración válida. Revisa la conexión y la confirmación del plan gratuito.',context_changed:'La conversación o las fuentes han cambiado. Genera de nuevo desde el chat actual.',local_limit:'Se alcanzó el límite de consultas reservado en BRUFF. Espera antes de volver a generar.',provider_limit:'El proveedor ha limitado las consultas o agotado su cuota gratuita. Respeta la espera indicada.',provider:'El proveedor no pudo completar la consulta. No se han preparado respuestas.',provider_auth:'Cloudflare ha rechazado la credencial o sus permisos de Workers AI. El propietario debe revisar esa conexión.',provider_request:'Cloudflare ha rechazado la petición al modelo. Hay que revisar su contrato antes de repetirla.',format:'El motor devolvió un formato que no se pudo validar. No se han preparado respuestas.',history:'No se pudo comprobar el historial reciente de esta conversación.',unavailable:'La generación manual no está disponible en este momento. No se ha consultado el banco como alternativa.',access:'Tu sesión o tus permisos ya no permiten consultar esta modelo.'};
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
export function safeGenerationDiagnostic(value){
 if(!record(value)||value.engine!=='generative'||!Object.hasOwn(messages,value.reason)||Object.keys(value).some(k=>!['engine','reason','retryAfter'].includes(k)))return null;
 if(value.retryAfter!==undefined&&(!Number.isSafeInteger(value.retryAfter)||value.retryAfter<1||value.retryAfter>86400))return null;
 return Object.freeze({engine:'generative',reason:value.reason,...(value.retryAfter!==undefined?{retryAfter:value.retryAfter}:{})});
}
export function generationDiagnosticError(reason,{retryAfter}={}){
 const diagnostic=safeGenerationDiagnostic({engine:'generative',reason,...(retryAfter===undefined?{}:{retryAfter})})||safeGenerationDiagnostic({engine:'generative',reason:'unavailable'});
 return Object.assign(new Error(messages[diagnostic.reason]),{diagnostic});
}
const codes={AI_PENDING:['pending',409],AI_DISABLED:['disabled',409],AI_SOURCES:['no_sources',409],AI_CONTEXT_CHANGED:['context_changed',409],AI_CONFIG:['config',503],AI_DRAFT_RESPONSE:['format',503],AI_LOCAL_LIMIT:['local_limit',429],AI_PROVIDER_LIMIT:['provider_limit',429],AI_PROVIDER:['provider',503],AI_PROVIDER_AUTH:['provider_auth',503],AI_PROVIDER_REQUEST:['provider_request',503],AI_HISTORY:['history',503],AI_HISTORY_EMPTY:['history',409],AI_AUTH:['access',401],AI_ACCESS:['access',403]};
async function codeFromResponse(response,signal){
 if(typeof response?.clone!=='function')return null;
 let reader;const abort=()=>{void reader?.cancel().catch(()=>{})};
 try{reader=response.clone().body?.getReader();if(!reader)return null;let raw='',bytes=0;const decoder=new TextDecoder('utf-8',{fatal:true});signal?.addEventListener('abort',abort,{once:true});
  while(true){if(signal?.aborted)return null;const {done,value}=await reader.read();if(signal?.aborted)return null;if(done)break;bytes+=value.byteLength;if(bytes>8192){abort();return null}raw+=decoder.decode(value,{stream:true})}
  const data=JSON.parse(raw+decoder.decode());return typeof data?.code==='string'&&Object.hasOwn(codes,data.code)?data.code:null;
 }catch{return null}finally{signal?.removeEventListener('abort',abort);reader?.releaseLock()}
}
export async function generationRequestError(error,signal){
 const response=error?.context,status=response?.status||error?.status;
 if([401,403].includes(status))return generationDiagnosticError('access');
 const code=await codeFromResponse(response,signal),mapping=code&&codes[code];
 const reason=mapping&&mapping[1]===status?mapping[0]:'unavailable';
 const raw=response?.headers?.get?.('Retry-After'),seconds=Number(raw),retryAfter=(status===429||status===409&&reason==='pending')&&Number.isSafeInteger(seconds)&&seconds>0&&seconds<=86400?seconds:undefined;
 return generationDiagnosticError(reason,{retryAfter});
}
