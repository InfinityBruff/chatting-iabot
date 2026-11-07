import {extractScriptProgress} from './progress.js';

export const OPENED_CONTRACT='ofmapi-openapi-20261107-ppv-opened';
export const PURCHASE_CONTRACT='ofmapi-webhooks-20261107-ppv-purchased';
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const exact=(x,keys)=>object(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const id=x=>typeof x==='string'&&/^[1-9]\d{0,23}$/u.test(x);
const uuid=x=>typeof x==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/iu.test(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/u.test(x);
const natural=x=>Number.isSafeInteger(x)&&x>=0;
const text=x=>typeof x==='string'&&x.length>0&&x.length<=256&&x===x.trim()&&!/[\u0000-\u001f\u007f]/u.test(x);
const date=x=>typeof x==='string'&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x).toISOString().slice(0,19)===x.slice(0,19)?new Date(x).toISOString():null;
const invalid=()=>Object.assign(Error('No se pudo verificar la evidencia de compras o el orden aprobado.'),{code:'MEMORY_COMMERCE',status:503});
const planError=()=>Object.assign(Error('Revisa y confirma el orden completo y los precios de la carpeta.'),{code:'MEMORY_PLAN_INPUT',status:400});
const compare=(a,b)=>a.length-b.length||(a<b?-1:a>b?1:0);
function mediaIds(values){if(!Array.isArray(values)||!values.length||values.length>1000||values.some(x=>!id(x))||new Set(values).size!==values.length)throw invalid();return values.slice().sort(compare)}
function evidence(value){
 if(!object(value)||!id(value.messageId)||!(value.offerPriceCents===null||natural(value.offerPriceCents)))throw invalid();
 const ids=mediaIds(value.mediaIds);
 if(value.kind==='paid_unlock_reported'){
  if(value.contract!==OPENED_CONTRACT||!(value.offerPriceCents>0)||value.paidAmountCents!==null||value.paidAt!==null||value.eventId!==null)throw invalid();
 }else if(value.kind==='ppv_purchase_event'){
  if(value.contract!==PURCHASE_CONTRACT||value.offerPriceCents===0||!natural(value.paidAmountCents)||value.paidAmountCents<=0||!date(value.paidAt)||!uuid(value.eventId))throw invalid();
 }else throw invalid();
 return {kind:value.kind,messageId:value.messageId,mediaIds:ids,offerPriceCents:value.offerPriceCents,paidAmountCents:value.paidAmountCents,paidAt:value.paidAt===null?null:date(value.paidAt),eventId:value.eventId===null?null:value.eventId.toLowerCase(),contract:value.contract};
}
export const normalizeCommerceEvidence=value=>evidence(value);
function observedByMessage(observations){
 if(!Array.isArray(observations)||observations.length>5000)throw invalid();
 const result=new Map();
 for(const row of observations){
  if(!object(row)||!text(row.folderId)||!id(row.messageId)||!id(row.mediaId)||!date(row.createdAt)||row.paidConfirmed!==false||![true,false,null].includes(row.openedReported)||!(row.kind==='offered'&&natural(row.priceCents)&&row.priceCents>0||row.kind==='free_sent'&&row.priceCents===0||row.kind==='sent_price_unknown'&&row.priceCents===null))throw invalid();
  let group=result.get(row.messageId);
  if(!group){group={createdAt:date(row.createdAt),kind:row.kind,priceCents:row.priceCents,rows:new Map()};result.set(row.messageId,group)}
  if(group.createdAt!==date(row.createdAt)||group.kind!==row.kind||group.priceCents!==row.priceCents)throw invalid();
  const key=JSON.stringify([row.folderId,row.mediaId]),previous=group.rows.get(key);if(previous&&previous.openedReported!==row.openedReported)throw invalid();
  group.rows.set(key,row);
 }
 return result;
}

// Explicit PPV-opened semantics from the named provider contract. The offer
// price is not a payment amount; no purchase date or refund state is inferred.
export function extractPaidUnlockEvidence({catalog,messages}={}){
 const observations=extractScriptProgress({catalog,messages}),groups=observedByMessage(observations),explicit=new Map();
 for(const message of messages){const key=typeof message.id==='number'?String(message.id):message.id;explicit.set(key,(explicit.get(key)??true)&&message.isTip===false)}
 const result=[];
 for(const [messageId,group] of groups){
  if(!explicit.get(messageId)||group.kind!=='offered'||![...group.rows.values()].every(row=>row.openedReported===true))continue;
  result.push(evidence({kind:'paid_unlock_reported',messageId,mediaIds:[...new Set([...group.rows.values()].map(row=>row.mediaId))],offerPriceCents:group.priceCents,paidAmountCents:null,paidAt:null,eventId:null,contract:OPENED_CONTRACT}));
 }
 return result;
}

// Events were already signature-verified and account/fan-scoped by the server.
// A matching message ID is mandatory; amount/time similarity is never a join.
export function reconcilePurchaseEvents({observations,events,fanId}={}){
 const groups=observedByMessage(observations);if(!id(fanId)||!Array.isArray(events)||events.length>5000)throw invalid();
 const unique=new Map(),result=[];
 for(const event of events){
  if(!object(event)||!uuid(event.eventId)||event.fanId!==fanId||!id(event.messageId)||!natural(event.amountCents)||event.amountCents<=0||!date(event.occurredAt)||!date(event.ingestedAt)||event.contract!==PURCHASE_CONTRACT)throw invalid();
  const normalized={eventId:event.eventId.toLowerCase(),fanId:event.fanId,messageId:event.messageId,amountCents:event.amountCents,occurredAt:date(event.occurredAt),contract:event.contract},key=normalized.eventId;
  if(unique.has(key)){if(JSON.stringify(unique.get(key))!==JSON.stringify(normalized))throw invalid();continue}unique.set(key,normalized);
  const group=groups.get(event.messageId);if(!group)continue;
  // A currently free message does not establish its historical PPV offer price.
  // Keep zero in the original observation; the signed payment amount is separate.
  result.push(evidence({kind:'ppv_purchase_event',messageId:event.messageId,mediaIds:[...new Set([...group.rows.values()].map(row=>row.mediaId))],offerPriceCents:group.priceCents>0?group.priceCents:null,paidAmountCents:event.amountCents,paidAt:date(event.occurredAt),eventId:key,contract:PURCHASE_CONTRACT}));
 }
 return result;
}

export async function commerceEvidenceId(scope,value){
 if(!object(scope)||!['ownerId','workspaceId','creatorId'].every(key=>uuid(scope[key]))||typeof scope.binding!=='string'||!/^acct_[A-Za-z0-9_-]{1,123}$/u.test(scope.binding)||!id(scope.fanId)||!hash(scope.batchHash))throw invalid();
 const row=evidence(value),data=[scope.ownerId,scope.workspaceId,scope.creatorId,scope.binding,scope.fanId,scope.batchHash,row.kind,row.messageId,row.mediaIds,row.offerPriceCents,row.paidAmountCents,row.paidAt,row.eventId,row.contract];
 return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(data))))].map(x=>x.toString(16).padStart(2,'0')).join('');
}

