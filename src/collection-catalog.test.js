import test from 'node:test';
import assert from 'node:assert/strict';
import {createCollectionCatalog} from './collection-catalog.js';
import {createReadScheduler} from './live-read-scheduler.js';
import {scheduleLiveRead} from './live-read-priority.js';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const list=(id,extra={})=>({id,name:id,type:'custom',usersCount:3,canUpdate:true,users:[{id:'123',name:'Fixture'}],...extra});
const page=(lists=[],cursor=null)=>({data:{lists,cursor,hasMore:!!cursor}});
function clock(){let at=1000,id=0;const tasks=new Map();return {now:()=>at,schedule:(fn,delay)=>{const key=++id;tasks.set(key,{fn,at:at+delay});return key},cancel:key=>tasks.delete(key),advance:ms=>at+=ms,nextAt:()=>tasks.size?Math.min(...[...tasks.values()].map(task=>task.at)):null,count:()=>tasks.size,fire:async()=>{const next=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!next)return false;tasks.delete(next[0]);at=Math.max(at,next[1].at);next[1].fn();await flush();return true}}}
function fixture(options={}){const time=clock(),calls=[];let shown=true,epoch=0;const reader=createCollectionCatalog({actor:'actor',workspace:'workspace',account:'A',...time,visible:()=>shown,cacheEpoch:()=>epoch,...options,request:async(...args)=>{calls.push(args);return options.request?options.request(...args):page()}});return {reader,time,calls,show:value=>shown=value,epoch:value=>epoch=value}}

test('only a complete explicit scope can start a catalog; constructing one performs no reads',()=>{
 for(const field of ['actor','workspace','account'])assert.throws(()=>createCollectionCatalog({actor:'u',workspace:'w',account:'a',request:()=>{},[field]:''}),TypeError);
 const f=fixture();assert.equal(f.calls.length,0);assert.equal(f.time.count(),0);assert.deepEqual(f.reader.getSnapshot().rows,[]);assert.equal(f.reader.getSnapshot().complete,false);
});

test('all native pages load automatically, progressively preserving exact model cursors, provider order and metadata',async()=>{
 const first=list('all',{type:'system',canAddUsers:false}),second=list('custom'),third=list('old');const f=fixture({request:async(w,op,args)=>args.cursor==='p2'?page([second,third]):page([first,second],'p2')});
 f.reader.start();await f.time.fire();assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['all','custom']);assert.equal(f.reader.getSnapshot().complete,false);assert.deepEqual(f.reader.getSnapshot().rows[0],first);assert.equal(f.time.nextAt(),2000);
 await f.time.fire();assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['all','custom','old']);assert.equal(f.reader.getSnapshot().complete,true);assert.equal(f.reader.getSnapshot().pages,2);assert.equal(f.reader.getSnapshot().checked,2000);
 assert.deepEqual(f.calls.map(([w,op,args])=>[w,op,args]),[['workspace','collections',{creator_id:'A'}],['workspace','collections',{creator_id:'A',cursor:'p2'}]]);assert.ok(f.calls.every(call=>call[3].signal instanceof AbortSignal));f.reader.stop();assert.equal(f.time.count(),0);
});

test('refresh keeps old known rows until validated EOF, then removes absent lists and restores new provider order',async()=>{
 let phase=0;const f=fixture({request:async(w,op,args)=>phase===0?page([list('removed'),list('keep',{name:'Old'})]):args.cursor?page([list('new'),list('keep',{name:'New'})]):page([list('new')],'next')});
 f.reader.start();await f.time.fire();assert.equal(f.reader.getSnapshot().complete,true);phase=1;assert.equal(f.reader.refresh(),true);assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['removed','keep']);await f.time.fire();assert.equal(f.reader.getSnapshot().complete,false);assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['new','removed','keep']);
 await f.time.fire();assert.equal(f.reader.getSnapshot().complete,true);assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['new','keep']);assert.equal(f.reader.getSnapshot().rows[1].name,'New');f.reader.stop();
});

test('a validated empty refresh removes old lists instead of retaining deleted collections forever',async()=>{
 let calls=0;const f=fixture({request:async()=>++calls===1?page([list('removed')]):page()});f.reader.start();await f.time.fire();assert.equal(f.reader.getSnapshot().rows.length,1);assert.equal(f.time.nextAt(),31000);await f.time.fire();assert.equal(f.calls.length,2);assert.deepEqual(f.reader.getSnapshot().rows,[]);assert.equal(f.reader.getSnapshot().complete,true);f.reader.stop();
});

