import {useCallback,useEffect,useRef,useState} from 'react';
import {mergePage} from '../chat-sync.js';
import {readPageCache,writePageCache,clearPageCache,pageCacheEpoch} from '../live-page-cache.js';
export function useLivePage(request,workspace,account,operation,args,field){
 const signature=JSON.stringify(args),scope=JSON.stringify([workspace,account,operation,signature]);
 const [state,setState]=useState(()=>({scope,result:readPageCache(scope),error:'',busy:false}));
 const generation=useRef(0),running=useRef(false),active=useRef(false),failures=useRef(0),waitUntil=useRef(0),retryCursor=useRef(null),limited=useRef(false),retryWake=useRef(()=>{});
 const retain=operation==='messages'||operation==='inbox';
 const load=useCallback(async(cursor)=>{
  if(!active.current||running.current||Date.now()<waitUntil.current)return false;
  const gen=generation.current,epoch=pageCacheEpoch();running.current=true;
  const requested=cursor||retryCursor.current;
  setState(s=>({scope,result:s.scope===scope?s.result:readPageCache(scope),error:'',busy:true,requestCursor:requested||null}));
  try{
   const next=await request(workspace,operation,{creator_id:account,...JSON.parse(signature),...(requested?{cursor:requested}:{})},{active:()=>active.current&&gen===generation.current&&epoch===pageCacheEpoch()});
   if(active.current&&gen===generation.current&&epoch===pageCacheEpoch()){failures.current=0;limited.current=false;retryCursor.current=null;setState(s=>{const result=mergePage(s.scope===scope?s.result:null,next,field,{append:!!requested,retain});writePageCache(scope,result,epoch);return {scope,result,error:'',busy:false,requestCursor:requested||null}});return true}
  }catch(e){if(active.current&&gen===generation.current){limited.current=e.status===429;failures.current=limited.current?0:Math.min(failures.current+1,4);retryCursor.current=requested||null;waitUntil.current=Date.now()+Math.max(0,Number(e.retryAfter)||0)*1000;if(e.status===401||e.status===403)clearPageCache();setState(s=>({scope,result:e.status===401||e.status===403?null:s.scope===scope?s.result:null,error:e.message,busy:false,requestCursor:requested||null}));if(limited.current)retryWake.current(Math.max(1000,waitUntil.current-Date.now()));}}
  finally{if(gen===generation.current)running.current=false;}
  return false;
 },[request,workspace,account,operation,signature,scope,field,retain]);
 useEffect(()=>{
  active.current=true;running.current=false;failures.current=0;waitUntil.current=0;retryCursor.current=null;generation.current++;load();
  let timer,cancelled=false;
  const interval=operation==='messages'?5000:12000;
  const tick=async()=>{if(document.visibilityState==='visible')await load();if(!cancelled)timer=setTimeout(tick,limited.current?Math.max(1000,waitUntil.current-Date.now()):Math.max(interval*2**failures.current,waitUntil.current-Date.now()))};
  retryWake.current=delay=>{if(retain&&!cancelled){clearTimeout(timer);timer=setTimeout(tick,delay)}};
  if(retain)timer=setTimeout(tick,interval);
  const visible=()=>{if(document.visibilityState==='visible')load()};
  if(retain)document.addEventListener('visibilitychange',visible);
  return()=>{cancelled=true;active.current=false;generation.current++;running.current=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)};
 },[load,retain,operation]);
 const update=useCallback(fn=>setState(s=>{if(s.scope!==scope)return s;const result=fn(s.result);writePageCache(scope,result);return {...s,result}}),[scope]);
 return state.scope===scope?{...state,load,update}:{result:readPageCache(scope),error:'',busy:true,load,update};
}
