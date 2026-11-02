import {resolveMassAudience,AudiencePending,AudienceError} from './advanced-audience.js';
// Service-side adapter. Every checkpoint RPC is scoped by authenticated actor,
// persisted draft version and database-derived provider binding, never client IDs.
export async function discoverAudience({config,binding,authorize,providerKey,fetcher,checkpointRpc,financialContext}){
 const reservation=await checkpointRpc('acquire');
 if(reservation?.busy===true)return {complete:false,retryAfter:reservation.retryAfter,activated:false};
 if(typeof reservation?.lease!=='string')throw new AudienceError('No se pudo reservar la sincronización');
 const lease=reservation.lease;
 const change=async(op,value,wait=0)=>{if(await checkpointRpc(op,lease,value,wait)!==true)throw new AudienceError('El avance cambió o se retiró el acceso; vuelve a comprobar la campaña')};
 try{
  const result=await resolveMassAudience({config,binding,authorize,providerKey,fetcher,financialContext,checkpoint:reservation.checkpoint,saveCheckpoint:value=>change('save',value),pageBudget:1});
  await change('release',null,0);
  return result;
 }catch(e){
  if(e instanceof AudiencePending){await change('release',null,e.retryAfter);return {complete:false,retryAfter:e.retryAfter,activated:false,message:e.message}}
  // Keep a valid checkpoint on transient network errors; never hide authorization failures.
  await change('release',null,60);
  throw e;
 }
}
