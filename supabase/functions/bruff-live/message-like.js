import {retrySeconds} from './provider-read-guard.js';
const likeActionUuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Explicit desired state only. Never toggles blindly, retries or sends a message.
export async function likeFanMessage({input,identity,binding,providerKey,fetcher,authorize,writeEnabled,reply}){
 if(!writeEnabled)return reply(403,{error:'El conector está en modo de lectura.'});
 if(!/^\d{1,24}$/.test(input.conversation_id||'')||!/^\d{1,24}$/.test(input.message_id||'')||typeof input.conversation_id!=='string'||typeof input.message_id!=='string')return reply(400,{error:'Mensaje inválido'});
 if(input.liked!==undefined&&typeof input.liked!=='boolean'||input.action_id!==undefined&&(typeof input.action_id!=='string'||!likeActionUuid.test(input.action_id)))return reply(400,{error:'Acción de Me gusta inválida'});
 if(typeof identity?.id!=='string'||!identity.id)throw Error('access');
 // Older clients only requested a like. New clients always supply the state and action UUID.
 const liked=input.liked??true,action=input.action_id||crypto.randomUUID();
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([identity.id,input.workspace_id,input.creator_id,binding,input.conversation_id,input.message_id,liked,action])));
 const idempotency='bruff-like-'+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
 const path=`https://api.ofmapi.com/v1/accounts/${binding}/conversations/${input.conversation_id}/messages/${input.message_id}`;
 const options={headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:AbortSignal.timeout(15000)};
 const read=await fetcher(path,options);if(!read.ok)return reply(read.status===429?429:502,{error:'No se pudo comprobar este mensaje.',providerStatus:read.status,...(read.status===429?{retryAfter:retrySeconds(read.headers)}:{})});
 const message=await read.json();if(String(message.id)!==input.message_id||message.isFromMe!==false||message.fromUserId!=null&&String(message.fromUserId)!==input.conversation_id)return reply(400,{error:'Solo puedes cambiar Me gusta en mensajes de este fan.'});
 if(await authorize()!==binding)throw Error('access');
 if(message.isLiked===liked)return reply(200,{data:{id:input.message_id,isLiked:liked}});
 const response=await fetcher(path+'/like',{...options,method:liked?'POST':'DELETE',headers:{...options.headers,'Idempotency-Key':idempotency},signal:AbortSignal.timeout(15000)});
 if(!response.ok)return reply(response.status===429?429:502,{error:'No se ha confirmado el cambio de Me gusta. No se reintentará automáticamente.',providerStatus:response.status,...(response.status===429?{retryAfter:retrySeconds(response.headers)}:{})});
 const result=await response.json();if(result.success!==true)throw Error('provider');
 if(await authorize()!==binding)throw Error('access');
 return reply(200,{data:{id:input.message_id,isLiked:liked}});
}
