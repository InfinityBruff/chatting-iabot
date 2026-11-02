import {useCallback,useEffect,useLayoutEffect,useRef} from 'react';
import {captureThreadAnchor,restoreThreadAnchor,nearHistoryStart} from '../thread-scroll.js';
import {readSession,writeSession} from '../chat-sync.js';
export function useThreadScroll({scrollKey,result,busy,error,load,requestCursor,revision,paginationEnabled=true}){
 const scroll=useRef(null),first=useRef(true),follow=useRef(true),anchor=useRef(null),paging=useRef(false),seen=useRef(new Set()),upward=useRef(false),lastTop=useRef(0),saveTimer=useRef(),alive=useRef(true),latest=useRef(),touchY=useRef(null);
 latest.current={result,busy,error,load,paginationEnabled};
 const save=useCallback(()=>{const el=scroll.current;if(el&&!first.current)writeSession(scrollKey,{...captureThreadAnchor(el),follow:follow.current})},[scrollKey]);
 const loadOlder=useCallback(async cursor=>{
  const state=latest.current,el=scroll.current;
  if(!el||!cursor||state.busy||paging.current||seen.current.has(cursor))return false;
  paging.current=true;follow.current=false;anchor.current={...captureThreadAnchor(el),result:state.result};
  try{const ok=await state.load(cursor);if(!alive.current)return false;if(ok)seen.current.add(cursor);else anchor.current=null;return ok}finally{paging.current=false}
 },[]);
 const check=useCallback(()=>{const el=scroll.current,state=latest.current;if(el&&!first.current&&upward.current&&state.paginationEnabled&&nearHistoryStart(el)&&state.result?.data.hasMore&&!state.busy&&!state.error)loadOlder(state.result.data.cursor)},[loadOlder]);
 useLayoutEffect(()=>{
  const el=scroll.current;if(!el||!result)return;
  if(first.current){const saved=readSession(scrollKey);if(saved&&typeof saved==='object'){if(saved.follow)el.scrollTop=el.scrollHeight;else restoreThreadAnchor(el,saved)}else el.scrollTop=Number.isFinite(saved)?saved:el.scrollHeight;first.current=false;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;lastTop.current=el.scrollTop;return}
  if(busy&&requestCursor&&!anchor.current&&!follow.current)anchor.current={...captureThreadAnchor(el),result};
  if(anchor.current&&anchor.current.result!==result){restoreThreadAnchor(el,anchor.current);anchor.current=null;lastTop.current=el.scrollTop;save();return}
  if(follow.current&&!anchor.current){el.scrollTop=el.scrollHeight;lastTop.current=el.scrollTop}
 },[result,busy,requestCursor,revision,scrollKey,save]);
 // Recheck after a refresh finishes: reaching the top while busy must not stall history.
 useEffect(()=>{if(!busy){const timer=setTimeout(check,0);return()=>clearTimeout(timer)}},[result,busy,error,check]);
 useEffect(()=>{alive.current=true;const el=scroll.current;if(!el)return;
  const observer=new ResizeObserver(()=>{if(follow.current&&!first.current&&!anchor.current){el.scrollTop=el.scrollHeight;lastTop.current=el.scrollTop}});observer.observe(el);
  return()=>{alive.current=false;clearTimeout(saveTimer.current);save();observer.disconnect()};
 },[save]);
 const onScroll=useCallback(e=>{const el=e.currentTarget;if(first.current)return;
  if(el.scrollTop<lastTop.current-1&&!anchor.current)upward.current=true;
  follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;
  if(follow.current)upward.current=false;
  lastTop.current=el.scrollTop;clearTimeout(saveTimer.current);saveTimer.current=setTimeout(save,180);check();
 },[check,save]);
 const requestHistory=()=>{upward.current=true;follow.current=false;check()};
 const scrollEvents={onScroll,onWheel:e=>{if(e.deltaY<0)requestHistory()},onKeyDown:e=>{if(['ArrowUp','PageUp','Home'].includes(e.key))requestHistory()},onTouchStart:e=>{touchY.current=e.touches[0]?.clientY??null},onTouchMove:e=>{const y=e.touches[0]?.clientY;if(touchY.current!==null&&y>touchY.current+2)requestHistory();touchY.current=y??null}};
 return {scroll,follow,loadOlder,scrollEvents};
}
