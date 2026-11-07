import {validUsage} from '../bruff-drafts/usage.js';

// The database owns authorization and job state. This projection never exposes
// leases, provider bindings, tokens, raw events or future private columns.
const record=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(x);
const same=(x,y)=>uuid(x)&&uuid(y)&&x.toLowerCase()===y.toLowerCase();
const fan=x=>typeof x==='string'&&/^[1-9]\d{0,23}$/u.test(x);
const clean=(x,max)=>typeof x==='string'&&x.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x);
const date=x=>typeof x==='string'&&Number.isFinite(Date.parse(x));
const settingKeys=['enabled','mode','fanScope','fanIds','delaySeconds','maxRepliesPerFanDay','contextSharingConfirmed','automaticSendingConfirmed'];
const states=['queued','claimed','generating','ready','draft_ready','sending','sent','skipped','blocked','uncertain'];
const usageKeys=['status','promptTokens','completionTokens','calculatedNeurons','chargedNeurons'];
export class AutopilotControlError extends Error{
 constructor(status,code,message){super(message);this.name='AutopilotControlError';this.status=status;this.code=code}
}
const unavailable=()=>new AutopilotControlError(503,'AUTOPILOT_UNAVAILABLE','No se pudo comprobar el estado de la delegación. Consulta su estado antes de repetir un cambio.');
export function validAutopilotSettings(x){
 return record(x)&&Object.keys(x).length===settingKeys.length&&settingKeys.every(key=>Object.hasOwn(x,key))&&typeof x.enabled==='boolean'&&['drafts','automatic'].includes(x.mode)&&['all','selected'].includes(x.fanScope)&&Array.isArray(x.fanIds)&&x.fanIds.length<=500&&x.fanIds.every(fan)&&new Set(x.fanIds).size===x.fanIds.length&&(x.fanScope!=='all'||x.fanIds.length===0)&&Number.isSafeInteger(x.delaySeconds)&&x.delaySeconds>=10&&x.delaySeconds<=120&&Number.isSafeInteger(x.maxRepliesPerFanDay)&&x.maxRepliesPerFanDay>=1&&x.maxRepliesPerFanDay<=20&&typeof x.contextSharingConfirmed==='boolean'&&typeof x.automaticSendingConfirmed==='boolean'&&(!x.enabled||x.contextSharingConfirmed&&(x.fanScope!=='selected'||x.fanIds.length>0)&&(x.mode!=='automatic'||x.automaticSendingConfirmed));
}
function draft(x){
 if(!record(x)||!['1','2','3'].includes(x.id)||!clean(x.english,700)||!x.english.trim()||!clean(x.spanish,1000)||!x.spanish.trim())throw unavailable();
 const refs=key=>{if(!Array.isArray(x[key])||x[key].length>(key==='exampleIds'?6:12)||key==='exampleIds'&&!x[key].length||!x[key].every(uuid)||new Set(x[key]).size!==x[key].length)throw unavailable();return [...x[key]]};
 return {id:x.id,english:x.english,spanish:x.spanish,exampleIds:refs('exampleIds'),knowledgeIds:refs('knowledgeIds')};
}
export function autopilotSnapshot(data,actor,w,c,{operation='read',expected,settings,review,runtime={}}={}){
 if(!record(data)||!same(data.actorId,actor)||!same(data.workspaceId,w)||!same(data.creatorId,c)||!validAutopilotSettings(data.settings)||!Number.isSafeInteger(data.version)||data.version<0||typeof data.effectiveEnabled!=='boolean'||!Array.isArray(data.activity)||data.activity.length>50)throw unavailable();
 if(expected!==undefined&&(data.version!==expected+1||settings&&settingKeys.some(key=>JSON.stringify(data.settings[key])!==JSON.stringify(settings[key]))||operation==='pause'&&data.settings.enabled!==false))throw unavailable();
 const seen=new Set(),activity=data.activity.map(row=>{
  if(!record(row)||!uuid(row.id)||seen.has(row.id)||!['automatic','manual'].includes(row.kind)||!Number.isSafeInteger(row.version)||row.version<1||!fan(row.fanId)||row.anchorMessageId!==null&&!fan(row.anchorMessageId)||!states.includes(row.state)||!date(row.createdAt)||!date(row.dueAt)||row.providerId!==null&&!fan(row.providerId)||row.detail!==null&&!clean(row.detail,300)||row.generationId!==null&&!uuid(row.generationId)||row.engineVersion!==null&&!['bruff-drafts-v2','bruff-autopilot-v1'].includes(row.engineVersion)||!Array.isArray(row.drafts)||row.drafts.length>3||!Array.isArray(row.unknowns)||row.unknowns.length>5||!row.unknowns.every(x=>clean(x,160))||row.usage!==null&&!validUsage(row.usage))throw unavailable();
  const selectedDraftId=row.selectedDraftId??null,reviewedAt=row.uncertainReviewedAt??null,reviewedBy=row.uncertainReviewedBy??null,reviewNote=row.uncertainReviewNote??null;
  if(selectedDraftId!==null&&!['1','2','3'].includes(selectedDraftId)||reviewedAt===null&&(reviewedBy!==null||reviewNote!==null)||reviewedAt!==null&&(!date(reviewedAt)||!uuid(reviewedBy)||!clean(reviewNote,500)||!reviewNote.trim()||row.state!=='uncertain'))throw unavailable();
  seen.add(row.id);const drafts=row.drafts.map(draft);if(new Set(drafts.map(x=>x.id)).size!==drafts.length||drafts.length&&(!row.generationId||!row.engineVersion)||row.state==='sent'&&!row.providerId)throw unavailable();
  return {id:row.id,kind:row.kind,version:row.version,fanId:row.fanId,anchorMessageId:row.anchorMessageId,state:row.state,createdAt:row.createdAt,dueAt:row.dueAt,providerId:row.providerId,detail:row.detail,generationId:row.generationId,engineVersion:row.engineVersion,selectedDraftId,uncertainReviewedAt:reviewedAt,uncertainReviewedBy:reviewedBy,uncertainReviewNote:reviewNote,aiGenerated:drafts.length>0,aiVerified:false,drafts,unknowns:[...row.unknowns],usage:row.usage===null?null:Object.fromEntries(usageKeys.map(key=>[key,row.usage[key]]))};
 });
 if(!['activity','review_uncertain'].includes(operation)&&activity.length)throw unavailable();
 if(operation==='review_uncertain'){
  const row=activity.find(x=>same(x.id,review?.id));if(!row||row.version!==review.version+1||row.state!=='uncertain'||!same(row.uncertainReviewedBy,actor)||!row.uncertainReviewedAt||row.uncertainReviewNote!==review.note||data.settings.enabled!==false||data.effectiveEnabled)throw unavailable();
 }
 const capabilities={workerEnabled:runtime.workerEnabled===true,automaticSendingEnabled:runtime.automaticSendingEnabled===true,backgroundReady:runtime.backgroundReady===true};
 return {actorId:actor,workspaceId:w,modelId:c,settings:{...data.settings,fanIds:[...data.settings.fanIds]},version:data.version,delegationAuthorized:data.effectiveEnabled,effectiveEnabled:data.effectiveEnabled&&capabilities.workerEnabled&&capabilities.backgroundReady&&(data.settings.mode!=='automatic'||capabilities.automaticSendingEnabled),runtime:capabilities,activity};
}
