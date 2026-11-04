import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {liveRequest} from './LiveData.jsx';
import {clearPageCache} from '../live-page-cache.js';
import {createInboxSpendReader,mergeInboxSpendPage} from '../inbox-spend.js';
export function useInboxSpend(workspace,account,result,update,visibleIds,{refreshToken,refreshAll=false,selectedId=null}={}){
 const reader=useMemo(()=>createInboxSpendReader({workspace,account,request:liveRequest,visible:()=>document.visibilityState==='visible',onValue:(values,checkedAt)=>update(previous=>mergeInboxSpendPage(previous,values,checkedAt)),onDenied:()=>{update(()=>null);clearPageCache()}}),[workspace,account,update]);
 const state=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot),signature=JSON.stringify(visibleIds);
 useEffect(()=>{reader.start();return()=>reader.stop()},[reader]);
 useEffect(()=>reader.setInput(result?.data?.conversations||[],visibleIds,{refreshToken,refreshAll,selectedId}),[reader,result,signature,refreshToken,refreshAll,selectedId]);
 return state;
}
