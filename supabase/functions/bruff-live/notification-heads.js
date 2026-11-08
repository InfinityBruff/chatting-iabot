import {communityNormalize} from './community.js';
import {retrySeconds} from './provider-read-guard.js';

export const notificationHeadTypes=Object.freeze(['','purchases','tip']);
const aborted=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
const failure=(status=503,providerStatus)=>({status,...(providerStatus?{providerStatus}:{}),message:status===429?'OFMAPI ha limitado esta categoría. Espera antes de actualizar.':status===504?'Esta categoría no respondió dentro del plazo. Se conserva lo ya cargado.':'No se pudo comprobar esta categoría. Se conserva lo ya cargado.'});
async function readJson(response,signal){
 if(Number(response.headers.get('content-length'))>2*1024*1024)throw Error('schema');
 const reader=response.body?.getReader();if(!reader)throw Error('schema');const decoder=new TextDecoder('utf-8',{fatal:true});let bytes=0,text='';
 const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true});
 try{signal.throwIfAborted();while(true){const part=await reader.read();signal.throwIfAborted();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2*1024*1024)throw Error('schema');text+=decoder.decode(part.value,{stream:true})}return JSON.parse(text+decoder.decode())}
 finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock()}
}

// Only the three first pages of one already-authorized binding. The existing
// provider coordinator still admits each GET and preserves the chat reservation.
// No endpoint, category, cursor, fan or provider binding comes from a branch.
export async function readNotificationHeads({binding,providerKey,fetcher=fetch,signal,budgetMs=20000}={}){
 if(typeof binding!=='string'||!/^acct_[A-Za-z0-9_-]{1,123}$/u.test(binding)||typeof providerKey!=='string'||!providerKey||!Number.isSafeInteger(budgetMs)||budgetMs<1||budgetMs>25000)throw Error('input');
 if(signal?.aborted)throw aborted();
 const controller=new AbortController(),linked=signal?AbortSignal.any([signal,controller.signal]):controller.signal,heads=Array(3);let timer,done=false,denial;
 let rejectDenied;const denied=new Promise((_,reject)=>{rejectDenied=reject});
 let rejectCancelled;const cancelled=new Promise((_,reject)=>{rejectCancelled=reject});
 const onAbort=()=>{controller.abort();rejectCancelled(aborted())};signal?.addEventListener('abort',onAbort,{once:true});
 const timeout=new Promise(resolve=>{timer=setTimeout(()=>{controller.abort();resolve()},budgetMs)});
 const jobs=notificationHeadTypes.map(async(type,index)=>{
  try{
   linked.throwIfAborted();const params=new URLSearchParams({pages:'1'});if(type)params.set('type',type);
   const response=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/notifications?'+params,{method:'GET',readPriority:'background',headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:linked});linked.throwIfAborted();
   if(response.status===401||response.status===403){denial=Object.assign(Error('access'),{providerStatus:response.status});rejectDenied(denial);throw denial}
   let result;
   if(!response.ok){result={type,error:{...failure(response.status===429?429:502,response.status),...(response.status===429?{retryAfter:retrySeconds(response.headers)}:{})}}}
   else{const payload=await readJson(response,linked);if(!Array.isArray(payload?.notifications)||typeof payload.hasMore!=='boolean'||payload.cursor!=null&&(typeof payload.cursor!=='string'||!payload.cursor||payload.cursor.length>2048)||payload.hasMore&&!payload.cursor)throw Error('schema');result={type,data:communityNormalize('notifications',payload)}}
   if(!done)heads[index]=result;
  }catch(error){if(!done)heads[index]={type,error:failure(linked.aborted?504:503)}}
 });
 try{
  await Promise.race([Promise.allSettled(jobs),timeout,denied,cancelled]);
  if(signal?.aborted)throw aborted();if(denial)throw denial;
  done=true;return {heads:notificationHeadTypes.map((type,index)=>heads[index]||{type,error:failure(504)})};
 }finally{done=true;clearTimeout(timer);signal?.removeEventListener('abort',onAbort);controller.abort()}
}
