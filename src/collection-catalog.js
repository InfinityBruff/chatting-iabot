const scopePart=value=>typeof value==='string'&&value.trim()?value.trim():null;
const listId=row=>row&&typeof row==='object'&&!Array.isArray(row)&&typeof row.id==='string'&&/^[A-Za-z0-9_-]{1,100}$/.test(row.id)?row.id:null;
const cursorValue=value=>typeof value==='string'&&value.trim()&&value.length<=2048?value:null;
const partial=message=>Object.assign(Error(message),{catalogPartial:true});

// A collections-page reader, independent of the directories used by campaigns.
// The provider cursor is opaque and always belongs to this exact actor/model.
export function createCollectionCatalog({actor,workspace,account,request,onDenied=()=>{},cacheEpoch=()=>0,visible=()=>true,now=Date.now,schedule=setTimeout,cancel=clearTimeout,interval=30000,spacing=1000,maxLists=5000,maxBytes=4194304,maxPages=200}){
 if(![actor,workspace,account].every(scopePart)||typeof request!=='function')throw new TypeError('El catálogo necesita usuario, agencia, modelo y lector válidos.');
 const epoch=cacheEpoch(),listeners=new Set(),countLimit=Math.max(1,Math.min(5000,Math.floor(maxLists)||5000)),byteLimit=Math.max(1,Math.min(4194304,Math.floor(maxBytes)||4194304)),pageLimit=Math.max(1,Math.min(200,Math.floor(maxPages)||200));
 const refreshInterval=Math.max(30000,Number.isFinite(interval)?interval:30000),pageSpacing=Math.max(0,Number.isFinite(spacing)?spacing:1000);
 let active=false,denied=false,generation=0,job=null,timer=null,retryAt=0,nextAt=0,failures=0,restart=true,blocked=false,cursor=null,walk=new Map(),items=new Map(),seen=new Set();
 let state={rows:[],complete:false,busy:false,queued:false,waiting:false,checked:null,error:'',denied:false,pages:0};
 const emit=patch=>{state={...state,...patch};for(const listener of listeners)listener()};
 function clearTimer(){if(timer!==null)cancel(timer);timer=null}
 function deny(reason){
  if(denied)return;denied=true;generation++;clearTimer();job?.controller.abort();items.clear();walk.clear();seen.clear();cursor=null;
  const error=reason instanceof Error?reason:Error(typeof reason==='string'&&reason?reason:'No tienes acceso a las colecciones de esta modelo.');
  emit({rows:[],complete:false,busy:false,queued:false,waiting:false,checked:null,error:error.message,denied:true,pages:0});onDenied(error);
 }
 function allowed(){if(!active)return false;if(cacheEpoch()!==epoch)deny('El acceso ha cambiado. Vuelve a abrir las colecciones.');return !denied}
 const belongs=token=>allowed()&&job===token&&token.generation===generation;
 const current=token=>belongs(token)&&!token.controller.signal.aborted&&visible();
 function wake(){
  clearTimer();if(!allowed()||job||blocked||!visible())return;
  timer=schedule(()=>{timer=null;void tick()},Math.min(2147483647,Math.max(0,retryAt-now(),nextAt-now())));
 }
 function beginWalk(){restart=false;blocked=false;cursor=null;walk=new Map();seen=new Set();emit({complete:false,error:'',pages:0})}
 function accept(page){
  if(!Array.isArray(page?.lists)||typeof page.hasMore!=='boolean'||page.lists.some(row=>listId(row)===null))throw partial('Catálogo parcial: el proveedor no entregó una página de colecciones válida.');
  const following=page.hasMore?cursorValue(page.cursor):null;
  if(page.hasMore&&(!following||following===cursor||seen.has(following)))throw partial('Catálogo parcial: el proveedor no permite continuar con un cursor válido.');
  if(page.lists.length>countLimit)throw partial('Catálogo parcial: se alcanzó el límite de memoria. Vuelve a abrir las colecciones para iniciar otra consulta.');
  const nextWalk=new Map(walk);for(const row of page.lists)nextWalk.set(row.id,row);
  // Old known rows remain visible through partial/error refreshes. Only a
  // validated end-of-history can remove lists absent from the new traversal.
  const nextItems=page.hasMore?new Map([...items,...nextWalk]):new Map(nextWalk);
  if(nextItems.size>countLimit)throw partial('Catálogo parcial: se alcanzó el límite de memoria. Vuelve a abrir las colecciones para iniciar otra consulta.');
  let bytes=0;for(const row of nextItems.values()){try{bytes+=JSON.stringify(row).length*2}catch{throw partial('Catálogo parcial: el proveedor no entregó una colección válida.')}if(bytes>byteLimit)throw partial('Catálogo parcial: se alcanzó el límite de memoria. Vuelve a abrir las colecciones para iniciar otra consulta.')}
  const pages=state.pages+1;
  walk=nextWalk;items=nextItems;
  const rows=page.hasMore?[...walk.values(),...[...items].filter(([id])=>!walk.has(id)).map(([,row])=>row)]:[...walk.values()];
  cursor=following;if(following)seen.add(following);
  emit({rows,checked:now(),pages,complete:!page.hasMore,error:'',waiting:false});
  if(page.hasMore&&pages>=pageLimit)throw partial('Catálogo parcial: se alcanzó el límite de páginas. Vuelve a abrir las colecciones para iniciar otra consulta.');
  if(!page.hasMore){restart=true;nextAt=now()+refreshInterval}else nextAt=now()+pageSpacing;
 }
 async function tick(){
  if(!allowed()||job||blocked||!visible())return;
  if(now()<Math.max(retryAt,nextAt)){wake();return}
  if(restart)beginWalk();
  const token={generation,controller:new AbortController()};job=token;emit({busy:true,queued:true,waiting:false,error:''});
  try{
   const response=await request(workspace,'collections',{creator_id:account,...(cursor?{cursor}:{})},{priority:cursor?'pagination':'selected',active:()=>current(token),signal:token.controller.signal,onStart:()=>{if(current(token))emit({queued:false})}});
   if(!current(token))return;
   accept(response?.data);failures=0;retryAt=0;
  }catch(error){
   if(!belongs(token))return;
   if(error?.status===401||error?.status===403){deny(error);return}
   if(error?.name==='AbortError'||token.controller.signal.aborted&&error?.status!==429)return;
   if(error?.catalogPartial){blocked=true;emit({complete:false,error:error.message,waiting:false});return}
   const seconds=Number(error?.retryAfter),limited=error?.status===429,backoff=[2000,5000,10000,30000,60000][Math.min(failures++,4)];
   const supplied=Number.isFinite(seconds)&&seconds>0?seconds*1000:0;
   retryAt=Math.max(retryAt,now()+(limited?supplied||60000:Math.max(backoff,supplied)));
   emit({complete:false,error:limited?'El proveedor limita las consultas. Se conserva el catálogo y se reintentará al terminar la espera.':error?.message||'No se pudieron actualizar las colecciones. Se reintentará automáticamente.',waiting:limited});
  }finally{
   if(job===token){job=null;if(allowed()){emit({busy:false,queued:false});wake()}}
  }
 }
 return {
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener)},getSnapshot:()=>state,
  start(){if(active||denied)return;active=true;generation++;wake()},
  stop(){active=false;generation++;clearTimer();job?.controller.abort();emit({busy:false,queued:false})},
  recheckVisibility(){if(!allowed())return;if(!visible()){clearTimer();job?.controller.abort();emit({busy:false,queued:false})}else wake()},
  refresh(){
   if(!allowed())return false;generation++;restart=true;blocked=false;nextAt=0;clearTimer();job?.controller.abort();emit({complete:false,busy:false,queued:false,error:'',waiting:retryAt>now()});wake();return true;
  },
  deny,invalidate:deny,
 };
}
