import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogRecommendation} from '../supabase/functions/bruff-memory/recommendation.js';
import {extractPaidUnlockEvidence,reconcilePurchaseEvents,assessScriptPlan} from '../supabase/functions/bruff-memory/commerce.js';

// Every identity, message, receipt and catalogue in these tests is fictional.
const owner='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000002',workspace='20000000-0000-4000-8000-000000000001',creator='30000000-0000-4000-8000-000000000001';
const eventId='40000000-0000-4000-8000-000000000001',batch='a'.repeat(64),date='2026-11-07T10:00:00.000Z';
const scope=()=>({ownerId:owner,actorId:actor,workspaceId:workspace,creatorId:creator,binding:'acct_fixture',fanId:'77',batchHash:batch});
const catalog=()=>({ownerId:owner,workspaceId:workspace,creatorId:creator,batchHash:batch,sourceUsername:'fictional_model',folders:[{id:'script',name:'Fictional Script',orderConfirmed:false,items:[{id:'12',type:'video',referencePriceCents:9000},{id:'11',type:'photo',referencePriceCents:999},{id:'13',type:'video',referencePriceCents:9100},{id:'14',type:'photo'},{id:'15',type:'video',referencePriceCents:9200}]},{id:'other',name:'Fictional Other',orderConfirmed:false,items:[{id:'20',type:'photo'}]}]});
const plan=()=>({folderId:'script',version:1,planHash:'b'.repeat(64),approvedAt:date,steps:[{mediaId:'11',priceCents:0},{mediaId:'12',priceCents:600},{mediaId:'13',priceCents:1000},{mediaId:'14',priceCents:0},{mediaId:'15',priceCents:2000}]});
const observation=(mediaId='11',patch={})=>({folderId:'script',mediaId,messageId:'100',createdAt:date,kind:'free_sent',priceCents:0,openedReported:false,paidConfirmed:false,...patch});
const offered=(mediaId='12',patch={})=>observation(mediaId,{messageId:'101',kind:'offered',priceCents:600,...patch});
const receipt=(patch={})=>({eventId,fanId:'77',messageId:'101',amountCents:550,occurredAt:'2026-11-07T10:02:00.000Z',ingestedAt:'2026-11-07T10:02:01.000Z',contract:'ofmapi-webhooks-20261107-ppv-purchased',...patch});
const openedEvidence=()=>extractPaidUnlockEvidence({catalog:catalog(),messages:[{id:'101',isFromMe:true,isTip:false,createdAt:date,price:6,isOpened:true,media:[{id:'12',type:'video'}]}]});
const recommend=(patch={})=>createCatalogRecommendation({catalog:catalog(),observations:[],scope:scope(),commerce:{plans:[plan()],evidence:[],refundStatus:'unknown'},...patch});

test('v2 follows the approved free-photo then video order and exact reviewed prices instead of inventory/reference order',async()=>{
 const first=await recommend();assert.equal(first.policyVersion,'bruff-catalog-proposal-v2');assert.equal(first.mediaId,'11');assert.equal(first.priceCents,0);assert.equal(first.stepIndex,0);assert.equal(first.progressState,'ready');assert.equal(first.orderConfirmed,true);assert.equal(first.reviewRequired,true);assert.equal(first.paidConfirmed,false);assert.equal(first.planVersion,1);assert.equal(first.planHash,plan().planHash);assert.equal(first.evidenceBasis,'none');
 const second=await recommend({observations:[observation()]});assert.equal(second.mediaId,'12');assert.equal(second.priceCents,600);assert.equal(second.stepIndex,1);assert.equal(second.progressState,'ready');assert.equal(second.evidenceBasis,'free_sent');assert.equal(second.observedCount,0);assert.equal(second.pendingOfferCount,0);assert.match(second.reason,/historial.*parcial/iu);
});

