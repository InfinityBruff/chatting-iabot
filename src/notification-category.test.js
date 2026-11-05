import test from 'node:test';
import assert from 'node:assert/strict';
import {createNotificationCategory,createNotificationCategoryCache} from './notification-category.js';
import {createNotificationReads} from './notification-reads.js';
import {createReadScheduler} from './live-read-scheduler.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const row=(id,type='tip')=>({id,type,text:id,createdAt:'2026-11-05T12:00:00Z'});
const page=(rows=[],cursor=null)=>({data:{notifications:rows,cursor,hasMore:!!cursor}});
function clock(){let at=0,next=0;const timers=new Map();return {now:()=>at,schedule:(fn,delay)=>{const id=++next;timers.set(id,{fn,at:at+delay});return id},cancel:id=>timers.delete(id),advance:async ms=>{at+=ms;const ready=[...timers].filter(([,task])=>task.at<=at);for(const [id,task] of ready){timers.delete(id);task.fn()}await flush()},size:()=>timers.size}}
function bus(){const listeners=new Set();return {subscribeInvalidation:listener=>{listeners.add(listener);return()=>listeners.delete(listener)},emit:event=>[...listeners].forEach(fn=>fn(event)),size:()=>listeners.size}}
const make=(options={})=>createNotificationCategory({request:async()=>page(),workspace:'w',scope:'actor-w',ids:['A'],type:'tip',...options});

test('a category renders known matching feed rows immediately without borrowing its general cursor',()=>{
 let calls=0;const reader=make({request:async()=>{calls++;return page()},models:{A:{rows:[row('tip'),row('purchase','paided_message'),row('subscription','subscribed')],cursor:'general-only',hasMore:true,checked:12}}});
 const model=reader.getSnapshot().models.A;assert.deepEqual(model.rows.map(n=>n.id),['tip']);assert.equal(model.cursor,null);assert.equal(model.hasMore,false);assert.equal(model.checked,12);assert.equal(calls,0);
});

test('pure peek of the exact model and category seeds its rows and its own history cursor',()=>{
 const calls=[],reader=make({models:{A:{rows:[row('known')],cursor:'wrong'}},peek:(w,args)=>{calls.push([w,args]);return page([row('exact','unknown-provider-name')],'tip-cursor')}});
 assert.deepEqual(calls,[['w',{creator_id:'A',type:'tip'}]]);assert.deepEqual(reader.getSnapshot().models.A.rows.map(n=>n.id),['known','exact']);assert.equal(reader.getSnapshot().models.A.cursor,'tip-cursor');
 assert.ok(reader.getSnapshot().models.A.rows.every(n=>n.id==='known'||n.category==='tip'));
});

test('models enqueue independently: a slow A cannot withhold B or its 20 second poll',async()=>{
 const time=clock(),calls=[];let release;
 const reader=make({...time,ids:['A','B'],request:async(w,operation,args,options)=>{calls.push([args.creator_id,options.priority]);if(args.creator_id==='A')return new Promise(resolve=>release=resolve);return page([row('B-tip')])}});
 reader.start();await flush();assert.deepEqual(calls,[['A','selected'],['B','selected']]);assert.equal(reader.getSnapshot().models.A.busy,true);assert.equal(reader.getSnapshot().models.B.busy,false);assert.equal(reader.getSnapshot().models.B.rows[0].id,'B-tip');
 await time.advance(19999);assert.equal(calls.length,2);await time.advance(1);assert.deepEqual(calls,[['A','selected'],['B','selected'],['B','selected']]);
 release(page([row('A-tip')]));await flush();assert.equal(reader.getSnapshot().models.A.rows[0].id,'A-tip');reader.stop();assert.equal(time.size(),0);
});

