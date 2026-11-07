import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogScope,validateCatalogSnapshot,catalogProgressStats,createChatDirectCatalogSource,createCatalogReader} from './chat-direct-catalog-source.js';
const actor='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333';
const context={actor,workspace,account,fanId:'99',canRead:true,canInsert:false};
const snapshot=()=>({actorId:actor,workspaceId:workspace,creatorId:account,fanId:'99',sendsEnabled:false,observedAt:'2026-11-07T10:00:00Z',catalog:{batchHash:'a'.repeat(64),folders:[{id:'folder-qa',name:'Script de QA',orderConfirmed:false,items:[{id:'101',type:'photo',label:'F01',durationLabel:null,referencePriceCents:0,configuredPriceCents:null},{id:'102',type:'video',label:'V01',durationLabel:'1:30',referencePriceCents:600,configuredPriceCents:null}]}]},progress:{observations:[],scan:{version:0,cursor:null,historyComplete:false,recentCheckedAt:null,historyCheckedAt:null,pages:0}}});
const observation=(mediaId='101',patch={})=>({folderId:'folder-qa',mediaId,messageId:'500',createdAt:'2026-11-07T09:00:00Z',kind:'offered',priceCents:1800,openedReported:true,paidConfirmed:false,...patch});
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let time=0,id=0;const timers=new Map();return{now:()=>time,setTimer:(fn,ms)=>{timers.set(++id,{fn,at:time+ms});return id},clearTimer:id=>timers.delete(id),async tick(ms){time+=ms;for(const [id,timer] of [...timers])if(timer.at<=time){timers.delete(id);timer.fn()}await flush()},timers}}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}

test('read and each explicit sync use only the fixed endpoint and active scope; read-only workers need no insert permission',async()=>{
 const calls=[],source=createChatDirectCatalogSource({functions:{invoke:async(...args)=>{calls.push(args);return{data:snapshot()}}}},{actor,workspace});
 await source.read(context);await source.sync(context,{scan:'recent'});await source.sync(context,{scan:'older'});
 assert.deepEqual(calls.map(([endpoint,{body}])=>[endpoint,body]),['read','recent','older'].map((operation,index)=>['bruff-memory',{operation:index?'sync':'read',workspace_id:workspace,creator_id:account,conversation_id:'99',...(index?{scan:operation}:{})}]));
 assert.equal(catalogScope({...context,fanId:99}),null);assert.equal(calls.length,3);
 for(const patch of [{actor:account},{workspace:actor},{canRead:false},{fanId:'https://invalid'}])await assert.rejects(source.read({...context,...patch}),error=>error.status===403);
 await assert.rejects(source.sync(context,{scan:'all'}),error=>error.status===400);assert.equal(calls.length,3);
});

test('cross-scope responses fail closed and output strips opaque URLs and arbitrary provider data',()=>{
 for(const key of ['actorId','workspaceId','creatorId','fanId']){const value=snapshot();value[key]=key==='fanId'?'100':actor===value[key]?workspace:actor;assert.throws(()=>validateCatalogSnapshot(value,context),error=>error.status===403)}
 const value=snapshot();value.secret='not output';value.catalog.folders[0].items[0].url='https://invalid';const clean=validateCatalogSnapshot(value,context);assert.equal(clean.secret,undefined);assert.equal(clean.catalog.folders[0].items[0].url,undefined);assert.equal(clean.sendsEnabled,false);
});

test('prices, unconfirmed order and payment status are strict; numeric unsafe IDs and orphan matches are refused',()=>{
 const changes=[value=>value.sendsEnabled=true,value=>value.catalog.folders[0].orderConfirmed=true,value=>value.catalog.folders[0].items[0].configuredPriceCents=1,value=>value.catalog.folders[0].items[0].id=101,value=>value.catalog.folders[0].items[0].referencePriceCents=-1,value=>value.progress.observations=[observation('999')],value=>value.progress.observations=[observation('101',{paidConfirmed:true})],value=>value.progress.observations=[observation('101',{kind:'free_sent'})],value=>value.progress.observations=[observation('101',{kind:'sent_price_unknown',priceCents:0})]];
 for(const change of changes){const value=snapshot();change(value);assert.throws(()=>validateCatalogSnapshot(value,context))}
});

test('a bundle with two assets counts as one offered message, and opened never means purchased or revenue',()=>{
 const value=snapshot();value.progress.observations=[observation(),observation('102'),observation('101',{messageId:'501',kind:'free_sent',priceCents:0}),observation('102',{messageId:'502',kind:'sent_price_unknown',priceCents:null}),observation()];
 const clean=validateCatalogSnapshot(value,context);assert.equal(clean.progress.observations.length,4);assert.deepEqual(catalogProgressStats(clean.progress.observations),{messages:3,media:2,offered:1,free:1,unknown:1,paidConfirmed:null});
 const conflict=snapshot();conflict.progress.observations=[observation(),observation('102',{priceCents:2000})];assert.throws(()=>validateCatalogSnapshot(conflict,context));
 const contradictory=snapshot();contradictory.progress.observations=[observation(),observation('101',{openedReported:false})];assert.throws(()=>validateCatalogSnapshot(contradictory,context));
 const unnamed=snapshot();unnamed.catalog.folders[0].items[0].label=null;assert.equal(validateCatalogSnapshot(unnamed,context).catalog.folders[0].items[0].label,null);
});

