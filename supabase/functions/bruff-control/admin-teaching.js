// Owner scope is authenticated by the caller and checked again by every RPC.
// This module never receives a service credential, arbitrary URL or fan send.
import {validateCitedCandidates} from '../bruff-memory/cited-candidates.js';
import {validateMemoryQuestion} from '../../../server/fan-memory.js';
export class TeachingError extends Error{constructor(status,code,message){super(message);this.name='TeachingError';this.status=status;this.code=code}}
const error=(status=503,code='TEACHING_UNAVAILABLE')=>new TeachingError(status,code,status===400?'Revisa la enseñanza, el ámbito y la confirmación explícita.':status===409?'La versión cambió. Vuelve a leer antes de guardar.':'No se pudo confirmar la operación de conocimiento.');
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(v);
const same=(a,b)=>uuid(a)&&uuid(b)&&a.toLowerCase()===b.toLowerCase();
const natural=v=>Number.isSafeInteger(v)&&v>=0&&v<Number.MAX_SAFE_INTEGER;
const text=(v,max,multiline=false)=>typeof v==='string'&&!!v.trim()&&v.length<=max&&!(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u:/[\u0000-\u001f\u007f]/u).test(v);
const identifier=(v,max)=>typeof v==='string'&&v.length<=max&&/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(v);
const kinds=['example','style_rule','model_fact','boundary'],facts=['public_name','age','country','city','language','about'];
const categories=['preferred_name','language','interests','availability','pending_question','commitment','personal_context'];
const timestamp=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,19)===v.slice(0,19);
function identity(data,actor,w,c){if(!object(data)||!same(data.actorId,actor)||!same(data.workspaceId,w)||!same(data.creatorId,c))throw error();return {actorId:actor,workspaceId:w,modelId:c}}
function permission(value){if(!exact(value,['enabled','allowedKinds'])||typeof value.enabled!=='boolean'||!Array.isArray(value.allowedKinds)||value.allowedKinds.length>4||value.allowedKinds.some(k=>!kinds.includes(k))||new Set(value.allowedKinds).size!==value.allowedKinds.length||value.enabled&&!value.allowedKinds.length)throw error(400);return {enabled:value.enabled,allowedKinds:value.allowedKinds.slice().sort()}}
export function teachingPermissionSnapshot(data,actor,w,c){const scoped=identity(data,actor,w,c);if(!natural(data.version))throw error();const value=permission(data.permission);if(data.version===0&&(value.enabled||value.allowedKinds.length))throw error();return {...scoped,permission:value,version:data.version}}
function entry(kind,value){
 const fields=kind==='example'?['trigger','english','spanish','reference_id','label','source_version']:['text','reference_id','label','source_version',...(kind==='model_fact'?['key']:[])];
 if(!kinds.includes(kind)||!exact(value,fields)||!identifier(value.reference_id,128)||!identifier(value.source_version,96)||value.source_version==='0'||!text(value.label,kind==='example'?200:160)||value.label!==value.label.trim())throw error(400);
 if(kind==='example'){if(!text(value.trigger,2000)||value.trigger!==value.trigger.trim()||!text(value.english,10000,true)||!text(value.spanish,10000,true)||[value.trigger,value.english,value.spanish].some(v=>v.includes('{{')||v.includes('}}')))throw error(400)}
 else if(!text(value.text,1200,true)||value.text.includes('{{')||value.text.includes('}}')||kind==='model_fact'&&!facts.includes(value.key))throw error(400);
 return kind==='example'?{trigger:value.trigger,english:value.english,spanish:value.spanish,referenceId:value.reference_id,label:value.label,sourceVersion:value.source_version}:{text:value.text,referenceId:value.reference_id,label:value.label,sourceVersion:value.source_version,...(kind==='model_fact'?{key:value.key}:{})};
}
export async function runTeachingAction({name,args,actor,w,c,rpc,recheckOwner}){
 if(![actor,w,c].every(uuid)||typeof rpc!=='function'||typeof recheckOwner!=='function')throw error(400);
 if(name==='bruff_read_teaching_permission'||name==='bruff_save_teaching_permission'){
  const saving=name==='bruff_save_teaching_permission';if(saving&&(!natural(args.expected_version)||args.confirmed!==true))throw error(400);const value=saving?permission(args.permission):null;
  const result=teachingPermissionSnapshot(await rpc('bruff_teaching_permission',{w,c,op:saving?'save':'read',expected:saving?args.expected_version:null,value}),actor,w,c);
  if(saving&&(result.version!==args.expected_version+1||JSON.stringify(result.permission)!==JSON.stringify(value)))throw error();await recheckOwner();return result;
 }
 if(name!=='bruff_save_reviewed_teaching'||!kinds.includes(args.kind)||!natural(args.expected_version)||!natural(args.permission_version)||args.permission_version<1||!uuid(args.request_id)||args.reviewed!==true||(args.source_id?!uuid(args.source_id)||args.expected_version<1:args.expected_version!==0))throw error(400);
 const value=entry(args.kind,args.entry),data=await rpc('bruff_save_reviewed_teaching',{w,c,kind:args.kind,source_id:args.source_id?.toLowerCase()??null,expected:args.expected_version,permission_version:args.permission_version,request_id:args.request_id.toLowerCase(),reviewed:true,value});
 const scoped=identity(data,actor,w,c),source=data.source;
 if(!same(data.requestId,args.request_id)||data.permissionVersion!==args.permission_version||data.kind!==args.kind||typeof data.reused!=='boolean'||!object(source)||!uuid(source.id)||args.source_id&&!same(source.id,args.source_id)||source.version!==args.expected_version+1||source.state!=='verified'||Object.keys(source).sort().join('|')!==['id','version','state',...Object.keys(value)].sort().join('|')||Object.keys(value).some(k=>source[k]!==value[k]))throw error();
 await recheckOwner();return {...scoped,requestId:data.requestId,permissionVersion:data.permissionVersion,kind:data.kind,reused:data.reused,source:{id:source.id,version:source.version,state:'verified',...args.entry}};
}

