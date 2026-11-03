import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {createPageLoader} from '../page-loader.js';
import {readPageCache,writePageCache,clearPageCache,pageCacheEpoch} from '../live-page-cache.js';
export function useLivePage(request,workspace,account,operation,args,field,policy={}){
 const signature=JSON.stringify(args),scope=JSON.stringify([workspace,account,operation,signature]);
 const policyRef=useRef(policy);policyRef.current=policy;
 const retain=operation==='messages'||operation==='inbox';
 const controller=useMemo(()=>createPageLoader({field,retain,initial:readPageCache(scope),cacheEpoch:pageCacheEpoch,onDenied:clearPageCache,visible:()=>!retain||document.visibilityState==='visible',shouldPoll:()=>policyRef.current.shouldPoll?.()!==false,pollInterval:retain?(operation==='messages'?5000:12000):0,
  read:(cursor,background,active)=>request(workspace,operation,{creator_id:account,...JSON.parse(signature),...(cursor?{cursor}:background?{background:true}:{})},{priority:cursor?'pagination':background?'refresh':'interactive',active}),
  write:(value,epoch)=>writePageCache(scope,value,epoch)
 }),[request,workspace,account,operation,signature,scope,field,retain]);
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 useEffect(()=>{controller.start();const visible=()=>{if(document.visibilityState==='visible')controller.resume()};if(retain)document.addEventListener('visibilitychange',visible);return()=>{controller.stop();document.removeEventListener('visibilitychange',visible)}},[controller,retain]);
 return {...state,load:controller.load,update:controller.update};
}
