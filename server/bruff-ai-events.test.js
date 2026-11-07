import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createAiEventsHandler} from '../supabase/functions/bruff-ai-events/handler.js';
const at=Date.parse('2026-11-06T12:00:00.000Z'),current='fictional-current-webhook-secret',previous='fictional-previous-webhook-secret',id='11111111-1111-4111-8111-111111111111';
const event=(patch={})=>({event:'messages.received',event_id:id,account_id:'acct_fictional_model',occurred_at:'2026-11-06T11:59:59Z',ingested_at:'2026-11-06T12:00:00Z',source:'ws',payload:{id:999,conversation_id:123,from_user_id:123,via:'ws',message:{id:999,text:'<p>Hello 🙂</p>',user:{id:123,name:'Fictional fan'},media:[{url:'https://signed.private/secret',token:'private-capability'}]}},...patch});
async function sign(body,{key=current,time=Math.floor(at/1000)}={}){const encoder=new TextEncoder(),secret=await crypto.subtle.importKey('raw',encoder.encode(key),{name:'HMAC',hash:'SHA-256'},false,['sign']),sig=new Uint8Array(await crypto.subtle.sign('HMAC',secret,encoder.encode(time+'.'+body)));return 't='+time+',v1='+Array.from(sig,x=>x.toString(16).padStart(2,'0')).join('')}
async function request(value=event(),options={}){const raw=typeof value==='string'?value:JSON.stringify(value),headers={'Content-Type':'application/json','X-OFMAPI-Signature':await sign(raw,options),...options.headers};return new Request('https://events.test/functions/v1/bruff-ai-events',{method:'POST',headers,body:raw})}
function fixture(options={}){const queued=[],handler=createAiEventsHandler({webhookSecret:current,enabled:true,now:()=>at,enqueue:async value=>{queued.push(value);return options.result??{accepted:true,queued:true}},...options});return {handler,queued}}
const code=async response=>(await response.json()).code;

