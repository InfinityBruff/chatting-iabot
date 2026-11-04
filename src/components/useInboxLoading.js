import {useEffect,useLayoutEffect,useRef} from 'react';
import {inboxNextPage} from '../inbox-loading.js';
import {createScrollMotion,scrollAheadDistance} from '../scroll-prefetch.js';
import {readSession,writeSession} from '../chat-sync.js';
export const requestInboxPage=(load,cursor,nearEnd)=>cursor?load(cursor,{priority:nearEnd?'pagination':'background'}):undefined;
export function useInboxLoading(scope,{result,error,busy,load,latencyMs=1000,pageRevision=0,requestCursor}){
 const scroll=useRef(null),seen=useRef(new Set()),initialPages=useRef(0),restored=useRef(false),saveTimer=useRef(),motion=useRef(createScrollMotion()),accepted=useRef({scope,revision:0});
 useEffect(()=>()=>clearTimeout(saveTimer.current),[]);
 useLayoutEffect(()=>{if(accepted.current.scope!==scope){seen.current=new Set();initialPages.current=0;restored.current=false;motion.current.reset(0);accepted.current={scope,revision:0}}if(pageRevision!==accepted.current.revision){if(requestCursor&&!seen.current.has(requestCursor)){seen.current.add(requestCursor);initialPages.current++}accepted.current.revision=pageRevision}},[scope,pageRevision,requestCursor]);
 const next=async nearEnd=>{const cursor=inboxNextPage({page:result?.data,busy,error,seen:seen.current,initialPages:initialPages.current,nearEnd});if(cursor)await requestInboxPage(load,cursor,nearEnd)};
 const nearEnd=el=>!!el&&el.scrollTop>0&&el.scrollHeight-el.scrollTop-el.clientHeight<scrollAheadDistance({viewport:el.clientHeight,velocity:Math.max(0,motion.current.velocity()),latencyMs});
 useEffect(()=>{const timer=setTimeout(()=>{const el=scroll.current;if(el&&result&&!restored.current){el.scrollTop=readSession('bruff-scroll:'+scope,0);restored.current=true;motion.current.reset(el.scrollTop)}void next(nearEnd(el))},180);return()=>clearTimeout(timer)},[scope,result,busy,error,load,latencyMs]);
 return {ref:scroll,onScroll:e=>{const el=e.currentTarget,top=el.scrollTop;motion.current.sample(top);clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>writeSession('bruff-scroll:'+scope,top),180);if(nearEnd(el))void next(true)}};
}
