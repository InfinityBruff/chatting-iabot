import test from 'node:test';import assert from 'node:assert/strict';
import {pageReadPriority,pageReadBackground,scheduleLiveRead} from './live-read-priority.js';
import {createReadScheduler} from './live-read-scheduler.js';
import {createPageLoader} from './page-loader.js';
test('automatic inbox cursor admission also marks the provider read background without changing manual pages',()=>{
 for(const priority of ['background','prefetch'])assert.equal(pageReadBackground('inbox',{cursor:'next',priority:pageReadPriority('inbox',{cursor:'next',priority})}),true);
 for(const priority of [undefined,'pagination','selected','interactive'])assert.equal(pageReadBackground('inbox',{cursor:'next',priority:pageReadPriority('inbox',{cursor:'next',priority})}),false);
 assert.equal(pageReadBackground('inbox',{priority:'background'}),false);assert.equal(pageReadBackground('messages',{cursor:'next',priority:'background'}),false);assert.equal(pageReadBackground('transactions',{cursor:'next',priority:'background'}),false);
 for(const operation of ['inbox','messages'])assert.equal(pageReadBackground(operation,{background:true}),true);
});
test('only inbox cursor loads accept bounded client priority overrides',()=>{
 for(const priority of ['background','pagination','prefetch'])assert.equal(pageReadPriority('inbox',{cursor:'next',priority}),priority);
 for(const priority of [undefined,null,'selected','interactive','conversation','history',{},true])assert.equal(pageReadPriority('inbox',{cursor:'next',priority}),'pagination');
 assert.equal(pageReadPriority('inbox',{priority:'background'}),'interactive');
 assert.equal(pageReadPriority('messages',{cursor:'next',priority:'background'}),'history');
 assert.equal(pageReadPriority('transactions',{cursor:'next',priority:'background'}),'pagination');
 assert.equal(pageReadPriority('messages',{preparing:true,cursor:'next',priority:'background'}),'history-prepare');
 assert.equal(pageReadPriority('inbox',{background:true,priority:'background'}),'refresh');
});
test('financial heads select only bounded report operations while legacy earnings and other scans retain background priority',()=>{
 for(const operation of ['monthly','balances','transactions'])assert.equal(pageReadPriority(operation),'selected');
 for(const category of ['total','messages','tips','subscriptions','posts','streams','referrals'])assert.equal(pageReadPriority('earnings',{category}),'selected');
 for(const category of [undefined,null,'','other','../total',123,{},['total']])assert.equal(pageReadPriority('earnings',{category}),'background');
 for(const operation of ['earnings','fan_profile','fan_history','presence','notifications'])assert.equal(pageReadPriority(operation),'background');
 for(const operation of ['earnings','monthly','balances','transactions']){assert.equal(pageReadPriority(operation,{category:'total',background:true}),'refresh');assert.equal(pageReadPriority(operation,{category:'total',cursor:'older'}),'pagination')}
 assert.equal(pageReadPriority('messages'),'conversation');assert.equal(pageReadPriority('inbox'),'interactive');assert.equal(pageReadPriority('vault_media'),'interactive');
});
test('all selected financial heads remain in the secondary lane',()=>{
 const calls=[],scheduler={primary:()=>{throw Error('financial read must not use the primary lane')},secondary:(_run,_active,priority)=>calls.push(priority)};
 for(const [operation,category] of [['monthly'],['balances'],['transactions'],['earnings','total'],['earnings','messages']])scheduleLiveRead(scheduler,operation,()=>{}, {priority:pageReadPriority(operation,{category})});
 assert.deepEqual(calls,['selected','selected','selected','selected','selected']);
});
test('inbox background and prefetch use the secondary lane and other explicit read priorities are forwarded',()=>{
 const calls=[],active=()=>true,run=()=>42,scheduler={primary:(...args)=>(calls.push(['primary',...args]),42),secondary:(...args)=>(calls.push(['secondary',...args]),42)};
 for(const priority of ['background','prefetch'])assert.equal(scheduleLiveRead(scheduler,'inbox',run,{active,priority}),42);
 scheduleLiveRead(scheduler,'inbox',run,{active,priority:'pagination'});scheduleLiveRead(scheduler,'fan_profile',run,{active,priority:'selected'});scheduleLiveRead(scheduler,'earnings',run,{active,priority:'background'});
 assert.deepEqual(calls.map(([lane,_run,_active,priority])=>[lane,priority]),[['secondary','background'],['secondary','prefetch'],['primary','pagination'],['secondary','selected'],['secondary','background']]);assert.ok(calls.every(([,fn,isActive])=>fn===run&&isActive===active));
 calls.length=0;assert.equal(scheduleLiveRead(scheduler,'send_message',run,{active,priority:'background'}),42);assert.deepEqual(calls,[]);
});
test('background inbox loading does not reset the four-second foreground idle period before a selected record',async()=>{
 let at=0;const tasks=new Map(),calls=[],clock={now:()=>at,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn)};
 const scheduler=createReadScheduler({...clock,backgroundIdle:4000}),flush=async()=>{const [fn,due]=[...tasks].sort((a,b)=>a[1]-b[1])[0];tasks.delete(fn);at=due;await fn()};
 await scheduleLiveRead(scheduler,'inbox',async()=>calls.push(['opening',at]),{priority:'interactive'});
 const pagination=scheduleLiveRead(scheduler,'inbox',async()=>calls.push(['automatic page',at]),{priority:'background'});await flush();await pagination;
 const selected=scheduleLiveRead(scheduler,'fan_profile',async()=>calls.push(['selected profile',at]),{priority:'selected'});await flush();await selected;
 assert.deepEqual(calls,[['opening',0],['automatic page',4000],['selected profile',6500]]);
});
function clock(){let at=0;const tasks=new Map();return {now:()=>at,tasks,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn),step:async()=>{const first=[...tasks].sort((a,b)=>a[1]-b[1])[0];if(!first)return false;const [fn,due]=first;tasks.delete(fn);at=due;void fn();await new Promise(resolve=>setImmediate(resolve));return true}}}
test('a selected total requested behind nine slow background reads runs after the in-flight read and then resumes their FIFO queue',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,backgroundIdle:4000,startupGrace:1500,maxConcurrent:2}),starts=[];let active=0,peak=0;
 const background=Array.from({length:9},(_,index)=>scheduler.secondary(()=>{starts.push(['background-'+index,time.now()]);peak=Math.max(peak,++active);return new Promise(resolve=>time.schedule(()=>{active--;resolve({data:{}})},20000))}));
 await time.step();assert.deepEqual(starts,[['background-0',1500]]);assert.equal(active,1);
 const report=createPageLoader({...time,read:(_cursor,_background,valid)=>scheduleLiveRead(scheduler,'earnings',async()=>{starts.push(['total',time.now()]);return {data:{series:{total:{gross:42,total:32}}}}},{active:valid,priority:pageReadPriority('earnings',{category:'total'})})});report.start();
 assert.equal(report.getSnapshot().busy,true);assert.equal(starts.length,1);
 while(!report.getSnapshot().result)assert.equal(await time.step(),true);
 assert.deepEqual(starts,[['background-0',1500],['total',21650]]);assert.equal(report.getSnapshot().result.data.series.total.gross,42);
 while(await time.step()){}await Promise.all(background);
 assert.deepEqual(starts.map(([label])=>label),['background-0','total',...Array.from({length:8},(_,index)=>'background-'+(index+1))]);
 assert.ok(starts.slice(1).every(([,at],index)=>at-starts[index][1]>=2500));assert.equal(peak,1);report.stop();
});
test('selected financial heads still wait for an observed quota reservation',async()=>{
 for(const [operation,category] of [['monthly'],['balances'],['transactions'],['earnings','total']]){
  const time=clock(),scheduler=createReadScheduler(time),starts=[];
  scheduler.observeQuota({limit:60,remaining:3,window:60,reset:60});
  const pending=scheduleLiveRead(scheduler,operation,async()=>starts.push(time.now()),{priority:pageReadPriority(operation,{category})});
  assert.deepEqual(starts,[]);assert.ok([...time.tasks.values()].every(due=>due>=60000));await time.step();await pending;assert.deepEqual(starts,[60000]);
 }
});
test('a selected financial head respects foreground idle and retains automatic 429 Retry-After',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,backgroundIdle:4000,startupGrace:1500,maxConcurrent:2}),starts=[];
 await scheduler.primary(async()=>{});
 const report=createPageLoader({...time,read:(_cursor,_background,active)=>scheduleLiveRead(scheduler,'earnings',async()=>{starts.push(time.now());if(starts.length===1){scheduler.block(5);throw Object.assign(Error('limited'),{status:429,retryAfter:5})}return {data:{series:{total:{gross:0,total:0}}}}},{active,priority:pageReadPriority('earnings',{category:'total'})})});report.start();
 assert.ok([...time.tasks.values()].every(due=>due>=4000));await time.step();assert.deepEqual(starts,[4000]);assert.equal(report.getSnapshot().waiting,true);
 assert.equal(await report.load(),false);assert.ok([...time.tasks.values()].every(due=>due>=9000));
 while(!report.getSnapshot().result)assert.equal(await time.step(),true);
 assert.deepEqual(starts,[4000,9150]);assert.equal(report.getSnapshot().waiting,false);assert.equal(report.getSnapshot().result.data.series.total.gross,0);report.stop();
});
