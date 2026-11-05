import React,{useEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import ConversationGallery from './ConversationGallery.jsx';
import {createConversationGalleryReader} from '../conversation-gallery-reader.js';
import {pageCacheEpoch,clearPageCache} from '../live-page-cache.js';
import {liveRequest} from './LiveData.jsx';

// Mounted only while the gallery is open. No persistent media or fan cache.
export default function ConnectedConversationGallery({scope,actor,workspace,account,fan,model,fanName,initial,onClose,onDenied}){
 const denied=useRef(onDenied);denied.current=onDenied;
 const reader=useMemo(()=>createConversationGalleryReader({actor,workspace,account,fan,initial,cacheEpoch:pageCacheEpoch,visible:()=>document.visibilityState==='visible',
  request:(cursor,options)=>liveRequest(workspace,'messages',{creator_id:account,conversation_id:String(fan),...(cursor?{cursor}:{}),background:true},{...options,priority:cursor?'pagination':'history'}),
  onDenied:()=>{clearPageCache();denied.current?.()}
 }),[actor,workspace,account,fan]);
 const state=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot);
 useEffect(()=>{reader.start();const changed=()=>reader.resume();document.addEventListener('visibilitychange',changed);return()=>{reader.stop();document.removeEventListener('visibilitychange',changed)}},[reader]);
 useEffect(()=>{reader.ingest(initial)},[reader,initial]);
 return <ConversationGallery scope={scope} model={model} fanName={fanName} {...state} onClose={onClose} onLoadMore={()=>reader.loadMore()} onRefresh={()=>reader.refresh()} onToggleScan={()=>reader.toggleScan()}/>;
}
