import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {createNotificationCategory,createNotificationCategoryCache} from '../notification-category.js';

// Filter visits share only this page's memory, scoped to the current actor and
// workspace. A new request identity cannot inherit another user's cached rows.
export function useNotificationCategory(request,workspace,ids,type,options={}){
 const scope=options.scope??workspace,signature=JSON.stringify(ids),callbacks=useRef(options);callbacks.current=options;
 const store=useMemo(()=>createNotificationCategoryCache(),[request,workspace,scope]);
 const reader=useMemo(()=>createNotificationCategory({request,workspace,ids:JSON.parse(signature),type,scope,cache:store,models:callbacks.current.models,
  peek:(...args)=>callbacks.current.peek?.(...args),subscribeInvalidation:listener=>callbacks.current.subscribeInvalidation?.(listener),onDenied:(...args)=>callbacks.current.onDenied?.(...args),visible:()=>document.visibilityState==='visible',
 }),[request,workspace,signature,type,scope,store]);
 const state=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot);
 useEffect(()=>{reader.start();const visible=()=>reader.recheckVisibility();document.addEventListener('visibilitychange',visible);return()=>{document.removeEventListener('visibilitychange',visible);reader.stop()}},[reader]);
 useEffect(()=>reader.setModels(options.models),[reader,options.models]);
 return {...state,load:reader.load};
}
