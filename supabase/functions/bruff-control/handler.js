// Private MCP resource server. Every database call uses the real user's token.
// No service role, provider API, arbitrary RPC, approval, generation or send path.
const MODERN='2026-07-28',LEGACY='2025-03-26',VERSIONS=[MODERN,LEGACY];
const SERVER={name:'bruff-control',version:'1.0.0',title:'BRUFF · Control privado'};
const INSTRUCTIONS='Control privado de preferencias y ejemplos documentales no explícitos. Solo propietario. Guardar un ejemplo crea un borrador; la aprobación humana se realiza en BRUFF. Ninguna herramienta genera contenido, activa bots ni envía mensajes.';
const UUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const IDENTIFIER='^[A-Za-z0-9][A-Za-z0-9_.:-]*$';
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const uuid={type:'string',pattern:UUID},integer=(minimum,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const text=(maxLength,multiline=false)=>({type:'string',minLength:1,maxLength,pattern:multiline?'^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]+$':'^[^\\u0000-\\u001f\\u007f]+$'});
const identifier=maxLength=>({type:'string',minLength:1,maxLength,pattern:IDENTIFIER});
const SETTINGS=object({mode:{type:'string',enum:['bank','semantic']},maxResults:integer(1,3),minScore:{type:'number',minimum:.5,maximum:.99},dailyLimit:integer(1,100)});
const ENTRY=object({trigger:text(2000),english:text(10000,true),spanish:text(10000,true),reference_id:identifier(128),label:text(200),source_version:identifier(96)});
const SCOPE={workspace_id:uuid,model_id:uuid};
const SECURITY=[{type:'oauth2',scopes:['openid','email','profile']}];
const definition=(name,title,description,inputSchema,readOnly)=>({name,title,description,inputSchema,securitySchemes:SECURITY,_meta:{securitySchemes:SECURITY},annotations:{readOnlyHint:readOnly,destructiveHint:!readOnly,idempotentHint:readOnly,openWorldHint:false}});
const TOOLS=[
 definition('bruff_list_models','Listar modelos de BRUFF','Lista únicamente las agencias donde eres propietario activo y sus modelos registradas. No consulta fans ni OnlyFans.',object({workspace_id:uuid},[]),true),
 definition('bruff_read_ai_settings','Consultar preferencias IA','Lee preferencias de selección de ejemplos de una modelo. No ejecuta una IA ni activa conversaciones.',object(SCOPE),true),
 definition('bruff_update_ai_settings','Guardar preferencias IA','Guarda preferencias con control de versión. No conecta un generador, activa un bot ni envía mensajes.',object({...SCOPE,expected_version:integer(0),settings:SETTINGS}),false),
 definition('bruff_list_examples','Consultar ejemplos documentales','Lee la base documental de una modelo, incluidos borradores y archivo. No presenta un borrador como ejemplo aprobado.',object(SCOPE),true),
 definition('bruff_save_example_draft','Guardar borrador documental','Crea o edita exclusivamente un borrador no explícito con referencia y traducción. Nunca aprueba un ejemplo. Un ejemplo existente pasa a borrador; requiere su versión vigente.',object({...SCOPE,example_id:uuid,expected_version:integer(0),entry:ENTRY},['workspace_id','model_id','expected_version','entry']),false),
 definition('bruff_archive_example','Archivar ejemplo documental','Archiva un ejemplo de la modelo indicada con su versión vigente. Deja de ofrecerse en consultas nuevas; no elimina mensajes ni envía nada.',object({...SCOPE,example_id:uuid,expected_version:integer(1)}),false),
];
const BY_NAME=new Map(TOOLS.map(tool=>[tool.name,tool]));
const RPCS=new Set(['bruff_ai_models','bruff_ai_control','bruff_chat_direct_knowledge']);
// The Supabase relay can remove /functions/v1 before invoking Deno. A function
// mounted at its own root may also receive /. These are exact aliases only.
const ROUTES=new Set(['/functions/v1/bruff-control','/bruff-control','']);
const METADATA_ROUTES=new Set([...ROUTES].map(path=>path+'/.well-known/oauth-protected-resource'));
const own=(value,key)=>Object.hasOwn(value,key),record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isUuid=value=>typeof value==='string'&&new RegExp(UUID,'u').test(value);
const sameId=(a,b)=>isUuid(a)&&isUuid(b)&&a.toLowerCase()===b.toLowerCase();
function valid(schema,value){
 if(schema.type==='object')return record(value)&&schema.required.every(key=>own(value,key))&&Object.keys(value).every(key=>own(schema.properties,key)&&valid(schema.properties[key],value[key]));
 if(schema.type==='string')return typeof value==='string'&&(!schema.minLength||value.trim().length>=schema.minLength)&&(!schema.maxLength||value.length<=schema.maxLength)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value))&&(!schema.enum||schema.enum.includes(value));
 return typeof value==='number'&&Number.isFinite(value)&&(schema.type!=='integer'||Number.isSafeInteger(value))&&value>=schema.minimum&&value<=schema.maximum;
}
class Failure extends Error{constructor(status,code,message){super(message);this.status=status;this.code=code}}
const unavailable=()=>new Failure(503,1005,'El servicio no está disponible. No se ha podido confirmar la operación; consulta el estado antes de repetir un cambio.');
const forbidden=()=>new Failure(403,1003,'Acceso no permitido. Verifica tu sesión de propietario y la modelo seleccionada.');
function requireObject(value,keys){if(!record(value)||Object.keys(value).some(key=>!keys.includes(key)))throw new Failure(400,-32602,'Parámetros no válidos.');return value}
function headerName(value){
 if(typeof value!=='string'||value.length>512)return null;
 if(!value.startsWith('=?base64?')||!value.endsWith('?='))return value;
 try{const decoded=atob(value.slice(9,-2));return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(decoded,char=>char.charCodeAt(0)))}catch{return null}
}
function modelsSnapshot(data,actor,workspace){
 if(!record(data)||!sameId(data.actorId,actor)||!Array.isArray(data.workspaces)||data.workspaces.length>1000)throw unavailable();
 const seen=new Set(),workspaces=data.workspaces.map(item=>{
  if(!record(item)||!isUuid(item.id)||seen.has(item.id.toLowerCase())||typeof item.name!=='string'||item.name.length>500||!Array.isArray(item.models)||item.models.length>10000||workspace&&!sameId(item.id,workspace))throw unavailable();
  seen.add(item.id.toLowerCase());const ids=new Set();
  return {id:item.id,name:item.name,models:item.models.map(model=>{if(!record(model)||!isUuid(model.id)||ids.has(model.id.toLowerCase())||typeof model.name!=='string'||model.name.length>500)throw unavailable();ids.add(model.id.toLowerCase());return {id:model.id,name:model.name}})};
 });
 if(!workspaces.length)throw forbidden();
 return {actorId:actor,workspaces};
}
function settingsSnapshot(data,actor,w,c){
 if(!record(data)||!sameId(data.actorId,actor)||!sameId(data.workspaceId,w)||!sameId(data.creatorId,c)||!valid(SETTINGS,data.settings)||!Number.isSafeInteger(data.version)||data.version<0)throw unavailable();
 return {actorId:actor,workspaceId:w,modelId:c,settings:{mode:data.settings.mode,maxResults:data.settings.maxResults,minScore:data.settings.minScore,dailyLimit:data.settings.dailyLimit},version:data.version};
}
function examplesSnapshot(data,actor,w,c,{operation,exampleId}={}){
 if(!record(data)||data.schemaVersion!==1||data.status!=='connected'||data.canEdit!==true||!Array.isArray(data.items)||data.items.length>200||data.limit!==200||!Number.isSafeInteger(data.total)||data.total<data.items.length||typeof data.complete!=='boolean')throw unavailable();
 const ids=new Set(),items=data.items.map(item=>{
  if(!record(item)||!isUuid(item.id)||ids.has(item.id)||!Number.isSafeInteger(item.version)||item.version<1||!['draft','verified','archived'].includes(item.state))throw unavailable();
  const entry={trigger:item.trigger,english:item.english,spanish:item.spanish,reference_id:item.referenceId,label:item.label,source_version:item.sourceVersion};
  if(!valid(ENTRY,entry))throw unavailable();ids.add(item.id);
  return {id:item.id,version:item.version,state:item.state,...entry};
 });
 const savedId=data.savedId??null;
 if(operation){const saved=items.find(item=>sameId(item.id,savedId));if(!saved||exampleId&&!sameId(savedId,exampleId)||saved.state!==(operation==='archive'?'archived':'draft'))throw unavailable()}
 return {actorId:actor,workspaceId:w,modelId:c,items,total:data.total,limit:200,complete:data.complete&&data.total===items.length,savedId:isUuid(savedId)?savedId:null};
}
async function readJson(request,signal){
 const declared=request.headers.get('content-length');if(declared&&(/^\d+$/.test(declared)?Number(declared)>131072:true))throw new Failure(413,-32600,'Solicitud demasiado grande o longitud no válida.');
 const reader=request.body?.getReader();if(!reader)throw new Failure(400,-32700,'JSON no válido.');
 let bytes=0,raw='';const decoder=new TextDecoder('utf-8',{fatal:true}),abort=()=>{void reader.cancel().catch(()=>{})};
 signal.addEventListener('abort',abort,{once:true});
 try{signal.throwIfAborted();while(true){const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;bytes+=value.byteLength;if(bytes>131072){abort();throw new Failure(413,-32600,'Solicitud demasiado grande.')}raw+=decoder.decode(value,{stream:true})}raw+=decoder.decode();return JSON.parse(raw)}catch(error){if(signal.aborted){abort();throw new Failure(408,-32600,'La lectura se ha cancelado o ha superado el tiempo permitido.')}if(error instanceof Failure)throw error;throw new Failure(400,-32700,'JSON no válido.')}finally{signal.removeEventListener('abort',abort);reader.releaseLock()}
}
async function responseJson(response,signal,limit){
 const reader=response.body?.getReader();if(!reader)throw unavailable();
 let bytes=0,raw='';const decoder=new TextDecoder('utf-8',{fatal:true}),abort=()=>{void reader.cancel().catch(()=>{})};signal.addEventListener('abort',abort,{once:true});
 try{signal.throwIfAborted();while(true){const {done,value}=await reader.read();signal.throwIfAborted();if(done)break;bytes+=value.byteLength;if(bytes>limit){abort();throw unavailable()}raw+=decoder.decode(value,{stream:true})}return JSON.parse(raw+decoder.decode())}catch{if(signal.aborted)abort();throw unavailable()}finally{signal.removeEventListener('abort',abort);reader.releaseLock()}
}
const defaultOrigins=['https://bruff-workspace.pages.dev','https://chatting-iabot-raul.infinitybruff.chatgpt.site','https://chatgpt.com','https://chat.openai.com'];
export function createBruffControlHandler({url,anonKey,allowedOrigins=defaultOrigins,fetcher=fetch,timeoutMs=10000}={}){
 let base=null;try{const parsed=new URL(url);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&['','/'].includes(parsed.pathname))base=parsed.origin}catch{}
 const resource=base&&base+'/functions/v1/bruff-control',metadata=resource+'/.well-known/oauth-protected-resource';
 const origins=new Set((Array.isArray(allowedOrigins)?allowedOrigins:[]).filter(value=>{try{const origin=new URL(value);return origin.protocol==='https:'&&origin.origin===value}catch{return false}}));
 const timeout=Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=15000?timeoutMs:10000;
 return async request=>{
  const origin=request.headers.get('origin'),headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin',...(origins.has(origin)?{'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, apikey, content-type, accept, mcp-protocol-version, mcp-method, mcp-name, mcp-session-id, x-client-info','Access-Control-Allow-Methods':'POST, GET, OPTIONS','Access-Control-Expose-Headers':'WWW-Authenticate, MCP-Protocol-Version'}:{})};
  let id,modern=false,applicationStage=false;
  const reply=(status,body,extra={})=>new Response(body===undefined?null:JSON.stringify(body),{status,headers:{...headers,...extra}});
  const fail=(status,code,message,data)=>reply(status,{jsonrpc:'2.0',...(id!==undefined?{id}:{}),error:{code,message,...(data?{data}:{})}},status===401?{'WWW-Authenticate':`Bearer resource_metadata="${metadata}"`}:{});
  const result=value=>reply(200,{jsonrpc:'2.0',id,result:{...(modern?{resultType:'complete',_meta:{'io.modelcontextprotocol/serverInfo':SERVER}}:{}),...value}});
  const path=new URL(request.url).pathname.replace(/\/$/,'');
  // Discovery is public and carries no credentials or private data.
  if(request.method==='GET'&&resource&&METADATA_ROUTES.has(path))return reply(200,{resource,authorization_servers:[base+'/auth/v1'],bearer_methods_supported:['header'],scopes_supported:['openid','email','profile'],resource_name:'BRUFF · Control privado IA'},{'Access-Control-Allow-Origin':'*'});
  if(origin&&!origins.has(origin))return fail(403,1003,'Origen no permitido.');
  if(!base||typeof anonKey!=='string'||!anonKey)return fail(503,1005,'Servicio no configurado.');
  if(!ROUTES.has(path))return fail(404,-32601,'Ruta no disponible.');
  if(request.method==='OPTIONS')return reply(204);
  if(request.method!=='POST')return reply(405,{error:'Método no permitido.'},{Allow:'POST, OPTIONS'});
  if(!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type')||''))return fail(415,-32600,'Se requiere application/json.');
  const accept=request.headers.get('accept');if(accept&&!accept.split(',').some(value=>/^\s*(?:application\/json|\*\/\*)(?:\s*;|\s*$)/i.test(value)))return fail(406,-32600,'El cliente debe aceptar respuestas application/json.');
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeout),signal=AbortSignal.any([controller.signal,request.signal]);
  try{
   const message=await readJson(request,signal);
   if(!record(message)||message.jsonrpc!=='2.0'||Object.keys(message).some(key=>!['jsonrpc','id','method','params'].includes(key))||typeof message.method!=='string'||message.method.length>100)throw new Failure(400,-32600,'Solicitud JSON-RPC no válida.');
   if(own(message,'id')){if(typeof message.id==='string'&&message.id.length<=128||Number.isSafeInteger(message.id))id=message.id;else throw new Failure(400,-32600,'Identificador JSON-RPC no válido.')}
   const params=message.params===undefined?{}:message.params;if(!record(params))throw new Failure(400,-32602,'Parámetros no válidos.');
   const protocolHeader=request.headers.get('mcp-protocol-version'),meta=params._meta;
   if(meta!==undefined&&!record(meta))throw new Failure(400,-32602,'Metadatos no válidos.');
   modern=protocolHeader===MODERN||record(meta)&&own(meta,'io.modelcontextprotocol/protocolVersion')||message.method==='server/discover';
   if(modern){
    const version=meta?.['io.modelcontextprotocol/protocolVersion'];
    if(!record(meta)||typeof version!=='string'||!record(meta['io.modelcontextprotocol/clientCapabilities']))throw new Failure(400,-32602,'Faltan los metadatos obligatorios del protocolo.');
    if(version!==MODERN)return fail(400,-32022,'Versión de protocolo no compatible.',{supported:VERSIONS,requested:version});
    if(protocolHeader!==version||request.headers.get('mcp-method')!==message.method||message.method==='tools/call'&&headerName(request.headers.get('mcp-name'))!==params.name)throw new Failure(400,-32020,'Los encabezados no coinciden con la solicitud.');
   }else if(protocolHeader&&protocolHeader!==LEGACY)return fail(400,-32022,'Versión de protocolo no compatible.',{supported:VERSIONS,requested:protocolHeader});
   if(id===undefined){
    if(!modern&&message.method==='notifications/initialized'&&Object.keys(params).length===0)return reply(202);
    throw new Failure(400,-32600,'Notificación no admitida.');
   }
   if(message.method==='initialize'){
    requireObject(params,['protocolVersion','capabilities','clientInfo','_meta']);
    if(modern||typeof params.protocolVersion!=='string'||!record(params.capabilities)||!record(params.clientInfo)||typeof params.clientInfo.name!=='string'||typeof params.clientInfo.version!=='string')throw new Failure(400,-32602,'Inicialización no válida.');
    return result({protocolVersion:LEGACY,capabilities:{tools:{listChanged:false}},serverInfo:SERVER,instructions:INSTRUCTIONS});
   }
   if(message.method==='server/discover'){requireObject(params,['_meta']);return result({supportedVersions:VERSIONS,capabilities:{tools:{listChanged:false}},instructions:INSTRUCTIONS,cacheScope:'public',ttlMs:0})}
   if(!['tools/list','tools/call','ping'].includes(message.method))return fail(404,-32601,'Método no disponible.');
   if(message.method==='tools/call')requireObject(params,['name','arguments','_meta']);else requireObject(params,['_meta']);
   let tool,args={};
   if(message.method==='tools/call'){
    tool=BY_NAME.get(params.name);args=params.arguments===undefined?{}:params.arguments;
    if(!tool||!valid(tool.inputSchema,args))throw new Failure(400,-32602,'Herramienta o argumentos no válidos.');
    if(tool.name==='bruff_save_example_draft'&&(args.example_id?args.expected_version<1:args.expected_version!==0))throw new Failure(400,-32602,'La versión debe ser cero al crear y positiva al editar.');
    if(args.entry&&(args.entry.source_version==='0'||[args.entry.trigger,args.entry.english,args.entry.spanish].some(value=>value.includes('{{')||value.includes('}}'))))throw new Failure(400,-32602,'No se admiten variables ni una versión documental cero.');
   }
   const authorization=request.headers.get('authorization')||'';
   if(!/^Bearer [^\s,]+$/i.test(authorization))return fail(401,1001,'Se requiere una sesión de BRUFF.');
   const call=async(path,body)=>{
    try{signal.throwIfAborted();const response=await fetcher(base+path,{method:body===undefined?'GET':'POST',headers:{apikey:anonKey,Authorization:authorization,'Content-Type':'application/json'},redirect:'error',signal,...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await responseJson(response,signal,path==='/auth/v1/user'?65536:8*1024*1024);return {ok:response.ok,status:response.status,data}}
    catch{throw unavailable()}
   };
   const identity=await call('/auth/v1/user');
   if(!identity.ok){if([401,403].includes(identity.status))return fail(401,1001,'La sesión no es válida. Vuelve a conectar BRUFF.');throw unavailable()}
   if(!isUuid(identity.data?.id)||typeof identity.data.email_confirmed_at!=='string'||!identity.data.email_confirmed_at||identity.data.is_anonymous===true)return fail(401,1001,'Se requiere una cuenta de BRUFF con correo confirmado.');
   const actor=identity.data.id;
   applicationStage=message.method==='tools/call';
   const rpc=async(name,value)=>{
    if(!RPCS.has(name))throw forbidden();
    const response=await call('/rest/v1/rpc/'+name,value);if(response.ok)return response.data;
    if(response.status===401)throw new Failure(401,1001,'La sesión ya no es válida. Vuelve a conectar BRUFF.');
    if(response.status===403||response.data?.code==='42501')throw forbidden();
    if(response.data?.code==='40001')throw new Failure(409,1009,'La versión ha cambiado. Vuelve a consultar antes de guardar; el cambio no se ha repetido.');
    if(['22023','23514','23505'].includes(response.data?.code))throw new Failure(400,-32602,'El cambio no es válido o supera el límite de la base. Revisa los datos en BRUFF.');
    throw unavailable();
   };
   const w=args.workspace_id?.toLowerCase()||null,c=args.model_id?.toLowerCase()||null;
   const models=modelsSnapshot(await rpc('bruff_ai_models',{w}),actor,w);
   if(message.method==='tools/list')return result({tools:TOOLS});
   if(message.method==='ping')return result({});
   if(tool.name==='bruff_list_models')return result({content:[{type:'text',text:JSON.stringify(models)}],structuredContent:models,isError:false});
   if(!models.workspaces.some(item=>sameId(item.id,w)&&item.models.some(model=>sameId(model.id,c))))throw forbidden();
   let output;
   if(['bruff_read_ai_settings','bruff_update_ai_settings'].includes(tool.name)){
    const saving=tool.name==='bruff_update_ai_settings';
    output=settingsSnapshot(await rpc('bruff_ai_control',{w,c,op:saving?'save':'read',expected:saving?args.expected_version:null,value:saving?args.settings:null}),actor,w,c);
   }else{
    const op=tool.name==='bruff_save_example_draft'?'save':tool.name==='bruff_archive_example'?'archive':'list';
    const entry=args.entry,value=op==='save'?{trigger:entry.trigger,english:entry.english,spanish:entry.spanish,state:'draft',referenceId:entry.reference_id,label:entry.label,sourceVersion:entry.source_version}:null;
    const exampleId=args.example_id?.toLowerCase()||null;
    output=examplesSnapshot(await rpc('bruff_chat_direct_knowledge',{w,c,op,example_id:exampleId,expected:op==='list'?null:args.expected_version,value}),actor,w,c,{...(op!=='list'?{operation:op,exampleId}:{})});
   }
   return result({content:[{type:'text',text:JSON.stringify(output)}],structuredContent:output,isError:false});
  }catch(error){
   const failure=error instanceof Failure?error:unavailable();
   if(applicationStage&&![401,403].includes(failure.status))return result({content:[{type:'text',text:failure.message}],isError:true});
   return fail(failure.status,failure.code,failure.message);
  }finally{clearTimeout(timer)}
 };
}