test('an offered video remains awaiting payment even when openedReported is true without a contractual evidence record',async()=>{
 for(const openedReported of [false,true,null]){
  const result=await recommend({observations:[observation(),offered('12',{openedReported})]});assert.equal(result.mediaId,'12');assert.equal(result.priceCents,600);assert.equal(result.progressState,'awaiting_payment');assert.equal(result.stepIndex,1);assert.equal(result.pendingOfferCount,1);assert.equal(result.observedCount,1);assert.equal(result.paidConfirmed,false);assert.match(result.reason,/falta evidencia/iu);
 }
});

test('contractual PPV opening advances to the following step without claiming a payment amount, date or refund outcome',async()=>{
 const evidence=openedEvidence(),observations=[observation(),offered('12',{openedReported:true})];assert.equal(evidence[0].paidAmountCents,null);assert.equal(evidence[0].paidAt,null);
 const result=await recommend({observations,commerce:{plans:[plan()],evidence,refundStatus:'unknown'}});assert.equal(result.mediaId,'13');assert.equal(result.priceCents,1000);assert.equal(result.progressState,'ready');assert.equal(result.evidenceBasis,'paid_unlock_reported');assert.equal(result.pendingOfferCount,0);assert.equal(result.paidConfirmed,false);assert.equal(Object.hasOwn(result,'paidAmountCents'),false);assert.match(result.reason,/no acreditan el importe cobrado/iu);
 const assessed=assessScriptPlan(plan(),observations,evidence);assert.deepEqual(assessed.payments,[]);assert.equal(assessed.refundStatus,'unknown');
});

test('an exact PPV purchase can complete a two-media bundle, advances once, and counts the paid amount once',async()=>{
 const observations=[observation(),offered('12',{priceCents:1500}),offered('13',{priceCents:1500})],events=[receipt({amountCents:900})],evidence=reconcilePurchaseEvents({observations,events,fanId:'77'});
 const result=await recommend({observations,commerce:{plans:[plan()],evidence,refundStatus:'unknown'}});assert.equal(result.mediaId,'14');assert.equal(result.stepIndex,3);assert.equal(result.priceCents,0);assert.equal(result.progressState,'ready');assert.equal(result.evidenceBasis,'ppv_purchase_event');assert.equal(result.pendingOfferCount,0);
 const assessed=assessScriptPlan(plan(),observations,evidence);assert.deepEqual(assessed.steps.slice(0,3).map(step=>step.state),['free_sent','purchased','purchased']);assert.equal(assessed.payments.length,1);assert.equal(assessed.payments[0].paidAmountCents,900);assert.equal(assessed.payments[0].offerPriceCents,1500);assert.deepEqual(assessed.payments[0].mediaIds,['12','13']);assert.equal(assessed.refundStatus,'unknown');
});

test('message/amount/time similarity cannot advance the plan without the exact purchased message',async()=>{
 const observations=[observation(),offered()],evidence=reconcilePurchaseEvents({observations,events:[receipt({messageId:'999',amountCents:600,occurredAt:date})],fanId:'77'});assert.deepEqual(evidence,[]);
 const result=await recommend({observations,commerce:{plans:[plan()],evidence}});assert.equal(result.mediaId,'12');assert.equal(result.progressState,'awaiting_payment');assert.equal(result.pendingOfferCount,1);
});

test('explicit future or already completed steps require review and never silently skip the approved current step',async()=>{
 const future=await recommend({folderId:'script',mediaId:'13'});assert.equal(future.mediaId,'13');assert.equal(future.stepIndex,2);assert.equal(future.progressState,'needs_review');assert.equal(future.reviewRequired,true);
 const previous=await recommend({observations:[observation()],folderId:'script',mediaId:'11'});assert.equal(previous.mediaId,'11');assert.equal(previous.progressState,'needs_review');assert.equal(previous.observedCount,1);
 const automatic=await recommend({observations:[observation()]});assert.equal(automatic.mediaId,'12');assert.equal(automatic.progressState,'ready');
});

