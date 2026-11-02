import {readFailureState} from '../live-page-policy.js';
import {useCallback,useEffect,useRef,useState} from 'react';
import {mergePage} from '../chat-sync.js';
import {readPageCache,writePageCache,clearPageCache,pageCacheEpoch} from '../live-page-cache.js';
export function useLivePage(request,workspace,account,operation,args,field,policy={}){
 const signature=JSON.stringify(args),scope=JSON.stringify([workspace,account,operation,signature]);
 const [state,setState]=useState(()=>({scope,result:readPageCache(scope),error:'',busy:false}));
 const generation=useRef(0),running=useRef(false),active=useRef(false),failures=useRef(0),waitUntil=useRef(0),retryCursor=useRef(null),limited=useRef(false),retryWake=useRef(()=>{});
 const policyRef=useRef(policy);policyRef.current=policy;
 const retain=operation==='messages'||operation==='inbox';
 const load=useCallback(async(cursor)=>{
  if(!active.current||running.current||Date.now()<waitUntil.current||retain&&document.visibilityState!=='visible')return false;
  const gen=generation.current,epoch=pageCacheEpoch();running.current=true;
  const requested=cursor||retryCursor.current;
  setState(s=>({scope,result:s.scope===scope?s.result:readPageCache(scope),error:'',waiting:false,busy:true,requestCursor:requested||null}));
  try{
   const refreshing=retain&&!requested&&!!readPageCache(scope);
   const next=await request(workspace,operation,{creator_id:account,...JSON.parse(signature),...(requested?{cursor:requested}:refreshing?{background:true}:{})},{priority:requested?'pagination':refreshing?'refresh':'interactive',active:()=>active.current&&gen===generation.current&&epoch===pageCacheEpoch()});
   if(active.current&&gen===generation.current&&epoch===pageCacheEpoch()){failures.current=0;limited.current=false;retryCursor.current=null;setState(s=>{const result=mergePage(s.scope===scope?s.result:null,next,field,{append:!!requested,retain});writePageCache(scope,result,epoch);return {scope,result,error:'',waiting:false,busy:false,requestCursor:requested||null}});return true}
  }catch(e){if(active.current&&gen===generation.current){const failure=readFailureState(e);limited.current=failure.waiting;failures.current=limited.current?0:Math.min(failures.current+1,4);retryCursor.current=requested||null;waitUntil.current=failure.retryAt;if(failure.denied)clearPageCache();setState(s=>({scope,result:failure.denied?null:s.scope===scope?s.result:null,error:failure.error,waiting:failure.waiting,busy:false,requestCursor:requested||null}));if(limited.current)retryWake.current(Math.max(1000,waitUntil.current-Date.now()));}}
  finally{if(gen===generation.current)running.current=false;}
  return false;
 },[request,workspace,account,operation,signature,scope,field,retain]);
 useEffect(()=>{
  active.current=true;running.current=false;failures.current=0;waitUntil.current=0;retryCursor.current=null;generation.current++;load();
  let timer,cancelled=false;
  const interval=operation==='messages'?5000:12000;
  const tick=async()=>{if(document.visibilityState==='visible'&&(limited.current||policyRef.current.shouldPoll?.()!==false))await load();if(!cancelled)timer=setTimeout(tick,limited.current?Math.max(1000,waitUntil.current-Date.now()):Math.max(interval*2**failures.current,waitUntil.current-Date.now()))};
  retryWake.current=delay=>{if(retain&&!cancelled){clearTimeout(timer);timer=setTimeout(tick,delay)}};
  if(retain)timer=setTimeout(tick,interval);
  const visible=()=>{if(document.visibilityState==='visible')load()};
  if(retain)document.addEventListener('visibilitychange',visible);
  return()=>{cancelled=true;active.current=false;generation.current++;running.current=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)};
 },[load,retain,operation]);
 const update=useCallback(fn=>setState(s=>{if(s.scope!==scope)return s;const result=fn(s.result);writePageCache(scope,result);return {...s,result}}),[scope]);
 return state.scope===scope?{...state,load,update}:{result:readPageCache(scope),error:'',busy:true,load,update};
}
