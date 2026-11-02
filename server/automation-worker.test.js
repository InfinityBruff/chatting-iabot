import test from 'node:test';
import assert from 'node:assert/strict';
import {automationPage,runAutomationTick} from '../supabase/functions/bruff-live/automation-worker.js';
const base={id:'a',binding:'acct_a',lease:'l',config:{type:'mass',audience:'selected',recipients:['123'],text:'Hola'},scan_done:false};
test('scheduler with no owner activation makes no provider requests',async()=>{
 let requests=0;assert.deepEqual(await runAutomationTick({token:'x',rpc:async()=>[],fetcher:async()=>requests++,writeEnabled:true}),{checked:0});assert.equal(requests,0);
});
test('disabled server never performs a provider write',async()=>{
 const calls=[];await runAutomationTick({rpc:async(_,v)=>{calls.push(v);return v.op==='claim'?[base]:{}},fetcher:async()=>assert.fail(),writeEnabled:false});assert.match(calls.at(-1).payload.error,/deshabilitados/);
});
test('delivery checks access twice, uses model binding and confirms provider id',async()=>{
 const ops=[],requests=[];let next=0;
 await runAutomationTick({writeEnabled:true,providerKey:'test',rpc:async(_,v)=>{ops.push(v);return v.op==='claim'?[base]:v.op==='next'?next++?null:{id:'d',fan_id:'123',text:'Hola'}:{ok:true}},fetcher:async(url,options)=>{requests.push({url,options});return Response.json({id:999})}});
 assert.equal(requests.length,1);assert.match(requests[0].url,/acct_a\/conversations\/123\/messages$/);assert.equal(requests[0].options.headers['Idempotency-Key'],'bruff-auto-d');assert.equal(ops.filter(v=>v.op==='check').length,2);assert.equal(ops.find(v=>v.op==='finish').payload.messageId,'999');
});
test('uncertain provider response is recorded and is never automatically retried',async()=>{
 let writes=0;const ops=[];
 await runAutomationTick({writeEnabled:true,rpc:async(_,v)=>{ops.push(v);return v.op==='claim'?[base]:v.op==='next'?{id:'d',fan_id:'123',text:'Hola'}:{}},fetcher:async()=>{writes++;throw Error('timeout')}});
 assert.equal(writes,1);assert.equal(ops.find(v=>v.op==='finish').payload.messageId,undefined);
});
test('revocation after discovery prevents any message',async()=>{
 let checks=0,writes=0;
 await runAutomationTick({writeEnabled:true,rpc:async(_,v)=>v.op==='claim'?[base]:v.op==='check'?(++checks===1?{}:null):v.op==='next'?{id:'d',fan_id:'123'}:{},fetcher:async()=>writes++});assert.equal(writes,0);
});
test('welcome excludes old, renewal, future and undated events',()=>{
 const t=Date.now(),rule={config:{type:'welcome'},activated_at:new Date(t-10000).toISOString()};
 const notification=(id,type,ms)=>({userId:id,type,createdAt:new Date(ms).toISOString()});
 assert.deepEqual(automationPage(rule,{notifications:[notification(1,'subscribed',t-1000),notification(2,'subscribed',t-20000),notification(3,'renewed',t-1000),notification(4,'subscribed',t+10000),{userId:5,type:'subscribed'}],hasMore:false}).fans,[{id:'1'}]);
});
test('discovery requires explicit complete/cursor and never conflates model pages',()=>{
 assert.throws(()=>automationPage({config:{type:'online'},cursor:'same'},{followings:[],hasMore:true,cursor:'same'}));
 assert.throws(()=>automationPage({config:{type:'mass'}},{fans:[]}));
 assert.deepEqual(automationPage({config:{type:'online'}},{followings:[{id:23},{id:23},{id:'bad'}],hasMore:false}).fans,[{id:'23'}]);
});
test('online recent conversation skips without sending, another model still proceeds',async()=>{
 const online={...base,id:'online',binding:'acct_online',config:{type:'online',skipRecent:true}};
 const requests=[],seen=new Set(),ops=[];
 await runAutomationTick({writeEnabled:true,rpc:async(_,v)=>{ops.push(v);if(v.op==='claim')return [online,base];if(v.op==='next'){if(seen.has(v.rule_id))return null;seen.add(v.rule_id);return {id:'delivery-'+v.rule_id,fan_id:'123',text:'Hola',created_at:new Date().toISOString()}}return {}},fetcher:async(url,options)=>{requests.push(url);if(url.includes('followings'))return Response.json({followings:[{id:123}],hasMore:false});if(url.includes('?pages=1'))return Response.json({messages:[{createdAt:new Date().toISOString()}]});return Response.json({id:444})}});
 assert.equal(requests.filter(u=>u.endsWith('/messages')).length,1);assert.match(requests.find(u=>u.endsWith('/messages')),/acct_a/);assert.equal(ops.filter(v=>v.op==='skip').length,1);
});
test('collections are read per model, deduplicated and partial groups block all sends',async()=>{
 for(const complete of [true,false]){let page,writes=0;const ops=[];await runAutomationTick({writeEnabled:true,rpc:async(_,v)=>{ops.push(v);if(v.op==='claim')return [{...base,config:{...base.config,audience:'collections',listIds:['group1','group2']}}];if(v.op==='page')page=v.payload;return v.op==='next'?null:{ok:true}},fetcher:async(url,options)=>{if(options.method==='POST')writes++;const id=url.split('/').at(-1);return Response.json({id,usersCount:complete?2:3,users:[{id:1},{id:2}]})}});assert.equal(writes,0);if(complete)assert.deepEqual(page.fans,[{id:'1'},{id:'2'}]);else{assert.equal(page,undefined);assert.match(ops.at(-1).payload.error,/incompleta/)} }
});
