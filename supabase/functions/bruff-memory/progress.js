const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const numericId=value=>typeof value==='string'&&/^[1-9]\d{0,23}$/.test(value)?value:typeof value==='number'&&Number.isSafeInteger(value)&&value>0?String(value):null;
const identifier=value=>typeof value==='string'&&value.length>0&&value.length<=256&&value===value.trim()&&!/[\u0000-\u001f\u007f]/u.test(value)?value:null;
const mediaTypes=new Set(['photo','video','audio','gif']);
const MAX_MESSAGES=20000,MAX_ITEMS=20000,MAX_OBSERVATIONS=200000;

export class ProgressError extends Error{
 constructor(code){super('No se pudo verificar el progreso del catálogo: '+code);this.name='ProgressError';this.code=code}
}
const fail=code=>{throw new ProgressError(code)};

function date(value){
 if(typeof value!=='string'||value.length>40)return null;
 const match=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.exec(value);
 if(!match)return null;
 const [,year,month,day,hour,minute,second]=match.map(Number),leap=year%4===0&&(year%100!==0||year%400===0);
 if(month<1||month>12||day<1||day>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][month-1]||hour>23||minute>59||second>59)return null;
 const at=Date.parse(value);return Number.isFinite(at)?new Date(at).toISOString():null;
}
function cents(value){
 if(typeof value!=='number'||!Number.isFinite(value)||value<0)return null;
 const n=Math.round(value*100);return Number.isSafeInteger(n)&&Math.abs(value*100-n)<=0.0000001?n:null;
}
function indexCatalog(catalog){
 if(!record(catalog)||!identifier(catalog.batchHash)||!Array.isArray(catalog.folders)||catalog.folders.length>200)fail('catalog');
 const folders=new Map(),items=new Map();let count=0;
 for(const folder of catalog.folders){
  const id=record(folder)?identifier(folder.id):null;
  if(!id||folders.has(id)||!Array.isArray(folder.items))fail('catalog_folder');
  folders.set(id,folder);
  for(const item of folder.items){
   if(++count>MAX_ITEMS)fail('catalog_limit');
   const mediaId=record(item)?numericId(item.id):null;
   // One media ID in multiple folders is ambiguous; never choose a folder by order.
   if(!mediaId||!mediaTypes.has(item.type)||items.has(mediaId))fail('catalog_media');
   items.set(mediaId,{folderId:id,type:item.type});
  }
 }
 return {batchHash:catalog.batchHash,folders,items};
}
function messageProjection(message){
 if(!record(message))fail('message');
 const id=numericId(message.id);if(!id)fail('message_id');
 const blocked=!!message.delivery||!!message.pending||['pending','queued','checking','sending','uncertain','failed'].includes(message.status);
 const media=new Map();
 if(message.media!=null&&!Array.isArray(message.media))fail('message_media');
 if((message.media?.length||0)>1000)fail('message_media_limit');
 for(const item of message.media||[]){
  const mediaId=record(item)?numericId(item.id):null;if(!mediaId)fail('message_media_id');
  const type=item.type==null?null:item.type;
  // mediaView preserves provider type strings. Unknown types outside this
  // catalog are irrelevant; a matching catalog ID is checked after eligibility.
  if(type!==null&&(typeof type!=='string'||type.length>100))fail('message_media_type');
  if(media.has(mediaId)&&media.get(mediaId)!==type)fail('message_media_conflict');
  media.set(mediaId,type);
 }
 const createdAt=date(message.createdAt),priceCents=cents(message.price),openedReported=typeof message.isOpened==='boolean'?message.isOpened:null;
 // Only progress-relevant fields participate: preview URL/seen/access changes are not a new offer.
 return {id,isFromMe:message.isFromMe===true?true:message.isFromMe===false?false:null,isTip:message.isTip===true,blocked,createdAt,priceCents,openedReported,media:[...media].sort(([a],[b])=>a.localeCompare(b))};
}

