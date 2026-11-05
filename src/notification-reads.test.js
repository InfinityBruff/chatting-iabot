import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationReads} from './notification-reads.js';
import {collectNotificationUpdates} from './notification-poll.js';
import {createReadScheduler} from './live-read-scheduler.js';
import {scheduleLiveRead} from './live-read-priority.js';
import {notificationCategories} from './notification-presentation.js';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const page=(id='fixture',cursor=null)=>({data:{notifications:[{id,createdAt:'2026-11-03T12:00:00Z'}],cursor,hasMore:false}});
const args={creator_id:'A',type:'purchases'};

test('real notification collectors share general, purchase and tip heads and keep all results',async()=>{
 const calls=[],reads=createNotificationReads(async(w,op,value)=>{calls.push(value);return page(value.type||'general')});
 const collect=()=>collectNotificationUpdates({known:new Set(),baseline:0,request:value=>reads.request('w','notifications',{creator_id:'A',...value})});
 const [first,second]=await Promise.all([collect(),collect()]);
 assert.equal(calls.filter(value=>value.type==='purchases').length,1);
 assert.equal(calls.filter(value=>value.type==='tip').length,1);
 assert.equal(calls.filter(value=>!value.type).length,1);
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

test('history cursors stay independent; every valid category shares heads and manual refresh bypasses the short cache',async()=>{
 let count=0;const calls=[],reads=createNotificationReads(async(w,op,value)=>{calls.push(value);return page(String(++count),'next-'+count)});
 await reads.request('w','notifications',args);await reads.request('w','notifications',args);
 assert.equal(count,1);
 await reads.request('w','notifications',args,{fresh:true});assert.equal(count,2);
 const cursorArgs={...args,cursor:'history'};
 const [a,b]=await Promise.all([reads.request('w','notifications',cursorArgs),reads.request('w','notifications',cursorArgs)]);
 assert.equal(count,4);assert.notEqual(a.data.cursor,b.data.cursor);assert.equal(calls.filter(value=>value.cursor==='history').length,2);
 await Promise.all([reads.request('w','notifications',{creator_id:'A',type:'subscribed'}),reads.request('w','notifications',{creator_id:'A',type:'subscribed'})]);assert.equal(count,5);
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

const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function clock(){let at=0,id=0;const tasks=new Map();return {now:()=>at,schedule:(fn,delay)=>{tasks.set(++id,{fn,at:at+delay});return id},cancel:id=>tasks.delete(id),flush:async()=>{const task=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!task)return;tasks.delete(task[0]);at=Math.max(at,task[1].at);await task[1].fn()}}}

test('general spellings and all valid filters singleflight; unsupported filters and every cursor remain independent',async()=>{
 const calls=[],reads=createNotificationReads(async(w,op,args,options)=>{options.onStart?.();calls.push(args);return page(args.type||'general')});
 await Promise.all([reads.request('w','notifications',{creator_id:'A'}),reads.request('w','notifications',{creator_id:'A',type:''}),reads.request('w','notifications',{creator_id:'A',cursor:null})]);
 assert.equal(calls.length,1);assert.equal(reads.peek('w',{creator_id:'A',type:''}),reads.peek('w',{creator_id:'A'}));
 for(const type of Object.keys(notificationCategories))await Promise.all([reads.request('w','notifications',{creator_id:'A',type}),reads.request('w','notifications',{creator_id:'A',type})]);
 assert.equal(calls.length,1+Object.keys(notificationCategories).length);
 const before=calls.length;await Promise.all([reads.request('w','notifications',{...args,type:'unsupported'}),reads.request('w','notifications',{...args,type:'unsupported'}),reads.request('w','notifications',{...args,cursor:''}),reads.request('w','notifications',{...args,cursor:''})]);
 assert.equal(calls.length,before+4);assert.equal(reads.peek('w',{...args,type:'unsupported'}),null);assert.equal(reads.peek('w',{...args,cursor:''}),null);
});

test('display seeds survive sixty seconds without extending the 1.5 second request TTL or triggering reads',async()=>{
 let time=0,count=0;const reads=createNotificationReads(async()=>page(String(++count)),{now:()=>time});
 const first=await reads.request('w','notifications',args);time=1501;
 assert.equal(reads.peek('w',args),first);assert.equal(count,1);
 assert.equal(reads.peek('other',args),null);assert.equal(reads.peek('w',{...args,creator_id:'B'}),null);assert.equal(reads.peek('w',{...args,type:'tip'}),null);
 const second=await reads.request('w','notifications',args);assert.notEqual(second,first);assert.equal(count,2);
 time=61501;assert.equal(reads.peek('w',args),second);time++;assert.equal(reads.peek('w',args),null);assert.equal(count,2);
 const otherActor=createNotificationReads(async()=>page('other'),{now:()=>time});assert.equal(otherActor.peek('w',args),null);
});

test('peek keeps a confirmed seed during manual refresh and never changes admission or reports invalidation',async()=>{
 const pending=deferred(),events=[];let count=0,admission;
 const reads=createNotificationReads(async(w,op,value,options)=>{count++;admission=options;options.onStart();return count===1?page('old'):pending.promise});
 reads.subscribeInvalidation(event=>events.push(event));const old=await reads.request('w','notifications',args),fresh=reads.request('w','notifications',args,{fresh:true});
 await flush();assert.equal(reads.peek('w',args),old);assert.equal(count,2);assert.equal(admission.active(),true);assert.deepEqual(events,[]);
 pending.resolve(page('new'));assert.equal((await fresh).data.notifications[0].id,'new');assert.notEqual(reads.peek('w',args),old);
});

test('retained heads have bounded LRU entries and bytes and oversized responses are never retained',async()=>{
 let count=0;const reads=createNotificationReads(async()=>page(String(++count)),{maxEntries:2});
 await reads.request('w','notifications',args);await reads.request('w','notifications',{...args,type:'tip'});reads.peek('w',args);await reads.request('w','notifications',{...args,type:'subscribed'});
 assert.ok(reads.peek('w',args));assert.equal(reads.peek('w',{...args,type:'tip'}),null);assert.ok(reads.peek('w',{...args,type:'subscribed'}));
 const small=createNotificationReads(async()=>page('large-payload'),{maxBytes:10});assert.ok(await small.request('w','notifications',args));assert.equal(small.peek('w',args),null);
});

test('actual scheduler keeps chat first and promotes one queued shared head ahead of unrelated background work',async()=>{
 const time=clock(),events=[],admissions=[],starts=[];
 const scheduler=createReadScheduler({...time,startupGrace:100,settleMs:0,backgroundInterval:0,minimumGap:0,maxConcurrent:1});
 const reads=createNotificationReads((w,op,value,options)=>{admissions.push(options);return scheduleLiveRead(scheduler,op,async()=>{events.push(value.creator_id);options.onStart();return page(value.creator_id)},options,value)});
 const unrelated=reads.request('w','notifications',{...args,creator_id:'B'}),background=reads.request('w','notifications',args,{onStart:()=>starts.push('background')});
 await flush();const oldAdmission=admissions[1];assert.equal(events.length,0);
 const selected=reads.request('w','notifications',args,{priority:'selected',onStart:()=>starts.push('selected')});
 const chat=scheduleLiveRead(scheduler,'messages',async()=>{events.push('conversation');return 'chat'}, {priority:'conversation'},{});
 assert.equal(await chat,'chat');await flush();assert.equal(oldAdmission.active(),false);oldAdmission.onStart();assert.deepEqual(starts,[]);
 await time.flush();const [a,b]=await Promise.all([background,selected]);await unrelated;
 assert.equal(a,b);assert.deepEqual(events,['conversation','A','B']);assert.deepEqual(starts,['background','selected']);assert.equal(events.filter(value=>value==='A').length,1);
});

test('a selected consumer joins an HTTP read already started without replay or losing either onStart',async()=>{
 const pending=deferred(),starts=[];let calls=0;
 const scheduler=createReadScheduler({settleMs:0,backgroundInterval:0,minimumGap:0});
 const reads=createNotificationReads((w,op,value,options)=>scheduleLiveRead(scheduler,op,()=>{calls++;options.onStart();return pending.promise},options,value));
 const first=reads.request('w','notifications',args,{onStart:()=>starts.push('first')});await flush();assert.equal(calls,1);
 const second=reads.request('w','notifications',args,{priority:'selected',onStart:()=>starts.push('second')});await flush();assert.equal(calls,1);assert.deepEqual(starts,['first','second']);
 pending.resolve(page());assert.equal(await first,await second);assert.equal(calls,1);
});

test('late callbacks and denial from a replaced queued attempt cannot clear the promoted result',async()=>{
 const attempts=[],denials=[],reads=createNotificationReads((w,op,value,options)=>{const pending=deferred();attempts.push({...pending,options});return pending.promise},{onDenied:(...event)=>denials.push(event)});
 const first=reads.request('w','notifications',args);await flush();const selected=reads.request('w','notifications',args,{priority:'selected'});await flush();assert.equal(attempts.length,2);
 attempts[1].options.onStart();attempts[1].resolve(page('promoted'));await Promise.all([first,selected]);attempts[0].options.onStart();attempts[0].reject(Object.assign(Error('old denial'),{status:403}));await flush();
 assert.equal(reads.peek('w',args).data.notifications[0].id,'promoted');assert.deepEqual(denials,[]);
});

test('one model denial revokes all its heads and old parallel responses, while other models and later revalidation stay independent',async()=>{
 const pending=new Map(),denials=[],events=[];let revalidating=false;
 const reads=createNotificationReads(async(w,op,value,options)=>{options.onStart();if(revalidating)return page('revalidated');if(value.type==='commented')return page('cached');const job=deferred();pending.set(value.creator_id+':'+(value.type||'all'),job);return job.promise},{onDenied:(...event)=>denials.push(event)});
 reads.subscribeInvalidation(event=>events.push(event));await reads.request('w','notifications',{...args,type:'commented'});
 const first=reads.request('w','notifications',{creator_id:'A'}),purchase=reads.request('w','notifications',args),tip=reads.request('w','notifications',{...args,type:'tip'}),other=reads.request('w','notifications',{...args,creator_id:'B'});
 const rejected=Promise.all([assert.rejects(first,error=>error.status===403),assert.rejects(purchase,{name:'AbortError'}),assert.rejects(tip,{name:'AbortError'})]);await flush();
 pending.get('A:all').reject(Object.assign(Error('revoked'),{status:403}));await rejected;assert.equal(denials.length,1);assert.equal(events.length,1);assert.equal(events[0].model,'A');assert.equal(reads.peek('w',{...args,type:'commented'}),null);
 pending.get('A:purchases').resolve(page('old-purchase'));pending.get('A:tip').reject(Object.assign(Error('old-revoked'),{status:401}));pending.get('B:purchases').resolve(page('other-model'));await other;await flush();
 assert.equal(reads.peek('w',args),null);assert.equal(reads.peek('w',{...args,type:'tip'}),null);assert.equal(denials.length,1);assert.equal(reads.peek('w',{...args,creator_id:'B'}).data.notifications[0].id,'other-model');
 revalidating=true;assert.equal((await reads.request('w','notifications',args)).data.notifications[0].id,'revalidated');assert.ok(reads.peek('w',args));
});

test('cursor denials also invalidate every model category; clear emits only all-scope invalidation without an auth denial',async()=>{
 const denials=[],events=[],reads=createNotificationReads(async(w,op,value)=>{if(value.cursor)throw Object.assign(Error('cursor denied'),{status:401});return page()},{onDenied:(...event)=>denials.push(event)});
 const unsubscribe=reads.subscribeInvalidation(event=>events.push(event));await reads.request('w','notifications',args);await reads.request('w','notifications',{...args,type:'tip'});
 await assert.rejects(reads.request('w','notifications',{...args,cursor:'history'}),error=>error.status===401);assert.equal(reads.peek('w',args),null);assert.equal(reads.peek('w',{...args,type:'tip'}),null);assert.equal(denials.length,1);
 await reads.request('w','notifications',args);reads.clear();assert.deepEqual(events.at(-1),{all:true});assert.equal(denials.length,1);assert.equal(reads.peek('w',args),null);unsubscribe();reads.invalidate('w','A');assert.equal(events.length,2);
});

test('promotion cannot bypass a hard scheduler cooldown or shorten its existing deadline',async()=>{
 const time=clock(),calls=[],scheduler=createReadScheduler({...time,settleMs:0,backgroundInterval:0,minimumGap:0});scheduler.block(12);
 const reads=createNotificationReads((w,op,value,options)=>scheduleLiveRead(scheduler,op,()=>{options.onStart();calls.push(time.now());return page()},options,value));
 const first=reads.request('w','notifications',args);await flush();const selected=reads.request('w','notifications',args,{priority:'selected',fresh:true});await flush();
 assert.deepEqual(calls,[]);await time.flush();assert.equal(await first,await selected);assert.deepEqual(calls,[12000]);
});

test('aborting one consumer signal does not abort a shared started head required by another scope consumer',async()=>{
 const pending=deferred(),controller=new AbortController();let underlying;
 const reads=createNotificationReads(async(w,op,value,options)=>{underlying=options;options.onStart();return pending.promise});
 const first=reads.request('w','notifications',args,{signal:controller.signal}),rejected=assert.rejects(first,{name:'AbortError'});await flush();
 const second=reads.request('w','notifications',args);controller.abort();assert.equal(underlying.signal,undefined);assert.equal(underlying.active(),true);
 pending.resolve(page('shared'));await rejected;assert.equal((await second).data.notifications[0].id,'shared');assert.ok(reads.peek('w',args));
});

test('a current head denial after its last consumer closes still revokes all categories without publishing to the closed caller',async()=>{
 const pending=deferred(),denials=[];let shown=true;
 const reads=createNotificationReads(async(w,op,value,options)=>{options.onStart?.();return value.type==='commented'?pending.promise:page('confirmed-tip')},{onDenied:(...event)=>denials.push(event)});
 await reads.request('w','notifications',{...args,type:'tip'});assert.ok(reads.peek('w',{...args,type:'tip'}));
 const closing=reads.request('w','notifications',{...args,type:'commented'},{active:()=>shown}),rejected=assert.rejects(closing,{name:'AbortError'});await flush();shown=false;
 pending.reject(Object.assign(Error('Current permission revoked'),{status:403}));await rejected;
 assert.equal(denials.length,1);assert.equal(denials[0][1],'A');assert.equal(reads.peek('w',{...args,type:'tip'}),null);assert.equal(reads.peek('w',{...args,type:'commented'}),null);
});

test('a current independent cursor denial after close revokes heads but old-epoch cursor denial cannot revoke a newer session',async()=>{
 for(const reset of [false,true]){
  const pending=deferred(),denials=[];let shown=true;
  const reads=createNotificationReads(async(w,op,value)=>value.cursor?pending.promise:page('confirmed-tip'),{onDenied:(...event)=>denials.push(event)});
  await reads.request('w','notifications',{...args,type:'tip'});
  const closing=reads.request('w','notifications',{...args,cursor:'history'},{active:()=>shown}),rejected=assert.rejects(closing,{name:'AbortError'});await flush();shown=false;
  if(reset){reads.clear();await reads.request('w','notifications',{...args,type:'tip'})}
  pending.reject(Object.assign(Error('Cursor permission revoked'),{status:401}));await rejected;
  assert.equal(denials.length,reset?0:1);assert.equal(!!reads.peek('w',{...args,type:'tip'}),reset);
 }
});
