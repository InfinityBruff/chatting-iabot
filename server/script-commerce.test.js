import test from 'node:test';
import assert from 'node:assert/strict';
import {extractPaidUnlockEvidence,reconcilePurchaseEvents,commerceEvidenceId,assessScriptPlan,validatePlanInput,OPENED_CONTRACT,PURCHASE_CONTRACT} from '../supabase/functions/bruff-memory/commerce.js';
const actor='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',w='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444',eventId='55555555-5555-4555-8555-555555555555';
const scope=()=>({actorId:actor,ownerId:owner,workspaceId:w,creatorId:c,binding:'acct_fixture',fanId:'55',batchHash:'a'.repeat(64)});
const catalog=()=>({batchHash:'a'.repeat(64),folders:[{id:'script',name:'Fictional Script',items:[{id:'11',type:'photo'},{id:'12',type:'video'},{id:'13',type:'video'}]}]});
const message=(patch={})=>({id:'101',isFromMe:true,isTip:false,createdAt:'2026-11-07T10:00:00Z',price:18.5,isOpened:true,media:[{id:'12',type:'video'},{id:'11',type:'photo'}],...patch});
const observation=(mediaId='12',patch={})=>({folderId:'script',mediaId,messageId:'101',createdAt:'2026-11-07T10:00:00.000Z',kind:'offered',priceCents:1850,openedReported:true,paidConfirmed:false,...patch});
const opened=()=>({kind:'paid_unlock_reported',messageId:'101',mediaIds:['11','12'],offerPriceCents:1850,paidAmountCents:null,paidAt:null,eventId:null,contract:OPENED_CONTRACT});
const event=patch=>({eventId,fanId:'55',messageId:'101',amountCents:1700,occurredAt:'2026-11-07T10:10:00.000Z',ingestedAt:'2026-11-07T10:10:01.000Z',contract:PURCHASE_CONTRACT,...patch});
const plan=()=>({folderId:'script',version:1,planHash:'b'.repeat(64),steps:[{mediaId:'11',priceCents:0},{mediaId:'12',priceCents:600},{mediaId:'13',priceCents:null}]});

