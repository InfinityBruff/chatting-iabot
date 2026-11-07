import {createCommerceStore} from '../bruff-memory/commerce-store.js';
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u.test(x);
// Trusted webhook data only. This adapter never invokes the bot queue, reads
// messages, generates text, updates a plan or sends anything to a fan.
export function createPurchaseRecorder({url,serviceKey,tursoUrl,tursoToken,enabled=false,fetcher=fetch,store:injectedStore}={}){
 let base,store=injectedStore;
 try{const u=new URL(url);if(u.protocol==='https:'&&!u.username&&!u.password&&!u.search&&!u.hash&&['','/'].includes(u.pathname))base=u.origin;if(enabled&&!store)store=createCommerceStore({url:tursoUrl,token:tursoToken,fetcher})}catch{}
 return async(event,requestSignal)=>{
  if(!enabled||!base||!store||typeof serviceKey!=='string'||!serviceKey||/[\s,]/u.test(serviceKey)||event?.kind!=='ppv_purchase')throw Error('purchase_config');
  const signal=requestSignal?AbortSignal.any([requestSignal,AbortSignal.timeout(7000)]):AbortSignal.timeout(7000);
  const resolve=async()=>{
   signal.throwIfAborted();const r=await fetcher(base+'/rest/v1/rpc/bruff_memory_event_scope',{method:'POST',redirect:'error',signal,headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({account_binding:event.account_id})});
   if(!r.ok)throw Error('purchase_scope');const reader=r.body?.getReader();if(!reader)throw Error('purchase_scope');let raw='',size=0;const decoder=new TextDecoder();
   const cancel=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',cancel,{once:true});
   try{while(true){signal.throwIfAborted();const p=await reader.read();signal.throwIfAborted();if(p.done)break;size+=p.value.byteLength;if(size>8192)throw Error('purchase_scope');raw+=decoder.decode(p.value,{stream:true})}return JSON.parse(raw+decoder.decode())}finally{signal.removeEventListener('abort',cancel);void reader.cancel().catch(()=>{});reader.releaseLock()}
  };
  const scope=await resolve();if(scope===null)return{accepted:false,queued:false};
  if(!scope||!['ownerId','workspaceId','creatorId'].every(k=>uuid(scope[k]))||scope.binding!==event.account_id||Object.keys(scope).length!==4)throw Error('purchase_scope');
  const current=await resolve();if(!current||Object.keys(current).length!==4||!['ownerId','workspaceId','creatorId','binding'].every(key=>current[key]===scope[key]))throw Error('purchase_scope_changed');
  await store.writeEvent({...scope,actorId:scope.ownerId},{eventId:event.event_id,fanId:event.fan_id,messageId:event.message_id,amountCents:event.amount_cents,occurredAt:event.occurred_at,ingestedAt:event.ingested_at,contract:event.contract},signal);
  signal.throwIfAborted();return{accepted:true,queued:false};
 };
}
