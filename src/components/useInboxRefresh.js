import {useMemo,useEffect,useSyncExternalStore} from 'react';
import {createInboxRefresh,mergeInboxRefresh,finishInboxRefresh} from '../inbox-refresh.js';
import {clearPageCache,pageCacheEpoch} from '../live-page-cache.js';
import {liveRequest} from './LiveData.jsx';
export function useInboxRefresh(workspace,account,query,update,onDenied){
 const controller=useMemo(()=>createInboxRefresh({cacheEpoch:pageCacheEpoch,request:(cursor,options)=>liveRequest(workspace,'inbox',{creator_id:account,query,fast:true,...(cursor?{cursor,background:true}:{})},options),onPage:page=>update(previous=>mergeInboxRefresh(previous,page)),onComplete:()=>update(finishInboxRefresh),onDenied:()=>{update(()=>null);clearPageCache();onDenied?.()}}),[workspace,account,query,update,onDenied]);
 const state=useSyncExternalStore(controller.subscribe,controller.getSnapshot,controller.getSnapshot);
 useEffect(()=>{controller.activate();return()=>controller.dispose()},[controller]);
 return {...state,start:controller.start,cancel:controller.cancel};
}
