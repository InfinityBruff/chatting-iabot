import {liveReads,secondaryReads,foregroundReads} from '../live-read-scheduler.js';
import React from 'react';
import {authClient} from '../auth.js';
import {useLivePage} from './useLivePage.js';
import {startupReadError} from '../startup-read-error.js';
import {cancellableLiveRead} from '../live-read-cancellation.js';
import {scheduleLiveRead,liveReadArgs} from '../live-read-priority.js';
export async function liveRequest(workspace,operation,extra={},options={}){
 const signal=cancellableLiveRead(operation,extra)?options.signal:undefined,parameters=liveReadArgs(operation,extra,options);
 const run=()=>{if(signal?.aborted)throw Object.assign(Error('Consulta cancelada'),{name:'AbortError'});options.onStart?.();return invokeLive(workspace,operation,parameters,signal)};
 return scheduleLiveRead(liveReads,operation,run,options,parameters);
}
let quotaLogKey='';
async function invokeLive(workspace,operation,extra,signal){
 const {data,error}=await authClient.functions.invoke('bruff-live',{body:{workspace_id:workspace,operation,...extra},...(signal?{signal}:{})});
 if(signal?.aborted)throw Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
 if(error){let payload;try{payload=await error.context.json()}catch{}const failure=Error(startupReadError(operation,payload,error.context?.status));failure.status=error.context?.status;if(Number.isInteger(payload?.providerStatus)&&payload.providerStatus>=400&&payload.providerStatus<=599)failure.providerStatus=payload.providerStatus;const retry=Number(payload?.retryAfter??error.context?.headers?.get('retry-after'));if(Number.isFinite(retry)&&retry>0)failure.retryAfter=retry;if(payload?.code==='CHAT_SAFETY')failure.safety=payload.safety;if(secondaryReads.has(operation)||foregroundReads.has(operation)){if(failure.status===429)liveReads.block(failure.retryAfter||60);if(payload?.readQuota)liveReads.observeQuota(payload.readQuota)}throw failure;}
 if(data?.readQuota){liveReads.observeQuota(data.readQuota);const key=JSON.stringify([data.readQuota.limit,data.readQuota.window,data.readQuota.reset]);if(key!==quotaLogKey){quotaLogKey=key;console.debug('BRUFF read budget',data.readQuota)}}
 if(data?.data?.providerStatus===429)liveReads.block(data.data.retryAfter||60);
 if(data?.error)throw Error(data.error);return data;
}
export function More({page,busy,load}){return page?.hasMore?<button disabled={busy||!page.cursor} onClick={()=>load(page.cursor)}>{busy?'Cargando…':page.cursor?'Cargar más':'El proveedor no entregó cursor; no se puede continuar'}</button>:null}
export function usePage(workspace,account,operation,args,field,policy){return useLivePage(liveRequest,workspace,account,operation,args,field,policy);}
