const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ID=/^[1-9][0-9]{0,23}$/u;
const identifier=value=>typeof value==='string'&&ID.test(value);
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const timestamp=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
const aborted=()=>Object.assign(new Error('Lectura cancelada.'),{name:'AbortError'});
const failure=(status=503,retryAfter=0)=>Object.assign(new Error(status===401||status===403?'El acceso al catálogo ha cambiado. Revisa tu sesión y permisos.':status===429?'La fuente pide esperar antes de volver a consultar.':'No se pudo verificar el catálogo y su seguimiento. Vuelve a intentarlo.'),{status,retryAfter});
export function catalogScope(context){return context&&UUID.test(context.actor)&&UUID.test(context.workspace)&&UUID.test(context.account)&&identifier(context.fanId)?JSON.stringify([context.actor,context.workspace,context.account,context.fanId]):null}
export function validateCatalogSnapshot(value,context){
 if(!value||value.actorId!==context.actor||value.workspaceId!==context.workspace||value.creatorId!==context.account||value.fanId!==context.fanId)throw failure(403);
 if(value.sendsEnabled!==false||!timestamp(value.observedAt)||!value.catalog||!/^[a-f0-9]{64}$/u.test(value.catalog.batchHash)||!Array.isArray(value.catalog.folders)||value.catalog.folders.length>100)throw failure();
 const folders=[],folderIds=new Set(),assets=new Map();let assetCount=0;
 for(const folder of value.catalog.folders){
  if(!folder||!text(folder.id,256)||folderIds.has(folder.id)||!text(folder.name,256)||folder.orderConfirmed!==false||!Array.isArray(folder.items)||folder.items.length>1000)throw failure();
  folderIds.add(folder.id);const ids=new Set(),items=[];
  for(const item of folder.items){
   if(!item||!identifier(item.id)||ids.has(item.id)||!['photo','video','audio','gif'].includes(item.type)||item.label!==null&&!text(item.label,256)||item.durationLabel!==null&&!text(item.durationLabel,100)||item.referencePriceCents!==null&&!natural(item.referencePriceCents)||item.configuredPriceCents!==null)throw failure();
   if(++assetCount>1000)throw failure();ids.add(item.id);items.push({id:item.id,type:item.type,label:item.label,durationLabel:item.durationLabel,referencePriceCents:item.referencePriceCents,configuredPriceCents:null});
  }
  assets.set(folder.id,ids);folders.push({id:folder.id,name:folder.name,orderConfirmed:false,items});
 }
 const progress=value.progress,scan=progress?.scan;
 if(!Array.isArray(progress?.observations)||progress.observations.length>10000||!scan||!natural(scan.version)||!natural(scan.pages)||typeof scan.historyComplete!=='boolean'||scan.cursor!==null&&!text(scan.cursor,2048)||![scan.recentCheckedAt,scan.historyCheckedAt].every(value=>value===null||timestamp(value)))throw failure();
 const observations=[],seen=new Map(),messages=new Map();
 for(const observation of progress.observations){
  const {folderId,mediaId,messageId,createdAt,kind,priceCents,openedReported,paidConfirmed}=observation||{};
  if(!assets.get(folderId)?.has(mediaId)||!identifier(messageId)||!timestamp(createdAt)||!['offered','free_sent','sent_price_unknown'].includes(kind)||paidConfirmed!==false||openedReported!==null&&typeof openedReported!=='boolean'||kind==='offered'&&(!natural(priceCents)||priceCents===0)||kind==='free_sent'&&priceCents!==0||kind==='sent_price_unknown'&&priceCents!==null)throw failure();
  const previous=messages.get(messageId);
  if(previous&&(previous.kind!==kind||previous.priceCents!==priceCents||previous.createdAt!==createdAt))throw failure();
  messages.set(messageId,{kind,priceCents,createdAt});const key=JSON.stringify([folderId,mediaId,messageId]);if(seen.has(key)){if(seen.get(key)!==openedReported)throw failure();continue}seen.set(key,openedReported);
  observations.push({folderId,mediaId,messageId,createdAt,kind,priceCents,openedReported,paidConfirmed:false});
 }
 return {actorId:context.actor,workspaceId:context.workspace,creatorId:context.account,fanId:context.fanId,sendsEnabled:false,observedAt:value.observedAt,catalog:{batchHash:value.catalog.batchHash,folders},progress:{observations,scan:{version:scan.version,cursor:scan.cursor,historyComplete:scan.historyComplete,recentCheckedAt:scan.recentCheckedAt,historyCheckedAt:scan.historyCheckedAt,pages:scan.pages}}};
}
// An offered bundle is one message, even when several catalog assets match it.
// Neither an opened report nor the proposed catalog price proves a purchase.
export function catalogProgressStats(observations=[]){
 const messages=new Map(),media=new Set();for(const row of observations){messages.set(row.messageId,row.kind);media.add(JSON.stringify([row.folderId,row.mediaId]))}
 return {messages:messages.size,media:media.size,offered:[...messages.values()].filter(kind=>kind==='offered').length,free:[...messages.values()].filter(kind=>kind==='free_sent').length,unknown:[...messages.values()].filter(kind=>kind==='sent_price_unknown').length,paidConfirmed:null};
}
export function createChatDirectCatalogSource(client,{actor,workspace}){
 const check=(context,signal)=>{if(signal?.aborted)throw aborted();if(!UUID.test(actor)||!UUID.test(workspace)||context?.actor!==actor||context.workspace!==workspace||!catalogScope(context)||context.canRead!==true)throw failure(403)};
 async function request(context,operation,{signal,scan}={}){
  check(context,signal);if(operation==='sync'&&!['recent','older'].includes(scan))throw failure(400);
  let response;try{response=await client.functions.invoke('bruff-memory',{body:{operation,workspace_id:workspace,creator_id:context.account,conversation_id:context.fanId,...(operation==='sync'?{scan}: {})},signal})}catch(error){if(signal?.aborted||error?.name==='AbortError')throw aborted();throw failure()}
  check(context,signal);
  if(response.error){const status=Number(response.error.context?.status||response.error.status)||503,raw=response.error.context?.headers?.get?.('Retry-After'),retryAfter=Number(raw);throw failure(status,status===429&&Number.isFinite(retryAfter)&&retryAfter>0?Math.min(86400,Math.ceil(retryAfter)):status===429?60:0)}
  return validateCatalogSnapshot(response.data,context);
 }
 return {read:(context,options)=>request(context,'read',options),sync:(context,options)=>request(context,'sync',options)};
}
// One visible panel owns one serial reader. Hiding aborts its admission and drops
// late results; no background history traversal or interval fan-out is created.
export function createCatalogReader(source,context,{onChange=()=>{},getEpoch=()=>0,now=Date.now,setTimer=setTimeout,clearTimer=clearTimeout}={}){
 const epoch=getEpoch();let alive=false,visible=true,running=null,timer=null,next='read',nextAt=0;
 let state={data:null,busy:false,phase:null,error:'',denied:false,retryAt:0};
 const emit=patch=>{state={...state,...patch};if(alive)onChange(state)};
 const clearTimerNow=()=>{if(timer!==null)clearTimer(timer);timer=null};
 const current=()=>alive&&getEpoch()===epoch;
 function schedule(){clearTimerNow();if(!alive||!visible||running||state.denied)return;if(!current()){emit({data:null,busy:false,phase:null,error:'El acceso al catálogo ha cambiado. Abre de nuevo este apartado.',denied:true});return}const wait=Math.max(nextAt,state.retryAt)-now();if(wait>0){timer=setTimer(()=>{timer=null;drive()},wait);return}drive()}
 function drive(){
  if(!current()||!visible||running||state.denied)return;
  if(now()<Math.max(nextAt,state.retryAt)){schedule();return}
  const phase=next;next=null;if(!phase)return;const ticket={controller:new AbortController()};running=ticket;emit({busy:true,phase,error:''});
  const valid=()=>current()&&visible&&running===ticket&&!ticket.controller.signal.aborted;
  Promise.resolve().then(()=>{if(!valid())throw aborted();return phase==='read'?source.read(context,{signal:ticket.controller.signal}):source.sync(context,{scan:phase,signal:ticket.controller.signal})}).then(data=>{
   if(!valid())return;emit({data,error:'',retryAt:0});next='recent';nextAt=phase==='read'?now():now()+60000;
  }).catch(error=>{
   if(!current()||running!==ticket)return;
   if(error?.name==='AbortError'||ticket.controller.signal.aborted){if(!next)next=state.data?'recent':'read';return}
   if([401,403].includes(error?.status)){next=null;emit({data:null,error:error.message,denied:true});return}
   emit({error:error?.message||'No se pudo completar la lectura.',retryAt:error?.status===429?now()+Math.max(1,error.retryAfter||60)*1000:0});next=state.data?'recent':'read';nextAt=now()+60000;
  }).finally(()=>{if(running!==ticket)return;running=null;if(!alive)return;if(!current()){emit({data:null,busy:false,phase:null,error:'El acceso al catálogo ha cambiado. Abre de nuevo este apartado.',denied:true});return}emit({busy:false,phase:null});schedule()});
 }
 return {
  snapshot:()=>state,start:()=>{if(alive)return;alive=true;onChange(state);schedule()},stop:()=>{alive=false;clearTimerNow();running?.controller.abort()},
  setVisible:value=>{visible=value===true;clearTimerNow();if(!visible){running?.controller.abort();if(running&&!next)next=state.data?'recent':'read'}else schedule()},
  refresh:scan=>{if(!alive||!visible||running||state.denied||!current()||now()<state.retryAt||!['recent','older'].includes(scan)||scan==='older'&&(!state.data?.progress.scan.cursor||state.data.progress.scan.historyComplete))return false;next=scan;nextAt=now();schedule();return true},
 };
}
