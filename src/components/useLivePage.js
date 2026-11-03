import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {createPageLoader} from '../page-loader.js';
import {createHistoryReader} from '../history-reader.js';
import {readPageCache,writePageCache,clearPageCache,pageCacheEpoch} from '../live-page-cache.js';
const noHistorySubscribe=()=>()=>{},noHistorySnapshot=()=>null;
export function useLivePage(request,workspace,account,operation,args,field,policy={}){
 const signature=JSON.stringify(args),scope=JSON.stringify([workspace,account,operation,signature]);
 const policyRef=useRef(policy);policyRef.current=policy;
 const retain=operation==='messages'||operation==='inbox';
 const {controller,history}=useMemo(()=>{
  const visible=()=>!retain||document.visibilityState==='visible';
  const read=(cursor,background,active,onStart,preparing=false,signal)=>request(workspace,operation,{creator_id:account,...JSON.parse(signature),...(cursor?{cursor}:{}),...(background?{background:true}:{})},{priority:preparing?'history-prepare':cursor?(operation==='messages'?'history':'pagination'):background?'refresh':operation==='messages'?'conversation':'interactive',active,onStart,...(operation==='messages'&&signal?{signal}:{})});
  const history=operation==='messages'?createHistoryReader({read,cacheEpoch:pageCacheEpoch,visible,onDenied:error=>controller.deny(error.message||'No se pudo verificar el acceso a la conversación.')}):null;
  const controller=createPageLoader({field,retain,cancelReads:operation==='messages',initial:readPageCache(scope),cacheEpoch:pageCacheEpoch,onDenied:()=>{history?.stop();clearPageCache()},visible,shouldPoll:()=>policyRef.current.shouldPoll?.()!==false,pollInterval:retain?(operation==='messages'?5000:12000):0,read:history?history.read:read,
   write:(value,epoch)=>{writePageCache(scope,value,epoch);history?.prepare(value,epoch)}
  });
  return {controller,history};
 },[request,workspace,account,operation,signature,scope,field,retain]);
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 const historyStatus=useSyncExternalStore(history?.subscribe||noHistorySubscribe,history?.getSnapshot||noHistorySnapshot,noHistorySnapshot);
 useEffect(()=>{history?.start();controller.start();history?.prepare(controller.getSnapshot().result);const visible=()=>{if(document.visibilityState==='visible'){controller.resume();history?.prepare(controller.getSnapshot().result)}};if(retain)document.addEventListener('visibilitychange',visible);return()=>{history?.stop();controller.stop();document.removeEventListener('visibilitychange',visible)}},[controller,history,retain]);
 return {...state,historyStatus,load:controller.load,update:controller.update};
}