test('filter changes retain known category history and isolated cursors in page memory',async()=>{
 const time=clock(),cache=createNotificationCategoryCache(),calls=[],request=async(w,op,args,options)=>{calls.push({w,...args,priority:options.priority});return args.cursor?page([row('older')],'older-cursor'):page([row('new')],'tip-head')};
 const first=make({...time,cache,request});first.start();await flush();await first.load('A','tip-head');assert.equal(first.getSnapshot().models.A.cursor,'older-cursor');first.stop();
 const purchases=make({...time,cache,request,type:'purchases'});assert.deepEqual(purchases.getSnapshot().models.A.rows,[]);assert.equal(purchases.getSnapshot().models.A.cursor,null);purchases.stop();
 const back=make({...time,cache,request});assert.deepEqual(back.getSnapshot().models.A.rows.map(n=>n.id),['new','older']);assert.equal(back.getSnapshot().models.A.cursor,'older-cursor');back.start();await flush();assert.equal(back.getSnapshot().models.A.cursor,'older-cursor');
 assert.equal(await back.load('A','general-unrelated'),false);assert.equal(calls.length,3);assert.equal(calls[1].cursor,'tip-head');assert.equal(calls[1].priority,'background');back.stop();
 for(const isolation of [{scope:'other-actor'},{workspace:'other-workspace'},{ids:['B']}]){const other=make({...time,cache,request,...isolation});assert.deepEqual(Object.values(other.getSnapshot().models)[0].rows,[]);other.stop()}
});

test('fresh manual refresh retains known rows and cannot bypass RetryAfter, even after changing filters',async()=>{
 const time=clock(),cache=createNotificationCategoryCache(),calls=[];let limited=true;
 const request=async(w,op,args,options)=>{calls.push({...args,fresh:options.fresh});if(limited)throw Object.assign(Error('Wait'),{status:429,retryAfter:45});return page([row('new')])};
 const reader=make({...time,cache,request,models:{A:{rows:[row('known')]}}});reader.start();await flush();assert.equal(reader.getSnapshot().models.A.waiting,true);assert.deepEqual(reader.getSnapshot().models.A.rows.map(n=>n.id),['known']);
 await reader.load();await reader.load('A');assert.equal(calls.length,1);await time.advance(20000);assert.equal(calls.length,1);reader.stop();
 const other=make({...time,cache,request,type:'purchases'});other.start();await flush();await other.load();assert.equal(calls.length,1);await time.advance(24999);assert.equal(calls.length,1);limited=false;await time.advance(1);assert.equal(calls.length,2);assert.equal(calls[1].type,'purchases');
 await other.load();assert.equal(calls.length,3);assert.equal(calls[2].fresh,true);other.stop();
});

test('ordinary errors and malformed pages preserve known rows and permit an explicit retry',async()=>{
 const time=clock();let attempt=0;const reader=make({...time,models:{A:{rows:[row('known')]}},request:async()=>{attempt++;if(attempt===1)throw Object.assign(Error('Service unavailable'),{status:503});if(attempt===2)return {data:{}};return page([row('new')])}});
 reader.start();await flush();assert.match(reader.getSnapshot().models.A.error,/unavailable/);assert.equal(reader.getSnapshot().models.A.rows.length,1);await reader.load();assert.match(reader.getSnapshot().models.A.error,/válida/);assert.equal(reader.getSnapshot().models.A.rows.length,1);await reader.load();assert.equal(reader.getSnapshot().models.A.error,'');assert.equal(reader.getSnapshot().models.A.rows.length,2);reader.stop();
});

test('model denial clears all its category caches and rejects a late result without reseeding revoked feed rows',async()=>{
 const time=clock(),events=bus(),cache=createNotificationCategoryCache();let release,reads=0;
 const first=make({...time,cache,models:{A:{rows:[row('purchase','purchases')]}},type:'purchases'});first.stop();
 const reader=make({...time,...events,cache,models:{A:{rows:[row('known')]}},request:()=>{reads++;return new Promise(resolve=>release=resolve)}});
 reader.start();await flush();events.emit({workspace:'w',model:'A',error:Object.assign(Error('Removed'),{status:403})});assert.deepEqual(reader.getSnapshot().models.A.rows,[]);assert.equal(reader.getSnapshot().models.A.cursor,null);assert.equal(reader.getSnapshot().models.A.denied,true);
 reader.setModels({A:{rows:[row('stale-general')],denied:true,version:1}});release(page([row('late-old')],'old-cursor'));await flush();assert.deepEqual(reader.getSnapshot().models.A.rows,[]);reader.stop();
 let peeks=0;const other=make({...time,cache,type:'purchases',models:{A:{rows:[row('stale','purchases')],denied:true}},peek:()=>{peeks++;return page([row('peek-stale')])},request:async()=>page([row('reauthorized')])});assert.deepEqual(other.getSnapshot().models.A.rows,[]);assert.equal(peeks,0);other.start();await flush();assert.equal(other.getSnapshot().models.A.rows[0].id,'reauthorized');assert.equal(other.getSnapshot().models.A.denied,false);other.stop();assert.equal(reads,1);
});