test('rate limiting preserves the pending cursor and RetryAfter cannot be bypassed by manual refresh or visibility',async()=>{
 let limited=true;const f=fixture({request:async(w,op,args)=>{if(args.cursor&&limited)throw Object.assign(Error('Quota'),{status:429,retryAfter:90});return args.cursor?page([list('second')]):page([list('first')],'next')}});f.reader.start();await f.time.fire();await f.time.fire();assert.equal(f.time.nextAt(),92000);assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['first']);assert.equal(f.reader.getSnapshot().waiting,true);
 f.show(false);f.reader.recheckVisibility();f.time.advance(10000);f.show(true);f.reader.recheckVisibility();assert.equal(f.time.nextAt(),92000);assert.equal(f.calls.length,2);limited=false;await f.time.fire();assert.equal(f.calls.at(-1)[2].cursor,'next');assert.equal(f.reader.getSnapshot().complete,true);
 f.reader.stop();const manual=fixture({request:async()=>{throw Object.assign(Error('Quota'),{status:429,retryAfter:45})}});manual.reader.start();await manual.time.fire();manual.reader.refresh();manual.reader.refresh();assert.equal(manual.time.nextAt(),46000);assert.equal(manual.calls.length,1);manual.reader.stop();
});

test('partial refresh errors retain old rows, retry the same cursor and never claim the catalog is complete',async()=>{
 let phase=0,failed=false;const f=fixture({request:async(w,op,args)=>{if(!phase)return page([list('old')]);if(!args.cursor)return page([list('new')],'next');if(!failed){failed=true;throw Object.assign(Error('Service unavailable'),{status:503})}return page([list('newer')])}});f.reader.start();await f.time.fire();phase=1;f.reader.refresh();await f.time.fire();await f.time.fire();assert.equal(f.reader.getSnapshot().complete,false);assert.match(f.reader.getSnapshot().error,/unavailable/);assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['new','old']);await f.time.fire();assert.equal(f.calls.at(-1)[2].cursor,'next');assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['new','newer']);assert.equal(f.reader.getSnapshot().complete,true);f.reader.stop();
});

test('missing or repeated cursors block a partial traversal without looping or claiming completion',async()=>{
 for(const invalid of [null,'repeat']){const f=fixture({request:async(w,op,args)=>args.cursor?{data:{lists:[list('second')],hasMore:true,cursor:invalid}}:page([list('first')],'repeat')});f.reader.start();await f.time.fire();await f.time.fire();assert.equal(f.reader.getSnapshot().complete,false);assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['first']);assert.match(f.reader.getSnapshot().error,/cursor/);assert.equal(f.time.count(),0);assert.equal(f.calls.length,2);f.reader.stop()}
});

test('malformed pages and invalid IDs retain known collections and do not fabricate a verified empty catalog',async()=>{
 for(const response of [{data:{}},{data:{lists:[],hasMore:'false'}},{data:{lists:[{id:null}],hasMore:false}},{data:{lists:[{id:'../bad'}],hasMore:false}}]){let initial=true;const f=fixture({request:async()=>initial?page([list('known')]):response});f.reader.start();await f.time.fire();initial=false;f.reader.refresh();await f.time.fire();assert.deepEqual(f.reader.getSnapshot().rows.map(row=>row.id),['known']);assert.equal(f.reader.getSnapshot().complete,false);assert.match(f.reader.getSnapshot().error,/parcial/);assert.equal(f.time.count(),0);f.reader.stop()}
});

test('item, byte and page bounds stop explicitly with partial data, never silently truncate a complete catalog',async()=>{
 for(const options of [{maxLists:1},{maxBytes:350},{maxPages:1}]){const f=fixture({...options,request:async(w,op,args)=>args.cursor?page([list('second',{name:'x'.repeat(300)})]):page([list('first')],'next')});f.reader.start();await f.time.fire();if(f.time.count())await f.time.fire();assert.equal(f.reader.getSnapshot().complete,false);assert.match(f.reader.getSnapshot().error,/límite/);assert.ok(f.reader.getSnapshot().rows.length<=1);assert.equal(f.time.count(),0);f.reader.stop()}
});

