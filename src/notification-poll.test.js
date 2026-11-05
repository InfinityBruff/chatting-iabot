import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNotificationUpdates,startModelPolling} from './notification-poll.js';
const flush=()=>new Promise(r=>setImmediate(r));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
const row=id=>({id,createdAt:'2026-11-05T12:00:00Z'});
const page=(notifications=[],hasMore=false,cursor=null)=>({data:{notifications,hasMore,cursor}});
test('financial category events missing from general feed arrive once with their category',async()=>{
 const r=await collectNotificationUpdates({known:new Set(),baseline:0,request:async({type})=>({data:{notifications:type==='tip'?[{id:'t',type:'tip',createdAt:'2026-11-01'}]:[{id:'p',type:'unknown',createdAt:'2026-11-01'}],hasMore:false}})});
 assert.equal(r.incoming.length,2);assert.equal(r.incoming.find(n=>n.id==='p').category,'purchases');assert.equal(r.incoming.find(n=>n.id==='t').category,'tip');
});
test('category failure does not lose other updates but revocation discards all',async()=>{
 const request=async({type})=>{if(type==='tip')throw Error('offline');return {data:{notifications:[{id:'p'}],hasMore:false}}};
 const r=await collectNotificationUpdates({known:new Set(),baseline:0,request});assert.equal(r.incoming.length,1);assert.ok(r.error);
 await assert.rejects(collectNotificationUpdates({known:new Set(),baseline:0,request:async({type})=>{if(type==='tip')throw Object.assign(Error('revoked'),{status:403});return request({type})}}),e=>e.status===403);
});
test('three models poll independently; slow first model cannot block others and logout stops timers',async()=>{
 let release;const calls=[],jobs=[];const c=startModelPolling({ids:['a','b','c'],poll:async id=>{calls.push(id);if(id==='a')await new Promise(r=>release=r)},schedule:f=>(jobs.push(f),jobs.length),cancel:()=>{}});
 await flush();assert.deepEqual(calls,['a','b','c']);assert.equal(jobs.length,2);jobs[0]();await flush();assert.equal(calls.length,4);c.stop();release();await flush();const count=calls.length;jobs.forEach(f=>f());await flush();assert.equal(calls.length,count);
});
test('responses after account teardown are discarded',async()=>{let active=true;const r=await collectNotificationUpdates({known:new Set(),baseline:0,active:()=>active,request:async()=>{active=false;return {data:{notifications:[{id:'late'}],hasMore:false}}}});assert.deepEqual(r.incoming,[])});
test('partial notification quota failures preserve results and delay polling; refresh cannot bypass Retry-After',async()=>{
 const result=await collectNotificationUpdates({known:new Set(),baseline:0,request:async({type})=>{if(type==='tip')throw Object.assign(Error('quota'),{status:429,retryAfter:180});return {data:{notifications:[{id:'fixture'}],hasMore:false}}}});assert.equal(result.incoming.length,1);assert.equal(result.retryAfter,180);
 let now=0,calls=0,job,delay;const controller=startModelPolling({ids:['A'],now:()=>now,poll:async()=>{calls++;return {retryAfter:180}},schedule:(f,ms)=>{job=f;delay=ms;return 1},cancel:()=>{}});
 await flush();assert.equal(calls,1);assert.equal(delay,180000);now=1000;controller.refresh();await flush();assert.equal(calls,1);assert.equal(delay,179000);
 now=180000;await job();assert.equal(calls,2);controller.stop();
});

test('general and purchase pages publish before a delayed tip while the final result stays unchanged',async()=>{
 const tip=deferred(),published=[],known=new Set(),responses={'':page([row('general'),row('payment')]),purchases:page([{...row('payment'),text:'same provider event'}]),tip:page([row('tip')])};let finished=false;
 const pending=collectNotificationUpdates({known,baseline:0,request:({type})=>type==='tip'?tip.promise:Promise.resolve(responses[type||'']),onPage:value=>published.push(value)}).then(value=>{finished=true;return value});
 await flush();assert.equal(finished,false);assert.deepEqual(published.map(x=>x.type),['','purchases']);assert.deepEqual(published[0].rows.map(x=>x.id),['general','payment']);assert.equal(published[1].rows[0].category,'purchases');assert.equal(published[0].head,responses[''].data);assert.equal(known.size,0);
 tip.resolve(responses.tip);const result=await pending,baselineResult=await collectNotificationUpdates({known:new Set(),baseline:0,request:async({type})=>responses[type||'']});assert.deepEqual(result,baselineResult);assert.equal(result.incoming.filter(x=>x.id==='payment').length,1);assert.deepEqual(published.map(x=>x.type),['','purchases','tip']);
});

