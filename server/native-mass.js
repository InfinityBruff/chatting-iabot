import {preparationPlan} from './advanced-preparation.js';
import {advancedProvider} from './advanced-provider.js';
const safeId=x=>typeof x==='string'&&/^[1-9][0-9]*$/.test(x)&&Number.isSafeInteger(Number(x));
export function nativeMassPayload(config,recipientIds,now=Date.now()){
 preparationPlan(config,new Date(now).toISOString());
 if(config.timeWindow?.enabled||config.ending?.enabled||config.unsend?.enabled)throw Error('La franja horaria requiere el ejecutor personalizado');
 if(config.bulk.repeat)throw Error('La repetición requiere el programador de BRUFF');
 const m=config.messages[0];
 if(m.text.includes('{nombre}'))throw Error('Los nombres por fan requieren el ejecutor personalizado');
 if(!Array.isArray(recipientIds)||!recipientIds.length||recipientIds.some(x=>!safeId(x))||new Set(recipientIds).size!==recipientIds.length)throw Error('Audiencia no verificada');
 // Explicit recipients preserve exclusions and the exact audience reviewed by the owner.
 return {text:m.text,media:m.media.map(x=>Number(x.id)),price:m.paidMedia||m.paidText?Number(m.price):0,lockedText:m.paidText===true,recipients:recipientIds.map(Number),...(config.bulk.schedule==='scheduled'?{scheduleAt:new Date(config.bulk.at).toISOString()}: {})};
}
export async function submitNativeMass({record,store,providerKey,fetcher=fetch,enabled=false,now=()=>Date.now()}){
 if(!enabled)throw Error('Envíos masivos nativos deshabilitados');
 const payload=nativeMassPayload(record.config,record.recipients,now());
 const scope={workspace:record.workspace,creator:record.creator,fan:record.recipients[0]};
 const media=advancedProvider({scope,binding:record.binding,providerKey,authorize:()=>store.authorize(record),fetcher});
 await media.resolveMedia(scope,record.config.messages[0].media);
 const tags=record.config.messages[0].tags||[];if(tags.length)payload.tagUsers=await media.resolveTags(scope,tags);
 if(!await store.moderate(record,payload.text))throw Error('Mensaje bloqueado por moderación');
 // A long vault lookup must not turn a scheduled campaign into an immediate send.
 nativeMassPayload(record.config,record.recipients,now());
 if(!await store.begin(record,payload))throw Error('La preparación ha cambiado o ya fue enviada');
 try{
  if(await store.authorize(record)!==record.binding)throw Error('Acceso retirado');
  const response=await fetcher('https://api.ofmapi.com/v1/accounts/'+record.binding+'/mass-messages',{method:'POST',headers:{Authorization:'Bearer '+providerKey,'Content-Type':'application/json','Idempotency-Key':'bruff-native-'+record.id},body:JSON.stringify(payload),redirect:'error',signal:AbortSignal.timeout(25000)});
  if(!response.ok)throw Error('Sin confirmación');
  const data=await response.json(),queueId=Number.isSafeInteger(data.queueId)&&data.queueId>0?String(data.queueId):null,messageId=Number.isSafeInteger(data.id)&&data.id>0?String(data.id):null;
  if(!queueId&&!messageId)throw Error('Confirmación incompleta');
  // Accepted is not proof that every recipient received it.
  await store.finish(record,{state:'accepted',queueId,messageId});
  return {state:'accepted',queueId,messageId,deliveredCount:null};
 }catch{
  await store.finish(record,{state:'uncertain',queueId:null,messageId:null});
  return {state:'uncertain',deliveredCount:null};
 }
}