test('only one request can run: refresh invalidates a pre-mutation response and starts a fresh walk after settlement',async()=>{
 let release;const f=fixture({request:()=>new Promise(resolve=>release=resolve)});f.reader.start();await f.time.fire();assert.equal(f.reader.getSnapshot().busy,true);assert.equal(f.reader.refresh(),true);assert.equal(f.calls[0][3].active(),false);assert.equal(f.calls[0][3].signal.aborted,true);assert.equal(f.time.count(),0);f.reader.refresh();assert.equal(f.calls.length,1);
 release(page([list('stale-before-write')]));await flush();assert.deepEqual(f.reader.getSnapshot().rows,[]);await f.time.fire();assert.equal(f.calls.length,2);release(page([list('fresh-after-write')]));await flush();assert.equal(f.reader.getSnapshot().rows[0].id,'fresh-after-write');assert.equal(f.reader.getSnapshot().complete,true);f.reader.stop();
});

test('hidden or disabled pages pause traversal and resume their exact cursor without dropping known rows',async()=>{
 const f=fixture({request:async(w,op,args)=>args.cursor?page([list('second')]):page([list('first')],'next')});f.show(false);f.reader.start();assert.equal(f.time.count(),0);f.show(true);f.reader.recheckVisibility();await f.time.fire();f.show(false);f.reader.recheckVisibility();assert.equal(f.time.count(),0);assert.equal(f.reader.getSnapshot().rows.length,1);f.time.advance(100000);f.reader.recheckVisibility();assert.equal(f.calls.length,1);f.show(true);f.reader.recheckVisibility();await f.time.fire();assert.equal(f.calls.at(-1)[2].cursor,'next');assert.equal(f.reader.getSnapshot().complete,true);f.reader.stop();
});

test('a response cancelled by hiding cannot populate rows, and a later 429 still preserves its deadline',async()=>{
 let reject,release;const f=fixture({request:()=>new Promise((yes,no)=>{release=yes;reject=no})});f.reader.start();await f.time.fire();f.show(false);f.reader.recheckVisibility();release(page([list('hidden')]));await flush();assert.deepEqual(f.reader.getSnapshot().rows,[]);f.show(true);f.reader.recheckVisibility();await f.time.fire();f.show(false);f.reader.recheckVisibility();reject(Object.assign(Error('Quota'),{status:429,retryAfter:60}));await flush();f.show(true);f.reader.recheckVisibility();assert.equal(f.time.nextAt(),61000);assert.equal(f.calls.length,2);f.reader.stop();
});

test('403 clears every row and remains terminal through refresh, visibility and StrictMode restarts',async()=>{
 let forbidden=false,denials=0;const f=fixture({onDenied:()=>denials++,request:async()=>{if(forbidden)throw Object.assign(Error('No access'),{status:403});return page([list('private')])}});f.reader.start();await f.time.fire();forbidden=true;f.reader.refresh();await f.time.fire();assert.deepEqual(f.reader.getSnapshot().rows,[]);assert.equal(f.reader.getSnapshot().checked,null);assert.equal(f.reader.getSnapshot().denied,true);assert.equal(denials,1);assert.equal(f.reader.refresh(),false);f.show(false);f.reader.recheckVisibility();f.show(true);f.reader.recheckVisibility();f.reader.stop();f.reader.start();assert.equal(f.time.count(),0);assert.equal(f.calls.length,2);
});

test('explicit detail denial clears an in-flight catalog; late success cannot restore any row or cursor',async()=>{
 let release,denials=0;const f=fixture({onDenied:()=>denials++,request:()=>new Promise(resolve=>release=resolve)});f.reader.start();await f.time.fire();f.reader.deny(Error('Detail revoked'));assert.equal(f.reader.getSnapshot().denied,true);assert.equal(f.calls[0][3].active(),false);release(page([list('late-private')],'next'));await flush();assert.deepEqual(f.reader.getSnapshot().rows,[]);assert.equal(f.time.count(),0);f.reader.invalidate('Again');assert.equal(denials,1);f.reader.stop();
});

test('cache-epoch changes deny old data while a new actor/model owns an independent catalog',async()=>{
 let release;const old=fixture({request:()=>new Promise(resolve=>release=resolve)});old.reader.start();await old.time.fire();old.epoch(1);release(page([list('old-private')]));await flush();assert.deepEqual(old.reader.getSnapshot().rows,[]);assert.equal(old.reader.getSnapshot().denied,true);assert.equal(old.time.count(),0);
 const next=fixture({actor:'new-actor',workspace:'other-workspace',account:'B',request:async()=>page([list('new-model')])});next.reader.start();await next.time.fire();assert.equal(next.calls[0][0],'other-workspace');assert.equal(next.calls[0][2].creator_id,'B');assert.deepEqual(next.reader.getSnapshot().rows.map(row=>row.id),['new-model']);old.reader.stop();next.reader.stop();
});

