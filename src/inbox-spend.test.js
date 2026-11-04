import test from 'node:test';import assert from 'node:assert/strict';
import {createInboxSpendReader,orderedSpendIds,spendIsFresh,mergeInboxSpendPage,INBOX_SPEND_TTL} from './inbox-spend.js';
import {createReadScheduler} from './live-read-scheduler.js';import {scheduleLiveRead} from './live-read-priority.js';
const base=Date.parse('2026-11-04T00:00:00Z'),row=id=>({userId:String(id),name:'Fan '+id,spend:{available:true,total:1}});
function clock(){let at=base;const tasks=new Map();return {now:()=>at,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn),advance:ms=>at+=ms,nextAt:()=>Math.min(...tasks.values()),flush:async()=>{const first=[...tasks].sort((a,b)=>a[1]-b[1])[0];if(!first)return;tasks.delete(first[0]);at=Math.max(at,first[1]);await first[0]()}}}
function fixture({count=45,visibleIds,request,visible=()=>true,cacheEpoch=()=>0}={}){
 const time=clock(),calls=[],values=[],priorities=[];let denied=0;
 const args={...time,workspace:'workspace',account:'model',visible,cacheEpoch,onValue:(rows,checkedAt)=>values.push({rows,checkedAt}),onDenied:()=>denied++,request:async(workspace,op,input,options)=>{
  assert.equal(workspace,'workspace');assert.equal(op,'fan_spend_batch');assert.equal(input.creator_id,'model');assert.equal(options.active(),true);assert.ok(options.signal instanceof AbortSignal);options.onStart?.();calls.push(input.user_ids);priorities.push(options.priority);
  return request?request(input,options):{data:{fans:input.user_ids.map(id=>({id,spend:{available:true,total:Number(id)}}))}};
 }};
 const reader=createInboxSpendReader(args),rows=Array.from({length:count},(_,i)=>row(i+1));reader.start();reader.setInput(rows,visibleIds??rows.map(f=>f.userId),{refreshToken:0});
 return {time,reader,rows,calls,values,priorities,denied:()=>denied};
}
test('selected fan keeps first place, with unique authorized IDs and batches of at most20',async()=>{
 const rows=Array.from({length:156},(_,i)=>row(i+1)),ids=['150',...rows.slice(0,40).map(f=>f.userId),'150','999','bad'];
 assert.equal(orderedSpendIds(rows,ids)[0],'150');assert.equal(orderedSpendIds(rows,ids).length,41);
 const f=fixture({count:156,visibleIds:ids});await f.time.flush();assert.equal(f.calls[0][0],'150');assert.equal(f.calls[0].length,20);assert.equal(f.calls[0].includes('999'),false);f.reader.stop();
});
test('confirmed spend refreshes afterTTL, including an unavailable response, and old props do not restart it',async()=>{
 const f=fixture({count:1});await f.time.flush();assert.equal(f.calls.length,1);
 f.reader.setInput(f.rows,['1'],{refreshToken:0});await f.time.flush();assert.equal(f.calls.length,1);assert.equal(f.time.nextAt(),base+400+INBOX_SPEND_TTL);
 await f.time.flush();assert.equal(f.calls.length,2);assert.deepEqual(f.priorities,['fan-visible','background']);assert.equal(spendIsFresh({spend:{available:false},spendCheckedAt:f.time.now()},f.time.now()),true);assert.equal(spendIsFresh(f.rows[0],f.time.now()),false);f.reader.stop();
});
test('manual refresh covers all loaded fans once, even fresh/offscreen rows, selectedfirst and progress retained',async()=>{
 const f=fixture({count:45,visibleIds:['45','1']});const fresh=f.rows.map(fan=>({...fan,spendCheckedAt:new Date(base).toISOString()}));
 f.reader.setInput(fresh,['45','1'],{refreshToken:0});await f.time.flush();assert.equal(f.calls.length,0);
 f.reader.setInput(fresh,['45','1'],{refreshToken:1,refreshAll:true});assert.equal(f.reader.getSnapshot().total,45);
 for(let i=0;i<3;i++)await f.time.flush();assert.equal(f.calls.length,3);assert.equal(f.calls[0][0],'45');assert.deepEqual(f.calls.map(ids=>ids.length),[20,20,5]);assert.deepEqual(f.priorities,['fan-visible','background','background']);assert.equal(new Set(f.calls.flat()).size,45);assert.equal(f.reader.getSnapshot().checked,45);assert.equal(f.reader.getSnapshot().done,true);assert.equal(f.reader.getSnapshot().refreshToken,1);f.reader.setInput(fresh,['45','1'],{refreshToken:2,refreshAll:true});assert.equal(f.reader.getSnapshot().done,false);assert.equal(f.reader.getSnapshot().refreshToken,2);f.reader.stop();
});
test('scroll changes and repeated input preserve one batch in flight and cancel hidden queued work',async()=>{
 let release,reads=0;const f=fixture({count:45,visibleIds:['45','1'],request:async(input)=>{reads++;await new Promise(resolve=>release=resolve);return {data:{fans:input.user_ids.map(id=>({id,spend:{available:true,total:2}}))}}}});
 const pending=f.time.flush();await Promise.resolve();f.reader.setInput(f.rows,['2','3'],{refreshToken:0});assert.equal(reads,1);release();await pending;assert.equal(f.calls.length,1);assert.equal(f.values.length,0);assert.equal(f.reader.getSnapshot().busy,false);f.reader.stop();
 let visible=false;const hidden=fixture({count:1,visible:()=>visible});await hidden.time.flush();assert.equal(hidden.calls.length,0);visible=true;await hidden.time.flush();assert.equal(hidden.calls.length,1);hidden.reader.stop();
});
test('a new visible window gets one fan-visible batch and its remaining bulk stays background',async()=>{
 const f=fixture({count:45}),ids=['45',...f.rows.map(row=>row.userId)];
 f.reader.setInput(f.rows,ids,{refreshToken:0,selectedId:'45'});await f.time.flush();
 f.reader.setInput(f.rows,[],{refreshToken:0,selectedId:'45',viewportActive:false});f.reader.setInput(f.rows,ids,{refreshToken:0,selectedId:'45',viewportActive:true});
 await f.time.flush();await f.time.flush();assert.deepEqual(f.priorities,['fan-visible','fan-visible','background']);f.reader.stop();
});
test('manual invalidation cannot bypass RetryAfter and unknown values are never replaced with zero',async()=>{
 let reads=0;const f=fixture({count:1,request:async(input)=>{if(++reads===1)throw Object.assign(Error('limited'),{status:429,retryAfter:7});return {data:{fans:[{id:input.user_ids[0],spend:{available:false,total:null}}]}}}});
 await f.time.flush();assert.equal(f.reader.getSnapshot().waiting,true);assert.equal(f.values.length,0);f.reader.setInput(f.rows,['1'],{refreshToken:1,refreshAll:true});assert.equal(f.time.nextAt(),base+7400);await f.time.flush();assert.equal(f.calls.length,2);assert.equal(f.values[0].rows[0].spend.total,null);assert.equal(f.reader.getSnapshot().done,true);f.reader.stop();
});
test('a reserve rejection before dispatch retains the initial visible batch priority and its RetryAfter',async()=>{
 let at=base;const tasks=new Map(),priorities=[],admitted=[],time={now:()=>at,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn)};
 const scheduler=createReadScheduler({...time,backgroundIdle:4000,startupGrace:1500,maxConcurrent:2});scheduler.observeQuota({limit:60,remaining:3,window:60,reset:(base+7000)/1000});
 const reader=createInboxSpendReader({...time,workspace:'w',account:'c',onValue:()=>{},request:(_w,operation,input,options)=>{priorities.push(options.priority);return scheduleLiveRead(scheduler,operation,async()=>{options.onStart();admitted.push({at,ids:input.user_ids});return {data:{fans:input.user_ids.map(id=>({id,spend:{available:true,total:0}}))}}},options,input)}});
 const step=async()=>{const first=[...tasks].sort((a,b)=>a[1]-b[1])[0];assert.ok(first);tasks.delete(first[0]);at=first[1];void first[0]();await new Promise(resolve=>setImmediate(resolve))};
 reader.start();reader.setInput(Array.from({length:21},(_,index)=>row(index+1)),Array.from({length:21},(_,index)=>String(index+1)),{});await step();
 assert.deepEqual(priorities,['fan-visible']);assert.deepEqual(admitted,[]);assert.equal(reader.getSnapshot().waiting,true);assert.equal(Math.min(...tasks.values()),base+7400);
 reader.recheckVisibility();assert.equal(Math.min(...tasks.values()),base+7400);
 while(admitted.length<2)await step();
 assert.deepEqual(priorities,['fan-visible','fan-visible','background']);assert.equal(admitted[0].at,base+7400);assert.equal(admitted[0].ids.length,20);assert.equal(admitted[1].ids.length,1);reader.stop();
});
test('a rate limit after actual dispatch consumes the initial batch intent and keeps subsequent retries background',async()=>{
 let reads=0;const f=fixture({count:1,request:async input=>{if(++reads===1)throw Object.assign(Error('provider limited'),{status:429,retryAfter:7});return {data:{fans:[{id:input.user_ids[0],spend:{available:true,total:0}}]}}}});
 await f.time.flush();assert.equal(f.reader.getSnapshot().waiting,true);assert.equal(f.time.nextAt(),base+7400);await f.time.flush();assert.deepEqual(f.priorities,['fan-visible','background']);assert.equal(f.values[0].rows[0].spend.total,0);f.reader.stop();
});
test('partial responses retain progress, retry only missing IDs and ignore foreign IDs',async()=>{
 let reads=0;const f=fixture({count:2,request:async()=>({data:{fans:++reads===1?[{id:'1',spend:{available:true,total:2}},{id:'999',spend:{available:true,total:999}}]:[{id:'2',spend:{available:true,total:3}}]}})});
 f.reader.setInput(f.rows,['1','2'],{refreshToken:1,refreshAll:true});await f.time.flush();assert.equal(f.reader.getSnapshot().checked,1);assert.equal(f.reader.getSnapshot().done,false);assert.deepEqual(f.values[0].rows.map(row=>row.id),['1']);await f.time.flush();assert.deepEqual(f.calls[1],['2']);assert.equal(f.reader.getSnapshot().checked,2);assert.equal(f.reader.getSnapshot().done,true);f.reader.stop();
});
test('switching scope or revocation cannot publish a late batch and denial stops retries',async()=>{
 let release;const f=fixture({count:1,request:()=>new Promise(resolve=>release=resolve)});const pending=f.time.flush();await Promise.resolve();f.reader.stop();release({data:{fans:[{id:'1',spend:{available:true,total:8}}]}});await pending;assert.equal(f.values.length,0);
 const denied=fixture({count:1,request:async()=>{throw Object.assign(Error('denied'),{status:403})}});await denied.time.flush();assert.equal(denied.denied(),1);assert.equal(denied.values.length,0);await denied.time.flush();assert.equal(denied.calls.length,1);denied.reader.stop();
});
test('merging a spend result touches only matching rows and never replaces a newer fan-card confirmation',()=>{
 const previous={data:{conversations:[{...row(1),spendCheckedAt:new Date(base+1000).toISOString()},row(2)],cursor:'older',hasMore:true}};
 const old=mergeInboxSpendPage(previous,[{id:'1',spend:{available:true,total:999}}],new Date(base).toISOString());assert.equal(old,previous);
 const next=mergeInboxSpendPage(previous,[{id:'2',spend:{available:true,total:0}},{id:'3',spend:{available:true,total:999}}],new Date(base+2000).toISOString());assert.equal(next.data.conversations[0],previous.data.conversations[0]);assert.equal(next.data.conversations[1].spend.total,0);assert.equal(next.data.conversations.length,2);assert.equal(next.data.cursor,'older');
});
test('an obsolete in-flight viewport aborts and the next visible window can start without waiting for its response',async()=>{
 let oldSignal,aborted=0;const f=fixture({count:1000,visibleIds:['1','2'],request:async(input,options)=>{
  if(input.user_ids[0]==='1'){oldSignal=options.signal;return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>{aborted++;reject(options.signal.reason)},{once:true}))}
  return {data:{fans:input.user_ids.map(id=>({id,spend:{available:true,total:8}}))}};
 }});
 const first=f.time.flush();await Promise.resolve();f.reader.setInput(f.rows,['991','992'],{refreshToken:0});await first;assert.equal(oldSignal.aborted,true);assert.equal(aborted,1);assert.equal(f.values.length,0);await f.time.flush();assert.deepEqual(f.calls,[['1','2'],['991','992']]);assert.equal(f.values[0].rows[0].id,'991');f.reader.stop();
});
test('hidden or moving viewport pauses forced work without discarding progress or consulting forty hidden fans',async()=>{
 const f=fixture({count:45,visibleIds:[]}),fresh=f.rows.map(row=>({...row,spendCheckedAt:new Date(base).toISOString()}));
 f.reader.setInput(fresh,[],{refreshToken:1,refreshAll:true,viewportActive:false});await f.time.flush();assert.equal(f.calls.length,0);assert.equal(f.reader.getSnapshot().total,45);assert.equal(f.reader.getSnapshot().done,false);
 f.reader.setInput(fresh,['1','2'],{refreshToken:1,refreshAll:true,viewportActive:true});await f.time.flush();assert.equal(f.calls.length,1);f.reader.stop();
});
test('cache epoch changes discard a completed batch and release busy state without clearing another identity cache',async()=>{
 let epoch=0,release;const f=fixture({count:1,cacheEpoch:()=>epoch,request:()=>new Promise(resolve=>release=resolve)}),pending=f.time.flush();await Promise.resolve();epoch++;release({data:{fans:[{id:'1',spend:{available:true,total:8}}]}});await pending;assert.equal(f.values.length,0);assert.equal(f.denied(),0);assert.equal(f.reader.getSnapshot().busy,false);f.reader.stop();
});
test('active checks reuse the per-input index instead of scanning every loaded fan for each batch ID',async()=>{
 const time=clock();let reads=0,checksBefore,checksAfter;const rows=Array.from({length:2000},(_,i)=>({get userId(){reads++;return String(i+1)}}));
 const reader=createInboxSpendReader({...time,workspace:'w',account:'c',request:async(_w,_op,input,options)=>{checksBefore=reads;for(let i=0;i<20;i++)assert.equal(options.active(),true);checksAfter=reads;return {data:{fans:input.user_ids.map(id=>({id,spend:{available:true,total:1}}))}}},onValue:()=>{}});
 reader.start();reader.setInput(rows,['1','2'],{});await time.flush();assert.equal(checksBefore,2000);assert.equal(checksAfter,checksBefore);reader.stop();
});