test('denial invalidation also clears a cached model that is not currently selected',()=>{
 const time=clock(),events=bus(),cache=createNotificationCategoryCache(),b=make({...time,cache,ids:['B'],models:{B:{rows:[row('B-private')]}}});b.stop();
 const a=make({...time,...events,cache});a.start();events.emit({workspace:'another-workspace',model:'B'});const unchanged=make({...time,cache,ids:['B']});assert.equal(unchanged.getSnapshot().models.B.rows.length,1);unchanged.stop();
 events.emit({workspace:'w',model:'B'});const denied=make({...time,cache,ids:['B'],models:{B:{rows:[row('B-stale')]}}});assert.deepEqual(denied.getSnapshot().models.B.rows,[]);assert.equal(denied.getSnapshot().models.B.denied,true);denied.stop();a.stop();
});

test('a denial while viewing Todos or only A cannot resurrect old B rows after the feed has reauthorized B',()=>{
 for(const current of [{type:''},{ids:['A']},{type:'',all:true}]){
  const time=clock(),events=bus(),cache=createNotificationCategoryCache();
  const previous=make({...time,cache,ids:['B'],models:{B:{rows:[row('B-private')],denied:false}}});previous.stop();
  const view=make({...time,...events,cache,...current});view.start();
  events.emit(current.all?{all:true}:{workspace:'w',model:'B',error:Object.assign(Error('Revoked B'),{status:403})});
  // Global feed may authorize B again before the user revisits this filter.
  // That does not authorize resurrecting the old category cache or its cursor.
  const revisit=make({...time,cache,ids:['B'],models:{B:{rows:[],denied:false,version:2}},peek:()=>null});
  assert.deepEqual(revisit.getSnapshot().models.B.rows,[]);assert.equal(revisit.getSnapshot().models.B.cursor,null);assert.equal(revisit.getSnapshot().models.B.hasMore,false);
  assert.ok([...cache.entries.values()].every(entry=>!entry.value.rows.some(n=>n.id==='B-private')));
  revisit.stop();view.stop();
 }
});

test('direct denied responses invoke fallback once and clear rows; another model remains usable',async()=>{
 const time=clock(),denials=[],reader=make({...time,ids:['A','B'],models:{A:{rows:[row('private')]}},onDenied:(...args)=>denials.push(args),request:async(w,op,args)=>{if(args.creator_id==='A')throw Object.assign(Error('No access'),{status:403});return page([row('B-tip')])}});
 reader.start();await flush();assert.equal(denials.length,1);assert.equal(denials[0][0],'w');assert.equal(denials[0][1],'A');assert.deepEqual(reader.getSnapshot().models.A.rows,[]);assert.equal(reader.getSnapshot().models.A.hasMore,false);assert.equal(reader.getSnapshot().models.B.rows.length,1);reader.stop();
});

test('new authorized feed events seed a category without restarting reads or replacing its exact cursor',async()=>{
 const time=clock();let calls=0;const reader=make({...time,request:async()=>{calls++;return page([row('own')],'exact')}});reader.start();await flush();reader.setModels({A:{rows:[row('new'),row('purchase','purchases')],cursor:'general'}});assert.equal(calls,1);assert.deepEqual(reader.getSnapshot().models.A.rows.map(n=>n.id),['new','own']);assert.equal(reader.getSnapshot().models.A.cursor,'exact');reader.stop();
});

