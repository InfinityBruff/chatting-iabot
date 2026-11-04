import test from 'node:test';
import assert from 'node:assert/strict';
import {financialPageRead} from './live-page-visibility.js';
import {createPageLoader} from './page-loader.js';
import {createReadScheduler} from './live-read-scheduler.js';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b});return {promise,resolve,reject}};
const settled=()=>new Promise(resolve=>setImmediate(resolve));
const page=(ids,cursor=null)=>({data:{transactions:ids.map(id=>({id})),cursor,hasMore:!!cursor}});
function clock(){let at=0;const tasks=new Map();return {now:()=>at,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn),set:value=>at=value,tasks,flush:async()=>{const first=[...tasks].sort((a,b)=>a[1]-b[1])[0];if(!first)return;tasks.delete(first[0]);at=Math.max(at,first[1]);await first[0]();await settled()}}}
test('financial visibility applies only to bounded financial operations, preserving legacy and chat contracts',()=>{
 for(const operation of ['monthly','balances','transactions'])assert.equal(financialPageRead(operation),true);
 for(const category of ['total','messages','tips','subscriptions','posts','streams','referrals'])assert.equal(financialPageRead('earnings',{category}),true);
 for(const category of [undefined,null,'unknown',{},1])assert.equal(financialPageRead('earnings',{category}),false);
 for(const operation of ['messages','inbox','vault_media','notifications','fan_activity','send_message'])assert.equal(financialPageRead(operation,{category:'total'}),false);
});
test('hiding a financial read aborts it, retains confirmed cache and rejects late writes before resuming',async()=>{
 let shown=true;const old=deferred(),fresh=deferred(),calls=[],writes=[],cached=page(['cached']);
 const loader=createPageLoader({initial:cached,field:'transactions',cancelReads:true,visible:()=>shown,write:value=>writes.push(value),read:(cursor,bg,active,onStart,prepare,signal)=>{calls.push({cursor,active,signal});return calls.length===1?old.promise:fresh.promise}});
 loader.start();shown=false;loader.pause();assert.equal(calls[0].signal.aborted,true);assert.equal(calls[0].active(),false);assert.equal(loader.getSnapshot().result,cached);assert.equal(loader.getSnapshot().busy,false);
 old.resolve(page(['late']));await settled();assert.deepEqual(writes,[]);loader.resume();assert.equal(calls.length,1);
 shown=true;loader.resume();assert.equal(calls.length,2);fresh.resolve(page(['fresh']));await settled();assert.deepEqual(loader.getSnapshot().result.data.transactions,[{id:'fresh'}]);assert.equal(writes.length,1);loader.stop();
});
test('financial hide/show preserves a429 deadline and creates no hidden retry reads',async()=>{
 let shown=true,reads=0;const time=clock(),loader=createPageLoader({...time,cancelReads:true,visible:()=>shown,read:async()=>{if(++reads===1)throw Object.assign(Error('limited'),{status:429,retryAfter:7});return page(['fresh'])}});
 loader.start();await settled();assert.equal(loader.getSnapshot().waiting,true);assert.deepEqual([...time.tasks.values()],[7000]);
 time.set(1000);shown=false;loader.pause();assert.equal(time.tasks.size,0);time.set(2000);shown=true;loader.resume();assert.equal(reads,1);assert.equal(loader.getSnapshot().waiting,true);assert.deepEqual([...time.tasks.values()],[7000]);
 await time.flush();assert.equal(reads,2);assert.equal(loader.getSnapshot().waiting,false);assert.equal(time.now(),7000);loader.stop();
});
test('a paused financial cursor resumes the same cursor/options without an extra completed head read',async()=>{
 let shown=true;const old=deferred(),fresh=deferred(),calls=[],options={priority:'selected'},loader=createPageLoader({initial:page(['cached'],'next'),field:'transactions',cancelReads:true,visible:()=>shown,read:(cursor,bg,active,onStart,prepare,signal,readOptions)=>{calls.push({cursor,signal,readOptions});return calls.length===1?Promise.resolve(page(['head'],'next')):calls.length===2?old.promise:fresh.promise}});
 loader.start();await settled();const pending=loader.load('next',options);shown=false;loader.pause();assert.equal(calls[1].signal.aborted,true);shown=true;loader.resume();assert.deepEqual(calls.map(call=>call.cursor),[null,'next','next']);assert.equal(calls[2].readOptions,options);
 fresh.resolve(page(['fresh-page']));await settled();old.resolve(page(['late-page']));assert.equal(await pending,false);assert.deepEqual(loader.getSnapshot().result.data.transactions,[{id:'head'},{id:'fresh-page'}]);assert.equal(loader.getSnapshot().pageRevision,1);loader.stop();
});
test('financial cursor RetryAfter survives pause and resumes its original cursor without bypassing the deadline',async()=>{
 let shown=true,attempts=0;const time=clock(),seen=[],loader=createPageLoader({...time,initial:page(['cached'],'next'),field:'transactions',cancelReads:true,visible:()=>shown,read:async cursor=>{seen.push(cursor);if(!cursor)return page(['head'],'next');if(++attempts===1)throw Object.assign(Error('limited'),{status:429,retryAfter:5});return page(['older'])}});
 loader.start();await settled();await loader.load('next');shown=false;loader.pause();time.set(2000);shown=true;loader.resume();assert.deepEqual(seen,[null,'next']);assert.deepEqual([...time.tasks.values()],[5000]);await time.flush();assert.deepEqual(seen,[null,'next','next']);loader.stop();
});
test('permission denial during financial pause remains terminal and cannot be resumed',async()=>{
 let shown=true,reads=0;const old=deferred(),loader=createPageLoader({initial:page(['cached']),field:'transactions',cancelReads:true,visible:()=>shown,read:()=>{reads++;return old.promise}});
 loader.start();shown=false;loader.pause();loader.deny('revoked');shown=true;loader.resume();old.resolve(page(['late']));await settled();assert.equal(reads,1);assert.equal(loader.getSnapshot().denied,true);assert.equal(loader.getSnapshot().result,null);assert.equal(await loader.load(),false);loader.stop();
});
test('a cache epoch change during financial pause discards old data and restarts only the authorized head',async()=>{
 let shown=true,epoch=0;const old=deferred(),fresh=deferred(),calls=[],loader=createPageLoader({initial:page(['cached'],'old-cursor'),field:'transactions',cacheEpoch:()=>epoch,cancelReads:true,visible:()=>shown,read:(cursor,bg,active,start,prepare,signal)=>{calls.push({cursor,signal});return calls.length===1?old.promise:fresh.promise}});
 loader.start();shown=false;loader.pause();epoch++;shown=true;loader.resume();assert.deepEqual(calls.map(call=>call.cursor),[null,null]);assert.equal(loader.getSnapshot().result,null);assert.equal(calls[0].signal.aborted,true);
 old.resolve(page(['late']));fresh.resolve(page(['authorized']));await settled();assert.deepEqual(loader.getSnapshot().result.data.transactions,[{id:'authorized'}]);loader.stop();
});
test('paused queued financial work invalidates admission callbacks and cannot dispatch after visibility returns',async()=>{
 let shown=true,release;const calls=[],scheduler=createReadScheduler({minimumGap:0,settleMs:0,visible:()=>shown}),held=scheduler.primary(()=>new Promise(resolve=>release=resolve));
 let staleStart,emissions=0;const loader=createPageLoader({field:'transactions',cancelReads:true,visible:()=>shown,read:(cursor,bg,active,onStart)=>{staleStart??=onStart;return scheduler.secondary(async()=>{calls.push(cursor);onStart();return page(['confirmed'])},active,'selected')}});loader.subscribe(()=>emissions++);
 loader.start();assert.equal(loader.getSnapshot().queued,true);shown=false;loader.pause();const before=emissions;staleStart();assert.equal(emissions,before);assert.equal(loader.getSnapshot().queued,false);
 shown=true;loader.resume();release();await held;await settled();assert.deepEqual(calls,[null]);assert.deepEqual(loader.getSnapshot().result.data.transactions,[{id:'confirmed'}]);loader.stop();
});
test('hiding and returning to a settled financial result creates no new polling or refresh requests',async()=>{
 let shown=true,reads=0;const time=clock(),loader=createPageLoader({...time,field:'transactions',cancelReads:true,visible:()=>shown,read:async()=>{reads++;return page(['confirmed'])}});
 loader.start();await settled();shown=false;loader.pause();shown=true;loader.resume();await settled();assert.equal(reads,1);assert.equal(time.tasks.size,0);assert.equal(loader.getSnapshot().result.data.transactions[0].id,'confirmed');loader.stop();
});
test('an initially hidden cached financial mount pauses before its first show and reauthorizes a changed cache epoch',async()=>{
 let shown=false,epoch=0,reads=0;const fresh=deferred(),written=[],cached=page(['cached']),loader=createPageLoader({initial:cached,field:'transactions',cancelReads:true,cacheEpoch:()=>epoch,visible:()=>shown,write:value=>written.push(value),read:()=>{reads++;return fresh.promise}});
 // useLivePage applies this pause only to an explicitly financial hidden mount.
 loader.start();if(!shown)loader.pause();assert.equal(reads,0);assert.equal(loader.getSnapshot().result,cached);
 epoch++;shown=true;loader.resume();assert.equal(reads,1);assert.equal(loader.getSnapshot().result,null);assert.equal(loader.getSnapshot().busy,true);assert.deepEqual(written,[]);
 fresh.resolve(page(['authorized']));await settled();assert.deepEqual(loader.getSnapshot().result.data.transactions,[{id:'authorized'}]);assert.equal(written.length,1);loader.stop();
});
test('an initially hidden cached financial mount still performs its deferred first-visit refresh in the same epoch',async()=>{
 let shown=false,reads=0;const fresh=deferred(),cached=page(['cached']),loader=createPageLoader({initial:cached,field:'transactions',cancelReads:true,visible:()=>shown,read:()=>{reads++;return fresh.promise}});
 loader.start();if(!shown)loader.pause();assert.equal(reads,0);assert.equal(loader.getSnapshot().result,cached);
 shown=true;loader.resume();assert.equal(reads,1);assert.equal(loader.getSnapshot().busy,true);assert.equal(loader.getSnapshot().result,cached);
 fresh.resolve(page(['refreshed']));await settled();assert.deepEqual(loader.getSnapshot().result.data.transactions,[{id:'refreshed'}]);
 shown=false;loader.pause();shown=true;loader.resume();await settled();assert.equal(reads,1);loader.stop();
});
