import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLiveHandler as sourceHandler} from '../supabase/functions/bruff-live/handler.js';
import {tickets} from '../supabase/functions/bruff-live/actions.js';
const createLiveHandler=process.env.BRUFF_TEST_BUNDLE?await(async()=>{const code=await readFile(process.env.BRUFF_TEST_BUNDLE,'utf8');return (await import('data:text/javascript;base64,'+Buffer.from(code.slice(0,code.lastIndexOf('Deno.serve('))).toString('base64'))).createLiveHandler})():sourceHandler;
const workspace='00000000-0000-4000-8000-000000000001',creator='00000000-0000-4000-8000-000000000002',other='00000000-0000-4000-8000-000000000003',action='00000000-0000-4000-8000-000000000004';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers});
function fixture({liked=false,own=false,wrongMessage=false,wrongFan=false,denied=false,revokeAt=Infinity,writeEnabled=true,readStatus=200,mutationStatus=200,mutationResult=true,timeout=false,safety=false}={}){
 const calls=[],checks=[];let binding='acct_fixture';
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'fixture-public',providerKey:'fixture-private',serviceKey:'fixture-server',writeEnabled,onFailure:()=>{},fetcher:async(url,options={})=>{
  const payload=options.body&&!(options.body instanceof FormData)?JSON.parse(options.body):null;
  if(url.endsWith('/auth/v1/user'))return json({id:'fixture-actor',email_confirmed_at:'yes'});
  if(url.includes('/rpc/bruff_provider_read_gate'))return json(payload.op==='block'?{allowed:false,retryAfter:payload.wait_seconds}:{allowed:true});
  if(url.includes('/rpc/bruff_live_authorize')){checks.push(payload);assert.equal(payload.p,'send');return denied||checks.length>=revokeAt?json({},403):json(payload.c===other?'acct_other':binding)}
  if(url.includes('/rpc/bruff_chat_screen'))return json({allowed:!safety,blocked:safety});
  if(url.includes('/rpc/bruff_message_begin'))return json({name:'Fixture worker',messageId:null});
  if(url.includes('/rpc/bruff_message_finish'))return json(null);
  calls.push({url,method:options.method||'GET',headers:options.headers,body:payload});
  const target=url.match(/\/conversations\/(\d+)\/messages\/(\d+)$/);
  if(target)return json({id:wrongMessage?88:Number(target[2]),isFromMe:own,fromUserId:wrongFan?999:Number(target[1]),isLiked:liked},readStatus,{'Retry-After':'7'});
  if(url.endsWith('/like')){if(timeout)throw Error('fixture timeout');return json({success:mutationResult},mutationStatus,{'Retry-After':'11'})}
  if(url.endsWith('/messages')&&options.method==='POST')return json({id:99,createdAt:'2026-11-04T00:00:00Z'});
  throw Error('Unexpected fixture request');
 }});
 return {calls,checks,setBinding:value=>binding=value,async call(input){const response=await handler(new Request('https://fixture.test',{method:'POST',headers:{Authorization:'Bearer fixture-session','Content-Type':'application/json'},body:JSON.stringify({workspace_id:workspace,creator_id:creator,...input})}));return {status:response.status,headers:response.headers,body:await response.json()}}};
}
const like=(liked=true,extra={})=>({operation:'like_message',conversation_id:'12',message_id:'77',liked,action_id:action,...extra});
const prepare=extra=>({operation:'prepare_send',conversation_id:'12',text:'Fixture response',attachments:[],replyTo:'77',...extra});
const mutations=f=>f.calls.filter(call=>call.method!=='GET');

