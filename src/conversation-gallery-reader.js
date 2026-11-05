import {readFailureState} from './live-page-policy.js';

const scopePart=value=>typeof value==='string'&&value.trim()?value.trim():typeof value==='number'&&Number.isSafeInteger(value)&&value>=0?String(value):null;
const messageId=row=>{if(!row||typeof row!=='object'||Array.isArray(row))return null;const value=row.id;return typeof value==='string'&&/^[1-9]\d{0,23}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null};
const cursorValue=value=>typeof value==='string'&&value.trim()&&value.length<=2048?value:null;

// A dialog-owned, memory-only traversal. Seed/thread rows never prove that an
// older cursor was visited: completeness belongs only to this fresh walk.
export function createConversationGalleryReader({actor,workspace,account,fan,request,initial=null,onDenied=()=>{},cacheEpoch=()=>0,visible=()=>true,now=Date.now,schedule=setTimeout,cancel=clearTimeout,spacing=500,maxMessages=20000,maxBytes=20*1024*1024}){
 const parts=[actor,workspace,account,fan].map(scopePart);
 if(parts.some(value=>value===null)||typeof request!=='function')throw new TypeError('La galería necesita actor, espacio, modelo, fan y lector válidos.');
 const scope=JSON.stringify(parts),initialEpoch=cacheEpoch(),listeners=new Set(),rows=new Map(),sizes=new Map(),verified=new Set();
 const gap=Math.max(500,Number.isFinite(spacing)?spacing:500),countLimit=Math.max(1,Math.min(20000,Math.floor(maxMessages)||20000)),byteLimit=Math.max(1,Math.min(20*1024*1024,Math.floor(maxBytes)||20*1024*1024));
 let active=false,denied=false,generation=0,running=null,timer=null,head=true,next=null,seen=new Set(),walkIds=new Set(),manual=false,walkStarted=false,limited=false,blocked=false,bytes=0,retryAt=0,nextAt=0;
 let state={messages:[],hasMore:true,complete:false,pages:0,busy:false,waiting:false,error:'',scanning:true,updated:null};
 const emit=patch=>{state={...state,...patch};for(const listener of listeners)listener()};
 const current=token=>active&&!denied&&running===token&&token.generation===generation&&initialEpoch===cacheEpoch()&&!token.controller.signal.aborted;
 function clearTimer(){if(timer!==null)cancel(timer);timer=null}
 function revoke(error=Error('El acceso ha cambiado. Vuelve a abrir la galería.')){
  if(denied)return;denied=true;generation++;clearTimer();running?.controller.abort();rows.clear();sizes.clear();verified.clear();bytes=0;next=null;seen.clear();
  emit({messages:[],hasMore:false,complete:false,pages:0,busy:false,waiting:false,error:error.message||'Sin acceso a la galería.',scanning:false,updated:null});onDenied(error);
 }
 function allowed(){if(initialEpoch!==cacheEpoch()){revoke();return false}return !denied}
 function merge(messages,authoritative=false){
  let invalid=false,capped=false;
  for(const row of messages){
   const id=messageId(row);if(id===null){invalid=true;continue}
   // Thread caches carry no per-row observation provenance. Once this reader
   // has verified a message, only its own fresh response can replace that row.
   if(!authoritative&&verified.has(id))continue;
   let size;try{size=JSON.stringify(row).length*2}catch{invalid=true;continue}
   const previous=sizes.get(id)||0;
   if((!rows.has(id)&&rows.size>=countLimit)||bytes-previous+size>byteLimit){capped=true;continue}
   rows.set(id,row);sizes.set(id,size);bytes+=size-previous;if(authoritative){verified.add(id);walkIds.add(id)}
  }
  if(capped)blocked=true;
  return {messages:[...rows.values()],invalid,capped};
 }
 function importRows(envelope){
  if(!allowed()||blocked||state.complete)return false;
  if(envelope?.scope!==undefined&&envelope.scope!==scope)return false;
  const messages=envelope?.data?.messages;if(!Array.isArray(messages))return false;
  const merged=merge(messages);
  emit({messages:merged.messages,...(merged.capped?{complete:false,scanning:false,error:'Galería parcial: se alcanzó el límite de memoria. Cierra la galería para iniciar otra consulta.'}:{})});
  if(merged.capped){clearTimer();running?.controller.abort()}
  return true;
 }
 function hasJob(){return head||!blocked&&walkStarted&&!state.complete&&next&&(manual||state.scanning)}
 function wake(){
  clearTimer();if(!active||running||!allowed()||blocked||!visible()||!hasJob())return;
  timer=schedule(tick,Math.max(0,retryAt-now(),nextAt-now()));
 }
 function fail(error){
  const failure=readFailureState(error,now());
  if(failure.denied){revoke(error);return}
  limited=failure.waiting;retryAt=Math.max(retryAt,failure.retryAt);
  if(limited){manual=true;emit({busy:false,waiting:true,error:'',complete:false})}
  else {manual=false;head=false;emit({busy:false,waiting:false,error:failure.error,complete:false,scanning:false})}
 }
 async function tick(){
  timer=null;if(!active||running||!allowed()||blocked||!visible()||!hasJob())return;
  if(now()<Math.max(retryAt,nextAt)){wake();return}
  const cursor=head?null:next,token={generation,controller:new AbortController(),cursor};running=token;manual=false;
  emit({busy:false,waiting:true,error:''});
  try{
   const response=await request(cursor,{signal:token.controller.signal,active:()=>current(token)&&visible(),onStart:()=>{if(current(token)&&visible())emit({busy:true,waiting:false})},background:cursor!==null});
   if(!current(token)||!visible())return;
   const data=response?.data;
   if(!Array.isArray(data?.messages)||typeof data.hasMore!=='boolean')throw Error('El proveedor no devolvió una página válida de mensajes.');
   const merged=merge(data.messages,true),pages=state.pages+1;
   emit({messages:merged.messages,pages,updated:response.observedAt||new Date(now()).toISOString()});
   if(merged.capped)throw Error('Galería parcial: se alcanzó el límite de memoria. Cierra la galería para iniciar otra consulta.');
   if(merged.invalid)throw Error('Galería parcial: algunos mensajes no tienen un identificador válido.');
   const following=data.hasMore?cursorValue(data.cursor):null;
   if(data.hasMore&&(!following||following===cursor||seen.has(following)))throw Error('Galería parcial: el proveedor no permite continuar este historial.');
   if(cursor===null){head=false;walkStarted=true}
   if(following)seen.add(following);next=following;limited=false;retryAt=0;nextAt=now()+gap;
   if(!data.hasMore)for(const id of rows.keys())if(!walkIds.has(id)){rows.delete(id);bytes-=sizes.get(id)||0;sizes.delete(id);verified.delete(id)}
   emit({messages:[...rows.values()],hasMore:data.hasMore,complete:!data.hasMore,busy:false,waiting:false,error:''});
  }catch(error){if(current(token)&&error?.name!=='AbortError')fail(error)}
  finally{
   if(running===token){running=null;if(active){if(!allowed())return;emit({busy:false,waiting:limited});wake()}}
  }
 }
 if(initial)importRows(initial);
 return {
  getSnapshot:()=>state,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},
  start(){if(active||!allowed())return;active=true;generation++;wake()},
  stop(){active=false;generation++;clearTimer();running?.controller.abort();emit({busy:false,waiting:false})},
  resume(){if(!active||!allowed())return;if(!visible()){clearTimer();running?.controller.abort();emit({busy:false,waiting:limited})}else wake()},
  pauseScan(){if(!allowed())return;manual=false;emit({scanning:false});if(running?.cursor!==null)running?.controller.abort();wake()},
  toggleScan(){if(!allowed()||blocked)return;const scanning=!state.scanning;emit({scanning,error:scanning?'':state.error});if(scanning){if(!walkStarted)head=true;wake()}else{manual=false;if(running?.cursor!==null)running?.controller.abort();wake()}},
  loadMore(){if(!active||!allowed()||blocked||running||state.complete)return false;manual=true;if(!walkStarted)head=true;emit({error:''});wake();return true},
  refresh(){if(!active||!allowed()||blocked)return false;generation++;head=true;next=null;seen=new Set();walkIds=new Set();walkStarted=false;manual=false;nextAt=0;running?.controller.abort();emit({hasMore:true,complete:false,pages:0,error:'',scanning:true});wake();return true},
  ingest:importRows,
 };
}
