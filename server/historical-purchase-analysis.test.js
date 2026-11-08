import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeHistoricalPurchases} from './historical-purchase-analysis.js';
const at=Date.parse('2026-11-08T10:00:00Z'),iso=minutes=>new Date(at+minutes*60000).toISOString();
const input=()=>({scope:{accountId:'onlyx-account',fanId:'native-fan',conversationId:'native-conversation'},source:{kind:'onlyx_reference',referenceId:'private-snapshot',capturedAt:iso(0)},coverage:{messagesComplete:false,purchasesComplete:true,purchaseSelectedSample:true},messages:[{id:'m1',isFromMe:true,createdAt:iso(-2),priceCents:600},{id:'fan1',isFromMe:false,createdAt:iso(1),text:'UNEXPOSED'}, {id:'m2',isFromMe:true,createdAt:iso(5),priceCents:1000}],purchases:[{id:'p1',messageId:'m1',amountCents:600,purchasedAt:iso(0),reportedPurchased:true},{id:'p2',messageId:'m2',amountCents:1000,purchasedAt:iso(10),reportedPurchased:true,status:'pending'}]});
test('linked historical references stay attributed, partial and unconfirmed as backend purchases',()=>{
 const a=analyzeHistoricalPurchases(input());assert.equal(a.linkedPurchaseReferences.length,2);assert.equal(a.windows.length,1);assert.equal(a.windows[0].durationMinutes,10);assert.equal(a.windows[0].settlementUncertain,true);assert.equal(a.refundStatus,'unknown');assert.equal(a.backendPurchaseConfirmed,false);assert.equal(a.conversionRate,null);assert.equal(a.causalityEstablished,false);assert.equal(a.coverage.messagesComplete,false);assert.ok(!JSON.stringify(a).includes('UNEXPOSED'));
});
test('scope mismatches and equal native IDs in a different account never cross-link',()=>{for(const field of ['accountId','fanId','conversationId']){const x=input();x.purchases[0][field]='other';assert.throws(()=>analyzeHistoricalPurchases(x))}});
test('only exact outgoing message ID joins; matching amounts and dates cannot substitute for it',()=>{
 const x=input();x.purchases[1].messageId='unmatched';let a=analyzeHistoricalPurchases(x);assert.equal(a.linkedPurchaseReferences.length,1);assert.equal(a.unmatchedPurchaseReferences,1);assert.equal(a.windows.length,0);x.purchases[1].messageId='fan1';a=analyzeHistoricalPurchases(x);assert.equal(a.linkedPurchaseReferences.length,1);
});
test('strict anchored windows cannot become long chains and exactly two hours is excluded',()=>{
 const x=input();x.messages.push({id:'m3',isFromMe:true,createdAt:iso(200),priceCents:600});x.purchases[1].purchasedAt=iso(119);x.purchases.push({id:'p3',messageId:'m3',amountCents:600,purchasedAt:iso(238),reportedPurchased:true});let a=analyzeHistoricalPurchases(x);assert.equal(a.windows.length,1);assert.equal(a.windows[0].durationMinutes,119);assert.equal(a.windows[0].purchases.length,2);x.purchases[1].purchasedAt=iso(120);x.purchases.pop();a=analyzeHistoricalPurchases(x);assert.equal(a.windows.length,0);
});
test('unknown times, refunds and unreported purchases do not silently become completed sales windows',()=>{
 const x=input();x.purchases[0].purchasedAt=null;let a=analyzeHistoricalPurchases(x);assert.equal(a.purchaseTimesUnknown,1);assert.equal(a.windows.length,0);x.purchases[0].purchasedAt=iso(0);x.purchases[0].status='refunded';a=analyzeHistoricalPurchases(x);assert.equal(a.windows.length,0);assert.equal(a.linkedPurchaseReferences[0].settlement,'refunded');x.purchases[0].reportedPurchased=false;a=analyzeHistoricalPurchases(x);assert.equal(a.unmatchedPurchaseReferences,1);
});
test('dedupe is reference-based, contradictions fail closed and unseen offers are never labeled certainly unpaid',()=>{
 const x=input();x.purchases.push({...x.purchases[0]});let a=analyzeHistoricalPurchases(x);assert.equal(a.linkedPurchaseReferences.length,2);x.messages.push({id:'offer',isFromMe:true,createdAt:iso(8),priceCents:1800});a=analyzeHistoricalPurchases(x);assert.equal(a.offersWithoutMatchedPurchaseInLoadedData,1);x.purchases[2].amountCents=700;assert.throws(()=>analyzeHistoricalPurchases(x));
});
test('analysis is bounded and does not mutate inputs or copy conversation text',()=>{
 const x=input(),before=JSON.stringify(x),out=analyzeHistoricalPurchases(x);assert.equal(JSON.stringify(x),before);assert.deepEqual(JSON.parse(JSON.stringify(out)),out);x.messages=Array(5001);assert.throws(()=>analyzeHistoricalPurchases(x));
});
