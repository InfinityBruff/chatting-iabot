import {catalogSelection,validateCatalogProposal} from './chat-direct-catalog-proposal.js';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const ID=/^[1-9][0-9]{0,23}$/u;
const identifier=value=>typeof value==='string'&&ID.test(value);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const exact=(value,keys)=>object(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key));
const price=value=>value===null||Number.isSafeInteger(value)&&value>=0&&Math.round(value/100*100)===value;
const natural=value=>Number.isSafeInteger(value)&&value>=0;
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f]/u.test(value);
const timestamp=value=>typeof value==='string'&&value.length<=40&&Number.isFinite(Date.parse(value));
const aborted=()=>Object.assign(new Error('Lectura cancelada.'),{name:'AbortError'});
const failure=(status=503,retryAfter=0)=>Object.assign(new Error(status===401||status===403?'El acceso al catálogo ha cambiado. Revisa tu sesión y permisos.':status===429?'La fuente pide esperar antes de volver a consultar.':'No se pudo verificar el catálogo y su seguimiento. Vuelve a intentarlo.'),{status,retryAfter});
export function catalogScope(context){return context&&UUID.test(context.actor)&&UUID.test(context.workspace)&&UUID.test(context.account)&&identifier(context.fanId)?JSON.stringify([context.actor,context.workspace,context.account,context.fanId]):null}
export function validateCatalogPlan(value,catalog,{saving=false}={}){
 const keys=saving?['folderId','expectedVersion','steps','confirmed']:['folderId','version','planHash','approvedAt','steps'];
 if(!exact(value,keys)||!text(value.folderId,256)||!Array.isArray(value.steps)||value.steps.length<1||value.steps.length>1000||saving&&(!natural(value.expectedVersion)||value.expectedVersion===Number.MAX_SAFE_INTEGER||value.confirmed!==true)||!saving&&(!natural(value.version)||value.version<1||!(/^[a-f0-9]{64}$/u).test(value.planHash)||!timestamp(value.approvedAt)))throw failure(400);
 const folder=catalog?.folders?.find(folder=>folder.id===value.folderId),seen=new Set();if(!folder||value.steps.length!==folder.items.length)throw failure(400);
 const steps=value.steps.map(step=>{const item=folder.items.find(item=>item.id===step?.mediaId);if(!exact(step,['mediaId','priceCents'])||!item||seen.has(step.mediaId)||!price(step.priceCents)||item.type==='photo'&&step.priceCents!==0)throw failure(400);seen.add(step.mediaId);return{mediaId:step.mediaId,priceCents:step.priceCents}});
 return saving?{folderId:value.folderId,expectedVersion:value.expectedVersion,steps,confirmed:true}:{folderId:value.folderId,version:value.version,planHash:value.planHash,approvedAt:value.approvedAt,steps};
}
export function catalogPriceInput(value){
 if(value==='')return null;if(typeof value!=='string'||!/^\d+(?:[.,]\d{1,2})?$/u.test(value))return undefined;const amount=Number(value.replace(',','.')),cents=Math.round(amount*100);return price(cents)&&Math.abs(amount*100-cents)<0.0000001?cents:undefined;
}
export function catalogPlanDraft(folder,plan){
 if(plan)return plan.steps.map(step=>({...step}));
 return [...folder.items.filter(item=>item.type==='photo'),...folder.items.filter(item=>item.type!=='photo')].map(item=>({mediaId:item.id,priceCents:item.type==='photo'?0:item.referencePriceCents}));
}
export function moveCatalogPlanStep(steps,index,direction){
 const target=index+direction;if(!Number.isInteger(index)||![-1,1].includes(direction)||index<0||index>=steps.length||target<0||target>=steps.length)return steps.map(step=>({...step}));
 const next=steps.map(step=>({...step}));[next[index],next[target]]=[next[target],next[index]];return next;
}
function validateCommerce(value,catalog,observations){
 if(value===undefined)return null;
 if(!exact(value,['plans','evidence','refundStatus'])||!Array.isArray(value.plans)||value.plans.length>100||!Array.isArray(value.evidence)||value.evidence.length>10000||value.refundStatus!=='unknown')throw failure();
 const folders=new Set(),plans=value.plans.map(plan=>{const clean=validateCatalogPlan(plan,catalog);if(folders.has(clean.folderId))throw failure();folders.add(clean.folderId);return clean}),rows=new Map();
 for(const row of value.evidence){
  if(!exact(row,['id','kind','messageId','mediaIds','offerPriceCents','paidAmountCents','paidAt','eventId','contract','observedAt'])||!(/^[a-f0-9]{64}$/u).test(row.id)||!identifier(row.messageId)||!Array.isArray(row.mediaIds)||row.mediaIds.length<1||row.mediaIds.length>1000||new Set(row.mediaIds).size!==row.mediaIds.length||!row.mediaIds.every(id=>identifier(id)&&observations.some(observation=>observation.messageId===row.messageId&&observation.mediaId===id))||!price(row.offerPriceCents)||!timestamp(row.observedAt))throw failure();
  if(row.kind==='paid_unlock_reported'){
   if(row.contract!=='ofmapi-openapi-20261107-ppv-opened'||!natural(row.offerPriceCents)||row.offerPriceCents===0||row.paidAmountCents!==null||row.paidAt!==null||row.eventId!==null)throw failure();
  }else if(row.kind==='ppv_purchase_event'){
   if(row.contract!=='ofmapi-webhooks-20261107-ppv-purchased'||row.offerPriceCents===0||!price(row.paidAmountCents)||row.paidAmountCents===null||row.paidAmountCents===0||!timestamp(row.paidAt)||!UUID.test(row.eventId))throw failure();
  }else throw failure();
  const clean=Object.fromEntries(['id','kind','messageId','mediaIds','offerPriceCents','paidAmountCents','paidAt','eventId','contract','observedAt'].map(key=>[key,key==='mediaIds'?row[key].slice():row[key]]));
  if(rows.has(row.id)&&JSON.stringify(rows.get(row.id))!==JSON.stringify(clean))throw failure();rows.set(row.id,clean);
 }
 return {plans,evidence:[...rows.values()],refundStatus:'unknown'};
}
export function catalogCommerceStats(observations,commerce){
 if(!commerce)return{reportedUnlocks:null,purchaseMessages:null,pendingOffers:null,refundStatus:'unknown'};
 const paid=new Set(commerce.evidence.map(row=>row.messageId)),unlocks=new Set(commerce.evidence.filter(row=>row.kind==='paid_unlock_reported').map(row=>row.messageId)),purchases=new Set(commerce.evidence.filter(row=>row.kind==='ppv_purchase_event').map(row=>row.messageId));
 return{reportedUnlocks:unlocks.size,purchaseMessages:purchases.size,pendingOffers:new Set(observations.filter(row=>row.kind==='offered'&&!paid.has(row.messageId)).map(row=>row.messageId)).size,refundStatus:'unknown'};
}
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
 const catalog={batchHash:value.catalog.batchHash,folders},commerce=validateCommerce(value.commerce,catalog,observations);
 return {commerce,commerceError:commerce?null:'Compras y orden temporalmente no disponibles',actorId:context.actor,workspaceId:context.workspace,creatorId:context.account,fanId:context.fanId,sendsEnabled:false,observedAt:value.observedAt,catalog:{batchHash:value.catalog.batchHash,folders},progress:{observations,scan:{version:scan.version,cursor:scan.cursor,historyComplete:scan.historyComplete,recentCheckedAt:scan.recentCheckedAt,historyCheckedAt:scan.historyCheckedAt,pages:scan.pages}}};
}
// An offered bundle is one message, even when several catalog assets match it.
// Neither an opened report nor the proposed catalog price proves a purchase.
export function catalogProgressStats(observations=[]){
 const messages=new Map(),media=new Set();for(const row of observations){messages.set(row.messageId,row.kind);media.add(JSON.stringify([row.folderId,row.mediaId]))}
 return {messages:messages.size,media:media.size,offered:[...messages.values()].filter(kind=>kind==='offered').length,free:[...messages.values()].filter(kind=>kind==='free_sent').length,unknown:[...messages.values()].filter(kind=>kind==='sent_price_unknown').length,paidConfirmed:null};
}
export function createChatDirectCatalogSource(client,{actor,workspace}){
 const check=(context,signal)=>{if(signal?.aborted)throw aborted();if(!UUID.test(actor)||!UUID.test(workspace)||context?.actor!==actor||context.workspace!==workspace||!catalogScope(context)||context.canRead!==true)throw failure(403)};
 async function request(context,operation,{signal,scan,folderId,mediaId,proposalId,plan}={}){
  check(context,signal);const selecting=['recommend','verify_recommendation'].includes(operation),selection=selecting?catalogSelection({...((folderId!==undefined)?{folderId}:{}),...((mediaId!==undefined)?{mediaId}:{})}):{};if(operation==='verify_recommendation'&&(typeof proposalId!=='string'||!/^[a-f0-9]{64}$/u.test(proposalId)))throw failure(400);if(operation==='sync'&&!['recent','older'].includes(scan))throw failure(400);
  let response;try{response=await client.functions.invoke('bruff-memory',{body:{operation,workspace_id:workspace,creator_id:context.account,conversation_id:context.fanId,...(operation==='sync'?{scan}: {}),...(selection.folderId?{folder_id:selection.folderId}:{}),...(selection.mediaId?{media_id:selection.mediaId}:{}),...(operation==='verify_recommendation'?{proposal_id:proposalId}:{}),...(operation==='save_plan'?{plan}:{})},signal})}catch(error){if(signal?.aborted||error?.name==='AbortError')throw aborted();throw failure()}
  check(context,signal);
  if(response.error){const status=Number(response.error.context?.status||response.error.status)||503,raw=response.error.context?.headers?.get?.('Retry-After'),retryAfter=Number(raw),error=failure(status,status===429&&Number.isFinite(retryAfter)&&retryAfter>0?Math.min(86400,Math.ceil(retryAfter)):status===429?60:0);if(operation==='save_plan'&&status===409)error.message='El orden o los precios cambiaron en otra sesión. Actualiza recientes y revisa la versión guardada.';throw error}
  const data=validateCatalogSnapshot(response.data,context);return selecting?{...data,proposal:validateCatalogProposal(response.data.proposal,data.catalog,data.commerce)}:data;
 }
 return {read:(context,options)=>request(context,'read',options),sync:(context,options)=>request(context,'sync',options),recommend:(context,options)=>request(context,'recommend',options),verifyRecommendation:(context,options)=>request(context,'verify_recommendation',options),savePlan:async(context,{catalog,signal,...plan})=>{const clean=validateCatalogPlan(plan,catalog,{saving:true}),data=await request(context,'save_plan',{signal,plan:clean}),saved=data.commerce?.plans.find(row=>row.folderId===clean.folderId);if(!saved||saved.version!==clean.expectedVersion+1||JSON.stringify(saved.steps)!==JSON.stringify(clean.steps))throw failure();return data}};
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
  report:error=>{if(!current())return;if([401,403].includes(error?.status)){next=null;clearTimerNow();running?.controller.abort();emit({data:null,busy:false,phase:null,denied:true,error:error.message});return}if(error?.status===429)emit({retryAt:now()+Math.max(1,error.retryAfter||60)*1000,error:error.message})},
  adopt:data=>{if(!current()||state.denied)return false;next='recent';nextAt=now()+60000;emit({data,error:'',retryAt:0});return true},
  snapshot:()=>state,start:()=>{if(alive)return;alive=true;onChange(state);schedule()},stop:()=>{alive=false;clearTimerNow();running?.controller.abort()},
  setVisible:value=>{visible=value===true;clearTimerNow();if(!visible){running?.controller.abort();if(running&&!next)next=state.data?'recent':'read'}else schedule()},
  refresh:scan=>{if(!alive||!visible||running||state.denied||!current()||now()<state.retryAt||!['recent','older'].includes(scan)||scan==='older'&&(!state.data?.progress.scan.cursor||state.data.progress.scan.historyComplete))return false;next=scan;nextAt=now();schedule();return true},
 };
}
