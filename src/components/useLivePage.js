import {useCallback,useEffect,useRef,useState} from 'react';
import {mergePage} from '../chat-sync.js';
export function useLivePage(request,workspace,account,operation,args,field){
 const signature=JSON.stringify(args),scope=JSON.stringify([workspace,account,operation,signature]);
 const [state,setState]=useState({scope,result:null,error:'',busy:false});
 const generation=useRef(0),running=useRef(false),active=useRef(false),failures=useRef(0);
 const retain=operation==='messages'||operation==='inbox';
 const load=useCallback(async(cursor)=>{
  if(!active.current||running.current)return;
  const gen=generation.current;running.current=true;
  setState(s=>({scope,result:s.scope===scope?s.result:null,error:'',busy:true}));
  try{
   const next=await request(workspace,operation,{creator_id:account,...JSON.parse(signature),...(cursor?{cursor}:{})});
   if(active.current&&gen===generation.current){failures.current=0;setState(s=>({scope,result:mergePage(s.scope===scope?s.result:null,next,field,{append:!!cursor,retain}),error:'',busy:false}));}
  }catch(e){if(active.current&&gen===generation.current){failures.current=Math.min(failures.current+1,4);setState(s=>({scope,result:e.status===401||e.status===403?null:s.scope===scope?s.result:null,error:e.message,busy:false}));}}
  finally{if(gen===generation.current)running.current=false;}
 },[request,workspace,account,operation,signature,scope,field,retain]);
 useEffect(()=>{
  active.current=true;running.current=false;failures.current=0;generation.current++;load();
  let timer,cancelled=false;
  const interval=operation==='messages'?5000:12000;
  const tick=async()=>{if(document.visibilityState==='visible')await load();if(!cancelled)timer=setTimeout(tick,interval*2**failures.current)};
  if(retain)timer=setTimeout(tick,interval);
  const visible=()=>{if(document.visibilityState==='visible')load()};
  if(retain)document.addEventListener('visibilitychange',visible);
  return()=>{cancelled=true;active.current=false;generation.current++;running.current=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)};
 },[load,retain,operation]);
 const update=useCallback(fn=>setState(s=>s.scope===scope?{...s,result:fn(s.result)}:s),[scope]);
 return state.scope===scope?{...state,load,update}:{result:null,error:'',busy:true,load,update};
}