test('receiver is disabled and unsigned by default; invalid configuration never enqueues',async()=>{
 let calls=0;const disabled=createAiEventsHandler({webhookSecret:current,enqueue:()=>{calls++}}),r=await disabled(await request());assert.equal(r.status,503);assert.equal(await code(r),'EVENT_DISABLED');assert.equal(calls,0);
 for(const options of [{webhookSecret:undefined},{webhookSecret:''},{webhookSecret:' '},{webhookSecret:'invalid\nsecret'},{previousWebhookSecret:'invalid\nsecret'},{enqueue:undefined}]){const f=fixture(options),response=await f.handler(await request());assert.equal(response.status,503);assert.equal(await code(response),'EVENT_CONFIG');assert.equal(f.queued.length,0)}
 const f=fixture();assert.equal((await f.handler(new Request('https://events.test'))).status,405);assert.equal((await f.handler(await request(event(),{headers:{'Content-Type':'text/plain'}}))).status,415);assert.equal(f.queued.length,0);
});
test('valid received event queues only canonical metadata, never body text, user records, actor claims or media',async()=>{
 const input=event({actor_id:'private-actor',workspace_id:'private-workspace'});input.payload.message.text='<p>Private body</p><script>private script</script>';input.payload.message.user.name='private-name';
 const f=fixture(),response=await f.handler(await request(input));assert.equal(response.status,202);assert.deepEqual(await response.json(),{accepted:true,queued:true});assert.deepEqual(f.queued,[{event_id:id,account_id:'acct_fictional_model',occurred_at:'2026-11-06T11:59:59.000Z',ingested_at:'2026-11-06T12:00:00.000Z',source:'ws',fan_id:'123',message_id:'999',direction:'received'}]);for(const hidden of ['private','http','text','media','user','actor','workspace'])assert.ok(!JSON.stringify(f.queued).includes(hidden),hidden);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('sent direction uses from_user_id and ignores the fan recipient nested in message.user',async()=>{
 const input=event({event:'messages.sent'});input.payload.from_user_id=456;input.payload.message.user={id:123,name:'Fan recipient'};const f=fixture();assert.equal((await f.handler(await request(input))).status,202);assert.equal(f.queued[0].direction,'sent');assert.equal(f.queued[0].fan_id,'123');
 for(const modify of [x=>{x.payload.from_user_id=456},x=>{x.event='messages.sent'}]){const wrong=event();modify(wrong);const rejected=fixture(),response=await rejected.handler(await request(wrong));assert.equal(response.status,400);assert.equal(rejected.queued.length,0)}
});
test('rotation verifies both current and previous secrets through WebCrypto without early success',async t=>{
 const original=crypto.subtle.verify.bind(crypto.subtle);let checks=0;t.mock.method(crypto.subtle,'verify',(...args)=>{checks++;return original(...args)});
 for(const key of [current,previous]){const before=checks,f=fixture({previousWebhookSecret:previous}),response=await f.handler(await request(event(),{key}));assert.equal(response.status,202);assert.equal(checks-before,2);assert.equal(f.queued.length,1)}
 const f=fixture({previousWebhookSecret:previous}),r=await f.handler(await request(event(),{key:'unrelated-secret'}));assert.equal(r.status,401);assert.equal(f.queued.length,0);assert.equal(checks,6);
});
test('HMAC authenticates literal raw UTF8 bytes rather than reparsed or normalized JSON',async()=>{
 const raw=' \n'+JSON.stringify(event(),null,2)+'\n ',f=fixture();assert.equal((await f.handler(await request(raw))).status,202);
 const signature=await sign(raw);for(const body of [raw+' ',raw.replace('Hello','Altered')]){const bad=fixture(),response=await bad.handler(await request(body,{headers:{'X-OFMAPI-Signature':signature}}));assert.equal(response.status,401);assert.equal(bad.queued.length,0)}
});
test('missing, duplicate, malformed and stale signatures fail before persistence',async()=>{
 for(const header of ['', 't=1,v1=bad','t=1,v1='+'0'.repeat(64)+',t=2','t=1,v1='+'0'.repeat(64)+',v1='+'0'.repeat(64),'t=1,sha1='+'0'.repeat(64),'t=001,v1='+'0'.repeat(64)]){const f=fixture(),r=await f.handler(await request(event(),{headers:{'X-OFMAPI-Signature':header}}));assert.equal(r.status,401);assert.equal(f.queued.length,0)}
 for(const delta of [-301,301]){const f=fixture(),r=await f.handler(await request(event(),{time:Math.floor(at/1000)+delta}));assert.equal(r.status,401);assert.equal(f.queued.length,0)}
 const boundary=fixture();assert.equal((await boundary.handler(await request(event(),{time:Math.floor(at/1000)-300}))).status,202);
});
test('freshness is rechecked after body delivery, not only before reading a slow stream',async()=>{
 const raw=JSON.stringify(event()),header=await sign(raw,{time:Math.floor(at/1000)-299});let clock=at;const f=fixture({now:()=>clock}),req=new Request('https://events.test',{method:'POST',duplex:'half',headers:{'Content-Type':'application/json','X-OFMAPI-Signature':header},body:new ReadableStream({start(controller){clock=at+2000;controller.enqueue(new TextEncoder().encode(raw));controller.close()}})});assert.equal((await f.handler(req)).status,401);assert.equal(f.queued.length,0);
});
test('declared and streamed size guards cap signed bodies at256KiB without trusting parsed payloads',async()=>{
 const large=JSON.stringify(event())+' '.repeat(256*1024),f=fixture();assert.equal((await f.handler(await request(large))).status,413);assert.equal(f.queued.length,0);
 const declared=fixture();assert.equal((await declared.handler(await request(event(),{headers:{'Content-Length':String(256*1024+1)}}))).status,413);assert.equal(declared.queued.length,0);
 const valid=JSON.stringify(event()),edge=valid+' '.repeat(256*1024-new TextEncoder().encode(valid).length),boundary=fixture();assert.equal((await boundary.handler(await request(edge))).status,202);assert.equal(boundary.queued.length,1);
});
test('a silent or cancelled request body closes its reader and never calls enqueue',async()=>{
 for(const abort of [false,true]){let cancelled=0;const controller=new AbortController(),f=fixture({readTimeoutMs:5}),req=new Request('https://events.test',{method:'POST',duplex:'half',headers:{'Content-Type':'application/json','X-OFMAPI-Signature':await sign('')},signal:controller.signal,body:new ReadableStream({cancel(){cancelled++}})}),keep=setTimeout(()=>{},100);try{const pending=f.handler(req);if(abort)controller.abort();const r=await pending;assert.equal(r.status,408);assert.equal(cancelled,1);assert.equal(f.queued.length,0)}finally{clearTimeout(keep)}}
});
test('malformed signed envelopes, conflicting IDs, future times and unsafe numeric IDs fail closed',async()=>{
 const cases=['{','null','[]',event({event_id:'bad'}),event({account_id:'https://private.test'}),event({occurred_at:'2026-02-30T00:00:00Z'}),event({ingested_at:'tomorrow'}),event({source:'arbitrary'}),event({occurred_at:'2026-11-06T12:05:01Z'}),event({ingested_at:'2026-11-06T12:05:01Z'})];
 for(const patch of [{conversation_id:Number.MAX_SAFE_INTEGER+1},{from_user_id:Number.MAX_SAFE_INTEGER+1},{id:Number.MAX_SAFE_INTEGER+1},{conversation_id:'1'.repeat(25)},{via:'reconcile'},{message:{id:998}}]){const value=event();Object.assign(value.payload,patch);cases.push(value)}
 for(const input of cases){const f=fixture(),r=await f.handler(await request(input));assert.equal(r.status,400,JSON.stringify(input));assert.equal(f.queued.length,0)}
 const input=event();input.payload.id='999999999999999999999999';input.payload.message.id=input.payload.id;input.payload.conversation_id='000123';const f=fixture();assert.equal((await f.handler(await request(input))).status,202);assert.equal(f.queued[0].message_id,'999999999999999999999999');assert.equal(f.queued[0].fan_id,'123');
});
test('reconciliation can report old events while future and malformed envelope times remain guarded',async()=>{
 const input=event({source:'reconcile',occurred_at:'2026-10-01T10:00:00+00:00',ingested_at:'2026-11-06T11:59:00Z'});input.payload.via='reconcile';const f=fixture();assert.equal((await f.handler(await request(input))).status,202);assert.equal(f.queued[0].source,'reconcile');assert.equal(f.queued[0].occurred_at,'2026-10-01T10:00:00.000Z');
});
test('unhandled events are acknowledged only after a valid signature and envelope and never enqueue',async()=>{
 for(const type of ['users.online','messages.deleted','notifications.paided_message','future.event']){const f=fixture(),r=await f.handler(await request(event({event:type,payload:{untrusted:'ignored'}})));assert.equal(r.status,200);assert.deepEqual(await r.json(),{accepted:false,queued:false});assert.equal(f.queued.length,0)}
 const bad=fixture();assert.equal((await bad.handler(await request({event:'users.online'}))).status,400);assert.equal(bad.queued.length,0);
});
test('duplicate delivery relies on SQL idempotency and returns truthful accepted or queued acknowledgements',async()=>{
 const seen=new Set(),queued=[];const f=fixture({enqueue:async value=>{queued.push(value);const duplicate=seen.has(value.event_id);seen.add(value.event_id);return {accepted:true,queued:!duplicate}}});assert.equal((await f.handler(await request())).status,202);const duplicate=await f.handler(await request());assert.equal(duplicate.status,200);assert.deepEqual(await duplicate.json(),{accepted:true,queued:false});assert.equal(queued.length,2);assert.deepEqual(queued[0],queued[1]);
 const ignored=fixture({result:{accepted:false,queued:false}});assert.equal((await ignored.handler(await request())).status,200);
});
test('queue errors and malformed results are retryable safe503 responses without echoing secrets or payloads',async()=>{
 for(const enqueue of [async()=>{throw Error('private token and private fan')},async()=>({accepted:false,queued:true}),async()=>({accepted:'yes',queued:true}),async()=>null]){const f=fixture({enqueue}),r=await f.handler(await request());assert.equal(r.status,503);const text=await r.text();for(const hidden of ['private','acct_','Hello',current,id])assert.ok(!text.includes(hidden),hidden)}
});
test('Edge entry point uses only fixed HTTPS service-role ingestion with a bounded response and no actor impersonation',async()=>{
 const source=await readFile(new URL('../supabase/functions/bruff-ai-events/index.ts',import.meta.url),'utf8'),handlerUrl=new URL('../supabase/functions/bruff-ai-events/handler.js',import.meta.url).href,originalDeno=globalThis.Deno,originalFetch=globalThis.fetch;
 try{
  for(const base of ['https://events-db.example','http://events-db.example','https://user@events-db.example']){
   const calls=[],reads=[];let handler;const values={SUPABASE_URL:base,SUPABASE_SERVICE_ROLE_KEY:'fictional-service-key',BRUFF_AI_AUTOPILOT_ENABLED:'true',OFMAPI_WEBHOOK_SECRET:current,OFMAPI_WEBHOOK_SECRET_PREVIOUS:previous};globalThis.Deno={env:{get:name=>{reads.push(name);return values[name]}},serve:value=>{handler=value}};globalThis.fetch=async(url,options)=>{calls.push({url,options});return new Response(JSON.stringify({accepted:true,queued:true,privateOpaque:'not-forwarded'}),{headers:{'Content-Type':'application/json'}})};
   const code=source.replace("'./handler.js'",JSON.stringify(handlerUrl))+'\n// fixture '+base;
   await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));const r=await handler(await request(event(),{time:Math.floor(Date.now()/1000)}));
   if(base.startsWith('https://events-db')){assert.equal(r.status,202);assert.equal(calls.length,1);assert.equal(calls[0].url,'https://events-db.example/rest/v1/rpc/bruff_ai_event_ingest');assert.equal(calls[0].options.redirect,'error');assert.equal(calls[0].options.headers.Authorization,'Bearer fictional-service-key');assert.equal(calls[0].options.headers.apikey,'fictional-service-key');const body=JSON.parse(calls[0].options.body);assert.deepEqual(Object.keys(body),['event']);assert.equal(body.event.direction,'received');assert.equal(body.event.actor,undefined);assert.ok(calls[0].options.signal instanceof AbortSignal);assert.deepEqual(await r.json(),{accepted:true,queued:true});let cancelled=0;globalThis.fetch=async()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode(' '.repeat(16385)))},cancel(){cancelled++}}));const oversized=await handler(await request(event(),{time:Math.floor(Date.now()/1000)}));assert.equal(oversized.status,503);assert.equal(cancelled,1);assert.equal((await oversized.json()).code,'EVENT_QUEUE')}else{assert.equal(r.status,503);assert.equal(calls.length,0)}
   assert.deepEqual(reads,['SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY','BRUFF_AI_AUTOPILOT_ENABLED','OFMAPI_WEBHOOK_SECRET','OFMAPI_WEBHOOK_SECRET_PREVIOUS']);
  }
 }finally{if(originalDeno===undefined)delete globalThis.Deno;else globalThis.Deno=originalDeno;globalThis.fetch=originalFetch}
});
test('new queued jobs may wake only the fixed own runner through waitUntil without delaying or exposing the acknowledgement',async()=>{
 const source=await readFile(new URL('../supabase/functions/bruff-ai-events/index.ts',import.meta.url),'utf8'),handlerUrl=new URL('../supabase/functions/bruff-ai-events/handler.js',import.meta.url).href,originalDeno=globalThis.Deno,originalFetch=globalThis.fetch,originalRuntime=globalThis.EdgeRuntime,job='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
 const scenarios=[{result:{accepted:true,queued:true,jobId:job.toUpperCase()},warm:true},{result:{accepted:true,queued:true,jobId:job},runtime:false},{result:{accepted:true,queued:true,jobId:'https://private.test'}},{result:{accepted:false,queued:false,jobId:job}},{result:{accepted:true,queued:false,jobId:job}},{result:{accepted:true,queued:true}},{result:{accepted:true,queued:true,jobId:job},enabled:false}];
 try{for(const [i,scenario]of scenarios.entries()){
  const calls=[],background=[];let handler,finishWorker;globalThis.Deno={env:{get:name=>({SUPABASE_URL:'https://events-db.example',SUPABASE_SERVICE_ROLE_KEY:'fictional-service-key',BRUFF_AI_AUTOPILOT_ENABLED:scenario.enabled===false?'false':'true',OFMAPI_WEBHOOK_SECRET:current})[name]},serve:value=>{handler=value}};
  if(scenario.runtime===false)delete globalThis.EdgeRuntime;else globalThis.EdgeRuntime={waitUntil:work=>{background.push(work)}};
  globalThis.fetch=(url,options)=>{calls.push({url,options});if(url.endsWith('/rest/v1/rpc/bruff_ai_event_ingest'))return Promise.resolve(new Response(JSON.stringify(scenario.result)));return new Promise(resolve=>{finishWorker=()=>resolve(new Response('{"state":"sent","privateToken":"never expose"}'))})};
  const code=source.replace("'./handler.js'",JSON.stringify(handlerUrl))+'\n// warm fixture '+i;await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
  const response=await handler(await request(event(),{time:Math.floor(Date.now()/1000)}));assert.equal(response.status,scenario.enabled===false?503:scenario.result.accepted&&scenario.result.queued?202:200);const output=await response.json();assert.equal(output.jobId,undefined);assert.ok(!JSON.stringify(output).includes(job));assert.ok(!JSON.stringify(output).includes('fictional-service-key'));
  assert.equal(calls.length,scenario.enabled===false?0:scenario.warm?2:1);assert.equal(background.length,scenario.warm?1:0);
  if(scenario.warm){const wake=calls[1];assert.equal(wake.url,'https://events-db.example/functions/v1/bruff-ai-runner');assert.equal(wake.options.method,'POST');assert.equal(wake.options.redirect,'error');assert.equal(wake.options.headers.Authorization,'Bearer fictional-service-key');assert.deepEqual(JSON.parse(wake.options.body),{job_id:job});assert.ok(wake.options.signal instanceof AbortSignal);assert.equal(typeof finishWorker,'function');finishWorker();await Promise.all(background)}
  assert.ok(calls.every(x=>x.url.startsWith('https://events-db.example/')));
 }}finally{if(originalDeno===undefined)delete globalThis.Deno;else globalThis.Deno=originalDeno;if(originalRuntime===undefined)delete globalThis.EdgeRuntime;else globalThis.EdgeRuntime=originalRuntime;globalThis.fetch=originalFetch}
});
