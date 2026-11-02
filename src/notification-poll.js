import {combineNotifications} from './notification-state.js';

// Separate category reads cover financial events omitted from the general feed.
// IDs remain provider IDs, so one payment cannot produce three alerts.
export async function collectNotificationUpdates({request,known,baseline,active=()=>true}){
 const results=await Promise.allSettled(['','purchases','tip'].map(async type=>{
  let cursor=null,head,rows=[],seen=new Set();
  do{
   if(!active())return {rows:[]};
   const response=await request({...type?{type}:{},...cursor?{cursor}:{}});
   if(!active())return {rows:[]};
   const page=response.data;
   if(!Array.isArray(page?.notifications))throw Error('Respuesta de notificaciones no válida.');
   head??=page;rows=combineNotifications(rows,page.notifications.map(n=>type?{...n,category:type}:n));
   if(page.notifications.some(n=>known.has(n.id)||Date.parse(n.createdAt)<=baseline)||!page.hasMore)break;
   if(!page.cursor||seen.has(page.cursor))throw Error('El proveedor no permite continuar la actualización.');
   cursor=page.cursor;seen.add(cursor);
  }while(active());
  return {rows,head};
 }));
 const denied=results.find(r=>r.status==='rejected'&&[401,403].includes(r.reason.status));
 if(denied)throw denied.reason;
 if(results.every(r=>r.status==='rejected'))throw results[0].reason;
 const retryAfter=Math.max(0,...results.filter(r=>r.status==='rejected'&&r.reason.status===429&&Number.isFinite(r.reason.retryAfter)).map(r=>r.reason.retryAfter));
 return {incoming:results.reduce((rows,r)=>r.status==='fulfilled'?combineNotifications(rows,r.value.rows):rows,[]),head:results[0].status==='fulfilled'?results[0].value.head:null,error:results.some(r=>r.status==='rejected')?'No se pudo comprobar toda la actividad. Se reintentará automáticamente.':'',...(retryAfter?{retryAfter}:{})};
}

export function startModelPolling({ids,poll,visible=()=>true,schedule=setTimeout,cancel=clearTimeout,interval=20000,now=Date.now}){
 let stopped=false;const timers=new Map(),running=new Set(),blockedUntil=new Map();
 async function tick(id){
  if(stopped||running.has(id))return;
  cancel(timers.get(id));const wait=(blockedUntil.get(id)||0)-now();if(wait>0){timers.set(id,schedule(()=>tick(id),Math.min(wait,2147483647)));return}running.add(id);
  let delay=interval;
  try{if(visible()){const result=await poll(id);if(Number.isFinite(result?.retryAfter)&&result.retryAfter>0){delay=Math.max(interval,result.retryAfter*1000);blockedUntil.set(id,now()+result.retryAfter*1000)}}}finally{running.delete(id);if(!stopped)timers.set(id,schedule(()=>tick(id),Math.min(delay,2147483647)))}
 }
 // Start in a microtask so the hook has installed its state and cleanup first.
 queueMicrotask(()=>{if(!stopped)ids.forEach(id=>void tick(id))});
 return {refresh:()=>ids.forEach(id=>void tick(id)),stop:()=>{stopped=true;timers.forEach(cancel);timers.clear()}};
}
