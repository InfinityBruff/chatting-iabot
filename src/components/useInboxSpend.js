import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {liveRequest} from './LiveData.jsx';
import {clearPageCache,pageCacheEpoch} from '../live-page-cache.js';
import {createInboxSpendReader,mergeInboxSpendPage} from '../inbox-spend.js';
export function useInboxSpend(workspace,account,result,update,visibleIds,{refreshToken,refreshAll=false,selectedId=null,viewportActive=true,onDenied}={}){
 const deniedHandler=useRef(onDenied);deniedHandler.current=onDenied;
 const reader=useMemo(()=>createInboxSpendReader({workspace,account,request:liveRequest,cacheEpoch:pageCacheEpoch,visible:()=>document.visibilityState==='visible',onValue:(values,checkedAt)=>update(previous=>mergeInboxSpendPage(previous,values,checkedAt)),onDenied:()=>{deniedHandler.current?.({workspace,account});update(()=>null);clearPageCache()}}),[workspace,account,update]);
 const state=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot),signature=JSON.stringify(visibleIds);
 useEffect(()=>{reader.start();const changed=()=>reader.recheckVisibility();document.addEventListener('visibilitychange',changed);return()=>{document.removeEventListener('visibilitychange',changed);reader.stop()}},[reader]);
 useEffect(()=>reader.setInput(result?.data?.conversations||[],visibleIds,{refreshToken,refreshAll,selectedId,viewportActive}),[reader,result,signature,refreshToken,refreshAll,selectedId,viewportActive]);
 return state;
}
