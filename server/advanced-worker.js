import {advancedStore} from './advanced-store.js';
import {advancedProvider} from './advanced-provider.js';
import {deliverAdvanced} from './advanced-delivery.js';
// Called by the server-only, secret-authenticated scheduler route.
export async function runAdvancedTick({token,rpc,providerKey,fetcher=fetch,writeEnabled=false}){
 const batch=await rpc('bruff_advanced_poll',{token,can_send:writeEnabled===true});
 if(!batch||typeof batch.ready!=='boolean'||!Array.isArray(batch.deliveries)||batch.deliveries.length>4)throw Error('Respuesta de programador inválida');
 if(!writeEnabled||!batch.ready)return {ready:false,processed:0};
 const results=await Promise.allSettled(batch.deliveries.map(async delivery=>{
  let claimed;
  const call=async(name,body)=>{try{return{data:await rpc(name==='bruff_advanced_delivery'?'bruff_advanced_execute':name,body),error:null}}catch(error){return{data:null,error}}};
  const store=advancedStore({rpc:call,context:async claim=>{
   const data=await rpc('bruff_advanced_context',{op:'context',delivery_id:claim.id,lease_id:claim.lease,expected_revision:claim.revision});
   if(data.binding!==delivery.binding)throw Error('Conexión modificada');
   const fan=await provider.fan();return {...data,fanName:fan.fanName,replyAfterPrevious:false};
  },moderate:async(claim,payload)=>{
   const result=await rpc('bruff_advanced_context',{op:'screen',delivery_id:claim.id,lease_id:claim.lease,expected_revision:claim.revision,body:payload.text});return result?.allowed===true;
  }});
  const original=store.claim;store.claim=async id=>{claimed=await original(id);return claimed};
  const provider=advancedProvider({scope:delivery.scope,binding:delivery.binding,providerKey,fetcher,enabled:true,authorize:async()=>claimed&&(await rpc('bruff_advanced_transport_authorize',{delivery_id:claimed.id,lease_id:claimed.lease,expected_revision:claimed.revision}))===true?delivery.binding:null});
  // Only mass step zero is currently admitted by the preparation RPC.
  const originalClaim=store.claim;store.claim=async id=>{const claim=await originalClaim(id);if(claim&&(claim.trigger!=='mass'||claim.stepIndex!==0)){await store.release(claim,{reason:'Disparador no conectado a este ejecutor'});return null}return claim};
  return deliverAdvanced({delivery,store,provider,enabled:true});
 }));
 return {ready:true,processed:results.length,results:results.map(r=>r.status==='fulfilled'?r.value.status:'error')};
}
