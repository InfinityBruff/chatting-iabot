import test from 'node:test';import assert from 'node:assert/strict';
import {financialReadSettled,financialSummarySettled,financialReadStatus} from './finance-read-state.js';
import {createReadScheduler} from './live-read-scheduler.js';import {createPageLoader} from './page-loader.js';
import {cancellableLiveRead} from './live-read-cancellation.js';
const done={result:{data:{}},busy:false,waiting:false,error:''};
test('period categories wait for the total response or its explicit failure, including provider backoff',()=>{
 assert.equal(financialReadSettled(done),true);assert.equal(financialReadSettled({...done,result:null,error:'Unavailable'}),true);
 for(const pending of [{...done,busy:true},{...done,waiting:true},{...done,result:null}])assert.equal(financialReadSettled(pending),false);
});
test('category admission waits for all three summary reads, including provider backoff',()=>{
 assert.equal(financialSummarySettled([done,done,done]),true);
 for(const pending of [{...done,busy:true},{...done,waiting:true},{result:null,busy:false,waiting:false,error:''}])assert.equal(financialSummarySettled([done,pending,done]),false);
 assert.equal(financialSummarySettled([done,{...done,result:null,error:'Unavailable'},done]),true);assert.equal(financialSummarySettled([]),false);
});
test('financial cards distinguish waiting loading errors and confirmed zero without altering values',()=>{
 const state={...done,result:{data:{series:{tips:{total:0}}}}};assert.equal(financialReadStatus(state),null);assert.equal(state.result.data.series.tips.total,0);
 assert.equal(financialReadStatus({...state,busy:true}).role,'status');assert.match(financialReadStatus({...state,waiting:true}).text,/automáticamente/);assert.deepEqual(financialReadStatus({...state,error:'Rejected'}),{role:'alert',text:'Rejected'});
});
test('financial status distinguishes admission backlog from active consultation and prioritizes provider backoff',()=>{
 assert.deepEqual(financialReadStatus({...done,busy:true,queued:true}),{role:'status',text:'Esperando turno de lectura…'});
 assert.deepEqual(financialReadStatus({...done,busy:true,queued:false}),{role:'status',text:'Consultando…'});
 assert.deepEqual(financialReadStatus({...done,busy:true,queued:true,waiting:true}),{role:'status',text:'En espera del proveedor. Se reintentará automáticamente.'});
 assert.equal(financialReadStatus({...done,queued:true}),null);
});
function clock(){let at=0;const tasks=new Map();return {now:()=>at,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn),flush:async()=>{const first=[...tasks].sort((a,b)=>a[1]-b[1])[0];if(!first)return;tasks.delete(first[0]);at=Math.max(at,first[1]);await first[0]()}}}
test('summary reads precede progressive categories and a pending category does not block opening chat',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,maxConcurrent:2}),order=[],categories=[];let release,admitted=false;
 const categoryKeys=['messages','tips'];
 const make=key=>createPageLoader({...time,read:(_cursor,_background,active)=>scheduler.secondary(async()=>{order.push(key);if(key==='messages')await new Promise(resolve=>release=resolve);return {data:{key}}},active)});
 const summary=['total','monthly','balances'].map(make);
 const admit=()=>{if(!admitted&&financialSummarySettled(summary.map(loader=>loader.getSnapshot()))){admitted=true;for(const key of categoryKeys){const loader=make(key);categories.push(loader);loader.start()}}};
 summary.forEach(loader=>loader.subscribe(admit));summary.forEach(loader=>loader.start());
 for(let i=0;i<3;i++){await time.flush();await new Promise(resolve=>setImmediate(resolve))}
 assert.deepEqual(order,['total','monthly','balances']);assert.equal(categories.length,2);assert.equal(summary[0].getSnapshot().result.data.key,'total');
 const pending=time.flush();await new Promise(resolve=>setImmediate(resolve));assert.deepEqual(order,['total','monthly','balances','messages']);assert.equal(categories[0].getSnapshot().busy,true);
 const chat=scheduler.primary(async()=>order.push('chat'),undefined,'conversation');await time.flush();await chat;assert.equal(order.at(-1),'chat');
 release();await pending;await new Promise(resolve=>setImmediate(resolve));assert.equal(categories[0].getSnapshot().result.data.key,'messages');assert.equal(categories[1].getSnapshot().result,null);
 await time.flush();await new Promise(resolve=>setImmediate(resolve));assert.equal(categories[1].getSnapshot().result.data.key,'tips');[...summary,...categories].forEach(loader=>loader.stop());
});
test('changing model invalidates queued category reads and drops an old in-flight result',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,maxConcurrent:2}),calls=[],writes=[];let release;
 const make=(model,category)=>createPageLoader({...time,read:(_cursor,_background,active)=>scheduler.secondary(async()=>{calls.push([model,category]);if(model==='old'&&category==='messages')await new Promise(resolve=>release=resolve);return {data:{model,category}}},active),write:value=>writes.push(value.data)});
 const old=make('old','messages'),queued=make('old','tips');old.start();queued.start();const pending=time.flush();await new Promise(resolve=>setImmediate(resolve));old.stop();queued.stop();
 const current=make('current','total');current.start();release();await pending;await new Promise(resolve=>setImmediate(resolve));await time.flush();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,[['old','messages'],['current','total']]);assert.deepEqual(writes,[{model:'current',category:'total'}]);assert.equal(old.getSnapshot().result,null);current.stop();
});
test('switching across three financial models aborts old work and frees the background lane for the last model',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,maxConcurrent:2}),calls=[],aborted=[],writes=[];
 const make=model=>createPageLoader({...time,cancelReads:cancellableLiveRead('earnings',{category:'total'}),read:(_cursor,_background,active,_start,_preparing,signal)=>scheduler.secondary(()=>new Promise((resolve,reject)=>{calls.push(model);if(model==='C')resolve({data:{model,total:0}});else signal.addEventListener('abort',()=>{aborted.push(model);reject(signal.reason)},{once:true})}),active),write:value=>writes.push(value.data)});
 const a=make('A');a.start();const first=time.flush();await new Promise(resolve=>setImmediate(resolve));a.stop();await first;
 const b=make('B');b.start();const second=time.flush();await new Promise(resolve=>setImmediate(resolve));b.stop();await second;
 const c=make('C');c.start();await time.flush();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(calls,['A','B','C']);assert.deepEqual(aborted,['A','B']);assert.deepEqual(writes,[{model:'C',total:0}]);assert.equal(c.getSnapshot().result.data.total,0);assert.equal(a.getSnapshot().result,null);assert.equal(b.getSnapshot().result,null);c.stop();
});
