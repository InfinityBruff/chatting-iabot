// Only operate on the queue ID recovered from a scoped cloud record.
export async function manageNativeQueue({record,store,providerKey,fetcher=fetch,cancel=false,enabled=false}){
 if(!/^acct_[A-Za-z0-9_-]+$/.test(record.binding)||! /^[1-9][0-9]*$/.test(record.queueId)||!Number.isSafeInteger(Number(record.queueId)))throw Error('Esta ejecución no tiene una referencia de cola válida');
 const authorize=async()=>{if(await store.authorize()!==record.binding)throw Error('Acceso retirado o modelo modificada')};
 await authorize();
 const base='https://api.ofmapi.com/v1/accounts/'+record.binding+'/messages-queue';
 const options={headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:AbortSignal.timeout(25000)};
 const response=await fetcher(base,{...options,method:'GET'});
 if(!response.ok)throw Error('No se pudo consultar la cola de OnlyFans');
 const data=await response.json();
 if(!Array.isArray(data.items)||!Number.isInteger(data.total)||data.total!==data.items.length)throw Error('Respuesta de cola incompleta');
 await authorize();
 const item=data.items.find(x=>String(x.id)===record.queueId);
 const state=!item?'not_found':item.isCanceled===true?'cancelled':item.hasError===true?'error':item.isDone===true?'completed':'queued';
 const result={state,queueId:record.queueId,checkedAt:new Date().toISOString(),date:item?.date||null,total:Number.isInteger(item?.total)?item.total:null,pending:Number.isInteger(item?.pending)?item.pending:null};
 if(!cancel)return result;
 if(!enabled)throw Error('Cancelación deshabilitada');
 if(state!=='queued')throw Error('El mensaje ya no está pendiente en la cola');
 // Cancellation cannot recall a message that has already fired. Never retry automatically.
 await authorize();
 let outcome;
 try{
  const r=await fetcher(base+'/'+record.queueId,{...options,method:'DELETE',signal:AbortSignal.timeout(25000)});
  const body=r.ok?await r.json():null;
  outcome=r.ok&&body?.success===true?'cancelled':r.ok&&body?.success===false?'not_cancelled':'uncertain';
 }catch{outcome='uncertain'}
 await store.record({state:outcome,queueId:record.queueId});
 return {...result,state:outcome};
}