export function validatePlanInput(catalog,plan){
 if(!exact(plan,['folderId','expectedVersion','steps','confirmed'])||!text(plan.folderId)||!natural(plan.expectedVersion)||plan.expectedVersion===Number.MAX_SAFE_INTEGER||plan.confirmed!==true||!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>1000)throw planError();
 const folder=catalog?.folders?.find(row=>row.id===plan.folderId);if(!folder||!Array.isArray(folder.items)||folder.items.length!==plan.steps.length)throw planError();
 const assets=new Map(folder.items.map(item=>[item.id,item])),seen=new Set();
 const steps=plan.steps.map(step=>{if(!exact(step,['mediaId','priceCents'])||!id(step.mediaId)||seen.has(step.mediaId)||!assets.has(step.mediaId)||!(step.priceCents===null||natural(step.priceCents)&&Math.round(step.priceCents/100*100)===step.priceCents)||assets.get(step.mediaId).type==='photo'&&step.priceCents!==0)throw planError();seen.add(step.mediaId);return {mediaId:step.mediaId,priceCents:step.priceCents}});
 return {folderId:plan.folderId,steps};
}

export function assessScriptPlan(plan,observations,records){
 if(!object(plan)||!text(plan.folderId)||!Number.isSafeInteger(plan.version)||plan.version<1||!hash(plan.planHash)||!Array.isArray(plan.steps)||!plan.steps.length||plan.steps.length>1000||!Array.isArray(records)||records.length>5000)throw invalid();
 const groups=observedByMessage(observations),all=[...groups].flatMap(([messageId,group])=>[...group.rows.values()].map(row=>({...row,messageId}))),sources=records.map(evidence),seen=new Set();
 const steps=plan.steps.map(step=>{
  if(!object(step)||!id(step.mediaId)||seen.has(step.mediaId)||!(step.priceCents===null||natural(step.priceCents)))throw invalid();seen.add(step.mediaId);
  const rows=all.filter(row=>row.folderId===plan.folderId&&row.mediaId===step.mediaId),messageIds=[...new Set(rows.map(row=>row.messageId))].sort(compare),matching=sources.filter(item=>messageIds.includes(item.messageId)&&item.mediaIds.includes(step.mediaId));
  let state='unknown',evidenceSource=null;
  if(matching.some(item=>item.kind==='ppv_purchase_event')){state='purchased';evidenceSource='ppv_purchase_event'}
  else if(matching.some(item=>item.kind==='paid_unlock_reported')){state='unlock_reported';evidenceSource='paid_unlock_reported'}
  else if(rows.some(row=>row.kind==='free_sent')){state='free_sent';evidenceSource='observed_message'}
  else if(rows.some(row=>row.kind==='offered')){state='awaiting_payment';evidenceSource='observed_message'}
  else if(rows.length)evidenceSource='observed_message';
  return {mediaId:step.mediaId,priceCents:step.priceCents,state,evidenceSource,messageIds};
 });
 const readyIndex=steps.findIndex(step=>!['free_sent','purchased','unlock_reported'].includes(step.state)),payments=new Map();
 for(const row of sources)if(row.kind==='ppv_purchase_event'&&steps.some(step=>step.messageIds.includes(row.messageId)&&row.mediaIds.includes(step.mediaId))){const prior=payments.get(row.eventId);if(prior&&JSON.stringify(prior)!==JSON.stringify(row))throw invalid();payments.set(row.eventId,row)}
 return {folderId:plan.folderId,version:plan.version,planHash:plan.planHash,steps,readyIndex:readyIndex<0?null:readyIndex,complete:readyIndex<0,payments:[...payments.values()],refundStatus:'unknown'};
}
