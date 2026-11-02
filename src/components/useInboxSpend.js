import {useEffect} from 'react';
import {liveRequest} from './LiveData.jsx';
export function useInboxSpend(workspace,account,result,update){
 const ids=(result?.data.conversations||[]).filter(f=>!f.spend?.available).map(f=>String(f.userId??f.id)).filter(id=>/^\d{1,24}$/.test(id)).join(',');
 useEffect(()=>{if(!ids)return;let cancelled=false,timer;
  const batches=ids.split(',');let offset=0;
  async function next(){const batch=batches.slice(offset,offset+20);if(cancelled||!batch.length)return;if(document.visibilityState!=='visible'){timer=setTimeout(next,2000);return}
   try{const r=await liveRequest(workspace,'fan_spend_batch',{creator_id:account,user_ids:batch},{active:()=>!cancelled});if(cancelled)return;const amounts=new Map(r.data.fans.map(f=>[f.id,f.spend]));update(old=>old?{...old,data:{...old.data,conversations:old.data.conversations.map(f=>amounts.has(String(f.userId??f.id))?{...f,spend:amounts.get(String(f.userId??f.id))}:f)}}:old);offset+=20;timer=setTimeout(next,750)}catch(e){if(!cancelled&&e.status===429)timer=setTimeout(next,Math.max(1000,Number(e.retryAfter||60)*1000))}
  }timer=setTimeout(next,400);return()=>{cancelled=true;clearTimeout(timer)};
 },[workspace,account,ids,update]);
}
