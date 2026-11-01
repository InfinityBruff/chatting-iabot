import {fanProfile,fanHistory} from './fan-profile.js';
import {actionNames,liveAction,mediaView} from './actions.js';
const origins=new Set(['https://bruff-workspace.pages.dev','https://chatting-iabot-raul.infinitybruff.chatgpt.site']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pick=(obj,keys)=>Object.fromEntries(keys.filter(k=>obj?.[k]!==undefined).map(k=>[k,obj[k]]));
export async function readOnlinePresence({binding,providerKey,fetcher,cursor}){
 // Bounded pages; the client follows all cursors without delaying inbox loading.
 const params=new URLSearchParams({filter:'all_online',pages:'1'});if(cursor)params.set('cursor',cursor);
 const r=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/followings?'+params,{headers:{Authorization:'Bearer '+providerKey},signal:AbortSignal.timeout(25000),redirect:'error'});
 if(!r.ok)throw Object.assign(Error('presence'),{providerStatus:r.status});
 const payload=await r.json();if(!Array.isArray(payload.followings))throw Error('schema');
 return {onlineIds:[...new Set(payload.followings.map(f=>String(f.id)).filter(id=>/^\d{1,24}$/.test(id)))],checkedAt:new Date().toISOString(),complete:payload.hasMore===false,scope:'followings',cursor:typeof payload.cursor==='string'?payload.cursor:null,hasMore:payload.hasMore===true};
}
export function normalizeSpend(row){
 const amount=v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&Number.isSafeInteger(Math.round(v*100))?v:null;
 const available=row?.available===true;
 return {available,...Object.fromEntries(['total','subscriptions','tips','messages','posts','streams'].map(k=>[k,available?amount(row[k]):null]))};
}
export function normalizeLive(operation,data,binding){
 const page={cursor:typeof data.cursor==='string'?data.cursor:null,hasMore:data.hasMore===true};
 if(operation==='inbox'){
  if(!Array.isArray(data.conversations))throw Error('schema');
  return {...page,conversations:data.conversations.map(x=>{const fan=pick(x,['id','userId','username','name','lastMessage','lastMessageTime','unreadCount','lastMessageIsFromMe']);try{const u=new URL(x.avatar);if(u.protocol==='https:'&&!u.username&&!u.password)fan.avatar=u.href}catch{}return fan})};
 }
 if(operation==='messages'){
  if(!Array.isArray(data.messages))throw Error('schema');
  return {...page,messages:data.messages.map(x=>({...pick(x,['id','text','isFromMe','createdAt','price','isTip','seenByFan','mediaCount','isOpened']),media:(Array.isArray(x.media)?x.media:[]).map(m=>mediaView(m,binding))}))};
 }
 if(operation==='transactions'){
  if(!Array.isArray(data.transactions))throw Error('schema');
  return {...page,transactions:data.transactions.map(x=>({...pick(x,['id','type','amount','netAmount','fee','createdAt','status']),user:pick(x.user,['id','name','username'])}))};
 }
 if(operation==='balances')return Object.fromEntries(['currentBalance','pendingBalance','availableToPayout'].map(k=>[k,typeof data[k]==='number'&&Number.isFinite(data[k])?data[k]:null]));
 if(operation==='monthly'){
  if(!Array.isArray(data.months))throw Error('schema');
  const number=(row,keys)=>{for(const k of keys)if(typeof row[k]==='number'&&Number.isFinite(row[k]))return row[k];return null};
  return {months:data.months.map(row=>({label:typeof row.date==='string'?row.date:row.year&&row.month?String(row.year)+'-'+String(row.month).padStart(2,'0'):typeof row.month==='string'?row.month:null,gross:number(row,['gross','grossAmount']),net:number(row,['net','netAmount']),total:number(row,['total','amount'])})),currency:'USD'};
 }
 if(operation==='earnings'){

  if(!data.series||typeof data.series!=='object'||Array.isArray(data.series))throw Error('schema');
  return {startDate:data.startDate,endDate:data.endDate,series:data.series,currency:'USD'};
 }
 if(operation==='profile'){
  if(!data.data?.id)throw Error('schema');
  const profile=pick(data.data,['id','name','username','isPerformer']);
  try{const u=new URL(data.data.avatar);profile.avatar=u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{profile.avatar=null}
  return profile;
 }
 throw Error('operation');
}
export function createLiveHandler({url,anonKey,providerKey,serviceKey,writeEnabled=false,fetcher=fetch}){
 return async request=>{
  const origin=request.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!origins.has(origin))return reply(403,{error:'Origen no permitido'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return reply(405,{error:'Método no permitido'});
  if(!url||!anonKey||!providerKey)return reply(503,{error:'Conector no configurado'});
  const authorization=request.headers.get('authorization')||'';
  if(!/^Bearer \S+$/.test(authorization))return reply(401,{error:'Vuelve a iniciar sesión'});
  try{
   const authHeaders={apikey:anonKey,Authorization:authorization,'Content-Type':'application/json'};
   const user=await fetcher(url+'/auth/v1/user',{headers:authHeaders,signal:AbortSignal.timeout(15000)});
   const identity=await user.json();if(!user.ok||!identity.id||!identity.email_confirmed_at)return reply(401,{error:'Sesión no válida'});
   const reader=request.body?.getReader();if(!reader)return reply(400,{error:'Faltan datos'});
   const multipart=request.headers.get('content-type')?.startsWith('multipart/form-data;');
   let bytes=0,raw='';const chunks=[];const decoder=new TextDecoder();
   try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>(multipart?11*1024*1024:150000)){await reader.cancel();return reply(413,{error:'Solicitud demasiado grande'})}if(multipart)chunks.push(value);else raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode()}finally{reader.releaseLock()}
   let input;try{input=multipart?Object.fromEntries(await new Response(new Blob(chunks),{headers:{'Content-Type':request.headers.get('content-type')}}).formData()):JSON.parse(raw)}catch{return reply(400,{error:'Solicitud inválida'})}
   if(!input||!uuid.test(input.workspace_id)||!['accounts','fan_profile','fan_history','presence','profile','inbox','messages','transactions','earnings','monthly','balances',...actionNames].includes(input.operation)||Object.keys(input).some(k=>!['workspace_id','creator_id','operation','conversation_id','cursor','start','end','query','category','type','text','attachments','ticket','file','price'].includes(k)))return reply(400,{error:'Consulta no válida'});
   const rpc=async(name,body)=>{const r=await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',headers:authHeaders,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('access');return r.json()};
   if(input.operation==='accounts')return reply(200,{accounts:await rpc('bruff_live_accounts',{w:input.workspace_id}),writeEnabled,chatSafety:await rpc('bruff_chat_status',{w:input.workspace_id})});
   if(!uuid.test(input.creator_id))return reply(400,{error:'Modelo inválida'});
   const permission=['transactions','earnings','monthly','balances'].includes(input.operation)?'analytics':input.operation.startsWith('vault_')?'vault':actionNames.includes(input.operation)?'send':'read';
   const authorize=async()=>{
    let p=permission;
    if(input.operation==='profile'){const accounts=await rpc('bruff_live_accounts',{w:input.workspace_id});const a=accounts.find(a=>a.id===input.creator_id);if(!a)throw Error('access');p=a.chat?'read':a.analytics?'analytics':a.vault?'vault':null;if(!p)throw Error('access')}
    return rpc('bruff_live_authorize',{w:input.workspace_id,c:input.creator_id,p});
   };
   const binding=await authorize();if(typeof binding!=='string'||!/^acct_[A-Za-z0-9_-]+$/.test(binding))throw Error('access');
   if(input.operation==='presence'){
    if(input.cursor!=null&&(typeof input.cursor!=='string'||input.cursor.length>2048))return reply(400,{error:'Cursor inválido'});
    let data;try{data=await readOnlinePresence({binding,providerKey,fetcher,cursor:input.cursor})}catch(e){data={onlineIds:[],checkedAt:null,complete:false,scope:'followings',unavailable:true,providerStatus:e.providerStatus||null}}
    if(await authorize()!==binding)throw Error('access');
    return reply(200,{data});
   }
   if(actionNames.includes(input.operation))return await liveAction({input,identity,binding,providerKey,fetcher,authorize,reply,writeEnabled,beginSend:async(fan,request_id)=>{if(!serviceKey)throw Error('attribution');return rpc('bruff_message_begin',{w:input.workspace_id,c:input.creator_id,fan,request_id})},finishSend:async(fan,request_id,message_id)=>{
     const r=await fetcher(url+'/rest/v1/rpc/bruff_message_finish',{method:'POST',headers:{apikey:serviceKey,Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify({w:input.workspace_id,c:input.creator_id,fan,request_id,actor:identity.id,message_id}),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('attribution');
    },screen:async(fan,body)=>{const result=await rpc('bruff_chat_screen',{w:input.workspace_id,c:input.creator_id,fan,body});if(typeof result?.allowed!=='boolean'||typeof result?.blocked!=='boolean')throw Error('safety');return result}});
   const params=new URLSearchParams();let path;
   if(['inbox','messages','transactions'].includes(input.operation)){params.set('pages','1');if(input.cursor!=null){if(typeof input.cursor!=='string'||input.cursor.length>2048)return reply(400,{error:'Cursor inválido'});params.set('cursor',input.cursor)}}
   if(['messages','fan_profile','fan_history'].includes(input.operation)){if(typeof input.conversation_id!=='string'||!/^\d{1,24}$/.test(input.conversation_id))return reply(400,{error:'Conversación inválida'});path=input.operation==='fan_profile'?'user/'+input.conversation_id:input.operation==='fan_history'?'fans/'+input.conversation_id+'/subscription-history':'conversations/'+input.conversation_id;}
   else if(input.operation==='profile')path='me';
   else if(input.operation==='monthly')path='earnings/monthly';
   else if(input.operation==='balances')path='balances';
   else if(input.operation==='inbox'){path='inbox';if(input.query){if(typeof input.query!=='string'||input.query.length>150)return reply(400,{error:'Búsqueda demasiado larga'});params.set('query',input.query)}}
   else{
    if(typeof input.start!=='string'||typeof input.end!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(input.start)||!/^\d{4}-\d{2}-\d{2}$/.test(input.end))return reply(400,{error:'Fechas inválidas'});
    const start=Date.parse(input.start+'T00:00:00Z'),end=Date.parse(input.end+'T23:59:59.999Z');
    if(!Number.isFinite(start)||!Number.isFinite(end)||end<start||end-start>367*86400000)return reply(400,{error:'Elige un intervalo de hasta un año'});
    params.set('start',new Date(start).toISOString());
    path=input.operation==='earnings'?'earnings/chart':'transactions';if(input.operation==='earnings')params.set('end',new Date(end).toISOString());
   }
   const response=await fetcher('https://api.ofmapi.com/v1/accounts/'+binding+'/'+path+'?'+params,{headers:{Authorization:'Bearer '+providerKey},signal:AbortSignal.timeout(25000),redirect:'error'});
   if(!response.ok)return reply(response.status===429?429:502,{error:response.status===429?'OFMAPI ha limitado las consultas. Espera antes de actualizar.':'OFMAPI no pudo consultar esta cuenta. Revisa su conexión o inténtalo más tarde.',providerStatus:response.status});
   const payload=await response.json();
   const data=input.operation==='fan_profile'?fanProfile(payload,input.conversation_id):input.operation==='fan_history'?fanHistory(payload,input.conversation_id):normalizeLive(input.operation,payload,binding);
   // Inbox has no spend. Fetch only ids from this authorized model's page,
   // in provider-supported batches of 20. A failed spend lookup never hides chats.
   if(input.operation==='inbox'){
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
   if(input.operation==='messages'){
    const ids=data.messages.filter(m=>m.isFromMe===true).map(m=>String(m.id)).filter(id=>/^\d{1,24}$/.test(id));
    let authors={},available=true;
    try{for(let i=0;i<ids.length;i+=500)Object.assign(authors,await rpc('bruff_message_authors',{w:input.workspace_id,c:input.creator_id,fan:input.conversation_id,ids:ids.slice(i,i+500)}))}catch{available=false}
    data.messages=data.messages.map(m=>({...m,...(m.isFromMe===true?{sentBy:available&&typeof authors[String(m.id)]==='string'?authors[String(m.id)]:null,attributionAvailable:available}:{})}));
   }
   // Recheck after provider latency so revoked membership cannot receive a pending result.
   if(await authorize()!==binding)throw Error('access');
   return reply(200,{data,observedAt:new Date().toISOString()});
  }catch(e){return reply(e.message==='access'?403:e.message==='ticket'?400:503,{error:e.message==='access'?'No tienes acceso a esta modelo o apartado.':e.message==='ticket'?'La selección ha caducado o no pertenece a esta cuenta. Vuelve a seleccionar los archivos.':'No se pudo confirmar la operación. Si estabas enviando, conserva la revisión y consulta el historial antes de crear otro mensaje.'})}
 };
}
