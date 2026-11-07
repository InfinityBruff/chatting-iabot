import {scopeKey} from './chat-direct.js';
import {vaultAttachment} from './vault-library.js';

const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const part=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value===value.trim()&&!/[\u0000-\u001f\u007f]/u.test(value);
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value);
const numericId=value=>typeof value==='string'&&/^[1-9]\d{0,23}$/u.test(value)?value:Number.isSafeInteger(value)&&value>0?String(value):null;
const types=new Set(['photo','video','audio','gif']);
const unavailable=()=>({status:'unavailable',message:'No se pudieron verificar todos los archivos en las páginas consultadas. Revisa el baúl.'});

// Exact, private equality keys: callers must not display, log or persist them.
// Type tags preserve raw price differences; sorted keys ignore object key order.
function snapshotValue(value,seen=new Set()){
 if(value===null)return ['null'];
 if(value===undefined)return ['undefined'];
 if(['string','boolean'].includes(typeof value))return [typeof value,value];
 if(typeof value==='number')return ['number',Object.is(value,-0)?'-0':String(value)];
 if(typeof value!=='object'||seen.has(value)||!Array.isArray(value)&&Object.getPrototypeOf(value)!==Object.prototype&&Object.getPrototypeOf(value)!==null)throw TypeError('Invalid draft');
 seen.add(value);
 const result=Array.isArray(value)?['array',value.map(item=>snapshotValue(item,seen))]:['object',Object.keys(value).sort().map(key=>[key,snapshotValue(value[key],seen)])];
 seen.delete(value);return result;
}
export function draftSnapshot(draft){
 if(!record(draft))throw TypeError('Invalid draft');
 return JSON.stringify(snapshotValue([draft.text,draft.price,draft.attachments,draft.reply]));
}
export function inspectDraft(draft){
 if(!record(draft)||typeof draft.text!=='string'||!Array.isArray(draft.attachments))throw TypeError('Invalid draft');
 const price=draft.price,hasPrice=price!==undefined&&price!==null&&price!==''&&(typeof price!=='string'&&typeof price!=='number'||!Number.isFinite(Number(typeof price==='string'?price.replace(',','.'):price))||Number(typeof price==='string'?price.replace(',','.'):price)!==0);
 return {text:draft.text,snapshot:draftSnapshot(draft),hasPrepared:!!(draft.text.length||draft.attachments.length||hasPrice||draft.reply!=null)};
}
function accountFromScope(scope){
 try{const [actor,workspace,account,fanId,...rest]=JSON.parse(scope);return !rest.length&&scopeKey({actor,workspace,account,fanId})===scope?account:null}catch{return null}
}
function contentSnapshot(content){
 if(!record(content)||!part(content.accountId)||content.currency!=='USD'||!(content.priceCents===null||Number.isSafeInteger(content.priceCents)&&content.priceCents>=0&&Math.round(content.priceCents/100*100)===content.priceCents)||!Array.isArray(content.mediaIds)||content.mediaIds.length<1||content.mediaIds.length>10)return null;
 if(content.mediaIds.some(id=>typeof id!=='string'||numericId(id)!==id)||new Set(content.mediaIds).size!==content.mediaIds.length)return null;
 const reference=content.reference,version=reference?.version,provenance=content.provenance;
 if(provenance!==undefined){
  // A manually reviewed catalog proposal is not an approved text example.
  // This is a structural guard only: the Provider rechecks the proposal with
  // the authenticated memory service before the compositor resolves media.
  if(reference!==undefined||content.categoryId!==undefined||content.mediaIds.length!==1||!record(provenance)||Object.keys(provenance).length!==8||provenance.kind!=='catalog_proposal'||provenance.policyVersion!=='bruff-catalog-proposal-v1'||!(/^[a-f0-9]{64}$/u).test(provenance.proposalId)||!(/^[a-f0-9]{64}$/u).test(provenance.batchHash)||!part(provenance.folderId)||provenance.reviewRequired!==true||provenance.orderConfirmed!==false||provenance.paidConfirmed!==false)return null;
 }else if(!record(reference)||reference.verified!==true||!identifier(reference.id)||!(Number.isSafeInteger(version)&&version>0||identifier(version)&&version!=='0'))return null;
 if(content.categoryId!==undefined&&(typeof content.categoryId!=='string'||!/^\d{1,20}$/u.test(content.categoryId)))return null;
 if(content.folderName!==undefined&&(!provenance||!part(content.folderName)))return null;
 return {accountId:content.accountId,priceCents:content.priceCents,mediaIds:content.mediaIds.slice(),categoryId:content.categoryId,folderName:content.folderName};
}
function available(row){
 return record(row)&&numericId(row.id)!==null&&types.has(row.type)&&row.isReady===true&&row.canView===true&&!row.hasError&&typeof row.attachment==='string'&&!!row.attachment.trim()&&row.attachment.length<=60000;
}
function matchingAttachments(items,content){
 return Array.isArray(items)&&items.length===content.mediaIds.length&&items.every((item,index)=>record(item)&&numericId(item.id)===content.mediaIds[index]&&typeof item.token==='string'&&item.token===item.media?.attachment&&available(item.media)&&numericId(item.media.id)===content.mediaIds[index]);
}