// Caller supplies a freshly authorized, single-model/fan scope. This pure helper
// cannot establish authorization, paid-unlock semantics, narrative order or completeness.
export function extractScriptProgress({catalog,messages}={}){
 const index=indexCatalog(catalog);
 if(!Array.isArray(messages)||messages.length>MAX_MESSAGES)fail('messages');
 const unique=new Map();
 for(const message of messages){
  const projected=messageProjection(message),previous=unique.get(projected.id);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(projected))fail('duplicate_message_conflict');
  unique.set(projected.id,projected);
 }
 const observations=[];
 for(const message of unique.values()){
  if(message.isFromMe!==true||message.isTip||message.blocked)continue;
  if(!message.createdAt)fail('message_date');
  for(const [mediaId,type] of message.media){
   const item=index.items.get(mediaId);if(!item)continue;
   if(type!==null&&type!==item.type)fail('catalog_media_type_conflict');
   if(observations.length>=MAX_OBSERVATIONS)fail('observation_limit');
   observations.push({folderId:item.folderId,mediaId,messageId:message.id,createdAt:message.createdAt,kind:message.priceCents===null?'sent_price_unknown':message.priceCents===0?'free_sent':'offered',priceCents:message.priceCents,openedReported:message.openedReported,paidConfirmed:false});
  }
 }
 return observations;
}

function observation(row,index){
 if(!record(row))fail('observation');
 const folderId=identifier(row.folderId),mediaId=numericId(row.mediaId),messageId=numericId(row.messageId),createdAt=date(row.createdAt),item=index.items.get(mediaId);
 if(!folderId||!messageId||!createdAt||!item||item.folderId!==folderId||row.paidConfirmed!==false||!(row.openedReported===null||typeof row.openedReported==='boolean'))fail('observation');
 if(!(row.kind==='sent_price_unknown'&&row.priceCents===null||row.kind==='free_sent'&&row.priceCents===0||row.kind==='offered'&&Number.isSafeInteger(row.priceCents)&&row.priceCents>0))fail('observation_price');
 return {folderId,mediaId,messageId,createdAt,kind:row.kind,priceCents:row.priceCents,openedReported:row.openedReported,paidConfirmed:false};
}
function counts(rows){
 const messages=new Map();
 for(const row of rows){
  const comparable=JSON.stringify([row.createdAt,row.kind,row.priceCents,row.openedReported]),previous=messages.get(row.messageId);
  if(previous&&previous.comparable!==comparable)fail('observation_message_conflict');
  messages.set(row.messageId,{row,comparable});
 }
 let freeMessages=0,offeredMessages=0,sentPriceUnknownMessages=0,offeredPriceCents=0;
 for(const {row} of messages.values()){
  if(row.kind==='free_sent')freeMessages++;
  else if(row.kind==='offered'){offeredMessages++;offeredPriceCents+=row.priceCents;if(!Number.isSafeInteger(offeredPriceCents))fail('summary_price_limit')}
  else sentPriceUnknownMessages++;
 }
 return {observationCount:rows.length,messageCount:messages.size,freeMessages,offeredMessages,sentPriceUnknownMessages,offeredPriceCents,confirmedPurchases:null,orderConfirmed:false};
}

export function summarizeScriptProgress({catalog,observations}={}){
 const index=indexCatalog(catalog);
 if(!Array.isArray(observations)||observations.length>MAX_OBSERVATIONS)fail('observations');
 const unique=new Map();
 for(const input of observations){
  const row=observation(input,index),key=JSON.stringify([row.messageId,row.mediaId,row.folderId]),previous=unique.get(key);
  if(previous&&JSON.stringify(previous)!==JSON.stringify(row))fail('duplicate_observation_conflict');
  unique.set(key,row);
 }
 const rows=[...unique.values()];
 // Folder counts overlap when one message contains assets from multiple folders;
 // global bundle prices are therefore recomputed by message, never added across folders.
 return {batchHash:index.batchHash,...counts(rows),priceUnit:'message_bundle',coverage:'loaded_messages_only',folders:[...index.folders.keys()].map(folderId=>({folderId,...counts(rows.filter(row=>row.folderId===folderId))}))};
}
