import {useEffect,useRef,useState} from 'react';
import {useInboxSpend} from './useInboxSpend.js';
import {spendViewportIds,spendViewportDemand,createSpendViewportRegistry,createSpendViewportSampler} from '../inbox-spend-viewport.js';
// Scroll changes stay in this invisible child; the list and conversation do not rerender.
export default function VisibleInboxSpend({scrollRef,workspace,account,result,update,rows,selectedId,refreshToken,refreshAll=false,onStatus,onDenied}){
 const [viewport,setViewport]=useState({ids:[],active:false}),tracker=useRef(null),statusHandler=useRef(onStatus);statusHandler.current=onStatus;
 const signature=JSON.stringify(rows.map(f=>String(f.userId??f.id)));
 useEffect(()=>{
  const el=scrollRef.current;if(!el)return;let live=true,observed=false,height=Math.round(el.getBoundingClientRect().height),registry;
  const measure=()=>{if(!live)return;const rect=el.getBoundingClientRect(),active=el.getClientRects().length>0&&rect.width>0&&rect.height>0;
   if(active&&!observed)return;
   const entries=registry.entries();
   const ids=active?spendViewportIds(entries,rect):[];setViewport(previous=>previous.active===active&&JSON.stringify(previous.ids)===JSON.stringify(ids)?previous:{ids,active});
  };
  const sampler=createSpendViewportSampler(measure),changed=()=>sampler.queue();
  const observer=()=>new IntersectionObserver(entries=>{if(!live)return;observed=true;registry.accept(entries);changed()},{root:el,rootMargin:`200px 0px ${Math.max(200,height)}px 0px`});
  registry=createSpendViewportRegistry(observer());tracker.current={sync:ids=>{registry.sync(ids,el.querySelectorAll('.chat-fan-entry[data-fan-id]'));changed()}};tracker.current.sync(JSON.parse(signature));
  const resize=typeof ResizeObserver==='function'?new ResizeObserver(()=>{const next=Math.round(el.getBoundingClientRect().height);if(next!==height){height=next;registry.replaceObserver(observer())}changed()}):null;resize?.observe(el);el.addEventListener('scroll',changed,{passive:true});
  return()=>{live=false;tracker.current=null;sampler.stop();registry.disconnect();resize?.disconnect();el.removeEventListener('scroll',changed)};
 },[scrollRef,workspace,account]);
 useEffect(()=>{tracker.current?.sync(JSON.parse(signature))},[signature,scrollRef,workspace,account]);
 const viewportActive=viewport.active,ids=spendViewportDemand(selectedId,viewport.ids,viewportActive);
 const state=useInboxSpend(workspace,account,result,update,ids,{refreshToken,refreshAll,selectedId,viewportActive,onDenied});
 useEffect(()=>{if(state.refreshToken===refreshToken)statusHandler.current?.(state)},[state,refreshToken]);
 return null;
}
