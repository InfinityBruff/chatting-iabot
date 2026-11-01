import {useEffect,useRef,useState} from 'react';
import {combineNotifications} from '../notification-state.js';
// Category cursors belong to one exact model/filter pair; never reuse inbox/head cursors.
export function useNotificationCategory(request,workspace,ids,type){
 const scope=JSON.stringify([workspace,ids,type]);const [state,setState]=useState({scope:'',models:{}}),control=useRef(()=>{});
 useEffect(()=>{let cancelled=false,timer,running=false;const models=Object.fromEntries(ids.map(id=>[id,{rows:[],cursor:null,hasMore:false,busy:true,error:'',checked:null}]));
 const publish=()=>{if(!cancelled)setState({scope,models:Object.fromEntries(Object.entries(models).map(([id,m])=>[id,{...m}]))})};
 async function fetchPage(id,cursor,initial=false){const m=models[id];if(!m||m.loading)return;m.loading=true;m.busy=true;publish();try{
  const response=await request(workspace,'notifications',{creator_id:id,type,...(cursor?{cursor}:{})});if(cancelled)return;
  if(!Array.isArray(response.data?.notifications))throw Error('Respuesta de notificaciones no válida.');
  const page=response.data;m.rows=combineNotifications(m.rows,page.notifications.map(n=>({...n,category:type})));m.error='';m.checked=Date.now();
  if(cursor||!m.extended){m.cursor=page.cursor;m.hasMore=page.hasMore}if(cursor)m.extended=true;
  if(page.hasMore&&(!page.cursor||page.cursor===cursor)){m.cursor=null;m.error='El proveedor no entregó un cursor válido para continuar el historial.'}
 }catch(e){if(cancelled)return;m.error=e.message;if(e.status===401||e.status===403)m.rows=[]}finally{if(!cancelled){m.busy=false;m.loading=false;publish()}}}
 async function poll(){if(cancelled||running||!type)return;running=true;for(const id of ids){if(cancelled)break;if(document.visibilityState!=='visible')break;await fetchPage(id)}running=false;if(!cancelled){clearTimeout(timer);timer=setTimeout(poll,20000)}}
 control.current=(id,cursor)=>{if(id)return fetchPage(id,cursor);clearTimeout(timer);return poll()};
 publish();if(type)poll();const visible=()=>{if(document.visibilityState==='visible'){clearTimeout(timer);poll()}};if(type)document.addEventListener('visibilitychange',visible);
 return()=>{cancelled=true;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)};
 },[scope,request]);
 return {models:state.scope===scope?state.models:{},load:(id,cursor)=>control.current(id,cursor)};
}
