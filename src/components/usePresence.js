import {useEffect,useMemo,useSyncExternalStore} from 'react';
import {liveRequest} from './LiveData.jsx';
import {createPresenceController} from '../presence-controller.js';

export default function usePresence(workspace,accounts,demandIds=[],identity='',{fastModel=null}={}){
 const scope=JSON.stringify(accounts.filter(a=>a.chat===true).map(a=>a.id).sort()),demand=JSON.stringify(demandIds);
 const reader=useMemo(()=>createPresenceController({workspace,request:liveRequest,visible:()=>document.visibilityState==='visible'}),[workspace,identity]);
 const snapshot=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot);
 useEffect(()=>{reader.start();const changed=()=>reader.resume();document.addEventListener('visibilitychange',changed);return()=>{reader.stop();document.removeEventListener('visibilitychange',changed)}},[reader]);
 useEffect(()=>reader.setInput(JSON.parse(scope),JSON.parse(demand),{fastModel}),[reader,scope,demand,fastModel]);
 // Permission removal must hide cached rows in this render, before effects run.
 return useMemo(()=>{const allowed=new Set(JSON.parse(scope));return Object.fromEntries(Object.entries(snapshot).filter(([id])=>allowed.has(id)))},[snapshot,scope]);
}
