import {useCallback,useEffect,useLayoutEffect,useRef} from 'react';
import {captureThreadAnchor,restoreThreadAnchor,nearHistoryStart} from '../thread-scroll.js';
import {readSession,writeSession} from '../chat-sync.js';
import {createScrollMotion,scrollAheadDistance} from '../scroll-prefetch.js';
export function useThreadScroll({scrollKey,result,busy,waiting=false,error,load,requestCursor,pageRevision=0,latencyMs=1000,revision,paginationEnabled=true,followRef}){
 const scroll=useRef(null),first=useRef(true),ownFollow=useRef(true),anchor=useRef(null),paging=useRef(false),seen=useRef(new Set()),upward=useRef(false),lastTop=useRef(0),saveTimer=useRef(),alive=useRef(true),latest=useRef(),touchY=useRef(null);
 const follow=followRef||ownFollow;
 const motion=useRef(createScrollMotion()),nodes=useRef(null),acceptedRevision=useRef(0);
 latest.current={result,busy:busy||waiting,error,load,paginationEnabled,pageRevision,latencyMs};
 const save=useCallback(()=>{const el=scroll.current;if(el&&!first.current)writeSession(scrollKey,{...captureThreadAnchor(el),follow:follow.current})},[scrollKey]);
 const loadOlder=useCallback(async cursor=>{
  const state=latest.current,el=scroll.current;
  if(!el||!cursor||state.busy||paging.current||seen.current.has(cursor))return false;
  paging.current=true;follow.current=false;anchor.current={...captureThreadAnchor(el),result:state.result,pageRevision:state.pageRevision};
  try{const ok=await state.load(cursor);if(!alive.current)return false;if(ok)seen.current.add(cursor);else anchor.current=null;return ok}finally{paging.current=false}
 },[]);
 const check=useCallback(()=>{const el=scroll.current,state=latest.current;if(el&&!first.current&&upward.current&&state.paginationEnabled&&nearHistoryStart(el,scrollAheadDistance({kind:'history',viewport:el.clientHeight,velocity:Math.min(0,motion.current.velocity()),latencyMs:state.latencyMs}))&&state.result?.data.hasMore&&!state.busy&&!state.error)loadOlder(state.result.data.cursor)},[loadOlder]);
 useLayoutEffect(()=>{
  const el=scroll.current;if(!el||!result)return;
  nodes.current=el.querySelectorAll('[data-message-id]');
  if(pageRevision!==acceptedRevision.current){if(requestCursor)seen.current.add(requestCursor);acceptedRevision.current=pageRevision}
  if(first.current){const saved=readSession(scrollKey);if(saved&&typeof saved==='object'){if(saved.follow)el.scrollTop=el.scrollHeight;else restoreThreadAnchor(el,saved)}else el.scrollTop=Number.isFinite(saved)?saved:el.scrollHeight;first.current=false;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;lastTop.current=el.scrollTop;motion.current.reset(el.scrollTop);return}
  if(busy&&requestCursor&&!anchor.current&&!follow.current)anchor.current={...captureThreadAnchor(el),result,pageRevision};
  if(anchor.current&&anchor.current.result!==result){restoreThreadAnchor(el,anchor.current);lastTop.current=el.scrollTop;motion.current.reset(el.scrollTop);if(anchor.current.pageRevision!==pageRevision){anchor.current=null;save()}else anchor.current.result=result;return}
  if(follow.current&&!anchor.current){el.scrollTop=el.scrollHeight;lastTop.current=el.scrollTop}
 },[result,busy,requestCursor,pageRevision,revision,scrollKey,save]);
 // Recheck after a refresh finishes: reaching the top while busy must not stall history.
 useEffect(()=>{if(!busy&&!waiting){const timer=setTimeout(check,0);return()=>clearTimeout(timer)}},[result,busy,waiting,error,check]);
 useEffect(()=>{alive.current=true;const el=scroll.current;if(!el)return;
  const observer=new ResizeObserver(()=>{if(follow.current&&!first.current&&!anchor.current){el.scrollTop=el.scrollHeight;lastTop.current=el.scrollTop}});observer.observe(el);
  return()=>{alive.current=false;clearTimeout(saveTimer.current);save();observer.disconnect()};
 },[save]);
 const onScroll=useCallback(e=>{const el=e.currentTarget;if(first.current)return;
  if(el.scrollTop<lastTop.current-1)upward.current=true;else if(el.scrollTop>lastTop.current+1)upward.current=false;motion.current.sample(el.scrollTop);
  follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;
  if(follow.current){upward.current=false;anchor.current=null}else if(anchor.current)anchor.current={...anchor.current,...captureThreadAnchor(el,nodes.current||undefined)};
  lastTop.current=el.scrollTop;clearTimeout(saveTimer.current);saveTimer.current=setTimeout(save,180);check();
 },[check,save]);
 const requestHistory=()=>{upward.current=true;follow.current=false;check()};
 const scrollEvents={onScroll,onWheel:e=>{if(e.deltaY<0)requestHistory()},onKeyDown:e=>{if(['ArrowUp','PageUp','Home'].includes(e.key))requestHistory()},onTouchStart:e=>{touchY.current=e.touches[0]?.clientY??null},onTouchMove:e=>{const y=e.touches[0]?.clientY;if(touchY.current!==null&&y>touchY.current+2)requestHistory();touchY.current=y??null}};
 return {scroll,follow,loadOlder,scrollEvents};
}
