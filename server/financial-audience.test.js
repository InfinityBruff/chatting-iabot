import {test} from 'node:test';
import assert from 'node:assert/strict';
import {filterFinancialAudience} from '../supabase/functions/bruff-live/financial-audience.js';
import {resolveMassAudience} from '../supabase/functions/bruff-live/advanced-audience.js';
import {createLiveHandler as sourceHandler} from '../supabase/functions/bruff-live/handler.js';
import {readFile} from 'node:fs/promises';
import {newAutoMessage} from '../src/auto-messages.js';
const createLiveHandler=process.env.BRUFF_TEST_BUNDLE?await (async()=>{
 const code=await readFile(process.env.BRUFF_TEST_BUNDLE,'utf8'),serve=code.lastIndexOf('Deno.serve(');
 assert.ok(serve>0);return (await import('data:text/javascript;base64,'+Buffer.from(code.slice(0,serve)).toString('base64'))).createLiveHandler;
})():sourceHandler;
const day=86400000,now=Date.parse('2026-11-02T12:00:00Z');
const sources=[{id:'a',binding:'acct_a'},{id:'b',binding:'acct_b'}];
const rule=(min,max)=>({enabled:true,min,max});
const purchase=(fan,days,extra={})=>({id:`${fan}-${days}`,user:{id:Number(fan)},type:'message',amount:10,status:'paid',createdAt:new Date(now-days*day).toISOString(),...extra});
const base=()=>({ids:['1','2'],current:'a',sources,audience:{agencyPurchase:rule(2,5)},now,save:async()=>{},read:async()=>({transactions:[],hasMore:false})});
test('financial purchase filters paginate across models, use latest purchase and resume without partial audience',async()=>{
 let checkpoint=null;const reads=[];
 const args={...base(),budget:1,save:async financial=>{checkpoint={financial}},read:async(source,path)=>{
  reads.push(source.id+path);const cursor=new URL('https://fixture/'+path).searchParams.get('cursor');
  if(source.id==='a'&&!cursor)return {transactions:[purchase('1',4),purchase('2',3)],hasMore:true,cursor:'next'};
  return {transactions:source.id==='a'?[purchase('1',3)]:[purchase('2',1)],hasMore:false};
 }};
 assert.deepEqual(await filterFinancialAudience(args),{complete:false});
 assert.deepEqual(await filterFinancialAudience({...args,checkpoint}),{complete:false});
 const result=await filterFinancialAudience({...args,checkpoint});assert.equal(result.complete,true);assert.deepEqual(result.ids,['1']);assert.equal(reads.length,3);
 assert.deepEqual((await filterFinancialAudience({...args,checkpoint})).ids,['1']);assert.equal(reads.length,3);
});
test('model purchase is independent from agency purchases and ignores subscriptions/tips/refunds',async()=>{
 const args={...base(),audience:{modelPurchase:rule(2,5)},read:async source=>{assert.equal(source.id,'a');return {transactions:[purchase('1',2),purchase('2',4,{type:'tip'}),purchase('2',3,{type:'new_subscription'}),purchase('1',1,{status:'refunded'})],hasMore:false}}};
 assert.deepEqual((await filterFinancialAudience(args)).ids,['1']);
});
test('purchase age uses whole 24-hour days with inclusive boundaries and excludes fans with no purchases',async()=>{
 const args={...base(),ids:['1','2','3','4'],audience:{modelPurchase:rule(2,2)},read:async()=>({transactions:[purchase('1',2),purchase('2',2.99),purchase('3',3)],hasMore:false})};
 assert.deepEqual((await filterFinancialAudience(args)).ids,['1','2']);
 await assert.rejects(filterFinancialAudience({...args,audience:{modelPurchase:rule(1.5,2)}}),/días enteros/);
});
test('agency spend sums exact cents across every model and intersects purchase filters',async()=>{
 let checkpoint;const args={...base(),budget:1,audience:{agencySpend:rule(0.3,0.3),agencyPurchase:rule(0,5)},save:async financial=>{checkpoint={financial}},read:async(source,path)=>path.startsWith('fans/')?{fans:[1,2].map(fan=>({fanId:fan,available:true,total:source.id==='a'?0.1:fan===1?0.2:0.3}))}:{transactions:[purchase('1',5),purchase('2',3)],hasMore:false}};
 let result;for(let i=0;i<6;i++){result=await filterFinancialAudience({...args,checkpoint});if(result.complete)break;assert.equal(result.ids,undefined)}assert.deepEqual(result.ids,['1']);
});
test('missing spend, unknown purchase status, repeated cursors and unavailable agency never produce recipients',async()=>{
 await assert.rejects(filterFinancialAudience({...base(),sources:[]}),/agencia/);
 await assert.rejects(filterFinancialAudience({...base(),audience:{agencySpend:rule(0,100)},read:async()=>({fans:[{fanId:1,available:false},{fanId:2,available:true,total:0}]})}),/no disponible/);
 await assert.rejects(filterFinancialAudience({...base(),read:async()=>({transactions:[purchase('1',3,{status:null})],hasMore:false})}),/Estado/);
 await assert.rejects(filterFinancialAudience({...base(),budget:3,read:async()=>({transactions:[],hasMore:true,cursor:'same'})}),/Paginación/);
});
test('source changes invalidate partial totals and expired checkpoints cannot be reused',async()=>{
 let checkpoint;const args={...base(),audience:{agencySpend:rule(0,100)},budget:1,save:async financial=>{checkpoint={financial}},read:async()=>({fans:[1,2].map(fanId=>({fanId,available:true,total:10}))})};
 await filterFinancialAudience(args);let reads=0;
 await filterFinancialAudience({...args,checkpoint,sources:[sources[0],{id:'b',binding:'acct_changed'}],read:async()=>{reads++;return {fans:[1,2].map(fanId=>({fanId,available:true,total:10}))}}});assert.equal(reads,1);assert.equal(checkpoint.financial.totals['1'],1000);
 await assert.rejects(filterFinancialAudience({...args,checkpoint,now:now+1800001,sources:[sources[0],{id:'b',binding:'acct_changed'}]}),/caducado/);
});
test('audience resolver refuses incomplete finance and applies finance together with local spend',async()=>{
 const config={trigger:'mass',bulk:{audience:'collections',listIds:['10']},audience:{excludeLists:[],modelPurchase:rule(2,5),modelSpend:rule(20,50)}};
 const args={config,binding:'acct_a',authorize:async()=> 'acct_a',providerKey:'fake',fetcher:async(url,o)=>{assert.equal(o.method,'GET');return new Response(JSON.stringify(url.includes('/lists/')?{id:10,users:[{id:1},{id:2}],usersCount:2}:{fans:[{fanId:1,available:true,total:30},{fanId:2,available:true,total:10}]}))},financialContext:{...base(),read:async()=>({transactions:[purchase('1',3),purchase('2',4)],hasMore:false})}};
 const result=await resolveMassAudience(args);assert.deepEqual(result.recipientIds,['1']);
 await assert.rejects(resolveMassAudience({...args,financialContext:undefined}),/ámbito financiero/);
});
test('authenticated financial preparation uses server agency bindings, rechecks changes and never sends',async()=>{
 const w='00000000-0000-0000-0000-000000000001',c='00000000-0000-0000-0000-000000000002',d='00000000-0000-0000-0000-000000000003';
 for(const mode of ['ok','changed','limited']){
  const draft={...newAutoMessage('mass'),id:d,version:1,name:'Finance fixture'};draft.messages[0].text='Hello';draft.audience.agencySpend=rule(20,20);
  let manifestReads=0,checkpoint=null,providerReads=0,prepared=null;
  const handler=createLiveHandler({url:'https://auth.test',anonKey:'fake',serviceKey:'private-fixture',providerKey:'fake',fetcher:async(url,o)=>{
   const json=x=>new Response(JSON.stringify(x));
   if(url.endsWith('/auth/v1/user'))return json({id:w,email_confirmed_at:'yes'});
   if(url.includes('bruff_my_workspaces'))return json([{id:w,role:'owner'}]);
   if(url.includes('bruff_live_authorize'))return json('acct_a');
   if(url.includes('bruff_auto_message_drafts'))return json({rows:[draft]});
   if(url.includes('bruff_financial_sources'))return json([{id:c,binding:'acct_a'},{id:'other',binding:mode==='changed'&&++manifestReads>1?'acct_changed':'acct_b'}]);
   if(url.includes('bruff_audience_checkpoint')){const b=JSON.parse(o.body);if(b.op==='save')checkpoint=b.value;return json(b.op==='acquire'?{lease:'fixture',checkpoint}:true)}
   if(url.includes('bruff_native_mass')){prepared=JSON.parse(o.body);return json({id:d,state:'prepared',kind:'native'})}
   assert.equal(o.method,'GET');providerReads++;
   if(url.includes('/fans?'))return json({fans:[{id:1}],hasMore:false});
   assert.match(url,/accounts\/acct_[ab]\/fans\/spend/);
   if(mode==='limited')return new Response('{}',{status:429,headers:{'retry-after':'60'}});
   return json({fans:[{fanId:1,available:true,total:10}]});
  }});
  const response=await handler(new Request('https://bruff.test',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({operation:'automation_prepare',workspace_id:w,creator_id:c,draft_id:d,expected_version:1})}));
  if(mode==='ok'){assert.equal(response.status,200);assert.deepEqual(prepared.recipients,['1']);assert.equal(providerReads,3);assert.equal((await response.json()).data.activated,false)}
  else {assert.equal(response.status,503);assert.equal(prepared,null);if(mode==='limited'){const body=await response.json();assert.equal(body.resumable,true);assert.equal(body.retryAfter,60)}}
 }
});
