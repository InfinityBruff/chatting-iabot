// Server-only adapter. rpc must use the worker credential, never a browser session.
export function advancedStore({rpc,context,moderate}){
 const call=async(op,claim,value)=>{
  const result=await rpc('bruff_advanced_delivery',{op,delivery_id:typeof claim==='string'?claim:claim.id,lease_id:typeof claim==='string'?null:claim.lease,expected_revision:typeof claim==='string'?null:claim.revision,value:value??null});
  // Supabase returns an envelope, not the SQL boolean. Never authorize on object truthiness.
  if(!result||!Object.hasOwn(result,'data')||!Object.hasOwn(result,'error'))throw Error('Respuesta RPC inválida');
  if(result.error)throw Error('No se pudo verificar la cola de entregas');
  return result.data;
 };
 return {
  claim:id=>call('claim',id),
  authorize:async claim=>(await call('authorize',claim))===true,
  begin:async(claim,payload)=>(await call('begin',claim,payload))===true,
  release:async(claim,result)=>{if(await call('release',claim,result)!==true)throw Error('No se pudo registrar la interrupción')},
  finish:async(claim,result)=>{if(await call('finish',claim,result)!==true)throw Error('No se pudo persistir el resultado')},
  context,moderate
 };
}