test('contractual paid opening yields one bundle observation, no paid amount/date or narrative claim',()=>{
 const input=message({text:'PRIVATE FIXTURE',seenByFan:true}),result=extractPaidUnlockEvidence({catalog:catalog(),messages:[input]});assert.deepEqual(result,[opened()]);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.equal(result.length,1);assert.equal(result[0].offerPriceCents,1850);
});
test('only strict non-tip outgoing opened PPV with actual matching media can yield opening evidence',()=>{
 for(const patch of [{isFromMe:false},{isTip:true},{isTip:undefined},{price:0},{price:null},{price:'18.5'},{isOpened:false},{isOpened:'true'},{isOpened:undefined},{delivery:'uncertain'},{pending:true},{media:[],mediaCount:3},{media:[{id:'999',type:'video'}]}])assert.deepEqual(extractPaidUnlockEvidence({catalog:catalog(),messages:[message(patch)]}),[]);
 assert.deepEqual(extractPaidUnlockEvidence({catalog:catalog(),messages:[message({isOpened:false,seenByFan:true,media:[{id:'12',type:'video',canView:true}]})]}),[]);
});
test('event reconciliation requires exact message/fan and preserves bundle amount once',()=>{
 const observations=[observation(),observation('11')],result=reconcilePurchaseEvents({observations,events:[event(),event()],fanId:'55'});
 assert.deepEqual(result,[{kind:'ppv_purchase_event',messageId:'101',mediaIds:['11','12'],offerPriceCents:1850,paidAmountCents:1700,paidAt:'2026-11-07T10:10:00.000Z',eventId,contract:PURCHASE_CONTRACT}]);
 assert.deepEqual(reconcilePurchaseEvents({observations,events:[event({messageId:'102'})],fanId:'55'}),[]);
 assert.throws(()=>reconcilePurchaseEvents({observations,events:[event({fanId:'56'})],fanId:'55'}));
});
test('unknown offer amount stays unknown and timestamp/amount similarity never joins an event',()=>{
 const observations=[observation('12',{kind:'sent_price_unknown',priceCents:null})];
 assert.equal(reconcilePurchaseEvents({observations,events:[event()],fanId:'55'})[0].offerPriceCents,null);
 assert.deepEqual(reconcilePurchaseEvents({observations,events:[event({messageId:'999',amountCents:1850,occurredAt:observations[0].createdAt})],fanId:'55'}),[]);
});
test('a signed payment for a now-free message preserves payment but does not invent a historical zero offer',()=>{
 const original=observation('12',{kind:'free_sent',priceCents:0}),before=JSON.stringify(original),[paid]=reconcilePurchaseEvents({observations:[original],events:[event()],fanId:'55'});
 assert.equal(paid.offerPriceCents,null);assert.equal(paid.paidAmountCents,1700);assert.equal(paid.paidAt,event().occurredAt);assert.equal(JSON.stringify(original),before);assert.equal(original.priceCents,0);
 assert.throws(()=>assessScriptPlan(plan(),[original],[{...paid,offerPriceCents:0}]));
});
test('event contradictions, untrusted contracts, invalid dates and amounts are rejected',()=>{
 for(const patch of [{amountCents:0},{amountCents:-1},{amountCents:1.2},{contract:'unknown'},{eventId:'bad'},{occurredAt:'2026-02-30T00:00:00Z'},{ingestedAt:null}])assert.throws(()=>reconcilePurchaseEvents({observations:[observation()],events:[event(patch)],fanId:'55'}));
 assert.throws(()=>reconcilePurchaseEvents({observations:[observation()],events:[event(),event({amountCents:1800})],fanId:'55'}));
});
test('evidence hash binds exact scope and semantic data but not audit actor or media array order',async()=>{
 const a=await commerceEvidenceId(scope(),opened()),b=await commerceEvidenceId({...scope(),actorId:owner},{...opened(),mediaIds:['12','11'],observedAt:'2099-01-01T00:00:00Z'});assert.equal(a,b);assert.match(a,/^[a-f0-9]{64}$/);
 for(const [key,value]of [['ownerId',actor],['workspaceId',actor],['creatorId',actor],['binding','acct_other'],['fanId','56'],['batchHash','c'.repeat(64)]])assert.notEqual(await commerceEvidenceId({...scope(),[key]:value},opened()),a);
 assert.notEqual(await commerceEvidenceId(scope(),{...opened(),offerPriceCents:2000}),a);
});
test('full owner plan accepts arbitrary reviewed order, photo zero and unknown video price',()=>{
 const input={folderId:'script',expectedVersion:0,confirmed:true,steps:[{mediaId:'13',priceCents:null},{mediaId:'11',priceCents:0},{mediaId:'12',priceCents:700}]};assert.deepEqual(validatePlanInput(catalog(),input),{folderId:'script',steps:input.steps});
 for(const patch of [{confirmed:false},{expectedVersion:-1},{extra:true},{steps:input.steps.slice(1)},{steps:[input.steps[0],input.steps[0],input.steps[2]]},{steps:input.steps.map(row=>row.mediaId==='11'?{...row,priceCents:1}:row)}])assert.throws(()=>validatePlanInput(catalog(),{...input,...patch}),error=>error.status===400);
});
test('plan assessment uses contiguous completion and distinguishes opening, purchase and pending offer',()=>{
 const observations=[observation('11',{messageId:'100',kind:'free_sent',priceCents:0}),observation()],initial=assessScriptPlan(plan(),observations,[]);assert.deepEqual(initial.steps.map(step=>step.state),['free_sent','awaiting_payment','unknown']);assert.equal(initial.readyIndex,1);
 const unlock=assessScriptPlan(plan(),observations,[opened()]);assert.equal(unlock.steps[1].state,'unlock_reported');assert.equal(unlock.steps[1].evidenceSource,'paid_unlock_reported');assert.equal(unlock.readyIndex,2);assert.equal(unlock.refundStatus,'unknown');assert.deepEqual(unlock.payments,[]);
 const paid=reconcilePurchaseEvents({observations,events:[event()],fanId:'55'}),purchased=assessScriptPlan(plan(),observations,paid);assert.equal(purchased.steps[1].state,'purchased');assert.equal(purchased.readyIndex,2);assert.equal(purchased.payments.length,1);assert.equal(purchased.payments[0].paidAmountCents,1700);assert.equal(purchased.steps[1].paidAmountCents,undefined);
});
test('a later completed step never skips an unknown earlier step; unrelated evidence cannot complete it',()=>{
 const p=plan(),observations=[observation('12')],a=assessScriptPlan(p,observations,[opened()]);assert.equal(a.readyIndex,0);assert.equal(a.steps[0].state,'unknown');assert.equal(a.steps[1].state,'unlock_reported');
 const mismatched=assessScriptPlan(p,observations,[{...opened(),messageId:'999'}]);assert.equal(mismatched.steps[1].state,'awaiting_payment');
});
test('a bundle purchase may complete two steps but appears once in payments',()=>{
 const observations=[observation('11'),observation('12'),observation('13')],payments=reconcilePurchaseEvents({observations,events:[event()],fanId:'55'}),result=assessScriptPlan(plan(),observations,payments);
 assert.deepEqual(result.steps.map(step=>step.state),['purchased','purchased','purchased']);assert.equal(result.readyIndex,null);assert.equal(result.complete,true);assert.equal(result.payments.length,1);assert.equal(result.payments[0].paidAmountCents,1700);assert.equal(result.refundStatus,'unknown');
});
test('immutable inputs yield JSON-safe output without content, media URLs or claim that refunds were checked',async()=>{
 const cat=catalog(),messages=[message()],before=JSON.stringify([cat,messages]);const records=extractPaidUnlockEvidence({catalog:cat,messages});await commerceEvidenceId(scope(),records[0]);assert.equal(JSON.stringify([cat,messages]),before);assert.deepEqual(JSON.parse(JSON.stringify(records)),records);
});