test('teardown and StrictMode keep one in-flight read, discard old results and remove every timer',async()=>{
 let release;const f=fixture({request:()=>new Promise(resolve=>release=resolve)});f.reader.start();await f.time.fire();f.reader.stop();f.reader.start();assert.equal(f.calls.length,1);assert.equal(f.time.count(),0);release(page([list('old')]));await flush();assert.deepEqual(f.reader.getSnapshot().rows,[]);await f.time.fire();assert.equal(f.calls.length,2);release(page([list('current')]));await flush();assert.equal(f.reader.getSnapshot().rows[0].id,'current');f.reader.stop();assert.equal(f.time.count(),0);
 const late=fixture({request:()=>new Promise(resolve=>release=resolve)});late.reader.start();await late.time.fire();late.reader.stop();late.epoch(1);release(page([list('closed')]));await flush();assert.deepEqual(late.reader.getSnapshot().rows,[]);assert.equal(late.time.count(),0);
});

test('the actual scheduler keeps catalog pages secondary and lets an open conversation run first',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,maxConcurrent:2}),order=[];const reader=createCollectionCatalog({actor:'u',workspace:'w',account:'a',...time,request:(w,op,args,options)=>scheduleLiveRead(scheduler,op,async()=>{order.push('collections');return page()},options,args)});reader.start();await time.fire();assert.deepEqual(order,[]);const conversation=scheduler.primary(async()=>order.push('conversation'),()=>true,'conversation');await conversation;assert.deepEqual(order,['conversation']);await time.fire();assert.deepEqual(order,['conversation','collections']);reader.stop();
});

test('the visible catalog overtakes queued background heads without overtaking a conversation or changing its secondary lane',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,maxConcurrent:2,backgroundIdle:4000,startupGrace:1500}),order=[],priorities=[];let backgroundActive=true,releaseHead;
 const background=Array.from({length:12},(_,index)=>scheduler.secondary(async()=>{order.push('background-'+index)},()=>backgroundActive).catch(()=>{}));
 const reader=createCollectionCatalog({actor:'u',workspace:'w',account:'a',...time,request:(w,op,args,options)=>{
  priorities.push(options.priority);
  return scheduleLiveRead(scheduler,op,async()=>{options.onStart?.();order.push(args.cursor?'catalog-cursor':'catalog-head');return args.cursor?page([list('second')]):new Promise(resolve=>releaseHead=resolve)},options,args);
 }});
 reader.start();await time.fire();assert.equal(reader.getSnapshot().busy,true);assert.equal(reader.getSnapshot().queued,true);assert.deepEqual(order,[]);
 const conversation=scheduler.primary(async()=>order.push('conversation'),()=>true,'conversation');await conversation;assert.deepEqual(order,['conversation']);
 await time.fire();assert.deepEqual(order,['conversation','catalog-head']);assert.equal(time.now(),5000,'the existing four-second secondary idle remains intact');assert.equal(reader.getSnapshot().busy,true);assert.equal(reader.getSnapshot().queued,false,'onStart distinguishes a real consultation from queued admission');releaseHead(page([list('first')],'next'));await flush();
 await time.fire();await time.fire();assert.deepEqual(order,['conversation','catalog-head','catalog-cursor']);assert.deepEqual(priorities,['selected','pagination']);assert.equal(reader.getSnapshot().complete,true);
 reader.stop();backgroundActive=false;await time.fire();await Promise.all(background);
});

test('stale onStart callbacks cannot clear the queued status of a refreshed request',async()=>{
 const pending=[],f=fixture({request:(w,op,args,options)=>new Promise(resolve=>pending.push({options,resolve}))});f.reader.start();await f.time.fire();assert.equal(f.reader.getSnapshot().queued,true);pending[0].options.onStart();assert.equal(f.reader.getSnapshot().queued,false);f.reader.refresh();assert.equal(f.reader.getSnapshot().queued,false);pending[0].resolve(page([list('obsolete')]));await flush();await f.time.fire();assert.equal(f.reader.getSnapshot().queued,true);pending[0].options.onStart();assert.equal(f.reader.getSnapshot().queued,true);pending[1].options.onStart();assert.equal(f.reader.getSnapshot().queued,false);pending[1].resolve(page([list('current')]));await flush();assert.equal(f.reader.getSnapshot().busy,false);assert.equal(f.reader.getSnapshot().queued,false);f.reader.stop();
});
