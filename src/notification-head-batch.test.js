import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNotificationUpdates,createNotificationHeadRequest} from './notification-poll.js';
import {createReadScheduler,secondaryReads} from './live-read-scheduler.js';
import {scheduleLiveRead} from './live-read-priority.js';
import {cancellableLiveRead} from './live-read-cancellation.js';
const page=(notifications=[],hasMore=false,cursor=null)=>({notifications,hasMore,cursor});
const row=id=>({id,createdAt:'2026-11-08T01:00:00.000Z'});
const response=(heads)=>({data:{heads},observedAt:'2026-11-08T01:00:01.000Z'});
const batch=()=>response([{type:'',data:page([row('general'),row('purchase')])},{type:'purchases',data:page([row('purchase')])},{type:'tip',data:page([row('tip')])}]);
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const options=()=>({known:new Set(),baseline:0});

test('one three-head Edge call replaces three first-page calls without losing purchases, tips or deduplication',async()=>{
 let grouped=0,legacy=0;const published=[],result=await collectNotificationUpdates({...options(),requestHeads:async()=>{grouped++;return batch()},request:()=>{legacy++;throw Error('No head fallback')},onPage:p=>published.push(p)});
 assert.equal(grouped,1);assert.equal(legacy,0);assert.equal(result.incoming.length,3);assert.equal(result.incoming.find(x=>x.id==='purchase').category,'purchases');assert.equal(result.incoming.find(x=>x.id==='tip').category,'tip');assert.deepEqual(published.map(p=>p.type),['','purchases','tip']);
});

test('three authorized model collectors require three batches and no legacy head reads, including a slow first model',async()=>{
 const slow=deferred(),started=[],finished=[];const tasks=['A','B','C'].map(model=>collectNotificationUpdates({...options(),requestHeads:async()=>{started.push(model);if(model==='A')await slow.promise;return batch()},request:()=>{throw Error('Unexpected legacy head')}}).then(r=>{finished.push(model);return r}));await new Promise(r=>setImmediate(r));assert.deepEqual(started,['A','B','C']);assert.deepEqual(finished,['B','C']);slow.resolve();await Promise.all(tasks);assert.equal(started.length,3);
});

test('cursor pages keep their exact category and opaque cursor while all heads share the one batch',async()=>{
 const known=new Set(['known']),requests=[];let count=0;
 const result=await collectNotificationUpdates({known,baseline:0,requestHeads:async()=>{count++;return response([{type:'',data:page([row('head')],true,'general&opaque')},{type:'purchases',data:page([row('purchase')])},{type:'tip',data:page([row('tip')],true,'tip&opaque')}])},request:async(params)=>{requests.push(params);return {data:page([row('known')],true,'must-not-follow')}}});
 assert.equal(count,1);assert.deepEqual(requests,[{cursor:'general&opaque'},{type:'tip',cursor:'tip&opaque'}]);assert.equal(result.incoming.filter(r=>r.id==='known').length,1);
});

test('a partial 429 or deadline keeps valid categories, preserves RetryAfter and never creates a fake empty success',async()=>{
 for(const status of [429,504]){let legacy=0;const result=await collectNotificationUpdates({...options(),requestHeads:async()=>response([{type:'',data:page([row('general')])},{type:'purchases',data:page([row('purchase')])},{type:'tip',error:{status,...(status===429?{retryAfter:180}:{})}}]),request:()=>{legacy++;throw Error('No fallback')}});assert.equal(result.incoming.length,2);assert.ok(result.error);assert.equal(result.retryAfter,status===429?180:undefined);assert.equal(legacy,0)}
});

test('a long provider cooldown remains intact instead of turning the whole batch into a schema failure',async()=>{
 const result=await collectNotificationUpdates({...options(),requestHeads:async()=>response([{type:'',data:page([row('general')])},{type:'purchases',data:page([row('purchase')])},{type:'tip',error:{status:429,retryAfter:172800}}]),request:()=>{throw Error('No fallback')}});
 assert.equal(result.retryAfter,172800);assert.deepEqual(result.incoming.map(n=>n.id),['general','purchase']);
});

test('whole-batch errors never fan out to legacy HTTP and authorization failures discard every category',async()=>{
 for(const status of [401,403,404,429,503]){let grouped=0,legacy=0;const failure=Object.assign(Error('failure'),{status});await assert.rejects(()=>collectNotificationUpdates({...options(),requestHeads:async()=>{grouped++;throw failure},request:()=>{legacy++;throw Error('No fallback')}}),e=>e===failure);assert.equal(grouped,1);assert.equal(legacy,0)}
 const published=[];await assert.rejects(()=>collectNotificationUpdates({...options(),requestHeads:async()=>response([{type:'',data:page([row('private')])},{type:'purchases',data:page([row('private')])},{type:'tip',error:{status:403}}]),request:()=>{throw Error('No fallback')},onPage:r=>published.push(r)}),e=>e.status===403);assert.deepEqual(published,[]);
});

test('missing, duplicated, mismatched or malformed branches fail closed instead of concealing financial events',async()=>{
 for(const heads of [[{type:'',data:page()}],[{type:'',data:page()},{type:'purchases',data:page()},{type:'purchases',data:page()}],[{type:'',data:page()},{type:'purchases',data:page()},{type:'wrong',data:page()}],[{type:'',data:page()},{type:'purchases',data:page()},{type:'tip',data:{notifications:[],hasMore:true,cursor:null}}]]){let legacy=0;await assert.rejects(()=>collectNotificationUpdates({...options(),requestHeads:async()=>response(heads),request:()=>{legacy++;throw Error('No fallback')}}));assert.equal(legacy,0)}
});

test('logout or scope teardown while the batch is pending cannot publish rows or traverse a late cursor',async()=>{
 let active=true,legacy=0,admission;const pending=deferred(),published=[],result=collectNotificationUpdates({...options(),active:()=>active,requestHeads:options=>{admission=options;return pending.promise},request:()=>{legacy++;throw Error('No late cursor')},onPage:p=>published.push(p)});await new Promise(r=>setImmediate(r));active=false;assert.equal(admission.active(),false);pending.resolve(batch());assert.deepEqual(await result,{incoming:[],head:null,error:''});assert.equal(legacy,0);assert.deepEqual(published,[]);
});

test('the batch is a cancellable secondary read and queued conversation work runs before it',async()=>{
 assert.equal(secondaryReads.has('notification_heads'),true);assert.equal(cancellableLiveRead('notification_heads'),true);
 const hold=deferred(),order=[],scheduler=createReadScheduler({maxConcurrent:1,settleMs:0,minimumGap:0,backgroundInterval:0});const first=scheduler.primary(()=>hold.promise),grouped=scheduleLiveRead(scheduler,'notification_heads',async()=>{order.push('batch');return batch()},{priority:'background'}),chat=scheduleLiveRead(scheduler,'messages',async()=>{order.push('chat')},{priority:'conversation'});hold.resolve();await Promise.all([first,grouped,chat]);assert.deepEqual(order,['chat','batch']);
});

test('a direct head adapter rejects unsupported categories without calling either endpoint',async()=>{
 let count=0;const request=createNotificationHeadRequest({request:()=>count++,requestHeads:()=>count++});await assert.rejects(()=>request({type:'wrong'}));assert.equal(count,0);
});
