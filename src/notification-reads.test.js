import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationReads} from './notification-reads.js';
import {collectNotificationUpdates} from './notification-poll.js';
import {createReadScheduler} from './live-read-scheduler.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const page=(id='fixture',cursor=null)=>({data:{notifications:[{id,createdAt:'2026-11-03T12:00:00Z'}],cursor,hasMore:false}});
const args={creator_id:'A',type:'purchases'};

test('real notification collectors share purchase/tip heads and keep all categories/results',async()=>{
 const calls=[],reads=createNotificationReads(async(w,op,value)=>{calls.push(value);return page(value.type||'general')});
 const collect=()=>collectNotificationUpdates({known:new Set(),baseline:0,request:value=>reads.request('w','notifications',{creator_id:'A',...value})});
 const [first,second]=await Promise.all([collect(),collect()]);
 assert.equal(calls.filter(value=>value.type==='purchases').length,1);
 assert.equal(calls.filter(value=>value.type==='tip').length,1);
 assert.equal(calls.filter(value=>!value.type).length,2);
 for(const result of [first,second]){assert.deepEqual(result.incoming.map(row=>row.id).sort(),['general','purchases','tip']);assert.equal(result.error,'');assert.equal(result.head.notifications[0].id,'general')}
});

test('one closing consumer cannot cancel a shared head still needed by another',async()=>{
 let drain,firstActive=true,providerReads=0;
 const scheduler=createReadScheduler({schedule:fn=>(drain=fn,1),cancel:()=>{}});
 const reads=createNotificationReads((w,op,value,options)=>scheduler.secondary(async()=>{providerReads++;return page()},options.active));
 const first=reads.request('w','notifications',args,{active:()=>firstActive});
 const rejected=assert.rejects(first,{name:'AbortError'});
 const second=reads.request('w','notifications',args,{active:()=>true});
 await flush();firstActive=false;await drain();await rejected;
 assert.equal((await second).data.notifications[0].id,'fixture');assert.equal(providerReads,1);
});

test('all closing consumers cancel a shared head in the actual read scheduler',async()=>{
 let drain,active=true,providerReads=0;
 const scheduler=createReadScheduler({schedule:fn=>(drain=fn,1),cancel:()=>{}});
 const reads=createNotificationReads((w,op,value,options)=>scheduler.secondary(async()=>{providerReads++;return page()},options.active));
 const first=reads.request('w','notifications',args,{active:()=>active}),second=reads.request('w','notifications',args,{active:()=>active});
 const rejections=Promise.all([assert.rejects(first,{name:'AbortError'}),assert.rejects(second,{name:'AbortError'})]);
 await flush();active=false;await drain();await rejections;assert.equal(providerReads,0);
});

test('history cursors and other categories stay independent; manual refresh bypasses the short cache',async()=>{
 let count=0;const calls=[],reads=createNotificationReads(async(w,op,value)=>{calls.push(value);return page(String(++count),'next-'+count)});
 await reads.request('w','notifications',args);await reads.request('w','notifications',args);
 assert.equal(count,1);
 await reads.request('w','notifications',args,{fresh:true});assert.equal(count,2);
 const cursorArgs={...args,cursor:'history'};
 const [a,b]=await Promise.all([reads.request('w','notifications',cursorArgs),reads.request('w','notifications',cursorArgs)]);
 assert.equal(count,4);assert.notEqual(a.data.cursor,b.data.cursor);assert.equal(calls.filter(value=>value.cursor==='history').length,2);
 await Promise.all([reads.request('w','notifications',{creator_id:'A',type:'subscribed'}),reads.request('w','notifications',{creator_id:'A',type:'subscribed'})]);assert.equal(count,6);
});

test('errors retain status/Retry-After and are never cached',async()=>{
 let count=0;const failure=Object.assign(Error('quota'),{status:429,retryAfter:180});
 const reads=createNotificationReads(async()=>{if(++count===1)throw failure;return page()});
 const first=reads.request('w','notifications',args),second=reads.request('w','notifications',args);
 await Promise.all([assert.rejects(first,error=>error===failure&&error.retryAfter===180),assert.rejects(second,error=>error===failure)]);
 assert.equal(count,1);assert.ok(await reads.request('w','notifications',args));assert.equal(count,2);
});

test('head cache expires after 1.5 seconds and never crosses workspace/model/category/identity',async()=>{
 let time=0,count=0;const request=async()=>page(String(++count)),reads=createNotificationReads(request,{now:()=>time});
 const first=await reads.request('w','notifications',args);time=1500;assert.equal(await reads.request('w','notifications',args),first);
 time=1501;assert.notEqual(await reads.request('w','notifications',args),first);assert.equal(count,2);
 await reads.request('other-workspace','notifications',args);await reads.request('w','notifications',{...args,creator_id:'B'});await reads.request('w','notifications',{...args,type:'tip'});assert.equal(count,5);
 const otherIdentity=createNotificationReads(request,{now:()=>time});await otherIdentity.request('w','notifications',args);assert.equal(count,6);
 reads.clear();await reads.request('w','notifications',args);assert.equal(count,7);
});

test('identity reset rejects late heads and malformed responses are not cached',async()=>{
 let release,count=0;const reads=createNotificationReads(()=>{count++;return new Promise(resolve=>release=resolve)});
 const pending=reads.request('w','notifications',args),rejected=assert.rejects(pending,{name:'AbortError'});await flush();reads.clear();release(page('old-user'));await rejected;
 const next=reads.request('w','notifications',args);await flush();release(page('new-user'));assert.equal((await next).data.notifications[0].id,'new-user');assert.equal(count,2);
 let malformed=0;const invalid=createNotificationReads(async()=>{malformed++;return {data:{}}});await invalid.request('w','notifications',args);await invalid.request('w','notifications',args);assert.equal(malformed,2);
});