test('abort wins over a late success and safe transport errors preserve Retry-After without upstream text',async()=>{
 const pending=deferred(),controller=new AbortController(),source=createChatDirectCatalogSource({functions:{invoke:()=>pending.promise}},{actor,workspace});const read=source.read(context,{signal:controller.signal});controller.abort();pending.resolve({data:snapshot()});await assert.rejects(read,error=>error.name==='AbortError');
 for(const status of [401,403,429,503]){const source=createChatDirectCatalogSource({functions:{invoke:async()=>({error:{message:'private upstream response',context:{status,headers:new Headers({'Retry-After':'7'})}}})}},{actor,workspace});await assert.rejects(source.read(context),error=>error.status===status&&!error.message.includes('private')&&(status!==429||error.retryAfter===7))}
});

test('visible startup reads once then checks recent once; later ticks do not traverse older history automatically',async()=>{
 const time=clock(),calls=[],data=snapshot();data.progress.scan.cursor='opaque-next';const reader=createCatalogReader({read:async()=>{calls.push('read');return data},sync:async(_,options)=>{calls.push(options.scan);return data}},context,{...time});
 reader.start();await flush();assert.deepEqual(calls,['read','recent']);await time.tick(59999);assert.equal(calls.length,2);await time.tick(1);assert.deepEqual(calls,['read','recent','recent']);
 assert.equal(reader.refresh('older'),true);await flush();assert.equal(calls.at(-1),'older');await time.tick(60000);assert.equal(calls.at(-1),'recent');reader.stop();assert.equal(time.timers.size,0);
});

test('hide aborts the current request, discards its late result, and resumes serially without overlap',async()=>{
 const pending=deferred(),time=clock(),calls=[];let signal;const reader=createCatalogReader({read:(_,options)=>{calls.push('read');signal=options.signal;return calls.length===1?pending.promise:Promise.resolve(snapshot())},sync:async()=>{calls.push('recent');return snapshot()}},context,{...time});
 reader.start();await flush();reader.setVisible(false);assert.equal(signal.aborted,true);reader.setVisible(true);assert.equal(calls.length,1);pending.resolve(snapshot());await flush();assert.deepEqual(calls,['read','read','recent']);assert.equal(reader.snapshot().data.fanId,'99');reader.stop();
});

test('closing or a cache permission epoch change drops pending results and clears previously read private data',async()=>{
 let epoch=0;const time=clock(),pending=deferred();let syncs=0;const emitted=[],reader=createCatalogReader({read:async()=>snapshot(),sync:()=>{syncs++;return pending.promise}},context,{...time,getEpoch:()=>epoch,onChange:state=>emitted.push(state)});reader.start();await flush();assert.equal(syncs,1);assert.ok(reader.snapshot().data);epoch++;pending.resolve(snapshot());await flush();assert.equal(reader.snapshot().data,null);assert.equal(reader.snapshot().denied,true);assert.equal(time.timers.size,0);reader.stop();
 const late=deferred(),updates=[],closed=createCatalogReader({read:()=>late.promise,sync:async()=>snapshot()},context,{...time,onChange:state=>updates.push(state)});closed.start();await flush();closed.stop();const before=updates.length;late.resolve(snapshot());await flush();assert.equal(updates.length,before);assert.equal(closed.snapshot().data,null);
});

test('403 clears the whole view, and429 pauses manual and automatic admission until its deadline',async()=>{
 const time=clock();let calls=0;const source={read:async()=>snapshot(),sync:async()=>{calls++;throw Object.assign(new Error('Wait'),{status:429,retryAfter:120})}},reader=createCatalogReader(source,context,{...time});reader.start();await flush();assert.equal(calls,1);assert.equal(reader.refresh('recent'),false);reader.setVisible(false);await time.tick(60000);reader.setVisible(true);await flush();assert.equal(calls,1);assert.equal(reader.refresh('older'),false);await time.tick(59999);assert.equal(calls,1);await time.tick(1);assert.equal(calls,2);reader.stop();
 const denied=createCatalogReader({read:async()=>snapshot(),sync:async()=>{throw Object.assign(new Error('Denied'),{status:403})}},context,{...clock()});denied.start();await flush();assert.equal(denied.snapshot().data,null);assert.equal(denied.snapshot().denied,true);assert.equal(denied.refresh('recent'),false);denied.stop();
});

test('initial hidden state does not dispatch and a complete scan cannot request older pages',async()=>{
 const data=snapshot();data.progress.scan.historyComplete=true;let reads=0;const reader=createCatalogReader({read:async()=>{reads++;return data},sync:async()=>data},context,{...clock()});reader.setVisible(false);reader.start();await flush();assert.equal(reads,0);reader.setVisible(true);await flush();assert.equal(reads,1);assert.equal(reader.refresh('older'),false);reader.stop();
});
