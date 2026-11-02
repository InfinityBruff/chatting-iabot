import {test} from 'node:test';import assert from 'node:assert/strict';
import {protectProviderReads,retrySeconds} from '../supabase/functions/bruff-live/provider-read-guard.js';
import {createLiveHandler as sourceHandler} from '../supabase/functions/bruff-live/handler.js';
import {readFile} from 'node:fs/promises';
const createLiveHandler=process.env.BRUFF_TEST_BUNDLE?await(async()=>{
 const code=await readFile(process.env.BRUFF_TEST_BUNDLE,'utf8');
 const encoded=Buffer.from(code.slice(0,code.lastIndexOf('Deno.serve('))).toString('base64');
 return (await import('data:text/javascript;base64,'+encoded)).createLiveHandler;
})():sourceHandler;
const endpoint='https://api.ofmapi.com/v1/accounts/acct_fixture/fans?pages=1';
test('Retry-After seconds, dates and missing values are bounded without shortening long waits',()=>{
 assert.equal(retrySeconds(new Headers({'retry-after':'300'})),300);
 assert.equal(retrySeconds(new Headers({'retry-after':'Wed, 21 Oct 2015 07:28:00 GMT'}),Date.parse('2015-10-21T07:27:00Z')),60);
 assert.equal(retrySeconds(new Headers()),60);assert.equal(retrySeconds(new Headers({'retry-after':'0'})),1);
});
test('shared cooldown blocks subsequent reads across instances and resumes after expiry without retrying',async()=>{
 let time=0,until=0,calls=0;
 const gate=async(op,wait=0)=>{if(op==='block')until=Math.max(until,time+wait*1000);return {allowed:until<=time,retryAfter:Math.max(0,Math.ceil((until-time)/1000))}};
 const args={gate,now:()=>time,fetcher:async()=>{calls++;return calls===1?new Response('{}',{status:429,headers:{'Retry-After':'120'}}):new Response('{}')}};
 const a=protectProviderReads(args),b=protectProviderReads(args);
 assert.equal((await a(endpoint)).status,429);assert.equal(calls,1);
 time=1000;const blocked=await b(endpoint);assert.equal(blocked.status,429);assert.equal(blocked.headers.get('retry-after'),'119');assert.equal(calls,1);
 time=120000;assert.equal((await b(endpoint)).status,200);assert.equal(calls,2);
});
test('a successful response with zero quota starts cooldown at the provider reset time',async()=>{
 const changes=[];const read=protectProviderReads({now:()=>100000,gate:async(op,wait)=>{changes.push({op,wait});return op==='check'?{allowed:true}:{allowed:false,retryAfter:wait}},fetcher:async()=>new Response('{}',{headers:{'X-RateLimit-Remaining':'0','X-RateLimit-Reset':'160'}})});
 assert.equal((await read(endpoint)).status,200);assert.deepEqual(changes,[{op:'check',wait:undefined},{op:'block',wait:60}]);
});
test('writes and authentication requests are never intercepted, replayed or retried',async()=>{
 let calls=0;const read=protectProviderReads({gate:async()=>{throw Error('must not gate writes')},fetcher:async()=>{calls++;return new Response('{}',{status:429})}});
 for(const method of ['POST','DELETE','PATCH'])assert.equal((await read(endpoint,{method})).status,429);
 await read('https://auth.test/auth/v1/user');assert.equal(calls,4);
});
test('missing coordination state fails closed before any provider read',async()=>{
 for(const gate of [async()=>null,async()=>{throw Error('unavailable')}]){let reads=0;await assert.rejects(protectProviderReads({gate,fetcher:async()=>{reads++;return new Response('{}')}})(endpoint));assert.equal(reads,0)}
});
test('authenticated fan-directory requests preserve real 429 and its delay across users without leaking provider body',async()=>{
 const w='00000000-0000-0000-0000-000000000001',c='00000000-0000-0000-0000-000000000002';let blocked=false,reads=0,checks=0;const failures=[];
 const fetcher=async(url,o)=>{
  const json=x=>new Response(JSON.stringify(x));
  if(url.endsWith('/auth/v1/user'))return json({id:'actor',email_confirmed_at:'yes'});
  if(url.includes('bruff_my_workspaces'))return json([{id:w,role:'owner'}]);
  if(url.includes('bruff_live_authorize')){checks++;return json('acct_fixture')}
  if(url.includes('bruff_provider_read_gate')){assert.equal(o.headers.Authorization,'Bearer private-fixture');const body=JSON.parse(o.body);if(body.op==='block')blocked=true;return json({allowed:!blocked,retryAfter:blocked?180:0})}
  assert.equal(o.method,'GET');reads++;return new Response('PRIVATE_PROVIDER_CONTENT',{status:429,headers:{'retry-after':'180'}});
 };
 for(const session of ['first','second']){
  const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',serviceKey:'private-fixture',providerKey:'fake',fetcher,onFailure:r=>failures.push(r)});
  const response=await handler(new Request('https://bruff.test',{method:'POST',headers:{Authorization:'Bearer '+session,'Content-Type':'application/json'},body:JSON.stringify({workspace_id:w,creator_id:c,operation:'collection_fans'})}));
  assert.equal(response.status,429);assert.equal(response.headers.get('retry-after'),'180');const body=await response.json();assert.equal(body.retryAfter,180);assert.ok(!JSON.stringify(body).includes('PRIVATE'));
 }
 assert.equal(reads,1);assert.equal(checks,2);assert.deepEqual(failures,[]);
});
