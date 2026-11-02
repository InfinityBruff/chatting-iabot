// Explicit user interaction only. Never toggles, retries or sends a message.
export async function likeFanMessage({input,binding,providerKey,fetcher,authorize,writeEnabled,reply}){
 if(!writeEnabled)return reply(403,{error:'El conector está en modo de lectura.'});
 if(!/^\d{1,24}$/.test(input.conversation_id||'')||!/^\d{1,24}$/.test(input.message_id||'')||typeof input.conversation_id!=='string'||typeof input.message_id!=='string')return reply(400,{error:'Mensaje inválido'});
 const path=`https://api.ofmapi.com/v1/accounts/${binding}/conversations/${input.conversation_id}/messages/${input.message_id}`;
 const options={headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:AbortSignal.timeout(15000)};
 const read=await fetcher(path,options);if(!read.ok)return reply(read.status===429?429:502,{error:'No se pudo comprobar este mensaje.',...(read.status===429?{retryAfter:60}:{})});
 const message=await read.json();if(String(message.id)!==input.message_id||message.isFromMe!==false)return reply(400,{error:'Solo puedes indicar Me gusta en mensajes del fan.'});
 if(await authorize()!==binding)throw Error('access');
 if(message.isLiked===true)return reply(200,{data:{id:input.message_id,isLiked:true}});
 const response=await fetcher(path+'/like',{...options,method:'POST',signal:AbortSignal.timeout(15000)});
 if(!response.ok)return reply(response.status===429?429:502,{error:'No se ha confirmado el Me gusta. No se reintentará automáticamente.'});
 const result=await response.json();if(result.success!==true)throw Error('provider');
 if(await authorize()!==binding)throw Error('access');
 return reply(200,{data:{id:input.message_id,isLiked:true}});
}
