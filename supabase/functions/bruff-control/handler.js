// Private MCP resource server. Every database call uses the real user's token.
// Advanced owner actions are opt-in; no arbitrary endpoint or direct fan write.
import {OwnerSourceError,prepareSourceApproval,approveSource} from './admin-sources.js';
import {ChatRelayError,runChatRelay} from './chat-relay.js';
import {SelectedReplyError,queueSelectedReply} from './selected-reply.js';
import {AutopilotControlError,autopilotSnapshot,validAutopilotSettings} from './autopilot-control.js';
import {TeachingError,runTeachingAction,runFanMemoryAction} from './admin-teaching.js';
const MODERN='2026-07-28',LEGACY='2025-03-26',VERSIONS=[MODERN,LEGACY];
const SERVER={name:'bruff-control',version:'1.0.0',title:'BRUFF · Control privado'};
const INSTRUCTIONS='Control privado de preferencias, ejemplos documentales y conocimiento no explícito por modelo. Solo propietario. Guardar crea borradores; la aprobación humana y la activación del generador se realizan exclusivamente en BRUFF. Ninguna herramienta genera contenido, activa generadores o bots ni envía mensajes.';
const OWNER_INSTRUCTIONS='Control privado con sesión real de propietario. Las aprobaciones requieren revisar la fuente exacta, su versión y su huella; guardar un borrador no lo aprueba. Un permiso de enseñanza activo permite registrar y aprobar enseñanzas expresas del propietario únicamente para las categorías y la modelo autorizadas, con contenido exacto, versiones y recibo; no importa el chat entero ni convierte mensajes de fans o hallazgos de IA en originales revisados. El permiso es revocable y el título del chat no autentica. Leer, sincronizar o importar memoria requiere fan y modelo concretos; no acredita historial completo. Importar candidatos exige citas literales neutrales contrastadas con mensajes reales del propio fan y versión vigente; guarda solo pendientes, nunca inferencias ni aprobaciones. Leer chats y generar borradores exige modelo y fan seleccionados. Generar comparte contexto reciente y fuentes aprobadas con Cloudflare y consume el presupuesto existente. Una elección confirmada pone en cola únicamente el texto canónico mostrado; no afirmes enviado hasta ver sent y providerId. La delegación automática requiere consentimiento específico, alcance por modelo/fan y runtime preparado; puede pausarse con su versión actual. No actives todas las modelos por inferencia. La IA solo admite texto no explícito, sin archivos, scripts ni precios, y se detiene ante desconocidos, cambios de contexto, toma manual o envío incierto. Una pausa impide preparaciones futuras pero no retira una llamada de envío ya iniciada. No hay endpoints arbitrarios ni control de campañas.';
const UUID='^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const IDENTIFIER='^[A-Za-z0-9][A-Za-z0-9_.:-]*$';
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required,additionalProperties:false});
const uuid={type:'string',pattern:UUID},integer=(minimum,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const text=(maxLength,multiline=false)=>({type:'string',minLength:1,maxLength,pattern:multiline?'^[^\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]+$':'^[^\\u0000-\\u001f\\u007f]+$'});
const identifier=maxLength=>({type:'string',minLength:1,maxLength,pattern:IDENTIFIER});
const SETTINGS=object({mode:{type:'string',enum:['bank','semantic']},maxResults:integer(1,3),minScore:{type:'number',minimum:.5,maximum:.99},dailyLimit:integer(1,100)});
const ENTRY=object({trigger:text(2000),english:text(10000,true),spanish:text(10000,true),reference_id:identifier(128),label:text(200),source_version:identifier(96)});
const FACT_KEYS=['public_name','age','country','city','language','about'];
const KNOWLEDGE_ENTRY=object({kind:{type:'string',enum:['style_rule','model_fact','boundary']},key:{type:'string',enum:FACT_KEYS},text:text(1200,true),reference_id:identifier(128),label:text(160),source_version:identifier(96)},['kind','text','reference_id','label','source_version']);
const GENERATION_SETTINGS=object({enabled:{type:'boolean'},dailyLimit:integer(1,1000),maxResults:integer(1,3)});
const DISABLED_GENERATION_SETTINGS=object({...GENERATION_SETTINGS.properties,enabled:{type:'boolean',const:false}});
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
 definition('bruff_list_model_knowledge','Consultar conocimiento de una modelo','Lee reglas de estilo, hechos documentados y límites por modelo, incluidos borradores y archivo. Un borrador no se presenta como conocimiento aprobado.',object(SCOPE),true),
 definition('bruff_save_model_knowledge_draft','Guardar borrador de conocimiento','Crea o edita únicamente un borrador no explícito con fuente real. kind distingue regla de estilo, hecho de modelo y límite; key es obligatoria solo para model_fact. Requiere versión vigente al editar y nunca aprueba.',object({...SCOPE,entry_id:uuid,expected_version:integer(0),entry:KNOWLEDGE_ENTRY},['workspace_id','model_id','expected_version','entry']),false),
 definition('bruff_archive_model_knowledge','Archivar conocimiento de una modelo','Archiva una entrada concreta con su versión vigente. Conserva el registro y no modifica chats, activa funciones ni envía mensajes.',object({...SCOPE,entry_id:uuid,expected_version:integer(1)}),false),
 definition('bruff_read_generation_settings','Consultar ajustes de borradores IA','Lee si el generador manual está habilitado y sus límites. Leer ajustes no ejecuta una inferencia ni demuestra que el motor funcione.',object(SCOPE),true),
 definition('bruff_update_generation_settings','Guardar ajustes de borradores IA desactivados','Guarda límites del generador manual exclusivamente con enabled:false y control de versión. Puede desactivar, pero nunca activar el generador; la activación y consentimiento se realizan en BRUFF.',object({...SCOPE,expected_version:integer(0),settings:DISABLED_GENERATION_SETTINGS}),false),
 definition('bruff_read_generation_quota','Consultar consumo y cupo de borradores IA','Lee las consultas de esta modelo y el presupuesto compartido de generación BRUFF por día UTC, separando consumo calculado y reservas estimadas. No mide el consumo global de Cloudflare ni garantiza disponibilidad. No ejecuta IA ni envíos.',object(SCOPE),true),
];
const SOURCE_REVIEW={kind:{type:'string',enum:['example','knowledge']},source_id:uuid,expected_version:integer(1,Number.MAX_SAFE_INTEGER-1)};
const FAN={type:'string',minLength:1,maxLength:24,pattern:'^[0-9]{1,24}$'};
const AUTOPILOT_SETTINGS=object({enabled:{type:'boolean'},mode:{type:'string',enum:['drafts','automatic']},fanScope:{type:'string',enum:['all','selected']},fanIds:{type:'array',maxItems:500,uniqueItems:true,items:{...FAN,pattern:'^[1-9][0-9]{0,23}$'}},delaySeconds:integer(10,120),maxRepliesPerFanDay:integer(1,20),contextSharingConfirmed:{type:'boolean'},automaticSendingConfirmed:{type:'boolean'}});
const TEACHING_KINDS=['example','style_rule','model_fact','boundary'];
const TEACHING_PERMISSION=object({enabled:{type:'boolean'},allowedKinds:{type:'array',maxItems:4,uniqueItems:true,items:{type:'string',enum:TEACHING_KINDS}}});
const TEACHING_ENTRY=object({...ENTRY.properties,text:text(1200,true),key:{type:'string',enum:FACT_KEYS}},['reference_id','label','source_version']);
const MEMORY_FAN={...FAN,pattern:'^[1-9][0-9]{0,23}$'};
const MEMORY_CATEGORIES=['preferred_name','language','interests','availability','pending_question','commitment','personal_context'];
const MEMORY_CANDIDATE=object({category:{type:'string',enum:MEMORY_CATEGORIES},message_id:MEMORY_FAN,quote:{...text(240),minLength:3}});
const OWNER_TOOLS=[
 definition('bruff_read_teaching_permission','Consultar permiso de enseñanza','Lee el permiso persistente de este propietario para registrar enseñanzas expresas en esta agencia y modelo. Desactivado inicialmente. No lee el chat ni concede permiso por su título.',object(SCOPE),true),
 definition('bruff_save_teaching_permission','Guardar o revocar permiso de enseñanza','Guarda con versión vigente el permiso por propietario, agencia, modelo y categorías. enabled:false revoca el registro delegado; no elimina fuentes ya guardadas ni activa generación o envíos. Requiere autorización expresa del propietario.',object({...SCOPE,expected_version:integer(0,Number.MAX_SAFE_INTEGER-1),permission:TEACHING_PERMISSION,confirmed:{type:'boolean',const:true}}),false),
 {...definition('bruff_save_reviewed_teaching','Registrar una enseñanza expresa revisada','Con permiso vigente, guarda y aprueba atómicamente solo la enseñanza expresa seleccionada del propietario, su referencia y versión reales. Usa example para ejemplos o FAQ; style_rule/model_fact/boundary para conocimiento. No importa todo el chat, aprueba hallazgos IA ni envía mensajes. Crear usa versión0; editar exigeID y versión. Reutiliza request_id ante respuesta perdida.',object({...SCOPE,kind:{type:'string',enum:TEACHING_KINDS},source_id:uuid,expected_version:integer(0,Number.MAX_SAFE_INTEGER-1),permission_version:integer(1,Number.MAX_SAFE_INTEGER-1),request_id:uuid,reviewed:{type:'boolean',const:true},entry:TEACHING_ENTRY},['workspace_id','model_id','kind','expected_version','permission_version','request_id','reviewed','entry']),false),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false}},
 definition('bruff_read_fan_memory','Consultar memoria de un fan','Lee recuerdos con fuente, estado y cobertura del fan de esta modelo. No consulta todos los fans, confirma hechos automáticamente ni ejecuta IA.',object({...SCOPE,fan_id:MEMORY_FAN}),true),
 {...definition('bruff_sync_fan_memory','Actualizar memoria de un fan','Lee una página real reciente o anterior y guarda candidatos pendientes con citas verificadas. Respeta permisos y límites; no genera respuestas, confirma candidatos ni envía mensajes. older amplía cobertura sin declarar completo un historial parcial.',object({...SCOPE,fan_id:MEMORY_FAN,scan:{type:'string',enum:['recent','older']}}),false),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},
 {...definition('bruff_import_fan_memory_candidates','Guardar citas neutrales pendientes','Guarda hasta veinte citas literales neutrales del propio fan, releyendo la página real seleccionada y comprobando versión y procedencia. Solo propietario. No acepta inferencias, datos sensibles, URLs, contactos, credenciales ni texto sexual. No confirma recuerdos, amplía cobertura, genera respuestas ni envía mensajes. Ante conflicto o respuesta perdida relee la memoria; no repitas a ciegas.',object({...SCOPE,fan_id:MEMORY_FAN,expected_version:integer(0,Number.MAX_SAFE_INTEGER-1),cursor:{anyOf:[text(2048),{type:'null'}]},candidates:{type:'array',minItems:1,maxItems:20,items:MEMORY_CANDIDATE}},['workspace_id','model_id','fan_id','expected_version','candidates']),false),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:false}},
 definition('bruff_edit_fan_memory','Revisar un recuerdo concreto','Confirma, corrige, fija o elimina un recuerdo del fan y modelo seleccionados con versión vigente. value solo se admite al corregir. No modifica mensajes del proveedor ni elimina datos de otros fans.',object({...SCOPE,fan_id:MEMORY_FAN,key:{type:'string',pattern:'^[a-z0-9_-]{1,80}$'},action:{type:'string',enum:['confirm','correct','pin','delete']},value:text(1000,true),expected_version:integer(0,Number.MAX_SAFE_INTEGER-1)},['workspace_id','model_id','fan_id','key','action','expected_version']),false),
 definition('bruff_prepare_source_approval','Revisar una fuente antes de aprobar','Lee una fuente concreta y su versión, muestra su contenido y devuelve una huella de revisión. No aprueba ni cambia nada.',object({...SCOPE,...SOURCE_REVIEW}),true),
 definition('bruff_approve_source','Aprobar una fuente revisada','Aprueba exactamente la fuente mostrada y revisada por el propietario con su versión y huella vigentes. No acepta contenido nuevo ni activa generación o envíos.',object({...SCOPE,...SOURCE_REVIEW,review_hash:{type:'string',pattern:'^[a-f0-9]{64}$'},reviewed:{type:'boolean',const:true}}),false),
 definition('bruff_save_generation_preferences','Guardar preferencias de generación manual','Guarda la activación manual y límites con versión vigente. Habilitar requiere confirmar compartir con Cloudflare contexto reciente y fuentes aprobadas al consultar. No activa un bot ni envía mensajes.',object({...SCOPE,expected_version:integer(0,Number.MAX_SAFE_INTEGER-1),settings:GENERATION_SETTINGS,context_sharing_confirmed:{type:'boolean'}}),false),
 definition('bruff_list_conversations','Consultar conversaciones de una modelo','Consulta una página de chats reales de una modelo autorizada, con búsqueda y cursor opcionales. Devuelve solo datos acotados, no archivos ni URLs de medios.',object({...SCOPE,query:text(150),cursor:text(2048)},['workspace_id','model_id']),true),
 definition('bruff_read_conversation','Leer una conversación seleccionada','Lee una página de mensajes del fan seleccionado para esta modelo. El historial puede ser parcial. No descarga archivos ni ejecuta una IA.',object({...SCOPE,fan_id:FAN,cursor:text(2048)},['workspace_id','model_id','fan_id']),true),
 {...definition('bruff_generate_replies','Generar hasta tres borradores','Solicita una consulta manual de hasta tres respuestas no explícitas en inglés y español. Comparte con Cloudflare hasta veinte mensajes recientes y fuentes aprobadas de esta modelo; aplica consumo y cuotas. No envía mensajes. force:true solo tras pedir expresamente Regenerar.',object({...SCOPE,fan_id:FAN,request_id:uuid,share_context:{type:'boolean',const:true},force:{type:'boolean'}},['workspace_id','model_id','fan_id','request_id','share_context']),false),annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:false,openWorldHint:true}},
 definition('bruff_verify_reply_selection','Verificar una opción elegida','Revalida la identidad, contexto, fuentes y vigencia de un borrador seleccionado. Devuelve su texto canónico; no confirma exactitud factual, inserta texto ni envía mensajes.',object({...SCOPE,fan_id:FAN,generation_id:uuid,draft_id:{type:'string',enum:['1','2','3']}}),true),
 definition('bruff_read_autopilot','Consultar delegación IA','Lee la configuración por modelo, su versión y si la ejecución en nube está preparada. No activa ni ejecuta una consulta.',object(SCOPE),true),
 definition('bruff_save_autopilot','Guardar delegación IA por modelo','Guarda alcance, demora y límite diario por fan con versión vigente. enabled:true delega la generación; automatic añade elección y envío de texto no explícito sin confirmar cada mensaje, solo con ambos consentimientos y runtime listo. No envía al guardar ni inicia históricos. Solicita una activación concreta al propietario.',object({...SCOPE,expected_version:integer(0,Number.MAX_SAFE_INTEGER-1),settings:AUTOPILOT_SETTINGS}),false),
 definition('bruff_pause_autopilot','Pausar delegación IA','Desactiva la delegación de esta modelo y bloquea sus preparaciones automáticas pendientes con versión vigente. No retira un envío ya iniciado. La pausa sigue disponible aunque el runtime esté apagado.',object({...SCOPE,expected_version:integer(0,Number.MAX_SAFE_INTEGER-1)}),false),
 definition('bruff_read_autopilot_activity','Consultar actividad y borradores delegados','Muestra hasta cincuenta trabajos de esta modelo, borradores disponibles y recibos. queued no significa enviado; solo sent con providerId acredita confirmación. Una entrega uncertain exige revisión y no se reenvía automáticamente.',object(SCOPE),true),
 definition('bruff_review_uncertain_reply','Registrar revisión de una entrega incierta','Solo después de revisar la entrega concreta, registra una nota del propietario con la versión del trabajo. Conserva el estado incierto y prohíbe reenviar ese trabajo. Deja la modelo pausada; una activación posterior explícita solo permite mensajes futuros. No acredita que se haya enviado ni que no se haya enviado.',object({...SCOPE,job_id:uuid,expected_job_version:integer(1,Number.MAX_SAFE_INTEGER-1),review_note:text(500)}),false),
 {...definition('bruff_queue_selected_reply','Enviar la respuesta elegida y confirmada','Tras mostrar modelo, fan y texto inglés exacto y obtener la confirmación del propietario, revalida la opción canónica vigente y la pone en cola para envío real de texto. No permite archivos ni precios. Usa el mismo request_id ante estado incierto y consulta la actividad antes de repetir. El recibo queued no acredita entrega.',object({...SCOPE,fan_id:FAN,generation_id:uuid,draft_id:{type:'string',enum:['1','2','3']},request_id:uuid,expected_english:text(700,true),confirmed:{type:'boolean',const:true}}),false),annotations:{readOnlyHint:false,destructiveHint:true,idempotentHint:true,openWorldHint:true}},
];
const RPCS=new Set(['bruff_ai_models','bruff_ai_control','bruff_chat_direct_knowledge','bruff_model_knowledge','bruff_generation_control','bruff_generation_quota','bruff_autopilot_control','bruff_queue_selected_reply','bruff_teaching_permission','bruff_save_reviewed_teaching']);
// The Supabase relay can remove /functions/v1 before invoking Deno. A function
// mounted at its own root may also receive /. These are exact aliases only.
const ROUTES=new Set(['/functions/v1/bruff-control','/bruff-control','']);
const METADATA_ROUTES=new Set([...ROUTES].map(path=>path+'/.well-known/oauth-protected-resource'));
const own=(value,key)=>Object.hasOwn(value,key),record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const isUuid=value=>typeof value==='string'&&new RegExp(UUID,'u').test(value);
const sameId=(a,b)=>isUuid(a)&&isUuid(b)&&a.toLowerCase()===b.toLowerCase();
function valid(schema,value){
 if(schema.anyOf)return schema.anyOf.some(option=>valid(option,value));
 if(schema.type==='null')return value===null;
 if(schema.type==='object')return record(value)&&schema.required.every(key=>own(value,key))&&Object.keys(value).every(key=>own(schema.properties,key)&&valid(schema.properties[key],value[key]));
 if(schema.type==='array')return Array.isArray(value)&&value.length>=(schema.minItems??0)&&value.length<=(schema.maxItems??Number.MAX_SAFE_INTEGER)&&value.every(item=>valid(schema.items,item))&&(!schema.uniqueItems||new Set(value.map(item=>JSON.stringify(item))).size===value.length);
 if(schema.type==='string')return typeof value==='string'&&(!schema.minLength||value.trim().length>=schema.minLength)&&(!schema.maxLength||value.length<=schema.maxLength)&&(!schema.pattern||new RegExp(schema.pattern,'u').test(value))&&(!schema.enum||schema.enum.includes(value));
 if(schema.type==='boolean')return typeof value==='boolean'&&(!own(schema,'const')||value===schema.const);
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
function generationSnapshot(data,actor,w,c,{expected,settings,allowEnabled=false}={}){
 if(!record(data)||!sameId(data.actorId,actor)||!sameId(data.workspaceId,w)||!sameId(data.creatorId,c)||!valid(GENERATION_SETTINGS,data.settings)||!Number.isSafeInteger(data.version)||data.version<0||expected!==undefined&&(!allowEnabled&&data.settings.enabled!==false||data.version!==expected+1||Object.keys(settings).some(key=>data.settings[key]!==settings[key])))throw unavailable();
 return {actorId:actor,workspaceId:w,modelId:c,settings:{enabled:data.settings.enabled,dailyLimit:data.settings.dailyLimit,maxResults:data.settings.maxResults},version:data.version};
}
function quotaSnapshot(data,actor,w,c){
 if(!record(data)||!sameId(data.actorId,actor)||!sameId(data.workspaceId,w)||!sameId(data.creatorId,c)||!record(data.quota))throw unavailable();
 const quota=data.quota,fields=['modelQueries','modelDailyLimit','sharedBudgetNeurons','calculatedNeurons','reservedNeurons','chargedNeurons','remainingNeurons','observedRequests','reservedRequests'];
 if(!fields.every(key=>Number.isSafeInteger(quota[key])&&quota[key]>=0)||quota.modelDailyLimit<1||quota.modelDailyLimit>1000||quota.sharedBudgetNeurons!==7500||quota.reservedNeurons!==quota.reservedRequests*600||quota.chargedNeurons!==quota.calculatedNeurons+quota.reservedNeurons||quota.remainingNeurons!==Math.max(0,7500-quota.chargedNeurons)||typeof quota.usageDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/u.test(quota.usageDay)||typeof quota.resetsAt!=='string')throw unavailable();
 const start=Date.parse(quota.usageDay+'T00:00:00.000Z');
 if(!Number.isFinite(start)||new Date(start).toISOString().slice(0,10)!==quota.usageDay||Date.parse(quota.resetsAt)!==start+86400000)throw unavailable();
 if(quota.observedRequests===0&&quota.calculatedNeurons!==0||quota.calculatedNeurons<quota.observedRequests||BigInt(quota.modelQueries)>BigInt(quota.observedRequests)+BigInt(quota.reservedRequests))throw unavailable();
 // Only aggregate counters are returned. Extra RPC metadata, tokens, payloads,
 // fan identifiers or future fields cannot enter the private tool result.
 return {actorId:actor,workspaceId:w,modelId:c,quota:{usageDay:quota.usageDay,resetsAt:new Date(start+86400000).toISOString(),...Object.fromEntries(fields.map(key=>[key,quota[key]]))}};
}
const validKnowledgeEntry=entry=>valid(KNOWLEDGE_ENTRY,entry)&&(entry.kind==='model_fact'?own(entry,'key'):!own(entry,'key'));
function knowledgeSnapshot(data,actor,w,c,{operation,entryId,expected,entry}={}){
 if(!record(data)||data.schemaVersion!==1||!sameId(data.actorId,actor)||!sameId(data.workspaceId,w)||!sameId(data.creatorId,c)||data.canEdit!==true||!Array.isArray(data.items)||data.items.length>200||data.limit!==200||!Number.isSafeInteger(data.total)||data.total<data.items.length||data.total>200||typeof data.complete!=='boolean')throw unavailable();
 const ids=new Set(),items=data.items.map(item=>{
  if(!record(item)||!isUuid(item.id)||ids.has(item.id.toLowerCase())||!Number.isSafeInteger(item.version)||item.version<1||!['draft','verified','archived'].includes(item.state)||item.kind!=='model_fact'&&item.key!==null)throw unavailable();
  const entry={kind:item.kind,...(item.kind==='model_fact'?{key:item.key}:{}),text:item.text,reference_id:item.referenceId,label:item.label,source_version:item.sourceVersion};
  if(!validKnowledgeEntry(entry))throw unavailable();ids.add(item.id.toLowerCase());
  return {id:item.id,version:item.version,state:item.state,...entry,key:item.kind==='model_fact'?item.key:null};
 });
 const savedId=data.savedId??null;
 if(savedId!==null&&!isUuid(savedId))throw unavailable();
 if(operation){const saved=items.find(item=>sameId(item.id,savedId));if(!saved||entryId&&!sameId(savedId,entryId)||saved.state!==(operation==='archive'?'archived':'draft')||saved.version!==expected+1||operation==='save'&&(Object.keys(entry).some(key=>saved[key]!==entry[key])||saved.key!==(entry.key??null)))throw unavailable()}
 return {actorId:actor,workspaceId:w,modelId:c,items,total:data.total,limit:200,complete:data.complete&&data.total===items.length,savedId};
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
export function createBruffControlHandler({url,anonKey,allowedOrigins=defaultOrigins,fetcher=fetch,timeoutMs=10000,ownerActionsEnabled=false,draftsTimeoutMs=35000,autopilotEnabled=false,autopilotSendEnabled=false,autopilotRuntimeReady=false,dispatchJob}={}){
 let base=null;try{const parsed=new URL(url);if(parsed.protocol==='https:'&&!parsed.username&&!parsed.password&&!parsed.search&&!parsed.hash&&['','/'].includes(parsed.pathname))base=parsed.origin}catch{}
 const resource=base&&base+'/functions/v1/bruff-control',metadata=resource+'/.well-known/oauth-protected-resource';
 const origins=new Set((Array.isArray(allowedOrigins)?allowedOrigins:[]).filter(value=>{try{const origin=new URL(value);return origin.protocol==='https:'&&origin.origin===value}catch{return false}}));
 const timeout=Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=15000?timeoutMs:10000;
 const draftsTimeout=Number.isSafeInteger(draftsTimeoutMs)&&draftsTimeoutMs>0&&draftsTimeoutMs<=45000?draftsTimeoutMs:35000;
 const tools=ownerActionsEnabled===true?[...TOOLS,...OWNER_TOOLS]:TOOLS,byName=new Map(tools.map(tool=>[tool.name,tool])),instructions=ownerActionsEnabled===true?OWNER_INSTRUCTIONS:INSTRUCTIONS;
 const runtime={workerEnabled:autopilotEnabled===true,automaticSendingEnabled:autopilotSendEnabled===true,backgroundReady:autopilotRuntimeReady===true};
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
  const controller=new AbortController(),signal=AbortSignal.any([controller.signal,request.signal]);let timer=setTimeout(()=>controller.abort(),timeout);
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
    return result({protocolVersion:LEGACY,capabilities:{tools:{listChanged:false}},serverInfo:SERVER,instructions});
   }
   if(message.method==='server/discover'){requireObject(params,['_meta']);return result({supportedVersions:VERSIONS,capabilities:{tools:{listChanged:false}},instructions,cacheScope:'public',ttlMs:0})}
   if(!['tools/list','tools/call','ping'].includes(message.method))return fail(404,-32601,'Método no disponible.');
   if(message.method==='tools/call')requireObject(params,['name','arguments','_meta']);else requireObject(params,['_meta']);
   let tool,args={};
   if(message.method==='tools/call'){
    tool=byName.get(params.name);args=params.arguments===undefined?{}:params.arguments;
    if(!tool||!valid(tool.inputSchema,args))throw new Failure(400,-32602,'Herramienta o argumentos no válidos.');
    if(tool.name==='bruff_save_example_draft'&&(args.example_id?args.expected_version<1:args.expected_version!==0))throw new Failure(400,-32602,'La versión debe ser cero al crear y positiva al editar.');
    if(tool.name==='bruff_save_example_draft'&&(args.entry.source_version==='0'||[args.entry.trigger,args.entry.english,args.entry.spanish].some(value=>value.includes('{{')||value.includes('}}'))))throw new Failure(400,-32602,'No se admiten variables ni una versión documental cero.');
    if(tool.name==='bruff_save_model_knowledge_draft'&&(!validKnowledgeEntry(args.entry)||(args.entry_id?args.expected_version<1:args.expected_version!==0)))throw new Failure(400,-32602,'El hecho requiere una clave permitida; las reglas y límites no usan clave. La versión debe ser cero al crear y positiva al editar.');
   }
   const authorization=request.headers.get('authorization')||'';
   if(!/^Bearer [^\s,]+$/i.test(authorization))return fail(401,1001,'Se requiere una sesión de BRUFF.');
   const call=async(path,body)=>{
    try{signal.throwIfAborted();const response=await fetcher(base+path,{method:body===undefined?'GET':'POST',headers:{apikey:anonKey,Authorization:authorization,'Content-Type':'application/json'},redirect:'error',signal,...(body===undefined?{}:{body:JSON.stringify(body)})});const data=await responseJson(response,signal,path==='/auth/v1/user'?65536:8*1024*1024);const retry=Number(response.headers.get('Retry-After'));return {ok:response.ok,status:response.status,data,...(Number.isSafeInteger(retry)&&retry>0&&retry<=86400?{retryAfter:retry}:{})}}
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
   if(message.method==='tools/list')return result({tools});
   if(message.method==='ping')return result({});
   if(tool.name==='bruff_list_models')return result({content:[{type:'text',text:JSON.stringify(models)}],structuredContent:models,isError:false});
   if(!models.workspaces.some(item=>sameId(item.id,w)&&item.models.some(model=>sameId(model.id,c))))throw forbidden();
   const recheckOwner=async()=>{signal.throwIfAborted();const current=modelsSnapshot(await rpc('bruff_ai_models',{w}),actor,w);if(!current.workspaces.some(item=>sameId(item.id,w)&&item.models.some(model=>sameId(model.id,c))))throw forbidden();signal.throwIfAborted()};
   let output;
   if(['bruff_read_teaching_permission','bruff_save_teaching_permission','bruff_save_reviewed_teaching'].includes(tool.name)){
    output=await runTeachingAction({name:tool.name,args,actor,w,c,rpc,recheckOwner});
   }else if(['bruff_read_fan_memory','bruff_sync_fan_memory','bruff_import_fan_memory_candidates','bruff_edit_fan_memory'].includes(tool.name)){
    if(['bruff_sync_fan_memory','bruff_import_fan_memory_candidates'].includes(tool.name)){clearTimeout(timer);timer=setTimeout(()=>controller.abort(),draftsTimeout)}
    output=await runFanMemoryAction({name:tool.name,args,actor,w,c,call,recheckOwner});
   }else if(['bruff_prepare_source_approval','bruff_approve_source'].includes(tool.name)){
    const list=async kind=>kind==='example'?examplesSnapshot(await rpc('bruff_chat_direct_knowledge',{w,c,op:'list',example_id:null,expected:null,value:null}),actor,w,c):knowledgeSnapshot(await rpc('bruff_model_knowledge',{w,c,op:'list',entry_id:null,expected:null,value:null}),actor,w,c);
    const save=async(kind,id,expected,value)=>kind==='example'?examplesSnapshot(await rpc('bruff_chat_direct_knowledge',{w,c,op:'save',example_id:id,expected,value}),actor,w,c):knowledgeSnapshot(await rpc('bruff_model_knowledge',{w,c,op:'save',entry_id:id,expected,value}),actor,w,c);
    const review={kind:args.kind,sourceId:args.source_id,expected:args.expected_version,actor,w,c,list};
    output=tool.name==='bruff_prepare_source_approval'?await prepareSourceApproval(review):await approveSource({...review,reviewHash:args.review_hash,reviewed:args.reviewed,save});await recheckOwner();
   }else if(tool.name==='bruff_save_generation_preferences'){
    if(args.settings.enabled&&args.context_sharing_confirmed!==true)throw new Failure(400,-32602,'Confirma compartir el contexto reciente y las fuentes aprobadas con Cloudflare al solicitar una consulta.');
    const current=generationSnapshot(await rpc('bruff_generation_control',{w,c,op:'read',expected:null,value:null}),actor,w,c);if(current.version!==args.expected_version)throw new Failure(409,1009,'La configuración cambió. Vuelve a leerla antes de guardar.');
    output=generationSnapshot(await rpc('bruff_generation_control',{w,c,op:'save',expected:args.expected_version,value:args.settings}),actor,w,c,{expected:args.expected_version,settings:args.settings,allowEnabled:true});await recheckOwner();
   }else if(['bruff_list_conversations','bruff_read_conversation','bruff_generate_replies','bruff_verify_reply_selection'].includes(tool.name)){
    const operations={bruff_list_conversations:'list',bruff_read_conversation:'read',bruff_generate_replies:'generate',bruff_verify_reply_selection:'verify'},operation=operations[tool.name];
    if(['generate','verify'].includes(operation)){clearTimeout(timer);timer=setTimeout(()=>controller.abort(),draftsTimeout)}
    output=await runChatRelay({operation,args,actor,w,c,call,recheckOwner});
   }else if(['bruff_read_autopilot','bruff_save_autopilot','bruff_pause_autopilot','bruff_read_autopilot_activity','bruff_review_uncertain_reply'].includes(tool.name)){
    const op={bruff_read_autopilot:'read',bruff_save_autopilot:'save',bruff_pause_autopilot:'pause',bruff_read_autopilot_activity:'activity',bruff_review_uncertain_reply:'review_uncertain'}[tool.name];
    if(op==='save'&&(!validAutopilotSettings(args.settings)||args.settings.enabled&&(!runtime.workerEnabled||!runtime.backgroundReady||args.settings.mode==='automatic'&&!runtime.automaticSendingEnabled)))throw new AutopilotControlError(409,'AUTOPILOT_NOT_READY','Revisa alcance y consentimientos. La ejecución debe estar configurada y comprobada antes de activar esta modelo.');
    output=autopilotSnapshot(await rpc('bruff_autopilot_control',{w,c,op,expected:op==='review_uncertain'?args.expected_job_version:['save','pause'].includes(op)?args.expected_version:null,value:op==='review_uncertain'?{jobId:args.job_id,reviewNote:args.review_note}:op==='save'?args.settings:null}),actor,w,c,{operation:op,...(['save','pause'].includes(op)?{expected:args.expected_version}:{}),...(op==='save'?{settings:args.settings}:{}),...(op==='review_uncertain'?{review:{id:args.job_id,version:args.expected_job_version,note:args.review_note}}:{}),runtime});await recheckOwner();
   }else if(tool.name==='bruff_queue_selected_reply'){
    if(!runtime.workerEnabled||!runtime.automaticSendingEnabled||!runtime.backgroundReady)throw new AutopilotControlError(409,'AUTOPILOT_NOT_READY','El envío delegado todavía no está preparado. No se ha puesto ningún mensaje en cola.');
    clearTimeout(timer);timer=setTimeout(()=>controller.abort(),draftsTimeout);
    output=await queueSelectedReply({args,actor,w,c,call,recheckOwner,queue:value=>rpc('bruff_queue_selected_reply',value),...(typeof dispatchJob==='function'?{dispatch:dispatchJob}:{})});
   }else if(['bruff_read_ai_settings','bruff_update_ai_settings'].includes(tool.name)){
    const saving=tool.name==='bruff_update_ai_settings';
    output=settingsSnapshot(await rpc('bruff_ai_control',{w,c,op:saving?'save':'read',expected:saving?args.expected_version:null,value:saving?args.settings:null}),actor,w,c);
   }else if(['bruff_read_generation_settings','bruff_update_generation_settings'].includes(tool.name)){
    const saving=tool.name==='bruff_update_generation_settings';
    output=generationSnapshot(await rpc('bruff_generation_control',{w,c,op:saving?'save':'read',expected:saving?args.expected_version:null,value:saving?args.settings:null}),actor,w,c,saving?{expected:args.expected_version,settings:args.settings}:{});
   }else if(tool.name==='bruff_read_generation_quota'){
    output=quotaSnapshot(await rpc('bruff_generation_quota',{w,c}),actor,w,c);
   }else if(['bruff_list_model_knowledge','bruff_save_model_knowledge_draft','bruff_archive_model_knowledge'].includes(tool.name)){
    const op=tool.name==='bruff_save_model_knowledge_draft'?'save':tool.name==='bruff_archive_model_knowledge'?'archive':'list';
    const entry=args.entry?{...args.entry,label:args.entry.label.trim()}:undefined,value=op==='save'?{kind:entry.kind,...(entry.kind==='model_fact'?{key:entry.key}:{}),text:entry.text,referenceId:entry.reference_id,label:entry.label,sourceVersion:entry.source_version,state:'draft'}:null;
    const entryId=args.entry_id?.toLowerCase()||null;
    output=knowledgeSnapshot(await rpc('bruff_model_knowledge',{w,c,op,entry_id:entryId,expected:op==='list'?null:args.expected_version,value}),actor,w,c,op==='list'?{}:{operation:op,entryId,expected:args.expected_version,entry});
   }else{
    const op=tool.name==='bruff_save_example_draft'?'save':tool.name==='bruff_archive_example'?'archive':'list';
    const entry=args.entry,value=op==='save'?{trigger:entry.trigger,english:entry.english,spanish:entry.spanish,state:'draft',referenceId:entry.reference_id,label:entry.label,sourceVersion:entry.source_version}:null;
    const exampleId=args.example_id?.toLowerCase()||null;
    output=examplesSnapshot(await rpc('bruff_chat_direct_knowledge',{w,c,op,example_id:exampleId,expected:op==='list'?null:args.expected_version,value}),actor,w,c,{...(op!=='list'?{operation:op,exampleId}:{})});
   }
   return result({content:[{type:'text',text:JSON.stringify(output)}],structuredContent:output,isError:false});
  }catch(error){
   const advancedError=error instanceof OwnerSourceError||error instanceof ChatRelayError||error instanceof SelectedReplyError||error instanceof AutopilotControlError||error instanceof TeachingError;
   const failure=error instanceof Failure?error:advancedError?new Failure(error.status,error.status===401?1001:error.status===403?1003:error.status===409?1009:1005,error.message):unavailable();
   if(applicationStage&&![401,403].includes(failure.status))return result({content:[{type:'text',text:failure.message}],isError:true,...(advancedError?{structuredContent:{errorCode:error.code,status:failure.status,...(error.retryAfter?{retryAfter:error.retryAfter}:{})}}:{})});
   return fail(failure.status,failure.code,failure.message);
  }finally{clearTimeout(timer)}
 };
}