test('a missing reviewed price remains null and requires review instead of borrowing a catalogue reference or zero',async()=>{
 const approved=plan();approved.steps[1].priceCents=null;const result=await recommend({observations:[observation()],commerce:{plans:[approved],evidence:[]}});assert.equal(result.mediaId,'12');assert.equal(result.priceCents,null);assert.equal(result.progressState,'needs_review');assert.equal(result.reviewRequired,true);assert.notEqual(result.priceCents,catalog().folders[0].items[0].referencePriceCents);
});

test('plan version, approved order, reviewed price and contractual evidence changes invalidate a v2 proposal',async()=>{
 const observations=[observation(),offered('12',{openedReported:true})],evidence=openedEvidence(),base={observations,commerce:{plans:[plan()],evidence}},original=await recommend(base);
 for(const change of [p=>{p.version=2;p.planHash='c'.repeat(64)},p=>{p.steps[2].priceCents=1100;p.planHash='d'.repeat(64)},p=>{[p.steps[2],p.steps[3]]=[p.steps[3],p.steps[2]];p.planHash='e'.repeat(64)}]){const approved=plan();change(approved);assert.notEqual((await recommend({...base,commerce:{plans:[approved],evidence}})).id,original.id)}
 const purchase=reconcilePurchaseEvents({observations,events:[receipt()],fanId:'77'}),paid=await recommend({...base,commerce:{plans:[plan()],evidence:purchase}});assert.equal(paid.mediaId,original.mediaId);assert.equal(paid.evidenceBasis,'ppv_purchase_event');assert.notEqual(paid.id,original.id);
 const corrected=reconcilePurchaseEvents({observations,events:[receipt({amountCents:500})],fanId:'77'});assert.notEqual((await recommend({...base,commerce:{plans:[plan()],evidence:corrected}})).id,paid.id);
});

test('explicit verification of the automatic v2 selection reproduces its exact fingerprint',async()=>{
 for(const input of [{},{observations:[observation()]},{observations:[observation(),offered('12',{openedReported:true})],commerce:{plans:[plan()],evidence:openedEvidence()}}]){
  const automatic=await recommend(input),verified=await recommend({...input,folderId:automatic.folderId,mediaId:automatic.mediaId});assert.deepEqual(verified,automatic);
 }
});

test('scoped v2 fingerprints cannot move between workers, fans, model bindings or catalogue batches',async()=>{
 const original=(await recommend()).id;
 for(const [key,value]of [['actorId',owner],['fanId','78'],['binding','acct_other'],['ownerId',actor],['workspaceId',creator],['creatorId',workspace],['batchHash','c'.repeat(64)]]){
  const nextScope={...scope(),[key]:value},nextCatalog=catalog();if(['ownerId','workspaceId','creatorId','batchHash'].includes(key))nextCatalog[key]=value;
  assert.notEqual((await recommend({scope:nextScope,catalog:nextCatalog})).id,original,key);
 }
});

test('without an approved plan the existing v1 inventory behaviour and unconfirmed-order contract remain intact',async()=>{
 const legacy=await recommend({commerce:undefined}),empty=await recommend({commerce:{plans:[],evidence:[],refundStatus:'unknown'}});assert.equal(legacy.policyVersion,'bruff-catalog-proposal-v1');assert.equal(legacy.orderConfirmed,false);assert.equal(legacy.mediaId,'11');assert.equal(legacy.priceCents,0);assert.equal(legacy.id,empty.id);assert.equal(Object.hasOwn(legacy,'planHash'),false);
 const afterPhoto=await recommend({observations:[observation()],commerce:{plans:[],evidence:[]}});assert.equal(afterPhoto.mediaId,'14');assert.equal(afterPhoto.orderConfirmed,false);assert.equal(afterPhoto.policyVersion,'bruff-catalog-proposal-v1');
});

test('completed approved folders stop rather than jumping to a different script and inputs stay immutable',async()=>{
 const observations=plan().steps.map((step,i)=>observation(step.mediaId,{messageId:String(200+i)})),input={catalog:catalog(),observations,scope:scope(),commerce:{plans:[plan()],evidence:[],refundStatus:'unknown'}},before=JSON.stringify(input);assert.equal(await createCatalogRecommendation(input),null);assert.equal(JSON.stringify(input),before);
});
