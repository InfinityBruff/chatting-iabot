import {personalizeMessage} from '../src/dynamic-name.js';

const sameScope=(a,b)=>a&&b&&['workspace','creator','fan'].every(k=>typeof a[k]==='string'&&a[k]&&a[k]===b[k]);
// Adapter contract: claim/authorize/begin/finish MUST be durable server operations.
// begin atomically checks activation, revision, current access and lease ownership.
// No routes, schedules or provider credentials are installed by this module.
export async function deliverAdvanced({delivery,store,provider,enabled=false,now=()=>Date.now()}){
 if(!enabled)return {status:'disabled'};
 if(!delivery?.id||!delivery.scope||!delivery.activationId)throw Error('Entrega sin activación o ámbito');
 const claim=await store.claim(delivery.id);
 if(!claim)return {status:'not_claimed'};
 if(!sameScope(claim.scope,delivery.scope)||claim.activationId!==delivery.activationId)throw Error('Entrega de otro ámbito');
 if(claim.status!=='claimed'||!claim.lease||!Number.isSafeInteger(claim.revision))throw Error('Reserva inválida');
 let begun=false;
 const stop=async(reason)=>{await store.release(claim,{reason});return {status:'stopped',reason}};
 try{
  if(!await store.authorize(claim))return await stop('Sin permiso o campaña detenida');
  if(!Number.isFinite(Date.parse(claim.dueAt))||Date.parse(claim.dueAt)>now())return await stop('Todavía no corresponde enviar');
  if(!Number.isFinite(Date.parse(claim.expiresAt))||Date.parse(claim.expiresAt)<=now())return await stop('Reserva caducada');
  const context=await store.context(claim);
  if(!sameScope(context?.scope,claim.scope))throw Error('Contexto de otro fan o modelo');
  if(context.replyAfterPrevious===true&&claim.stepIndex>0)return await stop('El fan ha respondido');
  if(context.replyAfterPrevious!==false&&claim.stepIndex>0)throw Error('No se pudo verificar la respuesta del fan');
  if(claim.trigger==='online'&&(context.online!==true||!Number.isFinite(Date.parse(context.presenceAt))||now()-Date.parse(context.presenceAt)>45000||Date.parse(context.presenceAt)>now()))return await stop('Presencia no confirmada');
  const rendered=personalizeMessage(claim.message,{fan:context.fanName,custom:context.customName});
  const media=await provider.resolveMedia(claim.scope,claim.message.media);
  if(!sameScope(media?.scope,claim.scope)||media.verified!==true)throw Error('No se pudo verificar el contenido de esta modelo');
  const payload={text:rendered.text,media:media.items,price:claim.message.paidMedia||claim.message.paidText?Number(claim.message.price):0,lockedText:claim.message.paidText===true};
  if(!await store.moderate(claim,payload))return await stop('Contenido bloqueado por moderación');
  // begin records the exact payload once. A changed alias cannot alter an uncertain retry.
  if(!await store.begin(claim,payload,now()))return await stop('Campaña pausada, modificada o acceso retirado');
  begun=true;
  const response=await provider.send(claim.scope,payload,{idempotencyKey:'bruff-advanced-'+claim.id});
  if(!/^\d{1,24}$/.test(String(response?.id)))throw Error('Sin confirmación del proveedor');
  await store.finish(claim,{status:'sent',providerId:String(response.id),nameSource:rendered.source});
  return {status:'sent',providerId:String(response.id)};
 }catch(error){
  // Once a write may have started, never release it for automatic resend.
  if(begun){await store.finish(claim,{status:'uncertain',reason:'Entrega sin confirmación persistida; requiere revisión'});return {status:'uncertain'}}
  await store.release(claim,{reason:'Preparación incompleta'});return {status:'blocked'};
 }
}
