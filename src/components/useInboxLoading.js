import {useEffect,useRef} from 'react';
import {inboxNextPage} from '../inbox-loading.js';
import {readSession,writeSession} from '../chat-sync.js';
export function useInboxLoading(scope,{result,error,busy,load}){
 const scroll=useRef(null),seen=useRef(new Set()),initialPages=useRef(0),running=useRef(false),restored=useRef(false);
 useEffect(()=>{seen.current=new Set();initialPages.current=0;restored.current=false},[scope]);
 const next=async nearEnd=>{const cursor=inboxNextPage({page:result?.data,busy:error?false:busy,error,seen:seen.current,initialPages:initialPages.current,nearEnd});if(!cursor||running.current)return;running.current=true;try{if(await load(cursor)){seen.current.add(cursor);initialPages.current++}}finally{running.current=false}};
 useEffect(()=>{const timer=setTimeout(()=>{const el=scroll.current;if(el&&result&&!restored.current){el.scrollTop=readSession('bruff-scroll:'+scope,0);restored.current=true}next(!!el&&el.scrollTop>0&&el.scrollHeight-el.scrollTop-el.clientHeight<900)},180);return()=>clearTimeout(timer)},[scope,result,busy,error,load]);
 return {ref:scroll,onScroll:e=>{const el=e.currentTarget;writeSession('bruff-scroll:'+scope,el.scrollTop);if(el.scrollHeight-el.scrollTop-el.clientHeight<900)next(true)}};
}