export function fanMemorySnapshot(data,actor,w,c,fan){
 const scoped=identity(data,actor,w,c);if(data.fanId!==fan||typeof data.binding!=='string'||!/^acct_[A-Za-z0-9_-]{1,123}$/u.test(data.binding)||!natural(data.version)||typeof data.contextRevision!=='string'||!/^[a-f0-9]{64}$/u.test(data.contextRevision)||!Array.isArray(data.items)||data.items.length>100||!object(data.coverage))throw error();
 const keys=new Set(),items=data.items.map(item=>{
  if(!exact(item,['key','category','value','status','pinned','origin','source'])||typeof item.key!=='string'||!/^[a-z0-9_-]{1,80}$/u.test(item.key)||keys.has(item.key)||!categories.includes(item.category)||!text(item.value,1000,true)||!['pending','confirmed'].includes(item.status)||typeof item.pinned!=='boolean'||!['analysis','manual'].includes(item.origin)||!exact(item.source,['messageId','quote','at','author',...(Object.hasOwn(item.source||{},'question')?['question']:[])])||typeof item.source.messageId!=='string'||!/^[1-9][0-9]{0,23}$/u.test(item.source.messageId)||!text(item.source.quote,1000,true)||item.source.quote.trim().length<(Object.hasOwn(item.source,'question')?2:3)||!timestamp(item.source.at)||!['fan','model'].includes(item.source.author))throw error();
  let question;try{question=validateMemoryQuestion(item.source,item.category)}catch{throw error()}
  if(question&&item.origin==='analysis'&&item.value!==item.source.quote)throw error();keys.add(item.key);return {...item,source:{...item.source,...(question?{question}:{})}};
 });
 const v=data.coverage;if(!exact(v,['historyComplete','cursor','pages','recentCheckedAt','historyCheckedAt','messagesObserved','contextLimited'])||typeof v.historyComplete!=='boolean'||typeof v.contextLimited!=='boolean'||!natural(v.pages)||v.pages>1000000||!natural(v.messagesObserved)||(v.cursor!==null&&(!text(v.cursor,2048)))||![v.recentCheckedAt,v.historyCheckedAt].every(t=>t===null||timestamp(t))||v.historyComplete&&v.cursor!==null)throw error();
 return {...scoped,fanId:fan,binding:data.binding,version:data.version,contextRevision:data.contextRevision,items,coverage:{...v}};
}
export async function runFanMemoryAction({name,args,actor,w,c,call,recheckOwner}){
 const op={bruff_read_fan_memory:'fan_memory_read',bruff_sync_fan_memory:'fan_memory_sync',bruff_import_fan_memory_candidates:'fan_memory_import_candidates',bruff_edit_fan_memory:'fan_memory_edit'}[name];
 if(!op||![actor,w,c].every(uuid)||typeof args.fan_id!=='string'||!/^[1-9][0-9]{0,23}$/u.test(args.fan_id)||typeof call!=='function'||typeof recheckOwner!=='function')throw error(400);
 const body={operation:op,workspace_id:w,creator_id:c,conversation_id:args.fan_id};
 if(op==='fan_memory_sync'){if(!['recent','older'].includes(args.scan))throw error(400);body.scan=args.scan}
 if(op==='fan_memory_import_candidates'){
  if(Object.keys(args).some(key=>!['workspace_id','model_id','fan_id','expected_version','cursor','candidates'].includes(key))||Object.hasOwn(args,'workspace_id')&&!same(args.workspace_id,w)||Object.hasOwn(args,'model_id')&&!same(args.model_id,c)||!natural(args.expected_version)||(args.cursor!==undefined&&args.cursor!==null&&(!text(args.cursor,2048)||/https?:\/\//iu.test(args.cursor))))throw error(400);
  let candidates;try{candidates=validateCitedCandidates(args.candidates);if(!candidates.length)throw Error()}catch{throw new TeachingError(400,'FAN_MEMORY_INPUT','Revisa las citas literales neutrales y sus mensajes de origen.')}
  Object.assign(body,{expected_version:args.expected_version,candidates,...(args.cursor!==undefined?{cursor:args.cursor}:{})});
 }
 if(op==='fan_memory_edit'){
  if(typeof args.key!=='string'||!/^[a-z0-9_-]{1,80}$/u.test(args.key)||!['confirm','correct','pin','delete'].includes(args.action)||!natural(args.expected_version)||(args.action==='correct'?!text(args.value,1000,true):Object.hasOwn(args,'value')))throw error(400);
  body.edit={key:args.key,action:args.action,expected_version:args.expected_version,...(args.action==='correct'?{value:args.value}:{})};
 }
 const result=await call('/functions/v1/bruff-memory',body);
 if(!result?.ok){if([401,403].includes(result?.status))throw new TeachingError(result.status,'FAN_MEMORY_ACCESS','La sesión o los permisos ya no permiten consultar esta memoria.');if(result?.status===409)throw new TeachingError(409,'FAN_MEMORY_CHANGED','La memoria cambió. Vuelve a leerla antes de editar.');if(result?.status===429){const e=new TeachingError(429,'FAN_MEMORY_LIMIT','Espera antes de actualizar la memoria.');if(natural(result.retryAfter)&&result.retryAfter>0)e.retryAfter=result.retryAfter;throw e}if(op==='fan_memory_import_candidates'&&result?.status===400)throw new TeachingError(400,'FAN_MEMORY_INPUT','No se pudieron contrastar las citas neutrales con la página real seleccionada.');throw error()}
 const output=fanMemorySnapshot(result.data,actor,w,c,args.fan_id);if(op==='fan_memory_edit'&&output.version!==args.expected_version+1)throw error();
 if(op==='fan_memory_import_candidates'){
  const receipt=result.data.importResult;
  if(!exact(receipt,['added','reused'])||![receipt.added,receipt.reused].every(v=>natural(v)&&v<=20)||receipt.added+receipt.reused!==body.candidates.length||output.version!==args.expected_version+(receipt.added>0?1:0))throw error();
  // Structural receipt checks complement the endpoint's authoritative replay of
  // actual fan messages. Existing reviewed or suppressed duplicates stay intact.
  const matching=new Set(body.candidates.filter(candidate=>output.items.some(item=>item.category===candidate.category&&item.value===candidate.quote&&item.source.quote===candidate.quote&&item.source.messageId===candidate.message_id&&(candidate.question_message_id===undefined||item.source.question?.messageId===candidate.question_message_id)&&item.source.author==='fan'&&item.status==='pending'&&item.origin==='analysis'&&item.pinned===false)).map(candidate=>JSON.stringify(candidate)));
  if(matching.size<receipt.added)throw error();
  output.importResult={added:receipt.added,reused:receipt.reused};
 }
 await recheckOwner();return output;
}
