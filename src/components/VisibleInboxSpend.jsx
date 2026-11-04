import {useEffect,useRef,useState} from 'react';
import {useInboxSpend} from './useInboxSpend.js';
// Scroll changes stay in this invisible child; the list and conversation do not rerender.
export default function VisibleInboxSpend({scrollRef,workspace,account,result,update,rows,selectedId,refreshToken,refreshAll=false,onStatus}){
 const [range,setRange]=useState({start:0,moving:false}),timer=useRef(null),statusHandler=useRef(onStatus);statusHandler.current=onStatus;
 useEffect(()=>{const el=scrollRef.current;if(!el)return;const changed=()=>{setRange(s=>s.moving?s:{...s,moving:true});clearTimeout(timer.current);timer.current=setTimeout(()=>setRange({start:Math.max(0,Math.floor(el.scrollTop/124)-4),moving:false}),140)};el.addEventListener('scroll',changed,{passive:true});return()=>{clearTimeout(timer.current);el.removeEventListener('scroll',changed)}},[scrollRef,workspace,account]);
 const state=useInboxSpend(workspace,account,result,update,range.moving?[]:[...(selectedId?[selectedId]:[]),...rows.slice(range.start,range.start+40).map(f=>String(f.userId??f.id))],{refreshToken,refreshAll,selectedId});
 useEffect(()=>{if(state.refreshToken===refreshToken)statusHandler.current?.(state)},[state,refreshToken]);
 return null;
}
