import {useEffect,useState} from 'react';
import {liveRequest} from './LiveWorkspace.jsx';
// Refresh each authorized model independently. Never retain results after scope changes.
export default function usePresence(workspace,accounts){
 const [results,setResults]=useState({});
 const scope=JSON.stringify(accounts.filter(a=>a.chat===true).map(a=>a.id).sort());
 useEffect(()=>{
  let active=true;const inflight=new Set();setResults({});
  async function refresh(){if(document.visibilityState==='hidden')return;
   await Promise.all(JSON.parse(scope).map(async id=>{if(inflight.has(id))return;inflight.add(id);
    try{const r=await liveRequest(workspace,'presence',{creator_id:id});if(active)setResults(old=>({...old,[id]:r.data}))}
    catch{if(active)setResults(old=>({...old,[id]:{unavailable:true,onlineIds:[],checkedAt:null}}))}
    finally{inflight.delete(id)}
   }));
  }
  refresh();const timer=setInterval(refresh,45000);document.addEventListener('visibilitychange',refresh);
  return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',refresh)};
 },[workspace,scope]);
 return results;
}
