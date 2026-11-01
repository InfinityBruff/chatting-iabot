import test from 'node:test';
import assert from 'node:assert/strict';
import {collectNotificationUpdates,startModelPolling} from './notification-poll.js';
const flush=()=>new Promise(r=>setImmediate(r));
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
