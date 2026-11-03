import {coordinateProviderReads,createProviderReadCache} from './provider-read-coordinator.js';
import {likeFanMessage} from './message-like.js';
import {manageNativeQueue} from '../../../server/native-queue.js';
import {protectProviderReads,retrySeconds} from './provider-read-guard.js';
import {submitNativeMass} from '../../../server/native-mass.js';
import {runAdvancedTick} from '../../../server/advanced-worker.js';
import {preparationPlan} from '../../../server/advanced-preparation.js';
import {discoverAudience} from './audience-discovery.js';
import {resolveMassAudience,AudienceError,AudiencePending} from './advanced-audience.js';
import {runAutomationTick} from './automation-worker.js';
import {communityNames,communityAction} from './community.js';
import {fanProfile,fanHistory,fanActivity} from './fan-profile.js';
import {actionNames,liveAction,mediaView} from './actions.js';
const origins=new Set(['https://bruff-workspace.pages.dev','https://chatting-iabot-raul.infinitybruff.chatgpt.site']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pick=(obj,keys)=>Object.fromEntries(keys.filter(k=>obj?.[k]!==undefined).map(k=>[k,obj[k]]));
export async function readOnlinePresence({binding,providerKey,fetcher,cursor}){
 // Bounded pages; the client follows all cursors without delaying inbox loading.
 const params=new URLSearchParams({filter:'all_online',type:'all',pages:'1'});if(cursor)params.set('cursor',cursor);
 const r=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/followings?'+params,{headers:{Authorization:'Bearer '+providerKey},signal:AbortSignal.timeout(25000),redirect:'error'});
 if(!r.ok){const retry=Number(r.headers.get('Retry-After'));throw Object.assign(Error('presence'),{providerStatus:r.status,retryAfter:Number.isFinite(retry)&&retry>0?Math.min(retry,120):null})}
 const payload=await r.json();if(!Array.isArray(payload.followings)||typeof payload.hasMore!=='boolean')throw Error('schema');
 return {onlineIds:[...new Set(payload.followings.map(f=>String(f.id)).filter(id=>/^\d{1,24}$/.test(id)))],checkedAt:new Date().toISOString(),complete:payload.hasMore===false,scope:'followings',cursor:typeof payload.cursor==='string'?payload.cursor:null,hasMore:payload.hasMore===true};
}
export function normalizeSpend(row){
 const amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&Number.isSafeInteger(Math.round(v*100))?v:null;
 const available=row?.available===true;
 return {available,...Object.fromEntries(['total','subscriptions','tips','messages','posts','streams'].map(k=>[k,available?amount(row[k]):null]))};
}
const earningsKeys=['total','messages','tips','subscriptions','posts','streams','referrals'];
export function categorySeries(part,category){
 if(part.filter!=null&&part.filter!==category)throw Error('category');
 const series=part.series;if(!series||typeof series!=='object'||Array.isArray(series))throw Error('category');
 const values=Object.values(series).filter(v=>v&&typeof v==='object'&&!Array.isArray(v)&&(['gross','total'].some(k=>typeof v[k]==='number'&&Number.isFinite(v[k]))||Array.isArray(v.chartAmount)));
 const v=series[category]??(values.length===1?values[0]:null);if(!v||typeof v!=='object'||Array.isArray(v))throw Error('category');
 const n=x=>typeof x==='number'&&Number.isFinite(x)?x:null;
 const points=xs=>Array.isArray(xs)?xs.map(x=>({date:typeof x.date==='string'?x.date:typeof x.datetime==='string'?x.datetime:null,count:n(x.count)})):[];
 return {gross:n(v.gross),total:n(v.total),chartAmount:points(v.chartAmount),chartCount:points(v.chartCount)};
}
export function normalizeLive(operation,data,binding){
 const page={cursor:typeof data.cursor==='string'?data.cursor:null,hasMore:data.hasMore===true};
 if(operation==='inbox'){
  if(!Array.isArray(data.conversations))throw Error('schema');
  return {...page,conversations:data.conversations.map(x=>{const fan=pick(x,['id','userId','username','name','lastMessage','lastMessageTime','unreadCount','lastMessageIsFromMe']);try{const u=new URL(x.avatar);if(u.protocol==='https:'&&!u.username&&!u.password)fan.avatar=u.href}catch{}return fan})};
 }
 if(operation==='messages'){
  if(!Array.isArray(data.messages))throw Error('schema');
  return {...page,messages:data.messages.map(x=>({...pick(x,['id','text','isFromMe','createdAt','price','isTip','seenByFan','mediaCount','isOpened','isLiked']),media:(Array.isArray(x.media)?x.media:[]).map(m=>mediaView(m,binding))}))};
 }
 if(operation==='transactions'){
  if(!Array.isArray(data.transactions))throw Error('schema');
  return {...page,transactions:data.transactions.map(x=>({...pick(x,['id','type','amount','netAmount','fee','createdAt','status']),user:pick(x.user,['id','name','username'])}))};
 }
 if(operation==='balances')return Object.fromEntries(['currentBalance','pendingBalance','availableToPayout'].map(k=>[k,typeof data[k]==='number'&&Number.isFinite(data[k])?data[k]:null]));
 if(operation==='monthly'){
  if(!Array.isArray(data.months))throw Error('schema');
  const number=(row,keys)=>{for(const k of keys)if(typeof row[k]==='number'&&Number.isFinite(row[k]))return row[k];return null};
  const rows=data.months.flatMap(row=>Array.isArray(row?.monthlyTotal)?row.monthlyTotal:[row]);
  return {months:rows.map(row=>({label:typeof row.date==='string'?row.date:row.year&&row.month?String(row.year)+'-'+String(row.month).padStart(2,'0'):typeof row.month==='string'?row.month:null,gross:number(row,['gross','grossAmount']),net:number(row,['net','netAmount']),total:number(row,['total','amount'])})),currency:'USD'};
 }
 if(operation==='earnings'){

  if(!data.series||typeof data.series!=='object'||Array.isArray(data.series))throw Error('schema');
  return {startDate:data.startDate,endDate:data.endDate,series:data.series,unavailableCategories:Array.isArray(data.unavailableCategories)?data.unavailableCategories.filter(k=>earningsKeys.includes(k)):[],currency:'USD'};
 }
 if(operation==='profile'){
  if(!data.data?.id)throw Error('schema');
  const profile=pick(data.data,['id','name','username','isPerformer']);
  try{const u=new URL(data.data.avatar);profile.avatar=u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{profile.avatar=null}
  return profile;
 }
 throw Error('operation');
}
export function createLiveHandler({url,anonKey,providerKey,serviceKey,readSlotEnabled=false,writeEnabled=false,advancedWriteEnabled=false,fetcher=fetch,onFailure=record=>console.error(JSON.stringify(record))}){
 const baseFetcher=fetcher,readCache=createProviderReadCache();
 return async request=>{
  let readQuota=null,firstMessageRead=false;
  const guardedFetcher=protectProviderReads({fetcher:baseFetcher,onQuota:q=>{readQuota=q},gate:serviceKey?async(op,wait_seconds=0)=>{
   const response=await baseFetcher(url+'/rest/v1/rpc/bruff_provider_read_gate',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({op,wait_seconds}),signal:AbortSignal.timeout(10000)});
   if(!response.ok)throw Error('read_guard');return response.json();
  }:null});
  const fetcher=readSlotEnabled?coordinateProviderReads({fetcher:guardedFetcher,cache:readCache,slot:serviceKey?async(op,lease_id,priority)=>{
   if(firstMessageRead&&op==='acquire'){
    try{const combined=await baseFetcher(url+'/rest/v1/rpc/bruff_message_read_turn',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({lease_id,priority}),signal:AbortSignal.timeout(10000)});if(combined.ok)return await combined.json()}
    catch{
     // A lost response may have granted this exact ticket. Never replay acquisition.
     try{await baseFetcher(url+'/rest/v1/rpc/bruff_provider_read_slot',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({op:'release',lease_id,priority}),signal:AbortSignal.timeout(10000)})}catch{}
     throw Error('read_slot');
    }
    // Rolling deployment/outage: retain the existing slot and independent gate check.
   }
   const r=await baseFetcher(url+'/rest/v1/rpc/bruff_provider_read_slot',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({op,lease_id,priority}),signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('read_slot');return r.json()
  }:null}):guardedFetcher;
  let diagnosticOperation='request',failureKind='unavailable',providerStatus=null;
  const origin=request.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
  const reply=(status,body)=>{
   if(status===503)try{onFailure({event:'bruff_live_failure',operation:diagnosticOperation,kind:failureKind,...(Number.isInteger(providerStatus)&&providerStatus>=400&&providerStatus<=599?{providerStatus}:{})})}catch{}
   if(readQuota&&['inbox','messages','fan_spend_batch','presence','profile','fan_profile','fan_spend','fan_history','fan_activity',...communityNames].includes(diagnosticOperation))body={...body,readQuota};
   return new Response(JSON.stringify(body),{status,headers});
  };
  if(origin&&!origins.has(origin))return reply(403,{error:'Origen no permitido'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Método no permitido'});
  if(!url||!anonKey||!providerKey||readSlotEnabled&&!serviceKey)return reply(503,{error:'Conector no configurado'});
  if(request.headers.has('x-bruff-advanced-secret')){
   if(origin||!serviceKey)return reply(403,{error:'No autorizado'});
   const adminRpc=async(name,body)=>{const r=await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('No autorizado');return r.json()};
   try{return reply(200,await runAdvancedTick({token:request.headers.get('x-bruff-advanced-secret'),rpc:adminRpc,providerKey,fetcher,writeEnabled:advancedWriteEnabled===true}))}catch{return reply(403,{error:'No autorizado'})}
  }
  if(request.headers.has('x-bruff-automation-secret')){
   if(origin||!serviceKey)return reply(403,{error:'No autorizado'});
   const adminRpc=async(name,body)=>{const r=await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('No autorizado');return r.json()};
   try{return reply(200,await runAutomationTick({token:request.headers.get('x-bruff-automation-secret'),rpc:adminRpc,providerKey,fetcher,writeEnabled}))}catch{return reply(403,{error:'No autorizado'})}
  }
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))return reply(401,{error:'Vuelve a iniciar sesión'});
  try{
   const authHeaders={apikey:anonKey,Authorization:authorization,'Content-Type':'application/json'};
   const user=await fetcher(url+'/auth/v1/user',{headers:authHeaders,signal:AbortSignal.timeout(15000)});
   if(user.status>=500){failureKind='auth_service';headers['Retry-After']='10';return reply(503,{code:'AUTH_UNAVAILABLE',retryAfter:10,error:'No se pudo verificar el acceso. El servicio no responde. Inténtalo de nuevo más tarde.'})}
   const identity=await user.json();if(!user.ok||!identity.id||!identity.email_confirmed_at)return reply(401,{error:'Sesión no válida'});
   const reader=request.body?.getReader();if(!reader)return reply(400,{error:'Faltan datos'});
   const multipart=request.headers.get('content-type')?.startsWith('multipart/form-data;');
   let bytes=0,raw='';const chunks=[];const decoder=new TextDecoder();
   try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>(multipart?11*1024*1024:150000)){await reader.cancel();return reply(413,{error:'Solicitud demasiado grande'})}if(multipart)chunks.push(value);else raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode()}finally{reader.releaseLock()}
   let input;try{input=multipart?Object.fromEntries(await new Response(new Blob(chunks),{headers:{'Content-Type':request.headers.get('content-type')}}).formData()):JSON.parse(raw)}catch{return reply(400,{error:'Solicitud inválida'})}
   if(!input||!uuid.test(input.workspace_id)||!['automation_audience','automation_prepare','native_activate','native_queue','native_cancel','accounts','fan_profile','fan_history','fan_activity','fan_spend','fan_spend_batch','like_message','presence','profile','inbox','messages','transactions','earnings','monthly','balances',...communityNames,...actionNames].includes(input.operation)||Object.keys(input).some(k=>!['run_id','expected_revision','draft_id','expected_version','workspace_id','creator_id','operation','conversation_id','cursor','start','end','query','category','type','text','attachments','ticket','file','price','list_id','name','user_id','user_ids','fast','message_id','background'].includes(k)))return reply(400,{error:'Consulta no válida'});
   diagnosticOperation=input.operation;
   if(input.background!=null&&(!['inbox','messages'].includes(input.operation)||typeof input.background!=='boolean'))return reply(400,{error:'Consulta no válida'});
   const rpc=async(name,body)=>{const r=await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',headers:authHeaders,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error(['accounts','inbox','messages'].includes(input.operation)&&![401,403].includes(r.status)?'read_database':'access');return r.json()};
   if(input.operation==='accounts'){const [accounts,chatSafety]=await Promise.all([rpc('bruff_live_accounts',{w:input.workspace_id}),rpc('bruff_chat_status',{w:input.workspace_id})]);return reply(200,{accounts,writeEnabled,chatSafety})}
   if(!uuid.test(input.creator_id))return reply(400,{error:'Modelo inválida'});
   const permission=['like_message','automation_audience','automation_prepare','native_activate','native_queue','native_cancel'].includes(input.operation)?'send':['transactions','earnings','monthly','balances'].includes(input.operation)?'analytics':input.operation.startsWith('vault_')?'vault':actionNames.includes(input.operation)?'send':'read';
   const authorize=async()=>{
    let p=permission;
    if(communityNames.includes(input.operation)||['automation_audience','automation_prepare','native_activate','native_queue','native_cancel'].includes(input.operation)){const memberships=await rpc('bruff_my_workspaces',{});if(!Array.isArray(memberships)||!memberships.some(w=>w.id===input.workspace_id&&['owner','admin'].includes(w.role)))throw Error('access')} 
    if(input.operation==='profile'){const accounts=await rpc('bruff_live_accounts',{w:input.workspace_id});const a=accounts.find(a=>a.id===input.creator_id);if(!a)throw Error('access');p=a.chat?'read':a.analytics?'analytics':a.vault?'vault':null;if(!p)throw Error('access')}
    return rpc('bruff_live_authorize',{w:input.workspace_id,c:input.creator_id,p});
   };
   const binding=await authorize();if(typeof binding!=='string'||!/^acct_[A-Za-z0-9_-]+$/.test(binding))throw Error('access');
   firstMessageRead=input.operation==='messages'&&input.cursor==null&&input.background!==true;
   if(input.operation==='messages'&&request.signal.aborted)return reply(499,{error:'Consulta cancelada'});
   if(['native_queue','native_cancel'].includes(input.operation)){
    const cancel=input.operation==='native_cancel';
    if(!serviceKey||cancel&&!writeEnabled)return reply(503,{error:'Gestión de cola no habilitada'});
    if(!uuid.test(input.run_id))return reply(400,{error:'Ejecución inválida'});
    const call=async(op,value=null)=>{
     if(await authorize()!==binding)throw Error('access');
     const r=await fetcher(url+'/rest/v1/rpc/bruff_native_queue',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({w:input.workspace_id,c:input.creator_id,actor:identity.id,run_id:input.run_id,op,value}),signal:AbortSignal.timeout(15000)});
     if(!r.ok)throw Error('No se pudo autorizar la gestión de esta cola');return r.json();
    };
    const record=await call(cancel?'cancel_context':'context');if(record.binding!==binding)throw Error('access');
    const result=await manageNativeQueue({record,providerKey,fetcher,cancel,enabled:writeEnabled,store:{authorize:()=>call(cancel?'cancel_authorize':'authorize'),record:value=>call('record',value)}});
    return reply(200,{data:{...result,id:record.id}});
   }
   if(input.operation==='native_activate'){
    if(!writeEnabled||!serviceKey)return reply(503,{error:'Envíos nativos no habilitados'});
    if(!uuid.test(input.run_id)||!Number.isSafeInteger(input.expected_revision))return reply(400,{error:'Revisión de ejecución inválida'});
    const call=async(op,value=null)=>{
     if(await authorize()!==binding)throw Error('access');
     const r=await fetcher(url+'/rest/v1/rpc/bruff_native_mass',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({w:input.workspace_id,c:input.creator_id,actor:identity.id,op,run_id:input.run_id,expected_revision:input.expected_revision,value}),signal:AbortSignal.timeout(15000)});
     if(!r.ok)throw Error('No se pudo confirmar la ejecución nativa');return r.json();
    };
    const record=await call('context');if(record.binding!==binding)throw Error('access');
    const result=await submitNativeMass({record,enabled:true,providerKey,fetcher,store:{authorize:()=>call('authorize'),begin:(_,payload)=>call('begin',payload),finish:(_,result)=>call('finish',result),moderate:async(_,body)=>{const r=await rpc('bruff_chat_screen',{w:input.workspace_id,c:input.creator_id,fan:record.recipients[0],body});return r?.allowed===true}}});
    return reply(200,{data:{...result,id:record.id}});
   }
   if(['automation_audience','automation_prepare'].includes(input.operation)){
    if(!uuid.test(input.draft_id)||!Number.isSafeInteger(input.expected_version)||input.expected_version<1)return reply(400,{error:'Guarda y vuelve a abrir el borrador antes de comprobar la audiencia'});
    const stored=await rpc('bruff_auto_message_drafts',{w:input.workspace_id,c:input.creator_id,op:'list'});
    const draft=stored.rows?.find(d=>d.id===input.draft_id&&!d.archived);
    if(!draft||draft.version!==input.expected_version)return reply(409,{error:'El borrador ha cambiado. Actualiza antes de continuar'});
    if(draft.trigger!=='mass')return reply(400,{error:'Esta comprobación corresponde a mensajes masivos'});
    if(Object.entries(draft.audience||{}).some(([key,value])=>!['excludeLists','modelSpend','buyingPower','agencySpend','modelPurchase','agencyPurchase'].includes(key)&&value?.enabled))return reply(400,{error:'Hay filtros avanzados sin resolver; no se omitirán al preparar destinatarios'});
    let plan;
    if(input.operation==='automation_prepare'){
     if(!serviceKey)return reply(503,{error:'La preparación de ejecuciones no está configurada'});
     try{plan=preparationPlan(draft)}catch(e){return reply(400,{error:e.message})}
    }
    const checkpointRpc=async(op,lease_id=null,value=null,wait_seconds=0)=>{
     if(await authorize()!==binding)throw Error('access');
     const response=await fetcher(url+'/rest/v1/rpc/bruff_audience_checkpoint',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({w:input.workspace_id,c:input.creator_id,d:draft.id,v:draft.version,actor:identity.id,binding_id:binding,op,lease_id,value,wait_seconds}),signal:AbortSignal.timeout(15000)});
     if(!response.ok)throw new AudienceError('No se pudo guardar el avance de destinatarios. No se enviará nada.');
     return response.json();
    };
    let financialContext;
    if(['agencySpend','modelPurchase','agencyPurchase'].some(k=>draft.audience?.[k]?.enabled)){
     const agency=draft.audience.agencySpend.enabled||draft.audience.agencyPurchase.enabled;
     const manifest=async()=>agency?await rpc('bruff_financial_sources',{w:input.workspace_id}):[{id:input.creator_id,binding:await rpc('bruff_live_authorize',{w:input.workspace_id,c:input.creator_id,p:'analytics'})}];
     const sources=await manifest(),signature=JSON.stringify(sources);
     const check=async()=>{if(await authorize()!==binding||JSON.stringify(await manifest())!==signature)throw new AudienceError('Las modelos o permisos de la agencia han cambiado. Vuelve a preparar la audiencia')};
     financialContext={sources,current:input.creator_id,read:async(source,path)=>{
      await check();
      const response=await fetcher('https://api.ofmapi.com/v1/accounts/'+source.binding+'/'+path,{method:'GET',headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:AbortSignal.timeout(20000)});
      if(response.status===429){const raw=response.headers.get('retry-after'),wait=/^\d+$/.test(raw||'')?Number(raw):Math.ceil((Date.parse(raw)-Date.now())/1000);throw new AudiencePending('El proveedor limita el histórico financiero. Se conserva el avance.',Math.min(86400,Math.max(30,Number.isFinite(wait)?wait:60)))}
      if(!response.ok)throw new AudienceError('No se pudo completar el histórico financiero de la agencia');
      const data=await response.json();await check();return data;
     }};
    }
    let audience;try{audience=serviceKey?await discoverAudience({config:draft,binding,authorize,providerKey,fetcher,checkpointRpc,financialContext}):await resolveMassAudience({config:draft,binding,authorize,providerKey,fetcher,financialContext})}catch(e){if(e instanceof AudienceError)return reply(503,{error:e.message});throw e}
    if(audience.complete!==true)return reply(503,{error:(audience.message||'Hay una comprobación en curso o en espera.')+' Avance guardado en la nube. Vuelve a comprobar dentro de '+audience.retryAfter+' segundos.',retryAfter:audience.retryAfter,resumable:true});
    const latest=await rpc('bruff_auto_message_drafts',{w:input.workspace_id,c:input.creator_id,op:'list'});
    if(!latest.rows?.some(d=>d.id===draft.id&&d.version===draft.version&&!d.archived))return reply(409,{error:'La campaña cambió durante la comprobación'});
    let prepared;
    if(input.operation==='automation_prepare'){
     if(await authorize()!==binding)throw Error('access');
     const native=!draft.unsend.enabled&&!draft.ending.enabled&&!draft.timeWindow.enabled&&!draft.bulk.repeat&&!draft.messages[0].text.includes('{nombre}');
     const response=await fetcher(url+'/rest/v1/rpc/'+(native?'bruff_native_mass':'bruff_prepare_mass'),{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({w:input.workspace_id,c:input.creator_id,d:draft.id,v:draft.version,actor:identity.id,binding_id:binding,recipients:audience.recipientIds,...(native?{op:'prepare'}:{plan})}),signal:AbortSignal.timeout(15000)});
     if(!response.ok)return reply(503,{error:'No se pudo preparar la ejecución. No se ha activado ningún envío.'});
     prepared=await response.json();
     if(!uuid.test(prepared?.id)||(native?prepared.state!=='prepared':prepared.state!=='paused'||prepared.prepared!==true))return reply(409,{error:'La campaña ya tiene una ejecución. Revisa su estado antes de continuar.'});
    }
    return reply(200,{data:{...audience,...(prepared?{execution:prepared}:{}),draftId:draft.id,draftVersion:draft.version,creatorId:input.creator_id,activated:false}});
   }
   if(communityNames.includes(input.operation))return reply(200,{data:await communityAction({input,binding,providerKey,fetcher,authorize,writeEnabled}),observedAt:new Date().toISOString()});
   if(input.operation==='like_message')return await likeFanMessage({input,binding,providerKey,fetcher,authorize,writeEnabled,reply});
   if(input.operation==='fan_spend_batch'){
    if(!Array.isArray(input.user_ids)||!input.user_ids.length||input.user_ids.length>20||input.user_ids.some(id=>typeof id!=='string'||!/^\d{1,24}$/.test(id)))return reply(400,{error:'Fans inválidos'});
    const ids=[...new Set(input.user_ids)];
    const r=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/fans/spend?'+new URLSearchParams({ids:ids.join(',')}),{headers:{Authorization:'Bearer '+providerKey},redirect:'error',signal:AbortSignal.timeout(10000)});
    if(!r.ok){const error=Error('provider');error.providerStatus=r.status;error.retryAfter=r.status===429?retrySeconds(r.headers):null;throw error}
    const payload=await r.json();if(!Array.isArray(payload.fans))throw Error('schema');
    if(await authorize()!==binding)throw Error('access');
    return reply(200,{data:{fans:payload.fans.filter(row=>ids.includes(String(row.fanId))).map(row=>({id:String(row.fanId),spend:normalizeSpend(row)}))}});
   }
   if(input.operation==='presence'){
    if(input.cursor!=null&&(typeof input.cursor!=='string'||input.cursor.length>2048))return reply(400,{error:'Cursor inválido'});
    let data;try{data=await readOnlinePresence({binding,providerKey,fetcher,cursor:input.cursor})}catch(e){data={onlineIds:[],checkedAt:null,complete:false,scope:'followings',unavailable:true,providerStatus:e.providerStatus||null,retryAfter:e.retryAfter||null}}
    if(await authorize()!==binding)throw Error('access');
    return reply(200,{data});
   }
   if(actionNames.includes(input.operation))return await liveAction({input,identity,binding,providerKey,fetcher,authorize,reply,writeEnabled,beginSend:async(fan,request_id)=>{if(!serviceKey)throw Error('attribution');return rpc('bruff_message_begin',{w:input.workspace_id,c:input.creator_id,fan,request_id})},finishSend:async(fan,request_id,message_id)=>{
     const r=await fetcher(url+'/rest/v1/rpc/bruff_message_finish',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({w:input.workspace_id,c:input.creator_id,fan,request_id,actor:identity.id,message_id}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('attribution');
    },screen:async(fan,body)=>{const result=await rpc('bruff_chat_screen',{w:input.workspace_id,c:input.creator_id,fan,body});if(typeof result?.allowed!=='boolean'||typeof result?.blocked!=='boolean')throw Error('safety');return result}});
   const params=new URLSearchParams();let path;
   if(input.fast!=null&&(input.operation!=='inbox'||typeof input.fast!=='boolean'))return reply(400,{error:'Consulta no válida'});
   if(['inbox','messages','transactions','fan_activity'].includes(input.operation)){params.set('pages','1');if(input.cursor!=null){if(typeof input.cursor!=='string'||input.cursor.length>2048)return reply(400,{error:'Cursor inválido'});params.set('cursor',input.cursor)}}
   if(['messages','fan_profile','fan_history','fan_activity','fan_spend'].includes(input.operation)){if(typeof input.conversation_id!=='string'||!/^\d{1,24}$/.test(input.conversation_id))return reply(400,{error:'Conversación inválida'});if(input.operation==='fan_activity'&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.start||'')||!Number.isFinite(Date.parse(input.start))||input.start<'2016-01-01'||Date.parse(input.start)>Date.now()))return reply(400,{error:'Inicio de historial inválido'});if(input.operation==='fan_activity')params.set('start',input.start+'T00:00:00Z');if(input.operation==='fan_spend')params.set('ids',input.conversation_id);path=input.operation==='fan_activity'?'transactions':input.operation==='fan_spend'?'fans/spend':input.operation==='fan_profile'?'user/'+input.conversation_id:input.operation==='fan_history'?'fans/'+input.conversation_id+'/subscription-history':'conversations/'+input.conversation_id;}
   else if(input.operation==='profile')path='me';
   else if(input.operation==='monthly')path='earnings/monthly';
   else if(input.operation==='balances')path='balances';
   else if(input.operation==='inbox'){path='inbox';if(input.query){if(typeof input.query!=='string'||input.query.length>150)return reply(400,{error:'Búsqueda demasiado larga'});params.set('query',input.query)}}
   else{
    if(typeof input.start!=='string'||typeof input.end!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.start)||!/^\d{4}-\d{2}-\d{2}$/.test(input.end))return reply(400,{error:'Fechas inválidas'});
    const start=Date.parse(input.start+'T00:00:00Z'),end=Date.parse(input.end+'T23:59:59.999Z');
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>(input.operation==='earnings'?20*366:367)*86400000||start<Date.parse('2016-01-01T00:00:00Z'))return reply(400,{error:'Intervalo no permitido: movimientos hasta un año; gráficos desde 2016, hasta 20 años'});
    params.set('start',new Date(start).toISOString());
    path=input.operation==='earnings'?'earnings/chart':'transactions';if(input.operation==='earnings')params.set('end',new Date(end).toISOString());
   }
   const providerSignal=input.operation==='messages'?AbortSignal.any([request.signal,AbortSignal.timeout(25000)]):AbortSignal.timeout(25000);
   const response=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/'+path+'?'+params,{...(readSlotEnabled&&input.background===true?{readPriority:'background'}:{}),headers:{Authorization:'Bearer '+providerKey},signal:providerSignal,redirect:'error'});
   if(input.operation==='messages'&&request.signal.aborted)return reply(499,{error:'Consulta cancelada'});
   if(!response.ok){const retryAfter=response.status===429?retrySeconds(response.headers):null;if(retryAfter)headers['Retry-After']=String(retryAfter);
    return reply(response.status===429?429:502,{error:response.status===429?'OFMAPI ha limitado las consultas. Se conserva el avance; espera antes de actualizar.':'OFMAPI no pudo consultar esta cuenta. Revisa su conexión o inténtalo más tarde.',providerStatus:response.status,...(retryAfter?{retryAfter}:{})});}
   const payload=await response.json();
   if(input.operation==='messages'&&request.signal.aborted)return reply(499,{error:'Consulta cancelada'});
   if(input.operation==='earnings'){
    // The provider defaults to total. Each other category must be requested explicitly.
    const series={...payload.series},unavailableCategories=[];
    for(let i=1;i<earningsKeys.length;i+=2)await Promise.all(earningsKeys.slice(i,i+2).map(async category=>{
     const query=new URLSearchParams(params);query.set('filter',category);
     try{const r=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/earnings/chart?'+query,{headers:{Authorization:'Bearer '+providerKey},signal:AbortSignal.timeout(25000),redirect:'error'});
      if(!r.ok)throw Error('category');const part=await r.json();
      series[category]=categorySeries(part,category);
     }catch{delete series[category];unavailableCategories.push(category)}
    }));payload.series=series;payload.unavailableCategories=unavailableCategories;
   }
   const data=input.operation==='fan_activity'?fanActivity(payload,input.conversation_id,input.start):input.operation==='fan_spend'?normalizeSpend(payload.fans?.find(f=>String(f.fanId)===input.conversation_id)):input.operation==='fan_profile'?fanProfile(payload,input.conversation_id):input.operation==='fan_history'?fanHistory(payload,input.conversation_id):normalizeLive(input.operation,payload,binding);
   // Inbox has no spend. Fetch only ids from this authorized model's page,
   // in provider-supported batches of 20. A failed spend lookup never hides chats.
   if(input.operation==='inbox'&&input.fast!==true){
    const ids=[...new Set(data.conversations.map(f=>String(f.userId??f.id)).filter(id=>/^\d{1,24}$/.test(id)))].slice(0,100);
    const amounts=new Map();
    await Promise.all(Array.from({length:Math.ceil(ids.length/20)},async(_,index)=>{
     const batch=ids.slice(index*20,index*20+20);
     try{
      const r=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/fans/spend?'+new URLSearchParams({ids:batch.join(',')}),{headers:{Authorization:'Bearer '+providerKey},signal:AbortSignal.timeout(10000),redirect:'error'});
      if(!r.ok)return;const payload=await r.json();
      if(Array.isArray(payload.fans))for(const row of payload.fans){const fanId=String(row.fanId);if(batch.includes(fanId))amounts.set(fanId,normalizeSpend(row))}
     }catch{/* Spend remains explicitly unavailable. */}
    }));
    // Presence is queried separately so a provider-wide scan never blocks inbox.
    data.conversations=data.conversations.map(f=>({...f,spend:amounts.get(String(f.userId??f.id))??normalizeSpend(null)}));
   }
   let readContextVerified=false;
   if(input.operation==='messages'){
    const ids=data.messages.filter(m=>m.isFromMe===true).map(m=>String(m.id)).filter(id=>/^\d{1,24}$/.test(id));
    let authors={},available=true;
    if(ids.length>0&&ids.length<=500){
     // A single DB round trip, with the same final access/binding check after attribution.
     // Legacy fallback supports transient metadata failures and rolling deployment.
     let contextResponse=null,context=null;
     try{contextResponse=await fetcher(url+'/rest/v1/rpc/bruff_message_read_context',{method:'POST',headers:authHeaders,body:JSON.stringify({w:input.workspace_id,c:input.creator_id,fan:input.conversation_id,ids,expected_binding:binding}),signal:AbortSignal.timeout(15000)})}catch{}
     if(contextResponse?.status===401||contextResponse?.status===403)throw Error('access');
     if(contextResponse?.ok)try{context=await contextResponse.json()}catch{}
     if(context&&typeof context==='object'&&'binding'in context&&context.binding!==binding)throw Error('access');
     if(context?.binding===binding&&context.authors&&typeof context.authors==='object'&&!Array.isArray(context.authors)){authors=context.authors;readContextVerified=true}
    }
    if(!readContextVerified)try{for(let i=0;i<ids.length;i+=500)Object.assign(authors,await rpc('bruff_message_authors',{w:input.workspace_id,c:input.creator_id,fan:input.conversation_id,ids:ids.slice(i,i+500)}))}catch{available=false}
    data.messages=data.messages.map(m=>({...m,...(m.isFromMe===true?{sentBy:available&&typeof authors[String(m.id)]==='string'?authors[String(m.id)]:null,attributionAvailable:available}:{})}));
   }
   // Recheck after provider latency so revoked membership cannot receive a pending result.
   if(!readContextVerified&&await authorize()!==binding)throw Error('access');
   if(input.operation==='messages'&&request.signal.aborted)return reply(499,{error:'Consulta cancelada'});
   return reply(200,{data,observedAt:new Date().toISOString()});
  }catch(e){if(diagnosticOperation==='messages'&&request.signal.aborted)return reply(499,{error:'Consulta cancelada'});failureKind=['TypeError','ReferenceError','SyntaxError','TimeoutError','AbortError'].includes(e?.name)?e.name:['schema','provider','input','category','read_guard','read_slot','read_database'].includes(e?.message)?e.message:'unexpected';providerStatus=e?.providerStatus;
   if(e?.providerStatus===429){const retryAfter=Number.isInteger(e.retryAfter)&&e.retryAfter>0?e.retryAfter:60;headers['Retry-After']=String(retryAfter);return reply(429,{error:'El proveedor limita las consultas. Se conserva el avance; espera antes de actualizar.',providerStatus:429,retryAfter})}
   const status=e.message==='access'?403:['ticket','input'].includes(e.message)?400:503;
   if(status===503&&['accounts','inbox','messages'].includes(diagnosticOperation)){headers['Retry-After']='10';return reply(503,{code:'READ_UNAVAILABLE',retryAfter:10,error:diagnosticOperation==='accounts'?'No se pudieron cargar las modelos. El servidor no responde. Se reintentará automáticamente.':diagnosticOperation==='inbox'?'No se pudo cargar la lista de chats. El servidor no responde. Se reintentará automáticamente.':'No se pudo cargar el historial. El servidor no responde. Se reintentará automáticamente.'})}
   return reply(status,{error:e.message==='access'?'No tienes acceso a esta modelo o apartado.':e.message==='input'?'Revisa los parámetros de la consulta.':e.message==='ticket'?'La selección ha caducado o no pertenece a esta cuenta. Vuelve a seleccionar los archivos.':'No se pudo confirmar la operación. Si estabas enviando, conserva la revisión y consulta el historial antes de crear otro mensaje.'})}
 };
}
