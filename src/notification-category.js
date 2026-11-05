import {combineNotifications} from './notification-state.js';
import {notificationCategory,notificationCategories} from './notification-presentation.js';

// This store belongs to one mounted notifications page and verified identity.
// It deliberately has no persistent or module-global storage.
export function createNotificationCategoryCache(){return {entries:new Map(),cooldowns:new Map(),denied:new Set()}}

export function createNotificationCategory({request,workspace,ids,type,scope='',models:initialModels={},peek,subscribeInvalidation,onDenied,cache=createNotificationCategoryCache(),visible=()=>true,now=Date.now,schedule=setTimeout,cancel=clearTimeout,interval=20000}){
 const accounts=[...new Set(ids.map(String))],enabled=Object.hasOwn(notificationCategories,type),listeners=new Set(),states={},timers=new Map(),running=new Map(),versions=new Map(),sourceDenials=new Map();
 let active=false,generation=0,unsubscribe,sourceModels=initialModels,snapshot={models:{}};
 const modelKey=id=>JSON.stringify([scope,workspace,id]),key=id=>JSON.stringify([scope,workspace,id,type]);
 const matching=rows=>Array.isArray(rows)?rows.filter(row=>notificationCategory(row)===type):[];
 const blank=()=>({rows:[],cursor:null,hasMore:false,busy:false,loading:false,waiting:false,error:'',checked:null,extended:false,denied:false});
 const denialMessage=error=>error?.message||'No se pudo verificar el acceso a las notificaciones de esta modelo.';
 const current=token=>active&&running.get(token.id)===token&&token.generation===generation&&token.version===(versions.get(token.id)||0);
 function save(id){cache.entries.set(key(id),{modelKey:modelKey(id),value:{...states[id],busy:false,loading:false}})}
 function publish(){snapshot={models:Object.fromEntries(accounts.map(id=>[id,{...states[id]}]))};for(const listener of listeners)listener()}
 function clearTimer(id){if(timers.has(id))cancel(timers.get(id));timers.delete(id)}
 function clearModelCache(id){const identity=modelKey(id);for(const [entryKey,row] of cache.entries)if(row.modelKey===identity)cache.entries.delete(entryKey);cache.cooldowns.delete(identity);cache.denied.add(identity)}
 function deny(id,error){
  if(!states[id])return;
  versions.set(id,(versions.get(id)||0)+1);running.delete(id);clearTimer(id);clearModelCache(id);
  states[id]={...blank(),denied:true,error:denialMessage(error)};publish();
  if(active)wake(id,interval);
 }
 function seed(id){
  const source=sourceModels[id],blocked=source?.denied||cache.denied.has(modelKey(id));
  sourceDenials.set(id,{denied:!!source?.denied,version:source?.version});
  if(blocked){if(source?.denied)clearModelCache(id);return {...blank(),denied:true,error:source?.error||''}}
  const cached=cache.entries.get(key(id))?.value,state={...blank(),...cached,busy:false,loading:false};
  // A general head can seed known events, never the category history cursor.
  state.rows=combineNotifications(matching(source?.rows),state.rows);
  state.checked??=source?.checked||null;
  const head=peek?.(workspace,{creator_id:id,type});
  if(Array.isArray(head?.data?.notifications)){
   state.rows=combineNotifications(state.rows,head.data.notifications.map(row=>({...row,category:type})));
   if(!state.extended){const page=head.data,valid=!page.hasMore||typeof page.cursor==='string'&&!!page.cursor;state.cursor=valid&&page.hasMore?page.cursor:null;state.hasMore=valid&&page.hasMore===true}
   state.checked??=Number.isFinite(Date.parse(head.observedAt))?Date.parse(head.observedAt):now();
  }
  state.waiting=(cache.cooldowns.get(modelKey(id))||0)>now();return state;
 }
 function wake(id,delay=0){
  clearTimer(id);if(!active||!enabled||running.has(id)||!visible())return;
  const remaining=(cache.cooldowns.get(modelKey(id))||0)-now();
  timers.set(id,schedule(()=>{timers.delete(id);void fetchPage(id,null,false)},Math.min(Math.max(delay,remaining,0),2147483647)));
 }
 async function fetchPage(id,cursor=null,fresh=false){
  const m=states[id];if(!active||!enabled||!m||running.has(id)||!visible())return false;
  if(cursor&&(!m.hasMore||cursor!==m.cursor))return false;
  const wait=(cache.cooldowns.get(modelKey(id))||0)-now();
  if(wait>0){m.waiting=true;publish();wake(id,wait);return false}
  clearTimer(id);const token={id,generation,version:versions.get(id)||0};running.set(id,token);m.busy=true;m.loading=!!cursor;m.waiting=false;publish();
  try{
   const response=await request(workspace,'notifications',{creator_id:id,type,...(cursor?{cursor}:{})},{priority:cursor?'background':'selected',active:()=>current(token)&&visible(),...(fresh?{fresh:true}:{})});
   if(!current(token)||!visible())return false;
   const page=response?.data;if(!Array.isArray(page?.notifications))throw Error('Respuesta de notificaciones no válida.');
   m.rows=combineNotifications(m.rows,page.notifications.map(row=>({...row,category:type})));m.error='';m.checked=now();m.denied=false;cache.denied.delete(modelKey(id));cache.cooldowns.delete(modelKey(id));
   if(cursor||!m.extended){m.cursor=page.hasMore?page.cursor:null;m.hasMore=page.hasMore===true}
   if(cursor)m.extended=true;
   if(page.hasMore&&(!page.cursor||typeof page.cursor!=='string'||page.cursor===cursor)){m.cursor=null;m.hasMore=false;m.error='El proveedor no entregó un cursor válido para continuar el historial.'}
   save(id);return true;
  }catch(error){
   if(!current(token)||error?.name==='AbortError')return false;
   if(error?.status===401||error?.status===403){deny(id,error);onDenied?.(workspace,id,error);return false}
   m.error=error?.message||'No se pudieron consultar estas notificaciones.';
   if(error?.status===429){const seconds=Number.isFinite(error.retryAfter)&&error.retryAfter>0?error.retryAfter:interval/1000;cache.cooldowns.set(modelKey(id),Math.max(cache.cooldowns.get(modelKey(id))||0,now()+seconds*1000));m.waiting=true}
   save(id);return false;
  }finally{
   if(current(token)){running.delete(id);m.busy=false;m.loading=false;save(id);publish();wake(id,interval)}
  }
 }
 function invalidated(event){
  if(event?.all){for(const row of cache.entries.values())cache.denied.add(row.modelKey);cache.entries.clear();cache.cooldowns.clear();for(const id of accounts)deny(id,event.error);return}
  if(event?.workspace!==workspace)return;
  const id=String(event.model);if(states[id])deny(id,event.error);else clearModelCache(id);
 }
 if(enabled)for(const id of accounts){states[id]=seed(id);save(id)}
 // The hook does not use models when type is empty, and must not create reads.
 if(!enabled)accounts.length=0;
 publish();
 return {
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  getSnapshot:()=>snapshot,
  start(){if(active)return;active=true;generation++;unsubscribe=subscribeInvalidation?.(invalidated);queueMicrotask(()=>{if(active)for(const id of accounts)void fetchPage(id)})},
  stop(){active=false;generation++;unsubscribe?.();unsubscribe=null;for(const id of accounts){clearTimer(id);running.delete(id);states[id].busy=false;states[id].loading=false;save(id)}publish()},
  setModels(models={}){
   sourceModels=models;let changed=false;
   for(const id of accounts){
    const source=models[id],previous=sourceDenials.get(id),wasDenied=previous?.denied;sourceDenials.set(id,{denied:!!source?.denied,version:source?.version});
    if(source?.denied&&(!wasDenied||previous.version!==source.version)){deny(id,{message:source.error});continue}
    if(source?.denied||cache.denied.has(modelKey(id))||states[id].denied)continue;
    const incoming=matching(source?.rows),known=new Set(states[id].rows.map(row=>row.id));if(!incoming.some(row=>!known.has(row.id)))continue;
    states[id].rows=combineNotifications(incoming,states[id].rows);save(id);changed=true;
   }
   if(changed)publish();
  },
  recheckVisibility(){if(!active)return;for(const id of accounts){if(visible())void fetchPage(id);else clearTimer(id)}},
  load(id,cursor){if(id!==undefined&&id!==null&&id!=='')return fetchPage(String(id),cursor||null,true);return Promise.allSettled(accounts.map(account=>fetchPage(account,null,true)))},
 };
}
