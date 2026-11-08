import test from 'node:test';
import assert from 'node:assert/strict';
import {readNotificationHeads} from '../supabase/functions/bruff-live/notification-heads.js';
import {createLiveHandler as sourceHandler} from '../supabase/functions/bruff-live/handler.js';
import {readFile} from 'node:fs/promises';
const createLiveHandler=process.env.BRUFF_TEST_BUNDLE?await(async()=>{const code=await readFile(process.env.BRUFF_TEST_BUNDLE,'utf8');return(await import('data:text/javascript;base64,'+Buffer.from(code.slice(0,code.lastIndexOf('Deno.serve('))).toString('base64'))).createLiveHandler})():sourceHandler;
const w='00000000-0000-0000-0000-000000000001',c='20000000-0000-0000-0000-000000000001';
const json=(value,status=200,headers={})=>Response.json(value,{status,headers});
const page=(id='1')=>({notifications:[{id,text:'Fixture activity',raw:{secret:'not exposed'},textHtml:'private html'}],cursor:null,hasMore:false});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}};
const run=(fetcher,extra={})=>readNotificationHeads({binding:'acct_fixture',providerKey:'private-provider-fixture',fetcher,...extra});

test('one fixed binding reads precisely three first pages and sanitizes every successful branch',async()=>{
 const calls=[],result=await run(async(url,options)=>{calls.push({url:new URL(url),options});return json(page(String(calls.length)))});
 assert.deepEqual(result.heads.map(row=>row.type),['','purchases','tip']);assert.equal(calls.length,3);
 assert.deepEqual(calls.map(({url})=>url.searchParams.get('type')), [null,'purchases','tip']);
 for(const {url,options}of calls){assert.equal(url.origin,'https://api.ofmapi.com');assert.equal(url.pathname,'/v1/accounts/acct_fixture/notifications');assert.equal(url.searchParams.get('pages'),'1');assert.equal(url.searchParams.has('cursor'),false);assert.equal(options.readPriority,'background');assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.ok(options.signal)}
 assert.ok(!JSON.stringify(result).includes('private'));assert.ok(!JSON.stringify(result).includes('raw'));assert.ok(result.heads.every(row=>row.data.notifications.length===1));
});

test('a limited or failed category preserves the other two pages without fabricating an empty success',async()=>{
 const result=await run(async url=>new URL(url).searchParams.get('type')==='tip'?json({private:'hidden'},429,{'Retry-After':'180'}):json(page()));
 assert.equal(result.heads.filter(x=>x.data).length,2);assert.deepEqual(result.heads[2],{type:'tip',error:{status:429,providerStatus:429,retryAfter:180,message:'OFMAPI ha limitado esta categoría. Espera antes de actualizar.'}});
 assert.equal(Object.hasOwn(result.heads[2],'data'),false);assert.ok(!JSON.stringify(result).includes('hidden'));
});

test('the deadline returns completed branches even if one fetch ignores cancellation, and late results cannot mutate them',async()=>{
 const slow=deferred(),signals=[],start=Date.now(),result=await run(async(url,options)=>{signals.push(options.signal);return new URL(url).searchParams.get('type')==='tip'?slow.promise:json(page())},{budgetMs:8});
 assert.ok(Date.now()-start<500);assert.equal(result.heads[0].data.notifications.length,1);assert.equal(result.heads[1].data.notifications.length,1);assert.equal(result.heads[2].error.status,504);assert.ok(signals.every(signal=>signal.aborted));const before=JSON.stringify(result);slow.resolve(json(page('late')));await new Promise(r=>setImmediate(r));assert.equal(JSON.stringify(result),before);
});

test('any provider authorization denial discards all pages immediately, including slow sibling reads',async()=>{
 for(const status of [401,403]){const slow=deferred(),signals=[],started=Date.now();await assert.rejects(()=>run(async(url,options)=>{signals.push(options.signal);return new URL(url).searchParams.get('type')==='tip'?json({private:'secret'},status):slow.promise},{budgetMs:1000}),e=>e.message==='access'&&e.providerStatus===status);assert.ok(Date.now()-started<500);assert.ok(signals.every(signal=>signal.aborted));slow.resolve(json(page()))}
});

test('request cancellation cancels a stalled response body and never returns other private branches',async()=>{
 let cancelled=false;const controller=new AbortController(),pending=run(async url=>new URL(url).searchParams.get('type')==='tip'?new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('{"notifications":'));},cancel(){cancelled=true}})):json(page()),{signal:controller.signal,budgetMs:1000});setTimeout(()=>controller.abort(),5);await assert.rejects(()=>pending,e=>e.name==='AbortError');await new Promise(r=>setImmediate(r));assert.equal(cancelled,true);
});