test('a denial invalidates shared activity and rejects before delayed siblings can publish',async()=>{
 for(const status of [401,403]){
  const purchase=deferred(),tip=deferred(),published=[],options=[],failure=Object.assign(Error('revoked'),{status});
  const pending=collectNotificationUpdates({known:new Set(),baseline:0,request:({type},readOptions)=>{options.push(readOptions);return type==='tip'?tip.promise:type==='purchases'?purchase.promise:Promise.resolve(page([row('before_denial')]))},onPage:value=>published.push(value)});
  const rejected=assert.rejects(pending,error=>error===failure);await flush();assert.deepEqual(published.map(x=>x.type),['']);tip.reject(failure);await rejected;assert.ok(options.every(value=>value.active()===false));
  purchase.resolve(page([row('late_private')],true,'must_not_follow'));await flush();assert.deepEqual(published.map(x=>x.type),['']);assert.equal(options.length,3);
 }
});

test('teardown during page publication prevents follow-up cursors, later callbacks and final private rows',async()=>{
 const published=[],requests=[];let active=true;
 const result=await collectNotificationUpdates({known:new Set(),baseline:0,active:()=>active,request:async(args,options)=>{requests.push({args,options});return page([row(args.type||'general')],true,'older')},onPage:value=>{published.push(value);active=false}});
 assert.equal(published.length,1);assert.equal(requests.length,3);assert.ok(requests.every(value=>value.options.active()===false));assert.deepEqual(result,{incoming:[],head:null,error:''});
});

test('each history page publishes only its rows and uses an immutable known baseline for cursor stopping',async()=>{
 const known=new Set(['known']),published=[],requests=[],head=page([row('head')],true,'older').data;
 const result=await collectNotificationUpdates({known,baseline:0,request:async args=>{requests.push(args);return args.type?page():args.cursor?page([row('known')],true,'unused'):{data:head}},onPage:value=>{published.push(value);if(value.type==='')known.add('head')}});
 const general=published.filter(value=>value.type==='');assert.deepEqual(general.map(value=>value.rows.map(x=>x.id)),[['head'],['known']]);assert.ok(general.every(value=>value.head===head));assert.deepEqual(requests.filter(args=>!args.type).map(args=>args.cursor||null),[null,'older']);assert.deepEqual(result.incoming.map(x=>x.id),['head','known']);
});

test('missing or repeated cursors stop the branch after publishing valid pages without an infinite walk',async()=>{
 for(const cursor of [null,'older']){const published=[],requests=[];const result=await collectNotificationUpdates({known:new Set(),baseline:0,request:async args=>{requests.push(args);return args.type?page():args.cursor?page([row('second')],true,cursor):page([row('first')],true,'older')},onPage:value=>published.push(value)});
  assert.deepEqual(published.filter(value=>value.type==='').map(value=>value.rows[0].id),['first','second']);assert.equal(requests.filter(args=>!args.type).length,2);assert.ok(result.error);assert.equal(result.head,null);
 }
});

test('synchronous and asynchronous publication errors reject explicitly and prevent sibling publication',async()=>{
 for(const asynchronous of [false,true]){const sibling=deferred(),failure=Error('Publication failed'),published=[],options=[];
  const pending=collectNotificationUpdates({known:new Set(),baseline:0,request:({type},readOptions)=>{options.push(readOptions);return type?sibling.promise:Promise.resolve(page([row('head')]))},onPage:value=>{published.push(value);if(asynchronous)return Promise.reject(failure);throw failure}});
  await assert.rejects(pending,error=>error===failure);assert.ok(options.every(value=>value.active()===false));sibling.resolve(page([row('late')]));await flush();assert.equal(published.length,1);
 }
});

test('progressive success remains usable when another category is rate limited, preserving RetryAfter',async()=>{
 const published=[],result=await collectNotificationUpdates({known:new Set(),baseline:0,request:async({type})=>{if(type==='tip')throw Object.assign(Error('quota'),{status:429,retryAfter:180});return page([row(type||'general')])},onPage:value=>published.push(value)});
 assert.deepEqual(published.map(value=>value.type),['','purchases']);assert.equal(result.incoming.length,2);assert.equal(result.retryAfter,180);assert.ok(result.error);
});
