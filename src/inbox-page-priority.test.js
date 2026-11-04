import test from 'node:test';import assert from 'node:assert/strict';
import {requestInboxPage} from './components/useInboxLoading.js';import {scheduleLiveRead} from './live-read-priority.js';import {createReadScheduler} from './live-read-scheduler.js';
function clock(){let at=0;const tasks=new Map();return {now:()=>at,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn),flush:async()=>{const [fn,due]=[...tasks].sort((a,b)=>a[1]-b[1])[0];tasks.delete(fn);at=due;await fn()}}}
test('automatic inbox preload yields to selected metadata and opening conversation',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,backgroundIdle:4000}),order=[];
 const automatic=requestInboxPage((cursor,options)=>{assert.equal(cursor,'next');return scheduleLiveRead(scheduler,'inbox',async()=>order.push(['automatic',time.now()]),options)},'next',false);
 const selected=scheduleLiveRead(scheduler,'fan_profile',async()=>order.push(['selected',time.now()]),{priority:'selected'});await scheduleLiveRead(scheduler,'messages',async()=>order.push(['conversation',time.now()]),{priority:'conversation'});
 await time.flush();await selected;await time.flush();await automatic;assert.deepEqual(order,[['conversation',0],['selected',4000],['automatic',6500]]);
});
test('approaching the list end retains explicit pagination without exceeding foreground spacing',async()=>{
 const time=clock(),scheduler=createReadScheduler(time),order=[];
 const nearEnd=requestInboxPage((cursor,options)=>scheduleLiveRead(scheduler,'inbox',async()=>order.push(['pagination',time.now()]),options),'next',true);
 const selected=scheduleLiveRead(scheduler,'fan_spend_batch',async()=>order.push(['selected',time.now()]),{priority:'selected'});await nearEnd;await time.flush();await selected;assert.deepEqual(order,[['pagination',0],['selected',200]]);
 let called=false;assert.equal(requestInboxPage(()=>called=true,null,false),undefined);assert.equal(called,false);
});
