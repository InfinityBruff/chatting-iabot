// One directory belongs to one verified user/workspace. No browser disk storage.
export function directoryModelIds({accounts,role,section,activeModel}){
 if(!['owner','admin'].includes(role)||section&&(!['collections','automations','auto-messages','mass-messages'].includes(section)||!activeModel))return [];
 return accounts.filter(a=>a.chat&&(!activeModel||a.id===activeModel)).map(a=>a.id).sort();
}
export function demandedDirectoryIds(allowed,demand,kind){return allowed.filter(id=>(demand[JSON.stringify([kind,id])]||0)>0)}
export function createFanDirectory({request,workspace,ids,publish,now=Date.now,schedule=setTimeout,cancel=clearTimeout,operation='collection_fans',field='fans',visible=()=>true}){
 let stopped=false,timer,running=false,index=0;
 const models=Object.fromEntries(ids.map(id=>[id,{rows:[],complete:false,error:'',checked:null,cursor:null,seen:new Set(),next:0,head:0,refresh:0,failures:0,denied:false}]));
 const emit=()=>{if(!stopped)publish(Object.fromEntries(Object.entries(models).map(([id,m])=>[id,{rows:m.rows,complete:m.complete,error:m.error,checked:m.checked}])))};
 async function tick(){if(stopped||running)return;running=true;
  try{if(!visible())return;for(let n=0;n<ids.length;n++){const id=ids[index++%ids.length],m=models[id];if(m.denied||m.next>now())continue;
   if(!m.retrying&&m.complete&&m.refresh<=now()){m.complete=false;m.cursor=null;m.seen.clear()}
   const head=m.retrying?m.retryHead:m.complete||(m.head<=now()&&m.cursor!==null);const cursor=m.retrying?m.retryCursor:head?null:m.cursor;
   if(!m.retrying&&m.complete&&m.head>now())continue;
   try{const r=await request(workspace,operation,{creator_id:id,...(operation==='collection_fans'?{type:'all'}:{}),...(cursor?{cursor}:{})});if(stopped)return;const d=r.data;if(!Array.isArray(d?.[field]))throw Error('Respuesta de fans no válida.');
    if(!head&&d.hasMore&&(!d.cursor||m.seen.has(d.cursor)))throw Error('La sincronización está incompleta: el proveedor repitió una página.');
    m.rows=[...new Map([...m.rows,...d[field]].map(f=>[f.id,f])).values()];m.error='';m.failures=0;m.retrying=false;m.checked=now();m.next=now()+1000;
    if(!cursor)m.head=now()+30000;
    if(!head&&!m.complete){if(d.cursor)m.seen.add(d.cursor);m.cursor=d.hasMore?d.cursor:null;if(!d.hasMore){m.complete=true;m.refresh=now()+300000}}
   }catch(e){if(stopped)return;m.failures++;m.retrying=true;m.retryCursor=cursor;m.retryHead=head;m.error=e.status===429?'El proveedor limita las consultas. Se conserva el avance y se respeta su espera antes de continuar.':'Sincronización pendiente. Reintentando automáticamente; los fans ya cargados se conservan.';const retry=Number.isFinite(e.retryAfter)&&e.retryAfter>0?e.retryAfter*1000:0;m.next=now()+Math.max(retry,Math.min(60000,2000*2**Math.min(m.failures,5)));if(e.status===401||e.status===403){m.rows=[];m.denied=true;m.complete=false;m.error='No tienes acceso a los fans de esta modelo.'}}
   emit();break;
  }}finally{running=false;if(!stopped)timer=schedule(tick,1000)}
 }
 emit();if(ids.length)tick();return {stop(){stopped=true;cancel(timer);for(const m of Object.values(models))m.rows=[]}};
}
