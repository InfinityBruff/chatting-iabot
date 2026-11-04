import test from 'node:test';import assert from 'node:assert/strict';
import {pageReadPriority,pageReadBackground,scheduleLiveRead,fanVisibleRead,liveReadArgs} from './live-read-priority.js';
import {createReadScheduler} from './live-read-scheduler.js';
import {createPageLoader} from './page-loader.js';
test('foreground fan demand is bounded by operation, target, batch size and activity head',()=>{
 for(const operation of ['fan_profile','fan_history','fan_spend','fan_activity'])assert.equal(fanVisibleRead(operation,{conversation_id:'123'},'fan-visible'),true);
 assert.equal(fanVisibleRead('presence',{},'fan-visible'),true);assert.equal(fanVisibleRead('fan_spend_batch',{user_ids:['123','456']},'fan-visible'),true);
 for(const operation of ['fan_profile','fan_history','fan_spend','fan_activity'])for(const conversation_id of [undefined,123,'../123',''])assert.equal(fanVisibleRead(operation,{conversation_id},'fan-visible'),false);
 assert.equal(fanVisibleRead('fan_activity',{conversation_id:'123',cursor:'older'},'fan-visible'),false);
 for(const user_ids of [[],['123',4],Array.from({length:21},(_,i)=>String(i+1)),null])assert.equal(fanVisibleRead('fan_spend_batch',{user_ids},'fan-visible'),false);
 for(const operation of ['messages','inbox','profile','earnings','monthly','balances','transactions','notifications','send_message','prepare_send','like_message'])assert.equal(fanVisibleRead(operation,{conversation_id:'123',category:'total'},'fan-visible'),false);
 for(const priority of [undefined,'selected','interactive','background'])assert.equal(fanVisibleRead('fan_profile',{conversation_id:'123'},priority),false);
});
test('the foreground JSON flag is derived from eligible client intent and cannot promote raw body flags',()=>{
 const original={conversation_id:'123',foreground:false};assert.deepEqual(liveReadArgs('fan_profile',original,{priority:'fan-visible'}),{conversation_id:'123',foreground:true});assert.equal(original.foreground,false);
 assert.deepEqual(liveReadArgs('fan_profile',{conversation_id:'123',foreground:true},{priority:'background'}),{conversation_id:'123'});
 assert.deepEqual(liveReadArgs('earnings',{category:'total',foreground:true},{priority:'fan-visible'}),{category:'total'});
 assert.deepEqual(liveReadArgs('fan_spend_batch',{user_ids:Array(21).fill('123'),foreground:true},{priority:'fan-visible'}),{user_ids:Array(21).fill('123')});
 const routes=[],scheduler={primary:(_run,_active,priority)=>routes.push(['primary',priority]),secondary:(_run,_active,priority)=>routes.push(['secondary',priority])};
 scheduleLiveRead(scheduler,'fan_profile',()=>{}, {priority:'fan-visible'}, {conversation_id:'123'});scheduleLiveRead(scheduler,'fan_spend_batch',()=>{}, {priority:'fan-visible'}, {user_ids:['123']});scheduleLiveRead(scheduler,'presence',()=>{}, {priority:'fan-visible'});scheduleLiveRead(scheduler,'fan_activity',()=>{}, {priority:'fan-visible'}, {conversation_id:'123'});scheduleLiveRead(scheduler,'fan_activity',()=>{}, {priority:'fan-visible'}, {conversation_id:'123',cursor:'next'});scheduleLiveRead(scheduler,'earnings',()=>{}, {priority:'fan-visible'}, {category:'total'});
 assert.deepEqual(routes,[['primary','fan-visible'],['primary','fan-visible'],['primary','fan-visible'],['primary','fan-visible'],['secondary',undefined],['secondary',undefined]]);
});
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
test('visible fan demand uses the spare existing slot behind conversation opening while background work is in flight',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,maxConcurrent:2,backgroundIdle:4000}),starts=[];let finish,active=0,peak=0;
 const background=scheduler.secondary(()=>new Promise(resolve=>{starts.push('background');peak=Math.max(peak,++active);finish=()=>{active--;resolve()}}));await time.step();
 const fan=scheduleLiveRead(scheduler,'fan_profile',async()=>{starts.push('fan');peak=Math.max(peak,++active);active--},{priority:'fan-visible'},{conversation_id:'123'});
 const chat=scheduleLiveRead(scheduler,'messages',async()=>{starts.push('conversation');peak=Math.max(peak,++active);active--},{priority:'conversation'});
 await time.step();await chat;await time.step();await fan;assert.deepEqual(starts,['background','conversation','fan']);assert.equal(active,1);assert.equal(peak,2);finish();await background;
});
test('fan demand rechecks soft quota reserve at dispatch, rejects only itself and leaves chat capacity usable',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,maxConcurrent:2}),starts=[];let finish;
 const background=scheduler.secondary(()=>new Promise(resolve=>{starts.push('background');finish=resolve}));await time.step();
 const fan=scheduleLiveRead(scheduler,'fan_spend_batch',async()=>starts.push('fan'),{priority:'fan-visible'},{user_ids:['123']});const rejected=assert.rejects(fan,error=>error.status===429&&error.readReserved===true&&error.retryAfter===60);
 scheduler.observeQuota({limit:60,remaining:3,window:60,reset:60});await time.step();await rejected;assert.deepEqual(starts,['background']);
 const chat=scheduleLiveRead(scheduler,'messages',async()=>starts.push('conversation'),{priority:'conversation'});await time.step();await chat;assert.deepEqual(starts,['background','conversation']);finish();await background;
});
test('visible fan demand keeps hard cooldown and active-scope cancellation behavior',async()=>{
 const time=clock(),scheduler=createReadScheduler({...time,maxConcurrent:2});scheduler.block(5);let calls=0;
 await assert.rejects(scheduleLiveRead(scheduler,'presence',async()=>calls++,{priority:'fan-visible'}),error=>error.status===429&&error.retryAfter===5);assert.equal(calls,0);
 const hidden=clock(),queued=createReadScheduler({...hidden,visible:()=>false});let active=true;
 const fan=scheduleLiveRead(queued,'fan_profile',async()=>calls++,{priority:'fan-visible',active:()=>active},{conversation_id:'123'}),rejected=assert.rejects(fan,{name:'AbortError'});active=false;await hidden.step();await rejected;assert.equal(calls,0);
});
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
