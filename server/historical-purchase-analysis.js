// Reference-only descriptive analysis. No network, storage, generation, sales
// recommendations or conversion of historical references into signed events.
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const identifier=x=>typeof x==='string'&&x.length>0&&x.length<=128&&x===x.trim()&&!/[\u0000-\u001f\u007f]/u.test(x)&&!/^https?:/iu.test(x);
const cents=x=>Number.isSafeInteger(x)&&x>=0;
const time=x=>typeof x==='string'&&Number.isFinite(Date.parse(x))?new Date(x).toISOString():null;
const fail=()=>{throw new TypeError('La referencia histórica no tiene un scope o metadatos verificables.')};
const keyFields=['accountId','fanId','conversationId'];
const WINDOW_MS=2*60*60*1000;
function scoped(scope,row){if(keyFields.some(k=>row[k]!==undefined&&row[k]!==scope[k]))fail()}
function settlement(status){
 if(status==null)return'unknown';if(typeof status!=='string'||status.length>80)fail();const value=status.toLowerCase();
 if(['paid','completed','success','successful','succeeded'].includes(value))return'completed_reported';
 if(value==='pending')return'pending';if(['refund','refunded'].includes(value))return'refunded';if(value==='chargeback')return'chargeback';if(['failed','cancelled','canceled'].includes(value))return'failed';return'unknown';
}
export function analyzeHistoricalPurchases({scope,source,messages,purchases,coverage}={}){
 if(!object(scope)||!keyFields.every(k=>identifier(scope[k]))||source?.kind!=='onlyx_reference'||!identifier(source.referenceId)||!time(source.capturedAt)||!Array.isArray(messages)||messages.length>5000||!Array.isArray(purchases)||purchases.length>1000||!object(coverage)||!['messagesComplete','purchasesComplete','purchaseSelectedSample'].every(k=>typeof coverage[k]==='boolean'))fail();
 const byMessage=new Map();
 for(const raw of messages){
  if(!object(raw)||!identifier(raw.id)||typeof raw.isFromMe!=='boolean'||!time(raw.createdAt))fail();scoped(scope,raw);
  if(raw.delivery||raw.pending)continue;
  const row={id:raw.id,isFromMe:raw.isFromMe,createdAt:time(raw.createdAt),priceCents:cents(raw.priceCents)?raw.priceCents:null,mediaCount:Number.isSafeInteger(raw.mediaCount)&&raw.mediaCount>=0?raw.mediaCount:null};
  if(byMessage.has(row.id)&&JSON.stringify(byMessage.get(row.id))!==JSON.stringify(row))fail();byMessage.set(row.id,row);
 }
 const unique=new Map(),identities=new Map();
 for(const raw of purchases){
  if(!object(raw)||!identifier(raw.messageId)||!cents(raw.amountCents)||raw.amountCents<=0||typeof raw.reportedPurchased!=='boolean'||raw.id!==undefined&&!identifier(raw.id)||raw.purchasedAt!==null&&!time(raw.purchasedAt))fail();scoped(scope,raw);
  const row={purchaseId:raw.id??null,messageId:raw.messageId,amountCents:raw.amountCents,purchasedAt:raw.purchasedAt===null?null:time(raw.purchasedAt),reportedPurchased:raw.reportedPurchased,settlement:settlement(raw.status)};
  const key=raw.id===undefined?JSON.stringify([row.messageId,row.purchasedAt,row.amountCents]):'id:'+raw.id;
  if(unique.has(key)&&JSON.stringify(unique.get(key))!==JSON.stringify(row))fail();
  const identity=JSON.stringify([row.messageId,row.purchasedAt]);if(identities.has(identity)&&identities.get(identity)!==row.amountCents)fail();identities.set(identity,row.amountCents);unique.set(key,row);
 }
 const reported=[...unique.values()],linked=[],unmatched=[];
 for(const row of reported){const m=byMessage.get(row.messageId);if(!row.reportedPurchased||!m||!m.isFromMe){unmatched.push(row);continue}linked.push({...row,offeredAt:m.createdAt,offerPriceCents:m.priceCents,offerMatchesPaid:m.priceCents===null?null:m.priceCents===row.amountCents})}
 const eligible=linked.filter(row=>row.purchasedAt&&!['refunded','chargeback','failed'].includes(row.settlement)).sort((a,b)=>Date.parse(a.purchasedAt)-Date.parse(b.purchasedAt)||(a.messageId<b.messageId?-1:a.messageId>b.messageId?1:0)),orderedMessages=[...byMessage.values()].sort((a,b)=>Date.parse(a.createdAt)-Date.parse(b.createdAt));
 const windows=[];
 for(let i=0;i<eligible.length;){
  const start=Date.parse(eligible[i].purchasedAt);let end=i+1;while(end<eligible.length&&Date.parse(eligible[end].purchasedAt)-start<WINDOW_MS)end++;
  if(end-i>=2){
   const rows=eligible.slice(i,end),endAt=Date.parse(rows.at(-1).purchasedAt),contextStart=Math.min(...rows.map(row=>Date.parse(row.offeredAt))),context=orderedMessages.filter(row=>Date.parse(row.createdAt)>=contextStart&&Date.parse(row.createdAt)<=endAt);
   windows.push({startAt:rows[0].purchasedAt,endAt:rows.at(-1).purchasedAt,durationMinutes:(endAt-start)/60000,purchases:rows,contextMessageIds:context.slice(-100).map(row=>row.id),contextTruncated:context.length>100,fanMessages:context.filter(row=>!row.isFromMe).length,outgoingMessages:context.filter(row=>row.isFromMe).length,settlementUncertain:rows.some(row=>row.settlement!=='completed_reported'),causalityEstablished:false});
  }
  i=end;
 }
 const bought=new Set(linked.map(row=>row.messageId));
 return {schemaVersion:1,scope:Object.fromEntries(keyFields.map(k=>[k,scope[k]])),source:{kind:'onlyx_reference',referenceId:source.referenceId,capturedAt:time(source.capturedAt)},coverage:{messagesComplete:coverage.messagesComplete,purchasesComplete:coverage.purchasesComplete,purchaseSelectedSample:coverage.purchaseSelectedSample},loadedMessages:byMessage.size,linkedPurchaseReferences:linked,unmatchedPurchaseReferences:unmatched.length,purchaseTimesUnknown:linked.filter(row=>row.purchasedAt===null).length,offersWithoutMatchedPurchaseInLoadedData:[...byMessage.values()].filter(row=>row.isFromMe&&row.priceCents>0&&!bought.has(row.id)).length,windows,windowPolicy:'nonoverlapping_first_purchase_anchor_strict_lt_2h',refundStatus:'unknown',backendPurchaseConfirmed:false,causalityEstablished:false,conversionRate:null};
}
