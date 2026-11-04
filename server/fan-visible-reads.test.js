import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {createLiveHandler as sourceHandler} from '../supabase/functions/bruff-live/handler.js';
const createLiveHandler=process.env.BRUFF_TEST_BUNDLE?await(async()=>{const code=await readFile(process.env.BRUFF_TEST_BUNDLE,'utf8');return (await import('data:text/javascript;base64,'+Buffer.from(code.slice(0,code.lastIndexOf('Deno.serve('))).toString('base64'))).createLiveHandler})():sourceHandler;
const w='00000000-0000-0000-0000-000000000001',c='20000000-0000-0000-0000-000000000001',operations=['fan_profile','fan_history','fan_spend','fan_spend_batch','fan_activity','presence'];
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const input=(operation,extra={})=>({workspace_id:w,creator_id:c,operation,conversation_id:'123',start:'2026-10-01',...(operation==='fan_spend_batch'?{user_ids:['123','456']}:{}),...extra});
const request=(body,signal)=>new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify(body),...(signal?{signal}:{})});
function providerData(operation){return operation==='fan_profile'?{id:123,name:'Synthetic fan',subscribedOn:true}:operation==='fan_history'?{fanId:123,history:{list:[]}}:operation==='fan_spend'||operation==='fan_spend_batch'?{fans:[{fanId:123,available:true,total:42}]}:operation==='fan_activity'?{transactions:[],hasMore:false}:{followings:[{id:123}],hasMore:false}}
function fixture(operation,{provider,gateAllowed=true,revoke=false,denied=false,queued=false,limited=false,slots=true}={}){
 const calls=[],entered=deferred();let authorizations=0;
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'public-fixture',providerKey:'provider-fixture',serviceKey:'service-fixture',readSlotEnabled:slots,onFailure:()=>{},fetcher:async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return json({id:'actor',email_confirmed_at:'yes'});
  if(url.includes('bruff_live_authorize')){const body=JSON.parse(options.body);assert.deepEqual(body,{w,c,p:'read'});authorizations++;return denied||revoke&&authorizations>1?json({},403):json('acct_fixture')}
  if(url.includes('bruff_provider_read_gate')){const body=JSON.parse(options.body);calls.push({kind:'gate',op:body.op});return json(body.op==='block'||!gateAllowed?{allowed:false,retryAfter:7}:{allowed:true})}
  if(url.includes('bruff_provider_read_slot')){const body=JSON.parse(options.body);calls.push({kind:'slot',...body});if(body.op==='acquire'){if(queued){entered.resolve();return json({allowed:false,retryAfterMs:50})}return json({allowed:true,lease:body.lease_id})}return json({released:true,cancelled:true})}
  assert.equal(new URL(url).pathname.split('/')[3],'acct_fixture');assert.equal(Object.hasOwn(options,'readPriority'),false);calls.push({kind:'provider',url,signal:options.signal});entered.resolve(options.signal);
  if(provider)return provider(url,options);
  return json(limited?{}:providerData(operation),limited?429:200,limited?{'Retry-After':'7'}:{});
 }});
 return {calls,entered:entered.promise,invoke:(extra={},signal)=>handler(request(input(operation,extra),signal)),handler};
}
test('only explicit visible fan GET demand uses foreground capacity; default callers remain background',async()=>{
 for(const operation of operations)for(const foreground of [undefined,false,true]){
  const f=fixture(operation),response=await f.invoke(foreground===undefined?{}:{foreground});assert.equal(response.status,200);
  assert.equal(f.calls.filter(call=>call.kind==='provider').length,1);assert.equal(f.calls.find(call=>call.kind==='slot'&&call.op==='acquire').priority,foreground===true?'foreground':'background');assert.ok(f.calls.some(call=>call.kind==='gate'&&call.op==='check'));
 }
});
test('foreground flags are strictly typed, operation allowlisted, and cannot promote activity continuations or oversized batches',async()=>{
 for(const foreground of [null,'true',1,[],{}]){const f=fixture('fan_profile');assert.equal((await f.invoke({foreground})).status,400);assert.equal(f.calls.length,0)}
 for(const operation of ['send_message','prepare_send','like_message','earnings','monthly','balances','transactions','inbox','messages','profile','accounts','vault_media','notifications'])for(const foreground of [false,true]){const f=fixture(operation);assert.equal((await f.invoke({foreground})).status,400);assert.equal(f.calls.length,0)}
 const cursor=fixture('fan_activity');assert.equal((await cursor.invoke({foreground:true,cursor:'older'})).status,400);assert.equal(cursor.calls.length,0);
 for(const user_ids of [[],Array.from({length:21},(_,i)=>String(i+1)),['123',4],['../123']]){const f=fixture('fan_spend_batch');assert.equal((await f.invoke({foreground:true,user_ids})).status,400);assert.equal(f.calls.filter(call=>call.kind==='provider').length,0)}
 for(const extra of [{readPriority:'foreground'},{providerGateChecked:true},{gateChecked:true}]){const f=fixture('fan_profile');assert.equal((await f.invoke({foreground:true,...extra})).status,400);assert.equal(f.calls.length,0)}
});
test('visible fan reads preserve initial and final authorization and do not expose revoked data',async()=>{
 for(const operation of operations){const denied=fixture(operation,{denied:true});assert.equal((await denied.invoke({foreground:true})).status,403);assert.equal(denied.calls.length,0);const revoked=fixture(operation,{revoke:true}),response=await revoked.invoke({foreground:true});assert.equal(response.status,403);assert.equal((await response.json()).data,undefined);assert.equal(revoked.calls.filter(call=>call.kind==='provider').length,1)}
});
test('foreground fan demand still respects the shared server gate and provider Retry-After',async()=>{
 for(const operation of operations){
  const gated=fixture(operation,{gateAllowed:false}),gateResponse=await gated.invoke({foreground:true}),gateBody=await gateResponse.json();assert.equal(gateResponse.status,operation==='presence'?200:429);assert.equal(gated.calls.filter(call=>call.kind==='provider').length,0);assert.equal(operation==='presence'?gateBody.data.retryAfter:gateBody.retryAfter,7);
  const limited=fixture(operation,{limited:true}),response=await limited.invoke({foreground:true}),body=await response.json();assert.equal(response.status,operation==='presence'?200:429);assert.equal(operation==='presence'?body.data.retryAfter:body.retryAfter,7);assert.ok(limited.calls.some(call=>call.kind==='gate'&&call.op==='block'));
 }
});
test('all fan read kinds forward request abort and release their acquired lease',async()=>{
 for(const operation of operations){const controller=new AbortController(),f=fixture(operation,{provider:(_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true}))});const pending=f.invoke({foreground:true},controller.signal),signal=await f.entered;controller.abort();const response=await pending;assert.equal(signal.aborted,true);assert.equal(response.status,499);assert.equal((await response.json()).data,undefined);assert.equal(f.calls.at(-1).op,'release')}
});
test('abandoned queued fan demand cancels the ticket without a provider request',async()=>{
 for(const operation of ['fan_spend_batch','presence','fan_activity']){const controller=new AbortController(),f=fixture(operation,{queued:true});const pending=f.invoke({foreground:true},controller.signal);await f.entered;controller.abort();assert.equal((await pending).status,499);assert.deepEqual(f.calls.map(call=>call.op),['acquire','cancel'])}
});
test('abort after response headers suppresses fan JSON bodies, including presence and batches',async()=>{
 for(const operation of operations){let finish;const controller=new AbortController(),f=fixture(operation,{provider:()=>new Response(new ReadableStream({start(stream){finish=()=>{stream.enqueue(new TextEncoder().encode(JSON.stringify(providerData(operation))));stream.close()}}}))});const pending=f.invoke({foreground:true},controller.signal);await f.entered;await new Promise(resolve=>setImmediate(resolve));controller.abort();finish();const response=await pending;assert.equal(response.status,499);assert.equal((await response.json()).data,undefined)}
});
