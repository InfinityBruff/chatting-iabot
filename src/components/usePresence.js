import {useEffect,useState} from 'react';
import {liveRequest} from './LiveWorkspace.jsx';
import {startPresenceScan,acceptPresencePage,failPresenceScan} from '../presence-scan.js';
// Round-robin across all authorized models: one request at a time, independent cursors.
export default function usePresence(workspace,accounts){
 const scope=JSON.stringify(accounts.filter(a=>a.chat===true).map(a=>a.id).sort());
 const key=workspace+':'+scope;
 const [snapshot,setSnapshot]=useState({key:null,results:{}});
 useEffect(()=>{
  let active=true,timer,inflight=false;
  const ids=JSON.parse(scope),states=Object.fromEntries(ids.map(id=>[id,startPresenceScan()]));
  setSnapshot({key,results:{}});
  const publish=()=>{if(active)setSnapshot({key,results:{...states}})};
  const schedule=()=>{if(active)timer=setTimeout(tick,350)};
  async function tick(){
   if(!active||inflight)return;
   if(document.visibilityState==='hidden'){schedule();return}
   const now=Date.now(),id=ids.filter(id=>states[id].nextAt<=now).sort((a,b)=>states[a].nextAt-states[b].nextAt)[0];
   if(!id){schedule();return}
   inflight=true;
   if(!states[id].scanning)states[id]=startPresenceScan(states[id],now);
   const current=states[id];
   try{
    const r=await liveRequest(workspace,'presence',{creator_id:id,...(current.cursor?{cursor:current.cursor}:{})});
    if(!active)return;
    states[id]=acceptPresencePage(current,r.data,Date.now());
   }catch(e){if(active)states[id]=failPresenceScan(current,{status:e.status},Date.now())}
   finally{inflight=false;if(active){publish();schedule()}}
  }
  const visible=()=>{if(document.visibilityState==='visible'&&!inflight){clearTimeout(timer);tick()}};
  tick();document.addEventListener('visibilitychange',visible);
  return()=>{active=false;clearTimeout(timer);document.removeEventListener('visibilitychange',visible)};
 },[workspace,scope,key]);
 return snapshot.key===key?snapshot.results:{};
}
