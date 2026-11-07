// Owner authorization belongs to the calling handler and the scoped RPCs.
// This module only binds an explicit review to unchanged stored source data.
export class OwnerSourceError extends Error{
 constructor(status,code,message){super(message);this.name='OwnerSourceError';this.status=status;this.code=code}
}
const fail=(status,code,message)=>new OwnerSourceError(status,code,message);
const input=()=>fail(400,'SOURCE_INPUT','Revisa la modelo, la fuente y su versión vigente.');
const changed=()=>fail(409,'SOURCE_CHANGED','La fuente cambió o ya no está disponible. Vuelve a leerla antes de aprobar.');
const unavailable=()=>fail(503,'SOURCE_UNAVAILABLE','No se pudo verificar la fuente. No se ha confirmado su aprobación.');
const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const uuid=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value);
const sameId=(a,b)=>uuid(a)&&uuid(b)&&a.toLowerCase()===b.toLowerCase();
const identifier=(value,max)=>typeof value==='string'&&value.length<=max&&/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/u.test(value);
const text=(value,max,multiline=false)=>typeof value==='string'&&!!value.trim()&&value.length<=max&&!(multiline?/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u:/[\u0000-\u001f\u007f]/u).test(value);
const version=value=>Number.isSafeInteger(value)&&value>=1;
const facts=new Set(['public_name','age','country','city','language','about']);

function argumentsForReview({kind,sourceId,expected,actor,w,c,list}={}){
 if(!['example','knowledge'].includes(kind)||![sourceId,actor,w,c].every(uuid)||!version(expected)||expected>=Number.MAX_SAFE_INTEGER||typeof list!=='function')throw input();
 return {kind,sourceId:sourceId.toLowerCase(),expected,actor:actor.toLowerCase(),w:w.toLowerCase(),c:c.toLowerCase(),list};
}
function sourceEntry(raw,kind){
 if(!record(raw)||!uuid(raw.id)||!version(raw.version)||!['draft','verified','archived'].includes(raw.state)||!identifier(raw.reference_id,128)||!identifier(raw.source_version,96)||raw.source_version==='0'||!text(raw.label,kind==='example'?200:160))throw unavailable();
 const common={id:raw.id.toLowerCase(),version:raw.version,state:raw.state};
 if(kind==='example'){
  if(!text(raw.trigger,2000)||!text(raw.english,10000,true)||!text(raw.spanish,10000,true)||[raw.trigger,raw.english,raw.spanish].some(value=>value.includes('{{')||value.includes('}}')))throw unavailable();
  return Object.freeze({...common,trigger:raw.trigger,english:raw.english,spanish:raw.spanish,reference_id:raw.reference_id,label:raw.label,source_version:raw.source_version});
 }
 if(!['style_rule','model_fact','boundary'].includes(raw.kind)||!text(raw.text,1200,true)||raw.text.includes('{{')||raw.text.includes('}}')||(raw.kind==='model_fact'?!facts.has(raw.key):raw.key!==null))throw unavailable();
 return Object.freeze({...common,kind:raw.kind,key:raw.key,text:raw.text,reference_id:raw.reference_id,label:raw.label,source_version:raw.source_version});
}
function selectedSource(snapshot,args){
 if(!record(snapshot)||!sameId(snapshot.actorId,args.actor)||!sameId(snapshot.workspaceId,args.w)||!sameId(snapshot.modelId,args.c))throw fail(403,'SOURCE_SCOPE','La sesión o el ámbito de esta fuente han cambiado.');
 if(!Array.isArray(snapshot.items)||snapshot.items.length>200)throw unavailable();
 const ids=new Set();let selected=null;
 for(const raw of snapshot.items){
  const entry=sourceEntry(raw,args.kind);
  if(ids.has(entry.id))throw unavailable();ids.add(entry.id);
  if(entry.id===args.sourceId)selected=entry;
 }
 if(!selected||selected.version!==args.expected)throw changed();
 return selected;
}
async function reviewHash(args,entry){
 const body=JSON.stringify({reviewVersion:1,actorId:args.actor,workspaceId:args.w,modelId:args.c,kind:args.kind,entry});
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body));
 return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function prepareSourceApproval(options){
 const args=argumentsForReview(options),entry=selectedSource(await args.list(args.kind),args);
 if(entry.state==='archived')throw fail(409,'SOURCE_REVIEW','La fuente está archivada. Debe restaurarse y revisarse antes de aprobar.');
 return Object.freeze({actorId:args.actor,workspaceId:args.w,modelId:args.c,kind:args.kind,entry,reviewHash:await reviewHash(args,entry),requiresApproval:entry.state==='draft'});
}
export async function approveSource(options){
 const args=argumentsForReview(options);
 if(options.reviewed!==true||typeof options.reviewHash!=='string'||!/^[a-f0-9]{64}$/u.test(options.reviewHash)||typeof options.save!=='function')throw fail(400,'SOURCE_REVIEW','Confirma la revisión humana de esta fuente concreta antes de aprobar.');
 // No prepared object or cached list is trusted: every approval reads the
 // current scoped source again. The RPC's CAS is the final race guard.
 const prepared=await prepareSourceApproval(args);
 if(prepared.reviewHash!==options.reviewHash)throw changed();
 if(!prepared.requiresApproval)throw fail(409,'SOURCE_REVIEW','Esta fuente ya no es un borrador pendiente de aprobación.');
 const entry=prepared.entry;
 const value=args.kind==='example'?{trigger:entry.trigger,english:entry.english,spanish:entry.spanish,referenceId:entry.reference_id,label:entry.label,sourceVersion:entry.source_version,state:'verified',reviewed:true}:{kind:entry.kind,key:entry.key,text:entry.text,referenceId:entry.reference_id,label:entry.label,sourceVersion:entry.source_version,state:'verified'};
 const result=await options.save(args.kind,args.sourceId,args.expected,value);
 const saved=selectedSource(result,{...args,expected:args.expected+1});
 if(!sameId(result.savedId,args.sourceId)||saved.state!=='verified'||Object.keys(entry).some(key=>!['version','state'].includes(key)&&saved[key]!==entry[key]))throw unavailable();
 return result;
}
