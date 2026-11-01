import {useEffect,useRef} from 'react';
import {inboxNextPage} from '../inbox-loading.js';
export function useInboxLoading(scope,{result,error,busy,load}){
 const scroll=useRef(null),seen=useRef(new Set()),initialPages=useRef(0);
 useEffect(()=>{seen.current=new Set();initialPages.current=0;if(scroll.current)scroll.current.scrollTop=0},[scope]);
 const next=nearEnd=>{const cursor=inboxNextPage({page:result?.data,busy,error,seen:seen.current,initialPages:initialPages.current,nearEnd});if(!cursor)return;seen.current.add(cursor);initialPages.current++;load(cursor)};
 useEffect(()=>{const timer=setTimeout(()=>{const el=scroll.current;next(!!el&&el.scrollTop>0&&el.scrollHeight-el.scrollTop-el.clientHeight<500)},300);return()=>clearTimeout(timer)},[scope,result,busy,error,load]);
 return {ref:scroll,onScroll:e=>{const el=e.currentTarget;if(el.scrollTop>0&&el.scrollHeight-el.scrollTop-el.clientHeight<500)next(true)}};
}
