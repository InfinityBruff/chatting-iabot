import test from 'node:test';
import assert from 'node:assert/strict';
import {createMemoryHandler} from '../supabase/functions/bruff-memory/handler.js';

const actor='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',w='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444',batch='a'.repeat(64);
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
function fixture(options={}){
 const calls=[],writes=[],states=[],catalog={ownerId:owner,workspaceId:w,creatorId:c,batchHash:batch,sourceUsername:'model_a',folders:[{id:'folder1',name:'Script 1',orderConfirmed:false,items:[{id:'77',type:'video',label:'V01',configuredPriceCents:null}]}]},empty={version:0,cursor:null,historyComplete:false,recentCheckedAt:null,historyCheckedAt:null,pages:0};let checks=0,progress={observations:[],scan:{...empty,...options.scan}};
 const store={readCatalog:async(scope)=>{calls.push({kind:'catalog',scope});return {...catalog,...options.catalog}},readProgress:async(scope)=>{calls.push({kind:'progress',scope});return structuredClone(progress)},writeObservations:async(scope,values)=>{writes.push({scope,values});progress.observations.push(...values);options.onWrite?.()},saveScan:async(scope,version,next)=>{states.push({scope,version,next});if(options.conflict)throw Object.assign(Error('private SQL'),{code:'MEMORY_CONFLICT'});progress.scan={version:version+1,...next}}};
 const fetcher=async(url,init)=>{
  const body=init.body?JSON.parse(init.body):undefined;calls.push({url,body,init});assert.equal(init.redirect,'error');assert.equal(init.headers.Authorization,'Bearer user-session');assert.equal(init.headers.apikey,'public-key');
  if(url==='https://auth.test/auth/v1/user')return response(options.user||{id:actor,email_confirmed_at:'2026-11-07T00:00:00Z'});
  if(url==='https://auth.test/rest/v1/rpc/bruff_live_authorize'){checks++;return options.authorize?.(checks)||response('acct_connection_a')}
  if(url==='https://auth.test/functions/v1/bruff-live'&&body.operation==='profile')return response({data:{id:'9',username:options.username||'model_a'}});
  if(url==='https://auth.test/functions/v1/bruff-live'&&body.operation==='messages')return options.messagesResponse||response({data:{messages:options.messages||[{id:'88',isFromMe:true,createdAt:'2026-11-06T12:00:00Z',price:6,isOpened:true,media:[{id:'77',type:'video'}]}],hasMore:options.hasMore??true,cursor:options.cursor===undefined?'older-a':options.cursor}});
  throw Error('Unexpected route');
 };
 const handler=createMemoryHandler({url:'https://auth.test',anonKey:'public-key',catalogBatch:batch,enabled:true,store,fetcher,...options.config});
 const run=(patch={},headers={},method='POST')=>handler(new Request('https://edge.test',{method,headers:{Authorization:'Bearer user-session','Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify({operation:'read',workspace_id:w,creator_id:c,conversation_id:'55',...patch})}:{})}));
 return{run,calls,writes,states,handler};
}
test('read uses live identity and permission, scoped cloud catalog, and never sends or generates',async()=>{
 const f=fixture(),r=await f.run(),d=await r.json();assert.equal(r.status,200);assert.equal(d.actorId,actor);assert.equal(d.creatorId,c);assert.equal(d.fanId,'55');assert.equal(d.sendsEnabled,false);assert.equal(f.writes.length,0);assert.equal(f.states.length,0);assert.equal(r.headers.get('Cache-Control'),'no-store');
 assert.ok(f.calls.filter(x=>x.url?.endsWith('bruff_live_authorize')).every(x=>x.body.p==='read'&&x.body.w===w&&x.body.c===c));
 for(const x of f.calls.filter(x=>x.kind==='progress'))assert.deepEqual(x.scope,{ownerId:owner,actorId:actor,workspaceId:w,creatorId:c,fanId:'55',binding:'acct_connection_a',batchHash:batch});
 assert.ok(!f.calls.some(x=>x.body?.operation==='messages'||/send|like|drafts|runner|cloudflare|campaign/iu.test(x.url||'')));
});
test('sync records only provider metadata before advancing its checkpoint; opened never confirms a purchase',async()=>{
 const f=fixture(),r=await f.run({operation:'sync',scan:'recent'}),d=await r.json();assert.equal(r.status,200);assert.equal(f.writes.length,1);assert.equal(f.writes[0].values[0].priceCents,600);assert.equal(f.writes[0].values[0].paidConfirmed,false);assert.equal(d.progress.scan.cursor,'older-a');assert.equal(d.progress.scan.historyComplete,false);
 const provider=f.calls.find(x=>x.body?.operation==='messages');assert.deepEqual(provider.body,{workspace_id:w,creator_id:c,operation:'messages',conversation_id:'55',background:true});
 assert.ok(!JSON.stringify(f.writes).includes('user-session'));assert.ok(!Object.keys(f.writes[0].values[0]).includes('text'));
});
test('recent polling preserves older cursor; another device can continue the same fan in the cloud',async()=>{
 const scan={version:4,cursor:'remaining-old',historyComplete:false,pages:8,recentCheckedAt:'2026-11-06T00:00:00Z',historyCheckedAt:'2026-11-05T00:00:00Z'};
 const recent=fixture({scan});assert.equal((await recent.run({operation:'sync',scan:'recent'})).status,200);assert.equal(recent.states[0].next.cursor,'remaining-old');assert.equal(recent.states[0].next.pages,8);
 const older=fixture({scan,hasMore:false,cursor:null}),d=await(await older.run({operation:'sync',scan:'older'})).json();assert.equal(older.calls.find(x=>x.body?.operation==='messages').body.cursor,'remaining-old');assert.equal(d.progress.scan.historyComplete,true);assert.equal(d.progress.scan.pages,9);assert.equal(d.progress.scan.recentCheckedAt,scan.recentCheckedAt);
});
test('completed older scan performs no provider read or state write',async()=>{const f=fixture({scan:{version:2,historyComplete:true,pages:2}});assert.equal((await f.run({operation:'sync',scan:'older'})).status,200);assert.equal(f.writes.length,0);assert.ok(!f.calls.some(x=>x.body?.operation==='messages'))});
test('strict request rejects untrusted bindings, observations, SQL and write/send operations before network',async()=>{
 for(const patch of [{actor_id:actor},{binding:'acct_other'},{observations:[]},{sql:'SELECT 1'},{operation:'send'},{operation:'activate'},{operation:'read',scan:'recent'},{conversation_id:'001'},{creator_id:'bad'}]){const f=fixture();assert.equal((await f.run(patch)).status,400);assert.equal(f.calls.length,0)}
 const origin=fixture();assert.equal((await origin.run({}, {Origin:'https://evil.test'})).status,403);assert.equal(origin.calls.length,0);
});
test('revoked access or replaced binding prevents cloud writes and late responses',async()=>{
 for(const change of [()=>response({code:'42501'},403),()=>response('acct_connection_b')]){
  const f=fixture({authorize:n=>n>=3?change():response('acct_connection_a')});const r=await f.run({operation:'sync'});assert.equal(r.status,403);assert.equal(f.writes.length,0);assert.equal((await r.json()).catalog,undefined);
 }
 const read=fixture({authorize:n=>n>=3?response({code:'42501'},403):response('acct_connection_a')});assert.equal((await read.run()).status,403);
});
test('connection mismatch or foreign catalog fails closed without writing or reading a fan transcript',async()=>{
 for(const options of [{username:'another_model'},{catalog:{workspaceId:owner}},{catalog:{creatorId:owner}},{catalog:{batchHash:'b'.repeat(64)}}]){const f=fixture(options),r=await f.run({operation:'sync'});assert.equal(r.status,409);assert.equal(f.writes.length,0);assert.ok(!f.calls.some(x=>x.body?.operation==='messages'))}
});
test('bad pagination and provider throttling never advance coverage',async()=>{
 for(const option of [{hasMore:true,cursor:null},{scan:{version:2,cursor:'same',pages:1},cursor:'same'},{messagesResponse:response({error:'quota'},429,{'Retry-After':'45'})}]){const f=fixture(option),r=await f.run({operation:'sync',scan:'older'});assert.ok([409,429,503].includes(r.status));assert.equal(f.states.length,0);assert.equal(f.writes.length,0);if(r.status===429)assert.equal(r.headers.get('Retry-After'),'45')}
});
test('CAS conflict preserves metadata for idempotent retry but never pretends the checkpoint advanced',async()=>{const f=fixture({conflict:true}),r=await f.run({operation:'sync'});assert.equal(r.status,409);assert.equal((await r.json()).code,'MEMORY_CONFLICT');assert.equal(f.writes.length,1);assert.equal(f.states.length,1)});
test('missing configuration, unconfirmed identity and wrong methods stay closed',async()=>{
 for(const options of [{config:{enabled:false}},{config:{catalogBatch:'not-a-hash'}}]){const f=fixture(options);assert.equal((await f.run()).status,503);assert.ok(!f.calls.some(x=>x.kind==='catalog'))}
 for(const user of [{id:actor,email_confirmed_at:null},{id:actor,email_confirmed_at:'today',is_anonymous:true}]){const f=fixture({user});assert.equal((await f.run()).status,401);assert.equal(f.writes.length,0)}
 assert.equal((await fixture().run({}, {},'GET')).status,405);
});
