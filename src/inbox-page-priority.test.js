import test from 'node:test';import assert from 'node:assert/strict';
import {requestInboxPage} from './components/useInboxLoading.js';import {scheduleLiveRead,pageReadPriority,pageReadBackground} from './live-read-priority.js';import {createReadScheduler} from './live-read-scheduler.js';
import {createPageLoader} from './page-loader.js';import {inboxNextPage} from './inbox-loading.js';import {applyPresence,isFanOnline} from './fan-presence.js';
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
test('scrolling promotes the actual queued inbox page behind conversation opening without another provider read or four-second idle',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,backgroundIdle:4000}),calls=[],admissions=[];
 const flushPromises=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
 const presence={confirmations:{'1':new Date(0).toISOString()}},head={data:{conversations:[{userId:'1',lastMessage:'Conservado',spend:{available:true,total:12}}],hasMore:true,cursor:'next'}};
 const loader=createPageLoader({...time,field:'conversations',retain:true,cancelReads:true,read:(cursor,background,active,onStart,_preparing,signal,options)=>{
  const priority=pageReadPriority('inbox',{cursor,background,priority:options.priority}),args={fast:true,...(cursor?{cursor}:{}),...(pageReadBackground('inbox',{cursor,background,priority})?{background:true}:{})};
  admissions.push({cursor,priority,signal});
  return scheduleLiveRead(scheduler,'inbox',async()=>{assert.equal(signal.aborted,false);onStart();calls.push({kind:cursor?'cursor':'head',priority,at:time.now(),background:args.background===true});return cursor?{data:{conversations:[{userId:'2',lastMessage:'Página siguiente'}],hasMore:false,cursor:null}}:head},{active,priority},args);
 }});
 try{
  loader.start();await flushPromises();assert.deepEqual(calls.map(call=>call.kind),['head']);
  const automatic=requestInboxPage(loader.load,'next',false),queued=loader.getSnapshot();
  assert.equal(queued.busy,true);assert.equal(queued.pageQueued,true);assert.equal(queued.requestCursor,'next');
  assert.deepEqual(queued.result.data.conversations.map(fan=>fan.userId),['1']);
  assert.equal(inboxNextPage({page:queued.result.data,busy:queued.busy,error:queued.error,seen:new Set(),pageQueued:queued.pageQueued,requestCursor:queued.requestCursor,nearEnd:false}),null);
  const conversation=scheduleLiveRead(scheduler,'messages',async()=>calls.push({kind:'conversation',at:time.now()}),{priority:'conversation'});
  const cursor=inboxNextPage({page:queued.result.data,busy:queued.busy,error:queued.error,seen:new Set(),pageQueued:queued.pageQueued,requestCursor:queued.requestCursor,nearEnd:true});
  assert.equal(cursor,'next');const promoted=requestInboxPage(loader.load,cursor,true);
  assert.equal(admissions[1].priority,'background');assert.equal(admissions[1].signal.aborted,true);assert.equal(admissions[2].priority,'pagination');
  await time.flush();await conversation;await time.flush();assert.equal(await promoted,true);assert.equal(await automatic,false);
  assert.deepEqual(calls.map(call=>call.kind),['head','conversation','cursor']);
  const pageRead=calls.find(call=>call.kind==='cursor');assert.equal(pageRead.at,400);assert.ok(pageRead.at<4000);assert.equal(pageRead.background,false);
  const complete=loader.getSnapshot();assert.equal(complete.pageRevision,1);assert.equal(complete.busy,false);assert.equal(complete.pageQueued,false);
  assert.deepEqual(complete.result.data.conversations.map(fan=>fan.userId),['1','2']);assert.equal(complete.result.data.conversations[0].spend.total,12);
  const fans=applyPresence(complete.result.data.conversations,presence);assert.equal(isFanOnline(fans[0],time.now()),true);assert.equal(isFanOnline(fans[1],time.now()),false);
 }finally{loader.stop()}
});
