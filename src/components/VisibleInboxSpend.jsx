import {useEffect,useRef,useState} from 'react';
import {useInboxSpend} from './useInboxSpend.js';
import {spendViewportIds,spendViewportDemand} from '../inbox-spend-viewport.js';
// Scroll changes stay in this invisible child; the list and conversation do not rerender.
export default function VisibleInboxSpend({scrollRef,workspace,account,result,update,rows,selectedId,refreshToken,refreshAll=false,onStatus,onDenied}){
 const [viewport,setViewport]=useState({ids:[],active:false,moving:false}),timer=useRef(null),statusHandler=useRef(onStatus);statusHandler.current=onStatus;
 const signature=JSON.stringify(rows.map(f=>String(f.userId??f.id)));
 useEffect(()=>{
  const el=scrollRef.current;if(!el)return;let live=true,moving=false,observed=false;const positions=new Map(JSON.parse(signature).map((id,index)=>[id,index])),nearby=new Set();
  const measure=()=>{if(!live)return;const rect=el.getBoundingClientRect(),active=el.getClientRects().length>0&&rect.width>0&&rect.height>0;
   if(active&&!observed)return;
   const entries=[...nearby].map(node=>{const box=node.getBoundingClientRect(),id=node.dataset.fanId;return {id,index:positions.get(id),top:box.top,bottom:box.bottom}}).filter(row=>positions.has(row.id));
   const ids=active?spendViewportIds(entries,rect):[];setViewport(previous=>previous.active===active&&previous.moving===moving&&JSON.stringify(previous.ids)===JSON.stringify(ids)?previous:{ids,active,moving});
  };
  const observer=new IntersectionObserver(entries=>{observed=true;for(const entry of entries)entry.isIntersecting?nearby.add(entry.target):nearby.delete(entry.target);if(!moving)measure()},{root:el,rootMargin:'200px 0px'});
  for(const node of el.querySelectorAll('.chat-fan-entry[data-fan-id]'))observer.observe(node);
  const changed=()=>{moving=true;setViewport(previous=>previous.moving?previous:{...previous,moving:true});clearTimeout(timer.current);timer.current=setTimeout(()=>{moving=false;measure()},140)};
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(()=>{if(!moving)measure()}):null;resize?.observe(el);measure();el.addEventListener('scroll',changed,{passive:true});
  return()=>{live=false;clearTimeout(timer.current);observer.disconnect();resize?.disconnect();el.removeEventListener('scroll',changed)};
 },[scrollRef,workspace,account,signature]);
 const viewportActive=viewport.active&&!viewport.moving,ids=spendViewportDemand(selectedId,viewport.ids,viewportActive);
 const state=useInboxSpend(workspace,account,result,update,ids,{refreshToken,refreshAll,selectedId,viewportActive,onDenied});
 useEffect(()=>{if(state.refreshToken===refreshToken)statusHandler.current?.(state)},[state,refreshToken]);
 return null;
}