test('explicit like and unlike use canonical verbs and report their desired state',async()=>{
 for(const [current,desired,method]of [[false,true,'POST'],[true,false,'DELETE']]){
  const f=fixture({liked:current}),r=await f.call(like(desired));assert.equal(r.status,200);assert.deepEqual(r.body.data,{id:'77',isLiked:desired});
  assert.deepEqual(f.calls.map(c=>c.method),['GET',method]);assert.match(f.calls[0].url,/acct_fixture\/conversations\/12\/messages\/77$/);assert.match(f.calls[1].url,/\/messages\/77\/like$/);
  assert.match(f.calls[1].headers['Idempotency-Key'],/^bruff-like-[a-f0-9]{64}$/);assert.equal(f.checks.length,3);
 }
});
test('already requested like state is a verified no-op in either direction',async()=>{
 for(const liked of [false,true]){const f=fixture({liked}),r=await f.call(like(liked));assert.equal(r.status,200);assert.equal(r.body.data.isLiked,liked);assert.equal(mutations(f).length,0);assert.equal(f.checks.length,2)}
});
test('like idempotency is stable per action and isolated by creator, fan and desired state',async()=>{
 const f=fixture();await f.call(like());await f.call(like());const keys=mutations(f).map(c=>c.headers['Idempotency-Key']);assert.equal(keys[0],keys[1]);
 await f.call(like(true,{creator_id:other}));await f.call(like(true,{conversation_id:'13'}));await f.call(like(true,{action_id:other}));
 assert.equal(new Set(mutations(f).map(c=>c.headers['Idempotency-Key'])).size,4);
 const reverse=fixture({liked:true});await reverse.call(like(false));assert.notEqual(mutations(reverse)[0].headers['Idempotency-Key'],keys[0]);
});
test('unlike cannot bypass message ownership, write permissions or post-read authorization',async()=>{
 for(const config of [{writeEnabled:false},{denied:true},{own:true},{wrongMessage:true},{wrongFan:true},{revokeAt:2}]){const f=fixture({...config,liked:true});assert.ok((await f.call(like(false))).status>=400);assert.equal(mutations(f).length,0)}
 const f=fixture({liked:true,revokeAt:3});assert.equal((await f.call(like(false))).status,403);assert.equal(mutations(f).length,1);
});
test('malformed desired state, action IDs and action fields on other operations are rejected before provider calls',async()=>{
 const f=fixture();for(const input of [like('false'),like(false,{action_id:'bad'}),like(false,{message_id:'77/like'}),prepare({liked:false}),{operation:'inbox',liked:true}])assert.equal((await f.call(input)).status,400);
 assert.equal(f.calls.length,0);
});
test('rate-limited reads and writes retain Retry-After and never retry their action automatically',async()=>{
 for(const [config,expected,calls]of [[{readStatus:429},7,1],[{mutationStatus:429},11,2]]){const f=fixture(config),r=await f.call(like());assert.equal(r.status,429);assert.equal(r.body.retryAfter,expected);assert.equal(r.headers.get('Retry-After'),String(expected));assert.equal(f.calls.length,calls)}
 for(const config of [{timeout:true},{mutationStatus:503},{mutationResult:false}]){const f=fixture(config),r=await f.call(like());assert.ok(r.status>=400);assert.equal(mutations(f).length,1)}
});
test('reply preparation verifies the fan message without sending and binds the numeric parent into its reviewed ticket',async()=>{
 const f=fixture(),p=await f.call(prepare());assert.equal(p.status,200);assert.equal(p.body.data.replyTo,'77');assert.deepEqual(f.calls.map(c=>c.method),['GET']);
 assert.equal((await f.call({operation:'send_message',ticket:p.body.data.ticket})).status,200);
 const sent=mutations(f)[0];assert.match(sent.url,/acct_fixture\/conversations\/12\/messages$/);assert.equal(sent.body.replyTo,77);assert.equal(sent.body.text,'Fixture response');assert.equal(sent.body.price,0);assert.deepEqual(sent.body.media,[]);
});
test('a paid reply binds its parent, text, media and price into the same immutable reviewed payload',async()=>{
 const f=fixture(),capability=await tickets('fixture-private',JSON.stringify(['fixture-actor',workspace,creator,'acct_fixture'])),attachment=await capability.sign('attachment',42);
 const p=await f.call(prepare({text:'Fixture paid reply',attachments:[attachment],price:12.5}));assert.equal(p.status,200);assert.equal(mutations(f).length,0);
 await f.call({operation:'send_message',ticket:p.body.data.ticket,price:0,text:'Cannot replace reviewed text'});
 assert.deepEqual(mutations(f)[0].body,{text:'Fixture paid reply',media:[42],price:12.5,lockedText:false,typingWpm:200,replyTo:77});
});
test('forged or stale reply targets cannot be prepared or injected into a reviewed send',async()=>{
 for(const replyTo of ['77/like','077','0','9007199254740992',77,{},true]){const f=fixture();assert.equal((await f.call(prepare({replyTo}))).status,400);assert.equal(f.calls.length,0)}
 for(const config of [{own:true},{wrongMessage:true},{wrongFan:true},{readStatus:404},{revokeAt:2},{writeEnabled:false},{safety:true}]){const f=fixture(config);assert.ok((await f.call(prepare())).status>=400);assert.equal(mutations(f).length,0)}
 const f=fixture(),p=await f.call(prepare());assert.equal((await f.call({operation:'send_message',ticket:p.body.data.ticket,replyTo:'88'})).status,400);assert.equal(mutations(f).length,0);
 f.setBinding('acct_reconnected');assert.equal((await f.call({operation:'send_message',ticket:p.body.data.ticket})).status,400);assert.equal(mutations(f).length,0);
});
test('reviewed replies retain the same parent and idempotency key across retries; normal sends remain unchanged',async()=>{
 const f=fixture(),p=await f.call(prepare());for(let i=0;i<2;i++)assert.equal((await f.call({operation:'send_message',ticket:p.body.data.ticket,conversation_id:'999'})).status,200);
 const sends=mutations(f);assert.equal(sends[0].body.replyTo,77);assert.deepEqual(sends[0].body,sends[1].body);assert.equal(sends[0].headers['Idempotency-Key'],sends[1].headers['Idempotency-Key']);
 const normal=fixture(),plain=await normal.call(prepare({replyTo:null}));assert.equal(plain.status,200);assert.equal(normal.calls.length,0);await normal.call({operation:'send_message',ticket:plain.body.data.ticket});assert.equal(Object.hasOwn(mutations(normal)[0].body,'replyTo'),false);
});