test('oversized or malformed pages fail their branch with no truncated-success claim',async()=>{
 for(const bad of [()=>json({notifications:[],hasMore:true,cursor:null}),()=>json({notifications:'bad',hasMore:false}),()=>new Response('x'.repeat(2*1024*1024+1))]){const result=await run(async url=>new URL(url).searchParams.get('type')==='tip'?bad():json(page()));assert.equal(result.heads[2].error.status,503);assert.equal(result.heads.filter(x=>x.data).length,2)}
});

function fixture({role='owner',revoke=false,replaceBinding=false,limited=false,quota=false}={}){
 const provider=[],rpc=[],auth=[];let roles=0,bindings=0;
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'public-fixture',providerKey:'private-fixture',serviceKey:quota?'service-fixture':undefined,onFailure:()=>{},fetcher:async(url,options)=>{
  if(url.endsWith('/auth/v1/user')){auth.push(url);return json({id:'actor-fixture',email_confirmed_at:'confirmed'})}
  if(url.includes('/rest/v1/rpc/')){const name=url.split('/').at(-1),body=JSON.parse(options.body);rpc.push({name,body});if(name==='bruff_my_workspaces')return json([{id:w,role:revoke&&++roles>1?'viewer':role}]);if(name==='bruff_live_authorize')return json(replaceBinding&&++bindings>1?'acct_replaced':'acct_fixture');if(name==='bruff_provider_read_gate')return json(body.op==='block'?{allowed:false,retryAfter:body.wait_seconds}:{allowed:true});throw Error('Unexpected RPC')}
  const u=new URL(url);provider.push({url:u,options});assert.equal(u.pathname,'/v1/accounts/acct_fixture/notifications');const headers=quota?{'x-ratelimit-limit':'60','x-ratelimit-remaining':'20','x-ratelimit-reset':'1900000000','x-ratelimit-window':'60'}:{};
  return limited&&u.searchParams.get('type')==='tip'?json({},429,{...headers,'Retry-After':'17'}):json(page(),200,headers);
 }});
 return {provider,rpc,auth,request:extra=>handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer owner-fixture','Content-Type':'application/json'},body:JSON.stringify({workspace_id:w,creator_id:c,operation:'notification_heads',...extra})}))};
}

test('one Edge invocation uses one Auth call, two complete role/binding checks and exactly three provider reads',async()=>{
 const f=fixture(),response=await f.request();assert.equal(response.status,200);const body=await response.json();assert.equal(body.data.heads.length,3);assert.equal(f.auth.length,1);assert.equal(f.rpc.filter(x=>x.name==='bruff_my_workspaces').length,2);assert.equal(f.rpc.filter(x=>x.name==='bruff_live_authorize').length,2);assert.equal(f.provider.length,3);assert.equal(response.headers.get('Cache-Control'),'no-store');assert.ok(body.observedAt);
 for(const rpc of f.rpc.filter(x=>x.name==='bruff_live_authorize'))assert.deepEqual(rpc.body,{w,c,p:'read'});
});

test('the same owner/admin policy applies and denied workers cannot reach any provider branch',async()=>{
 for(const role of ['owner','admin','operator','viewer']){const f=fixture({role}),response=await f.request();assert.equal(response.status,['owner','admin'].includes(role)?200:403);assert.equal(f.provider.length,['owner','admin'].includes(role)?3:0)}
});

test('role revocation or a binding change during the three reads hides the entire result',async()=>{
 for(const option of [{revoke:true},{replaceBinding:true}]){const f=fixture(option),response=await f.request();assert.equal(response.status,403);assert.equal(f.provider.length,3);assert.ok(!(await response.text()).includes('Fixture activity'))}
});

test('batch endpoints never accept cursor, arbitrary type, extra fan, models or caller URLs',async()=>{
 for(const extra of [{cursor:'next'},{type:'tip'},{conversation_id:'77'},{user_ids:['77']},{creator_ids:[c]},{url:'https://elsewhere.test'},{background:true}]){const f=fixture(),response=await f.request(extra);assert.equal(response.status,400);assert.equal(f.provider.length,0)}
});

test('partial rate limits retain per-category RetryAfter and observed quota at the batch envelope',async()=>{
 const f=fixture({limited:true,quota:true}),response=await f.request(),body=await response.json();assert.equal(response.status,200);assert.equal(body.data.heads[2].error.retryAfter,17);assert.deepEqual(body.readQuota,{limit:60,remaining:20,reset:1900000000,window:60});assert.equal(f.provider.length,3);
});
