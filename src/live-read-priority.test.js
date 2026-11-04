import test from 'node:test';import assert from 'node:assert/strict';
import {pageReadPriority,pageReadBackground,scheduleLiveRead} from './live-read-priority.js';
import {createReadScheduler} from './live-read-scheduler.js';
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
test('secondary page heads preserve background admission while chat and vault retain opening priority',()=>{
 for(const operation of ['earnings','monthly','balances','transactions','fan_profile','fan_history'])assert.equal(pageReadPriority(operation),'background');
 assert.equal(pageReadPriority('messages'),'conversation');assert.equal(pageReadPriority('inbox'),'interactive');assert.equal(pageReadPriority('vault_media'),'interactive');
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