// Pure draft preparation only. The owner commits ready fields and consumes the
// token together, preserving reply. Capability authenticity remains server-owned.
export function applyChatDirectDraft({scope,currentScope,token,consumed,enabled,locked=false,draft,text,mode,expectedSnapshot,content,attachments}={}){
 const account=accountFromScope(scope);
 if(!account||scope!==currentScope)return {status:'stale'};
 if(enabled!==true||locked||!part(token))return {status:'blocked'};
 if(consumed instanceof Set?consumed.has(token):Array.isArray(consumed)?consumed.includes(token):consumed===token)return {status:'duplicate'};
 let inspected;try{inspected=inspectDraft(draft)}catch{return {status:'blocked',reason:'draft'}}
 if(draft.text.length>10000||draft.attachments.length>10)return {status:'blocked',reason:'draft'};
 const current={currentText:inspected.text,draftSnapshot:inspected.snapshot,hasPrepared:inspected.hasPrepared};
 if(mode==='check')return {status:'checked',...current};
 if(content!=null&&mode!=='replace-bundle')return {status:'blocked',reason:'content'};
 if(!['append','replace','replace-bundle'].includes(mode)||typeof text!=='string'||!text.trim()||text.length>10000||typeof expectedSnapshot!=='string')return {status:'blocked',reason:'text'};
 if(expectedSnapshot!==inspected.snapshot)return {status:'conflict',...current};
 if(mode==='replace-bundle'){
  const verified=contentSnapshot(content);
  if(!verified||verified.accountId!==account||verified.priceCents===null||!matchingAttachments(attachments,verified))return {status:'blocked',reason:'content'};
  return {status:'ready',text,price:String(verified.priceCents/100),attachments:attachments.slice()};
 }
 const next=mode==='replace'?text:draft.text+(draft.text?'\n':'')+text;
 return next.length<=10000?{status:'ready',text:next,price:draft.price,attachments:draft.attachments.slice()}:{status:'blocked',reason:'limit'};
}

// Only existing authorized vault pages are consulted. Finding a token here is
// evidence of that read, not cryptographic verification or future availability.
export async function resolveChatDirectMedia({content,request,active=()=>true,maxPages=4}={}){
 if(!active())return {status:'stale'};
 const verified=contentSnapshot(content);
 if(!verified||typeof request!=='function'||!Number.isSafeInteger(maxPages)||maxPages<1)return unavailable();
 // Resolve the reviewed folder name against current authorized folders. The
 // catalog's opaque folder key is never used as a provider category ID.
 if(verified.folderName){
  let folderCursor;const folderCursors=new Set(),categories=new Map(),matches=new Set();let complete=false;
  for(let page=0;page<4;page++){
   if(!active())return {status:'stale'};
   let response;try{response=await request('vault_categories',{creator_id:verified.accountId,...(folderCursor?{cursor:folderCursor}:{})})}catch(error){if(!active())return {status:'stale'};throw error}
   if(!active())return {status:'stale'};const data=response?.data;
   if(!record(data)||!Array.isArray(data.categories)||typeof data.hasMore!=='boolean')return unavailable();
   for(const folder of data.categories){const id=typeof folder?.id==='number'&&Number.isSafeInteger(folder.id)&&folder.id>=0?String(folder.id):folder?.id;if(typeof id!=='string'||!/^\d{1,20}$/u.test(id)||typeof folder.name!=='string'||categories.has(id))return unavailable();categories.set(id,folder.name);if(folder.name===verified.folderName)matches.add(id)}
   if(!data.hasMore){complete=true;break}
   if(typeof data.cursor!=='string'||!data.cursor||data.cursor.length>2048||folderCursors.has(data.cursor))return unavailable();folderCursors.add(data.cursor);folderCursor=data.cursor;
  }
  if(!complete||matches.size!==1)return unavailable();verified.categoryId=[...matches][0];
 }
 const wanted=new Set(verified.mediaIds),found=new Map(),seenIds=new Set(),seenCursors=new Set();let cursor;
 for(let page=0;page<Math.min(maxPages,4);page++){
  if(!active())return {status:'stale'};
  let response;
  try{response=await request('vault_media',{creator_id:verified.accountId,type:'all',...(verified.categoryId?{category:verified.categoryId}:{}),...(cursor?{cursor}:{})})}catch(error){if(!active())return {status:'stale'};throw error}
  if(!active())return {status:'stale'};
  const data=response?.data;
  if(!record(data)||!Array.isArray(data.media)||typeof data.hasMore!=='boolean')return unavailable();
  for(const row of data.media){
   const id=record(row)?numericId(row.id):null;
   if(!id||seenIds.has(id))return unavailable();
   seenIds.add(id);
   if(wanted.has(id)){
    if(!available(row))return unavailable();
    found.set(id,vaultAttachment({...row}));
   }
  }
  if(found.size===wanted.size)return {status:'resolved',items:verified.mediaIds.map(id=>found.get(id))};
  if(!data.hasMore)return unavailable();
  if(typeof data.cursor!=='string'||!data.cursor||data.cursor.length>2048||seenCursors.has(data.cursor))return unavailable();
  seenCursors.add(data.cursor);cursor=data.cursor;
 }
 return unavailable();
}