test('invalid repeating category cursors retain known rows but never expose a broken history action',async()=>{
 const time=clock(),reader=make({...time,request:async(w,op,args)=>page([row(args.cursor?'older':'head')],'same')});reader.start();await flush();await reader.load('A','same');const model=reader.getSnapshot().models.A;assert.equal(model.hasMore,false);assert.equal(model.cursor,null);assert.match(model.error,/cursor válido/);assert.equal(model.rows.length,2);reader.stop();
});

test('StrictMode stop/start invalidates old tokens, removes subscriptions and timers, and ignores late results',async()=>{
 const time=clock(),events=bus(),pending=[];const reader=make({...time,...events,request:(w,op,args,options)=>new Promise(resolve=>pending.push({resolve,options}))});reader.start();await flush();assert.equal(events.size(),1);assert.equal(pending.length,1);reader.stop();assert.equal(events.size(),0);assert.equal(pending[0].options.active(),false);reader.start();await flush();assert.equal(events.size(),1);assert.equal(pending.length,2);pending[0].resolve(page([row('old')]));await flush();assert.deepEqual(reader.getSnapshot().models.A.rows,[]);pending[1].resolve(page([row('current')]));await flush();assert.equal(reader.getSnapshot().models.A.rows[0].id,'current');assert.equal(time.size(),1);reader.stop();assert.equal(time.size(),0);assert.equal(events.size(),0);
});

test('empty/general filters make no category requests, peeks or polling timers',async()=>{
 const time=clock();let calls=0,peeks=0;const reader=make({...time,type:'',request:async()=>{calls++;return page()},peek:()=>{peeks++}});reader.start();await flush();await reader.load();await time.advance(20000);assert.deepEqual(reader.getSnapshot().models,{});assert.equal(calls,0);assert.equal(peeks,0);assert.equal(time.size(),0);reader.stop();
});

test('the real core shares a UI head with the global feed and denies both without a second callback or late repopulation',async()=>{
 const time=clock(),denials=[],releases=[];let count=0;
 const core=createNotificationReads((w,op,args,options)=>{options.onStart?.();count++;return new Promise((resolve,reject)=>releases.push({resolve,reject}))},{now:time.now,onDenied:(...args)=>denials.push(args)});
 const reader=make({...time,request:core.request,peek:core.peek,subscribeInvalidation:core.subscribeInvalidation,models:{A:{rows:[row('known')]}},onDenied:()=>assert.fail('core already owns denial')});
 const global=core.request('w','notifications',{creator_id:'A',type:'tip'}),globalRejected=assert.rejects(global,error=>error.status===403);
 reader.start();await flush();assert.equal(count,1);releases[0].reject(Object.assign(Error('Revoked'),{status:403}));await globalRejected;await flush();assert.equal(denials.length,1);assert.deepEqual(reader.getSnapshot().models.A.rows,[]);assert.equal(reader.getSnapshot().models.A.denied,true);assert.equal(core.peek('w',{creator_id:'A',type:'tip'}),null);
 const renewed=reader.load();await flush();assert.equal(count,2);releases[1].resolve(page([row('renewed')],'renewed-cursor'));await renewed;assert.equal(reader.getSnapshot().models.A.rows[0].id,'renewed');assert.equal(reader.getSnapshot().models.A.denied,false);reader.stop();core.clear();
});

test('selected UI heads stay secondary and the actual scheduler dispatches a conversation first',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,maxConcurrent:2}),order=[];
 const core=createNotificationReads((w,op,args,options)=>scheduler.secondary(async()=>{options.onStart?.();order.push(args.creator_id);return page([row(args.creator_id)])},options.active,options.priority),{now:time.now});
 const reader=make({...time,ids:['A','B'],request:core.request,subscribeInvalidation:core.subscribeInvalidation});reader.start();await flush();assert.deepEqual(order,[]);
 const conversation=scheduler.primary(async()=>order.push('conversation'),()=>true,'conversation');await conversation;assert.deepEqual(order,['conversation']);await time.advance(200);assert.deepEqual(order,['conversation','A']);await time.advance(2500);assert.deepEqual(order,['conversation','A','B']);reader.stop();core.clear();
});
