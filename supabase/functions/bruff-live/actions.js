// Capability tickets bind attachments and reviewed sends to one authenticated actor/model.
import {retrySeconds} from './provider-read-guard.js';
const encode=value=>btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(value)))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const bytes=value=>Uint8Array.from(atob(value.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
export async function tickets(secret,scope){
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
 return {
  async sign(kind,value){const payload=encode({scope,kind,value,expires:Date.now()+3600000});const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(payload));return payload+'.'+btoa(String.fromCharCode(...new Uint8Array(sig))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')},
  async read(token,kind){try{if(typeof token!=='string'||token.length>60000)throw Error();const [payload,sig,...rest]=token.split('.');if(rest.length||!await crypto.subtle.verify('HMAC',key,bytes(sig),new TextEncoder().encode(payload)))throw Error();const data=JSON.parse(new TextDecoder().decode(bytes(payload)));if(data.scope!==scope||data.kind!==kind||data.expires<Date.now()||data.expires>Date.now()+3600000)throw Error();return data.value}catch{throw Error('ticket')}}
 };
}
export function mediaView(item,binding){
 const safe=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.hostname==='api.ofmapi.com'&&!u.username&&!u.password&&u.pathname===`/v1/accounts/${binding}/media/download`?u.href:null}catch{return null}};
 return {id:String(item.id??''),type:item.type,createdAt:item.createdAt,isReady:item.isReady,canView:item.canView,duration:item.duration,isDrm:item.isDrm,convertedToVideo:item.convertedToVideo,hasError:item.hasError,
  url:item.canView===true?safe(item.downloadUrl):null,preview:item.canView===true?[item.downloadUrls?.thumb,item.downloadUrls?.squarePreview,item.downloadUrls?.preview,(['photo','gif'].includes(item.type)&&!item.convertedToVideo)?item.downloadUrls?.full:null].map(safe).find(Boolean)||null:null,previewSources:item.canView===true?[...new Set([item.downloadUrls?.thumb,item.downloadUrls?.squarePreview,item.downloadUrls?.preview,(['photo','gif'].includes(item.type)&&!item.convertedToVideo)?item.downloadUrls?.full:null].map(safe).filter(Boolean))]:[]};
}
export const actionNames=['vault_categories','vault_media','prepare_send','send_message','upload'];
export async function liveAction({input,identity,binding,providerKey,fetcher,authorize,reply,writeEnabled,screen,beginSend,finishSend}){
 const op=input.operation;
 const inspect=async(fan,text)=>{if(typeof screen!=='function')throw Error('safety');const safety=await screen(fan,text);return safety.allowed?null:reply(423,{error:safety.blocked?'No puedes volver a hablar hasta que el propietario lo considere.':'Mensaje detenido por la lista interna de BRUFF. Corrige el texto antes de enviarlo.',code:'CHAT_SAFETY',safety})};
 const capability=await tickets(providerKey,JSON.stringify([identity.id,input.workspace_id,input.creator_id,binding]));
 const upstream=async(path,options={})=>fetcher(`https://api.ofmapi.com/v1/accounts/${binding}/${path}`,{...options,headers:{Authorization:'Bearer '+providerKey,...options.headers},redirect:'error',signal:AbortSignal.timeout(op==='upload'?90000:25000)});
 const fail=r=>reply(r.status===429?429:502,{error:r.status===403?'OFMAPI no autoriza esta operación. Revisa el permiso de escritura de la clave.':'El proveedor no confirmó la operación. No se reintentará automáticamente.',providerStatus:r.status});
 if(op==='vault_categories'||op==='vault_media'){
  const params=new URLSearchParams();if(input.cursor!=null){if(typeof input.cursor!=='string'||input.cursor.length>2048)return reply(400,{error:'Cursor inválido'});params.set('cursor',input.cursor)}
  if(op==='vault_media'){
   params.set('pages','1');if(input.category){if(!/^\d{1,20}$/.test(input.category))return reply(400,{error:'Carpeta inválida'});params.set('category',input.category)}
   if(input.type){if(!['all','photo','video','audio','gif'].includes(input.type))return reply(400,{error:'Tipo inválido'});params.set('type',input.type)}
   if(input.query){if(typeof input.query!=='string'||input.query.length>150)return reply(400,{error:'Búsqueda inválida'});params.set('query',input.query)}
  }
  const r=await upstream((op==='vault_media'?'vault/media':'vault/categories')+'?'+params);if(!r.ok){if(r.status===429)throw Object.assign(Error('provider'),{providerStatus:429,retryAfter:retrySeconds(r.headers)});return reply(502,{error:r.status===403?'OFMAPI no autoriza consultar el baúl. Revisa el permiso de lectura de la clave.':'OFMAPI no pudo consultar el baúl de esta cuenta. Inténtalo más tarde.',providerStatus:r.status})}const data=await r.json();const field=op==='vault_media'?'media':'categories';if(!Array.isArray(data[field]))throw Error('schema');
  const rows=await Promise.all(data[field].map(async x=>field==='categories'?{id:x.id,name:x.name,photosCount:x.photosCount,videosCount:x.videosCount,audiosCount:x.audiosCount,gifsCount:x.gifsCount}:{...mediaView(x,binding),attachment:x.canView===true&&x.isReady===true&&!x.hasError&&/^\d+$/.test(String(x.id))&&Number.isSafeInteger(Number(x.id))?await capability.sign('attachment',Number(x.id)):null}));
  if(await authorize()!==binding)throw Error('access');return reply(200,{data:{[field]:rows,cursor:typeof data.cursor==='string'?data.cursor:null,hasMore:data.hasMore===true},observedAt:new Date().toISOString()});
 }
 if(!writeEnabled)return reply(503,{error:'Envíos pendientes de habilitar: la conexión está en modo de lectura.'});
 if(op==='upload'){
  const file=input.file;if(!(file instanceof Blob)||file.size===0||file.size>10*1024*1024||!['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','audio/mpeg','audio/mp4','audio/wav','audio/ogg'].includes(file.type))return reply(400,{error:'Elige una imagen, vídeo o audio compatible de hasta 10 MB.'});
  const form=new FormData();form.set('file',file,file.name||'archivo');form.set('wait','true');form.set('secure','false');
  const r=await upstream('uploads',{method:'POST',body:form});if(!r.ok)return fail(r);const data=await r.json();if(!data.id||!data.host||!data.name)throw Error('schema');
  if(await authorize()!==binding)throw Error('access');return reply(200,{data:{name:file.name,attachment:await capability.sign('attachment',{id:data.id,host:data.host,name:data.name,extra:data.extra??null})}});
 }
 if(op==='prepare_send'){
  if(typeof input.conversation_id!=='string'||!/^\d{1,24}$/.test(input.conversation_id)||typeof input.text!=='string'||input.text.length>10000||!Array.isArray(input.attachments)||input.attachments.length>10||(!input.text.trim()&&!input.attachments.length))return reply(400,{error:'Revisa el mensaje: texto o archivos, máximo 10 adjuntos.'});
  const price=input.price===undefined?0:input.price;
  if(typeof price!=='number'||!Number.isFinite(price)||price<0||!Number.isSafeInteger(Math.round(price*100))||Math.abs(price*100-Math.round(price*100))>0.0000001)return reply(400,{error:'Introduce un precio válido en USD, con un máximo de dos decimales.'});
  if(price>0&&!input.attachments.length)return reply(400,{error:'Adjunta contenido para poner un precio. El texto acompañante será visible sin pagar.'});
  const replyTo=input.replyTo;
  if(replyTo!=null&&(typeof replyTo!=='string'||!/^\d{1,24}$/.test(replyTo)||!Number.isSafeInteger(Number(replyTo))||Number(replyTo)<=0||String(Number(replyTo))!==replyTo))return reply(400,{error:'Elige un mensaje válido de este fan para responder.'});
  const media=await Promise.all(input.attachments.map(t=>capability.read(t,'attachment')));
  const stopped=await inspect(input.conversation_id,input.text);if(stopped)return stopped;
  if(replyTo!=null){
   const response=await upstream(`conversations/${input.conversation_id}/messages/${replyTo}`);
   if(!response.ok){if(response.status===429)throw Object.assign(Error('provider'),{providerStatus:429,retryAfter:retrySeconds(response.headers)});return reply(response.status===404?400:502,{error:'No se pudo comprobar el mensaje al que respondes. No se ha enviado nada.'})}
   const target=await response.json();
   if(String(target.id)!==replyTo||target.isFromMe!==false||target.fromUserId!=null&&String(target.fromUserId)!==input.conversation_id)return reply(400,{error:'Solo puedes responder a un mensaje de este fan.'});
   if(await authorize()!==binding)throw Error('access');
  }
  const value={conversation:input.conversation_id,body:{text:input.text,media,price:Math.round(price*100)/100,lockedText:false,typingWpm:200,...(replyTo!=null?{replyTo:Number(replyTo)}:{})},id:crypto.randomUUID()};
  return reply(200,{data:{ticket:await capability.sign('send',value),price:value.body.price,...(replyTo!=null?{replyTo}:{})}});
 }
 const send=await capability.read(input.ticket,'send');
 const stopped=await inspect(send.conversation,send.body.text);if(stopped)return stopped;
 if(typeof beginSend!=='function'||typeof finishSend!=='function')throw Error('attribution');
 const author=await beginSend(send.conversation,send.id);
 if(!author||typeof author.name!=='string')throw Error('attribution');
 if(author.messageId)return reply(200,{data:{id:author.messageId,status:'sent',sentBy:author.name}});
 // A reviewed ticket is immutable and expires well before the provider's 24h replay window.
 if(await authorize()!==binding)throw Error('access');
 const r=await upstream(`conversations/${send.conversation}/messages`,{method:'POST',headers:{'Content-Type':'application/json','Idempotency-Key':'bruff-'+send.id},body:JSON.stringify(send.body)});
 if(!r.ok)return fail(r);const data=await r.json();if(!data.id)return reply(502,{error:'El proveedor no confirmó un ID de mensaje. Revisa el historial antes de redactar otro.'});
 await finishSend(send.conversation,send.id,String(data.id));
 return reply(200,{data:{id:data.id,createdAt:data.createdAt,status:'sent',sentBy:author.name}});
}
