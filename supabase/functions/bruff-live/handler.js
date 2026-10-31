const origins=new Set(['https://bruff-workspace.pages.dev','https://chatting-iabot-raul.infinitybruff.chatgpt.site']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const pick=(obj,keys)=>Object.fromEntries(keys.filter(k=>obj?.[k]!==undefined).map(k=>[k,obj[k]]));
export function normalizeLive(operation,data){
 const page={cursor:typeof data.cursor==='string'?data.cursor:null,hasMore:data.hasMore===true};
 if(operation==='inbox'){
  if(!Array.isArray(data.conversations))throw Error('schema');
  return {...page,conversations:data.conversations.map(x=>pick(x,['id','userId','username','name','lastMessage','lastMessageTime','unreadCount','lastMessageIsFromMe']))};
 }
 if(operation==='messages'){
  if(!Array.isArray(data.messages))throw Error('schema');
  return {...page,messages:data.messages.map(x=>pick(x,['id','text','isFromMe','createdAt','price','isTip','seenByFan','mediaCount','isOpened']))};
 }
 if(operation==='transactions'){
  if(!Array.isArray(data.transactions))throw Error('schema');
  return {...page,transactions:data.transactions.map(x=>({...pick(x,['id','type','amount','netAmount','fee','createdAt','status']),user:pick(x.user,['id','name','username'])}))};
 }
 if(operation==='earnings'){
  if(!data.series||typeof data.series!=='object'||Array.isArray(data.series))throw Error('schema');
  return {startDate:data.startDate,endDate:data.endDate,series:data.series,currency:'USD'};
 }
 if(operation==='profile'){
  if(!data.data?.id)throw Error('schema');
  return pick(data.data,['id','name','username','isPerformer']);
 }
 throw Error('operation');
}
export function createLiveHandler({url,anonKey,providerKey,fetcher=fetch}){
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
   let bytes=0,raw='';const decoder=new TextDecoder();
   try{while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>8192){await reader.cancel();return reply(413,{error:'Solicitud demasiado grande'})}raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode()}finally{reader.releaseLock()}
   let input;try{input=JSON.parse(raw)}catch{return reply(400,{error:'Solicitud inválida'})}
   if(!input||!uuid.test(input.workspace_id)||!['accounts','profile','inbox','messages','transactions','earnings'].includes(input.operation)||Object.keys(input).some(k=>!['workspace_id','creator_id','operation','conversation_id','cursor','start','end','query'].includes(k)))return reply(400,{error:'Consulta no válida'});
   const rpc=async(name,body)=>{const r=await fetcher(url+'/rest/v1/rpc/'+name,{method:'POST',headers:authHeaders,body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('access');return r.json()};
   if(input.operation==='accounts')return reply(200,{accounts:await rpc('bruff_live_accounts',{w:input.workspace_id})});
   if(!uuid.test(input.creator_id))return reply(400,{error:'Modelo inválida'});
   const permission=['transactions','earnings'].includes(input.operation)?'analytics':'read';
   const authorize=()=>rpc('bruff_live_authorize',{w:input.workspace_id,c:input.creator_id,p:permission});
   const binding=await authorize();if(typeof binding!=='string'||!/^acct_[A-Za-z0-9_-]+$/.test(binding))throw Error('access');
   const params=new URLSearchParams();let path;
   if(['inbox','messages','transactions'].includes(input.operation)){params.set('pages','1');if(input.cursor!=null){if(typeof input.cursor!=='string'||input.cursor.length>2048)return reply(400,{error:'Cursor inválido'});params.set('cursor',input.cursor)}}
   if(input.operation==='messages'){if(typeof input.conversation_id!=='string'||!/^\d{1,24}$/.test(input.conversation_id))return reply(400,{error:'Conversación inválida'});path='conversations/'+input.conversation_id;}
   else if(input.operation==='profile')path='me';
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
   const data=normalizeLive(input.operation,await response.json());
   // Recheck after provider latency so revoked membership cannot receive a pending result.
   if(await authorize()!==binding)throw Error('access');
   return reply(200,{data,observedAt:new Date().toISOString()});
  }catch(e){return reply(e.message==='access'?403:503,{error:e.message==='access'?'No tienes acceso a esta modelo o apartado.':'No se pudieron cargar datos reales. No se han sustituido por ejemplos.'})}
 };
}
