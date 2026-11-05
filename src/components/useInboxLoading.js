import {useEffect,useLayoutEffect,useMemo,useRef,useSyncExternalStore} from 'react';
import {createInboxWindow} from '../inbox-window.js';
import {createScrollMotion,scrollAheadDistance} from '../scroll-prefetch.js';
import {readSession,writeSession} from '../chat-sync.js';
export const requestInboxPage=(load,cursor,nearEnd)=>cursor?load(cursor,{priority:nearEnd?'pagination':'background'}):undefined;
export function useInboxLoading(scope,{rows=[],result,error,busy,load,latencyMs=1000,pageRevision=0,requestCursor,pageQueued=false}){
 const scroll=useRef(null),restored=useRef(null),saveTimer=useRef(),motion=useRef(createScrollMotion()),lastTop=useRef(0),intent=useRef({id:0,accepted:0,until:0}),touch=useRef(null);
 const windowKey='bruff-inbox-window:'+scope;
 const reader=useMemo(()=>createInboxWindow({load,initial:{rows,result,error,busy,pageRevision,requestCursor,pageQueued},savedLimit:readSession(windowKey),onCommit:limit=>writeSession(windowKey,limit)}),[scope,load]);
 const state=useSyncExternalStore(reader.subscribe,reader.getSnapshot,reader.getSnapshot);
 useEffect(()=>()=>clearTimeout(saveTimer.current),[]);
 useEffect(()=>{reader.start();return()=>reader.stop()},[reader]);
 useLayoutEffect(()=>{reader.setInput({rows,result,error,busy,pageRevision,requestCursor,pageQueued});reader.commit();const el=scroll.current;if(el&&restored.current!==scope){const saved=state.restored?readSession('bruff-scroll:'+scope,0):0;el.scrollTop=Number.isFinite(saved)&&saved>=0?saved:0;lastTop.current=el.scrollTop;motion.current.reset(el.scrollTop);intent.current={id:0,accepted:0,until:0};restored.current=scope;if(!state.restored)writeSession('bruff-scroll:'+scope,0)}},[reader,scope,rows,result,error,busy,pageRevision,requestCursor,pageQueued,state.visibleLimit]);
 const acceptIntent=()=>{const current=intent.current;if(current.id===current.accepted)return;if(reader.loadMore())current.accepted=current.id};
 useEffect(()=>{const el=scroll.current;if(!el)return;
  const arm=()=>{intent.current.id++;intent.current.until=Date.now()+1500;if(el.scrollHeight-el.scrollTop-el.clientHeight<=2)acceptIntent()};
  const down=e=>{if(e.deltaY>0)arm()},key=e=>{if(['ArrowDown','PageDown','End',' '].includes(e.key)&&!e.target.closest('input,textarea,select,[contenteditable=true]')&&!(e.key===' '&&(e.shiftKey||e.target.closest('button,a'))))arm()},start=e=>{touch.current=e.touches?.[0]?.clientY??null},move=e=>{const y=e.touches?.[0]?.clientY;if(touch.current!==null&&Number.isFinite(y)&&y<touch.current)arm();touch.current=y??null},pointer=e=>{if(e.target===el&&e.clientX>=el.getBoundingClientRect().right-18)arm()};
  el.addEventListener('wheel',down,{passive:true});el.addEventListener('keydown',key);el.addEventListener('touchstart',start,{passive:true});el.addEventListener('touchmove',move,{passive:true});el.addEventListener('pointerdown',pointer,{passive:true});
  return()=>{el.removeEventListener('wheel',down);el.removeEventListener('keydown',key);el.removeEventListener('touchstart',start);el.removeEventListener('touchmove',move);el.removeEventListener('pointerdown',pointer)};
 },[reader]);
 const nearEnd=el=>!!el&&el.scrollTop>0&&el.scrollHeight-el.scrollTop-el.clientHeight<scrollAheadDistance({viewport:el.clientHeight,velocity:Math.max(0,motion.current.velocity()),latencyMs});
 const onScroll=e=>{const el=e.currentTarget,top=el.scrollTop,down=top>lastTop.current+1;lastTop.current=top;motion.current.sample(top);clearTimeout(saveTimer.current);saveTimer.current=setTimeout(()=>writeSession('bruff-scroll:'+scope,top),180);if(down&&Date.now()<=intent.current.until&&nearEnd(el))acceptIntent()};
 return {scrollProps:{ref:scroll,onScroll},visibleLimit:state.visibleLimit,hasMore:state.hasMore,canLoadMore:state.canLoadMore,loadMore:()=>reader.loadMore(),pending:state.pending};
}
