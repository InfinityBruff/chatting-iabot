import {useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {createCollectionCatalog} from '../collection-catalog.js';
import {pageCacheEpoch} from '../live-page-cache.js';
import {liveRequest} from './LiveData.jsx';

export default function useCollectionCatalog({actor,workspace,account,enabled=true,request=liveRequest,onDenied}={}){
 const epoch=pageCacheEpoch(),options=useRef({enabled,onDenied});options.current={enabled,onDenied};
 const valid=[actor,workspace,account].every(value=>typeof value==='string'&&value.trim());
 const reader=useMemo(()=>valid?createCollectionCatalog({actor,workspace,account,request,cacheEpoch:pageCacheEpoch,visible:()=>options.current.enabled&&document.visibilityState==='visible',onDenied:error=>options.current.onDenied?.(error)}):null,[actor,workspace,account,request,epoch,valid]);
 const state=useSyncExternalStore(reader?.subscribe||emptySubscribe,reader?.getSnapshot||emptySnapshot,emptySnapshot);
 useEffect(()=>{if(!reader)return;reader.start();const visible=()=>reader.recheckVisibility();document.addEventListener('visibilitychange',visible);return()=>{document.removeEventListener('visibilitychange',visible);reader.stop()}},[reader]);
 useEffect(()=>reader?.recheckVisibility(),[reader,enabled]);
 return {...state,refresh:reader?.refresh||noAction,deny:reader?.deny||noAction,invalidate:reader?.invalidate||noAction};
}
const emptySubscribe=()=>()=>{},empty=Object.freeze({rows:[],complete:false,busy:false,queued:false,waiting:false,checked:null,error:'',denied:false,pages:0}),emptySnapshot=()=>empty,noAction=()=>false;
