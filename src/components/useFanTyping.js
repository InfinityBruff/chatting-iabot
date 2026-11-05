import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {authClient} from '../auth.js';
import {pageCacheEpoch} from '../live-page-cache.js';
import {createFanTyping} from '../fan-typing.js';

// This POST uses the SDK's authenticated Response/SSE path directly. A stream
// must never occupy the scheduler used by bounded conversation/provider reads.
export default function useFanTyping({actor,workspace,account,fan,lastFanMessage,enabled=false}){
 const epoch=pageCacheEpoch(),valid=enabled&&[actor,workspace,account,fan].every(value=>typeof value==='string'&&value.trim());
 const reader=useMemo(()=>valid?createFanTyping({actor,workspace,account,fan,cacheEpoch:pageCacheEpoch,visible:()=>document.visibilityState==='visible',online:()=>typeof navigator==='undefined'||navigator.onLine!==false,
  request:async({signal,active})=>{
   if(!active())throw Object.assign(Error('Typing cancelled'),{name:'AbortError'});
   const {data,error}=await authClient.functions.invoke('bruff-live',{body:{workspace_id:workspace,creator_id:account,conversation_id:fan,operation:'typing_stream'},signal});
   if(error){
    let retryAfter=Number(error.context?.headers?.get('retry-after'));
    try{const payload=await error.context?.clone().json(),seconds=Number(payload?.retryAfter);if(Number.isFinite(seconds)&&seconds>0)retryAfter=seconds}catch{}
    throw Object.assign(Error('Typing unavailable'),{status:error.context?.status??error.status,...(Number.isFinite(retryAfter)&&retryAfter>0?{retryAfter}:{})});
   }
   return data;
  },
 }):null,[actor,workspace,account,fan,valid,epoch]);
 const value=useSyncExternalStore(reader?.subscribe||emptySubscribe,reader?.getSnapshot||emptySnapshot,emptySnapshot);
 useEffect(()=>{if(!reader)return;reader.start();const changed=()=>reader.resume();document.addEventListener('visibilitychange',changed);window.addEventListener('online',changed);window.addEventListener('offline',changed);return()=>{reader.stop();document.removeEventListener('visibilitychange',changed);window.removeEventListener('online',changed);window.removeEventListener('offline',changed)}},[reader]);
 const messageKey=lastFanMessage&&typeof lastFanMessage==='object'?JSON.stringify([lastFanMessage.id,lastFanMessage.createdAt]):lastFanMessage,seen=useRef({reader,messageKey});
 useEffect(()=>{if(seen.current.reader===reader&&seen.current.messageKey!==messageKey)reader?.clear();seen.current={reader,messageKey}},[reader,messageKey]);
 return valid&&value;
}
const emptySubscribe=()=>()=>{},emptySnapshot=()=>false;
