// Durable delivery state lives in PostgreSQL. No provider write is retried here.
export function automationPage(rule,data){
 const type=rule.config.type;
 const rows=type==='welcome'?data.notifications:type==='online'?data.followings:data.fans;
 if(!Array.isArray(rows)||typeof data.hasMore!=='boolean')throw Error('Respuesta incompleta del proveedor');
 if(data.hasMore&&(!data.cursor||data.cursor===rule.cursor))throw Error('Cursor repetido o ausente');
 const fans=rows.filter(x=>{
  if(type!=='welcome')return true;
  const time=Date.parse(x.createdAt);
  return ['subscribed','subscribe','subscription'].includes(x.type)&&!(/renew/i.test(x.subType||''))&&Number.isFinite(time)&&time>=Date.parse(rule.activated_at)&&time<=Date.now();
 }).map(x=>({id:String(type==='welcome'?x.userId:x.id)})).filter(x=>/^\d{1,24}$/.test(x.id));
 return {fans:[...new Map(fans.map(f=>[f.id,f])).values()],cursor:data.hasMore?data.cursor:null,done:!data.hasMore};
}
export async function runAutomationTick({token,rpc,providerKey,fetcher=fetch,writeEnabled=false,now=()=>Date.now()}){
 const rules=await rpc('bruff_automation_worker',{op:'claim',token});
 if(!Array.isArray(rules))throw Error('No autorizado');
 const call=async(rule,path,options={})=>{
  const r=await fetcher('https://api.ofmapi.com/v1/accounts/'+rule.binding+'/'+path,{...options,headers:{Authorization:'Bearer '+providerKey,'Content-Type':'application/json',...options.headers},signal:AbortSignal.timeout(15000),redirect:'error'});
  if(!r.ok)throw Error('Proveedor no disponible ('+r.status+')');return r.json();
 };
 await Promise.allSettled(rules.map(async rule=>{
  const op=(name,payload={})=>rpc('bruff_automation_worker',{op:name,rule_id:rule.id,lease_id:rule.lease,payload});
  let error=null;const deadline=now()+45000;
  try{
   if(!writeEnabled)throw Error('Envíos deshabilitados en el servidor');
   if(!await op('check'))return;
   if(!rule.scan_done){
    let page;
    if(rule.config.type==='mass'&&rule.config.audience==='selected'){
     const offset=Number(rule.cursor||0),ids=rule.config.recipients;
     if(!Number.isSafeInteger(offset)||offset<0)throw Error('Cursor no válido');
     page={fans:ids.slice(offset,offset+500).map(id=>({id})),cursor:offset+500<ids.length?String(offset+500):null,done:offset+500>=ids.length};
    }else if(rule.config.type==='mass'&&rule.config.audience==='collections'){
     const ids=new Set();
     for(const listId of rule.config.listIds){
      const list=await call(rule,'lists/'+encodeURIComponent(listId));
      if(String(list.id)!==listId||!Array.isArray(list.users)||!Number.isSafeInteger(list.usersCount))throw Error('No se pudo confirmar la colección completa');
      const members=[...new Set(list.users.map(f=>String(f.id)).filter(id=>/^\d{1,24}$/.test(id)))];
      if(members.length!==list.usersCount)throw Error('Colección incompleta: no se enviará a una vista previa');
      for(const id of members)ids.add(id);
     }
     const offset=Number(rule.cursor||0),members=[...ids].sort();
     if(!Number.isSafeInteger(offset)||offset<0)throw Error('Cursor no válido');
     page={fans:members.slice(offset,offset+500).map(id=>({id})),cursor:offset+500<members.length?String(offset+500):null,done:offset+500>=members.length};
    }else{
     const q=new URLSearchParams({pages:'1'});if(rule.cursor)q.set('cursor',rule.cursor);
     const type=rule.config.type;
     if(type==='welcome')q.set('type','subscribed');else{q.set('type','all');if(type==='online')q.set('filter','all_online')}
     page=automationPage(rule,await call(rule,(type==='welcome'?'notifications':type==='online'?'followings':'fans')+'?'+q));
    }
    if(!await op('page',page))return;
   }
   for(let i=0;i<10&&now()<deadline;i++){
    const delivery=await op('next');if(!delivery)break;
    try{
     if(rule.config.type==='online'&&rule.config.skipRecent){
      const history=await call(rule,'conversations/'+delivery.fan_id+'?pages=1');
      if(!Array.isArray(history.messages))throw Error('No se pudo verificar actividad reciente');
      if(history.messages.some(m=>!Number.isFinite(Date.parse(m.createdAt))||Date.parse(m.createdAt)>now()-1800000)){
       await op('skip',{id:delivery.id,detail:'Conversación activa en los últimos 30 minutos'});continue;
      }
     }
     // Revalidate after reads and immediately before the irreversible provider call.
     if(!await op('check')){await op('finish',{id:delivery.id,detail:'Interrumpido por cambio de acceso; revisar antes de reintentar'});return}
     if(rule.config.type==='online'&&now()-Date.parse(delivery.created_at)>=45000){await op('skip',{id:delivery.id,detail:'Presencia caducada'});continue}
     const sent=await call(rule,'conversations/'+delivery.fan_id+'/messages',{method:'POST',headers:{'Idempotency-Key':'bruff-auto-'+delivery.id},body:JSON.stringify({text:delivery.text,media:[],price:0,lockedText:false,typingWpm:200})});
     if(!/^\d{1,24}$/.test(String(sent.id)))throw Error('Proveedor sin confirmación de mensaje');
     await op('finish',{id:delivery.id,messageId:String(sent.id)});
    }catch(e){
     await op('finish',{id:delivery.id,detail:'Resultado sin confirmar. Revisa el chat; no se reintentará automáticamente.'});
     throw e;
    }
   }
  }catch(e){error=e.message}
  finally{await op('release',{error})}
 }));
 return {checked:rules.length};
}
