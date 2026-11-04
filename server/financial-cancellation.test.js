import test from 'node:test';import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLiveHandler as sourceHandler} from '../supabase/functions/bruff-live/handler.js';
const createLiveHandler=process.env.BRUFF_TEST_BUNDLE?await(async()=>{const code=await readFile(process.env.BRUFF_TEST_BUNDLE,'utf8');return (await import('data:text/javascript;base64,'+Buffer.from(code.slice(0,code.lastIndexOf('Deno.serve('))).toString('base64'))).createLiveHandler})():sourceHandler;
const w='00000000-0000-0000-0000-000000000001',c='20000000-0000-0000-0000-000000000001';
const json=(value,status=200)=>new Response(JSON.stringify(value),{status});
const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return {promise,resolve}};
const request=(operation,signal,extra={})=>new Request('https://edge.test',{method:'POST',signal,headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({workspace_id:w,creator_id:c,operation,start:'2026-10-01',end:'2026-10-31',...extra})});
function fixture(provider,{queued=false}={}){
 const calls=[],entered=deferred();
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'public-fixture',providerKey:'provider-fixture',serviceKey:'service-fixture',readSlotEnabled:true,onFailure:()=>{},fetcher:async(url,options)=>{
  if(url.endsWith('/auth/v1/user'))return json({id:'actor',email_confirmed_at:'yes'});
  if(url.includes('bruff_live_authorize'))return json('acct_current');
  if(url.includes('bruff_provider_read_gate'))return json({allowed:true});
  if(url.includes('bruff_provider_read_slot')){const input=JSON.parse(options.body);calls.push(input.op);if(input.op==='acquire'){if(queued){entered.resolve();return json({allowed:false,retryAfterMs:50})}return json({allowed:true,lease:input.lease_id})}return json({released:true,cancelled:true})}
  assert.equal(new URL(url).pathname.split('/')[3],'acct_current');calls.push('provider');entered.resolve(options.signal);return provider(url,options);
 }});
 return {handler,calls,entered:entered.promise};
}
test('single financial reads forward disposal to the provider and release their shared slot',async()=>{
 for(const operation of ['earnings','monthly','balances','transactions']){
  const controller=new AbortController(),f=fixture((_url,options)=>new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true})));
  const pending=f.handler(request(operation,controller.signal,operation==='earnings'?{category:'total'}:{})),providerSignal=await f.entered;
  controller.abort();const response=await pending;
  assert.equal(providerSignal.aborted,true);assert.equal(response.status,499);assert.deepEqual(f.calls,['acquire','provider','release']);assert.equal((await response.text()).includes('series'),false);
 }
});
test('an abandoned financial waiter cancels its ticket without calling the provider',async()=>{
 const controller=new AbortController(),f=fixture(()=>{throw Error('provider must not run')},{queued:true});
 const pending=f.handler(request('earnings',controller.signal,{category:'messages'}));await f.entered;controller.abort();
 assert.equal((await pending).status,499);assert.deepEqual(f.calls,['acquire','cancel']);
});
test('cancellation after financial response headers still suppresses the body',async()=>{
 let finishBody;const controller=new AbortController(),f=fixture(()=>new Response(new ReadableStream({start(stream){finishBody=()=>{stream.enqueue(new TextEncoder().encode(JSON.stringify({filter:'tips',series:{tips:{gross:40,total:32}}})));stream.close()}}})));
 const pending=f.handler(request('earnings',controller.signal,{category:'tips'}));await f.entered;await new Promise(resolve=>setImmediate(resolve));controller.abort();finishBody();
 const response=await pending;assert.equal(response.status,499);assert.equal((await response.text()).includes('series'),false);assert.deepEqual(f.calls,['acquire','provider','release']);
});
test('legacy earnings retain the complete response contract without inheriting page cancellation',async()=>{
 const controller=new AbortController(),gate=deferred();let gets=0,firstSignal;
 const f=fixture(async(url,options)=>{if(++gets===1){firstSignal=options.signal;await gate.promise}const category=new URL(url).searchParams.get('filter')||'total';return json({filter:category,series:{[category]:{gross:10,total:8}}})});
 const pending=f.handler(request('earnings',controller.signal));await f.entered;controller.abort();assert.equal(firstSignal.aborted,false);gate.resolve();
 const response=await pending;assert.equal(response.status,200);assert.equal(gets,7);assert.equal(Object.keys((await response.json()).data.series).length,7);
});
