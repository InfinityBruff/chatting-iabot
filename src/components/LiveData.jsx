import {liveReads,secondaryReads} from '../live-read-scheduler.js';
import React from 'react';
import {authClient} from '../auth.js';
import {useLivePage} from './useLivePage.js';
export async function liveRequest(workspace,operation,extra={},options={}){
 const run=()=>invokeLive(workspace,operation,extra);
 if(operation==='inbox'&&options.priority==='prefetch')return liveReads.secondary(run,options.active,'prefetch');
 return secondaryReads.has(operation)?liveReads.secondary(run,options.active):['inbox','messages'].includes(operation)?liveReads.primary(run,options.active,options.priority):run();
}
let quotaLogKey='';
async function invokeLive(workspace,operation,extra){
 const {data,error}=await authClient.functions.invoke('bruff-live',{body:{workspace_id:workspace,operation,...extra}});
 if(error){let payload;try{payload=await error.context.json()}catch{}const failure=Error(payload?.error||'No se pudieron consultar los datos reales.');failure.status=error.context?.status;const retry=Number(payload?.retryAfter??error.context?.headers?.get('retry-after'));if(Number.isFinite(retry)&&retry>0)failure.retryAfter=retry;if(payload?.code==='CHAT_SAFETY')failure.safety=payload.safety;if(secondaryReads.has(operation)||['inbox','messages'].includes(operation)){if(failure.status===429)liveReads.block(failure.retryAfter||60);if(payload?.readQuota)liveReads.observeQuota(payload.readQuota)}throw failure;}
 if(data?.readQuota){liveReads.observeQuota(data.readQuota);const key=JSON.stringify([data.readQuota.limit,data.readQuota.window,data.readQuota.reset]);if(key!==quotaLogKey){quotaLogKey=key;console.debug('BRUFF read budget',data.readQuota)}}
 if(data?.data?.providerStatus===429)liveReads.block(data.data.retryAfter||60);
 if(data?.error)throw Error(data.error);return data;
}
export function More({page,busy,load}){return page?.hasMore?<button disabled={busy||!page.cursor} onClick={()=>load(page.cursor)}>{busy?'Cargando…':page.cursor?'Cargar más':'El proveedor no entregó cursor; no se puede continuar'}</button>:null}
export function usePage(workspace,account,operation,args,field,policy){return useLivePage(liveRequest,workspace,account,operation,args,field,policy);}
