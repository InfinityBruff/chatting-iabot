// Server-only adapter. rpc must use the worker credential, never a browser session.
export function advancedStore({rpc,context,moderate}){
 const call=(op,claim,value)=>rpc('bruff_advanced_delivery',{op,delivery_id:typeof claim==='string'?claim:claim.id,lease_id:typeof claim==='string'?null:claim.lease,expected_revision:typeof claim==='string'?null:claim.revision,value:value??null});
 return {
  claim:id=>call('claim',id),
  authorize:claim=>call('authorize',claim),
  begin:(claim,payload)=>call('begin',claim,payload),
  release:async(claim,result)=>{if(await call('release',claim,result)!==true)throw Error('No se pudo registrar la interrupción')},
  finish:async(claim,result)=>{if(await call('finish',claim,result)!==true)throw Error('No se pudo persistir el resultado')},
  context,moderate
 };
}
