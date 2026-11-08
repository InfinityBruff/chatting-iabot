import {combineNotifications} from './notification-state.js';

const headTypes=['','purchases','tip'];
const cancelled=()=>Object.assign(Error('Consulta cancelada'),{name:'AbortError'});
function notificationHeads(value){
 const rows=value?.data?.heads;if(!Array.isArray(rows)||rows.length!==3)throw Error('Respuesta agrupada de notificaciones no válida.');
 const result=new Map();let denial;
 for(const row of rows){
  if(!row||typeof row!=='object'||!headTypes.includes(row.type)||result.has(row.type)||!!row.data===!!row.error)throw Error('Respuesta agrupada de notificaciones no válida.');
  if(row.data){const page=row.data;if(!Array.isArray(page.notifications)||typeof page.hasMore!=='boolean'||page.cursor!==null&&(typeof page.cursor!=='string'||!page.cursor||page.cursor.length>2048)||page.hasMore&&!page.cursor)throw Error('Respuesta agrupada de notificaciones no válida.');result.set(row.type,{data:page,observedAt:value.observedAt})}
  else{
   const e=row.error;if(![401,403,429,502,503,504].includes(e.status)||e.retryAfter!==undefined&&(!Number.isSafeInteger(e.retryAfter)||e.retryAfter<1||e.retryAfter>2147483647)||e.providerStatus!==undefined&&(!Number.isInteger(e.providerStatus)||e.providerStatus<400||e.providerStatus>599))throw Error('Respuesta agrupada de notificaciones no válida.');
   const error=Object.assign(Error(e.status===429?'El proveedor limita esta categoría. Espera antes de actualizar.':'No se pudo comprobar esta categoría. Se conserva lo ya cargado.'),{status:e.status,...(e.retryAfter?{retryAfter:e.retryAfter}:{}),...(e.providerStatus?{providerStatus:e.providerStatus}:{})});result.set(row.type,{error});if([401,403].includes(error.status))denial=error;
  }
 }
 if(denial)throw denial;return result;
}

// A single collector cycle shares one fixed three-head request. Cursor pages
// remain independent legacy reads; a failed batch never fans out into 3 calls.
export function createNotificationHeadRequest({request,requestHeads,active=()=>true}){
 let pending;
 return async(params={},options={})=>{
  const current=()=>active()&&options.active?.()!==false;if(!current())throw cancelled();
  if(params.cursor!=null)return request(params,options);
  const type=params.type||'';if(!headTypes.includes(type))throw Error('Categoría no válida.');
  pending??=Promise.resolve().then(()=>{if(!active())throw cancelled();return requestHeads({active})}).then(notificationHeads);
  const heads=await pending;if(!current())throw cancelled();const branch=heads.get(type);if(branch.error)throw branch.error;return branch;
 };
}

// Separate category reads cover financial events omitted from the general feed.
// IDs remain provider IDs, so one payment cannot produce three alerts.
export async function collectNotificationUpdates({request,requestHeads,known,baseline,active=()=>true,onPage}){
 const previous=new Set(known);let invalidated=false,rejectFatal;
 const fatal=new Promise((_,reject)=>{rejectFatal=reject});
 const collectorActive=()=>!invalidated&&active();
 const read=typeof requestHeads==='function'?createNotificationHeadRequest({request,requestHeads,active:collectorActive}):request;
 // A denial must reach the caller immediately so it can clear pages already
 // shown, while queued or late sibling branches lose their right to publish.
 const invalidate=error=>{if(!invalidated){invalidated=true;rejectFatal(error)}};
 const settled=Promise.allSettled(['','purchases','tip'].map(async type=>{
  let cursor=null,head,rows=[],seen=new Set();
  do{
   if(!collectorActive())return {rows:[]};
   let response;try{response=await read({...type?{type}:{},...cursor?{cursor}:{}},{active:collectorActive})}catch(error){if([401,403].includes(error?.status))invalidate(error);throw error}
   if(!collectorActive())return {rows:[]};
   const page=response.data;
   if(!Array.isArray(page?.notifications))throw Error('Respuesta de notificaciones no válida.');
   const incoming=page.notifications.map(n=>type?{...n,category:type}:n);
   head??=page;rows=combineNotifications(rows,incoming);
   // Callback failures are application failures, not a partial provider result.
   // Await asynchronous callbacks too, so rejected promises cannot escape.
   if(onPage)try{await onPage({rows:[...incoming],head,type})}catch(error){invalidate(error);throw error}
   if(!collectorActive())return {rows:[]};
   if(page.notifications.some(n=>previous.has(n.id)||Date.parse(n.createdAt)<=baseline)||!page.hasMore)break;
   if(!page.cursor||seen.has(page.cursor))throw Error('El proveedor no permite continuar la actualización.');
   cursor=page.cursor;seen.add(cursor);
  }while(collectorActive());
  return {rows,head};
 }));
 const results=await Promise.race([settled,fatal]);
 const denied=results.find(r=>r.status==='rejected'&&[401,403].includes(r.reason.status));
 if(denied)throw denied.reason;
 if(!collectorActive())return {incoming:[],head:null,error:''};
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
