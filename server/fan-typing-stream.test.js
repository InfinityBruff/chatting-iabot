import test from 'node:test';import assert from 'node:assert/strict';
import {typingEvent,createTypingResponse} from '../supabase/functions/bruff-live/typing-stream.js';
import {createLiveHandler} from '../supabase/functions/bruff-live/handler.js';
const base=Date.parse('2026-11-05T12:00:00.000Z'),binding='acct_modelA',fan='123';
const event=(extra={},payload={conversation_id:fan})=>({type:'event',seq:1,event:{event:'users.typing',event_id:'event-1',account_id:binding,occurred_at:new Date(base).toISOString(),payload,...extra}});
const parse=value=>typingEvent(value,{binding,fan,now:base});
test('typing requires exact account, semantic fan ID and fresh timestamp; generic IDs never count',()=>{
 assert.equal(parse(event()).typing,true);assert.equal(parse(event({}, {user_id:123})).typing,true);
 for(const value of [event({account_id:'acct_other'}),event({event:'messages.received'}),event({}, {conversation_id:'456'}),event({}, {conversation_id:fan,user_id:'456'}),event({}, {id:123}),event({}, {user_id:9007199254740993}),event({occurred_at:new Date(base-6000).toISOString()}),event({occurred_at:new Date(base+1001).toISOString()}),event({event_id:''}),{type:'event',event:'users.typing',payload:{conversation_id:fan}}])assert.equal(parse(value),null);
 assert.deepEqual(parse(event({}, {user_id:fan,typing:false})),{eventId:'event-1',type:'stopped'});
});
const tick=async()=>{for(let i=0;i<12;i++)await Promise.resolve()};
function fixture(options={}){
 let time=base,next=1,checks=0,socket;const tasks=new Map(),calls=[];
 const schedule=(fn,ms)=>{const id=next++;tasks.set(id,{fn,at:time+ms});return id},cancel=id=>tasks.delete(id);
 const abort=new AbortController();
 const create=()=>createTypingResponse({binding,fan,providerKey:'provider-secret',signal:abort.signal,now:()=>time,schedule,cancel,authorize:async()=>{checks++;return options.authorize?options.authorize(checks):binding},fetcher:async(url,input)=>{calls.push({url,input});return new Response(JSON.stringify({token:'server.jwt.token',wsUrl:'wss://untrusted.example/token'}),{status:200})},connect:url=>{socket={url,sends:[],closed:false,send(value){this.sends.push(JSON.parse(value))},close(){this.closed=true;this.onclose?.()}};return socket}});
 return {create,calls,tasks,abort,get socket(){return socket},get checks(){return checks},async advance(ms){time+=ms;for(const [id,t]of [...tasks])if(t.at<=time){tasks.delete(id);t.fn()}await tick()}};
}
async function start(f){const response=await f.create(),reader=response.body.getReader(),decoder=new TextDecoder();return {response,reader,async next(){const n=await reader.read();return n.done?null:JSON.parse(decoder.decode(n.value).trim().slice(6))}}}
test('relay sends only users.typing subscription and fixed upstream host; provider token stays server-side',async()=>{
 const f=fixture(),r=await start(f);f.socket.onopen();assert.deepEqual(f.socket.sends,[{type:'subscribe',account_id:binding,events:['users.typing']}]);assert.match(f.socket.url,/^wss:\/\/gateway\.ofmapi\.com\/v1\/ws\?token=/);assert.equal(f.calls[0].url,'https://api.ofmapi.com/v1/ws/token');assert.equal(f.calls[0].input.headers.Authorization,'Bearer provider-secret');
 f.socket.onmessage({data:JSON.stringify({type:'subscribed'})});assert.deepEqual(await r.next(),{type:'ready'});
 f.socket.onmessage({data:JSON.stringify(event({}, {user_id:fan,text:'private',token:'secret'}))});const received=await r.next();assert.equal(received.typing,true);assert.equal(received.expiresAt,'2026-11-05T12:00:06.000Z');assert.deepEqual(Object.keys(received).sort(),['expiresAt','observedAt','type','typing']);assert.equal(JSON.stringify(received).includes('private'),false);await r.reader.cancel();assert.equal(f.socket.closed,true);assert.equal(f.tasks.size,0);
});
test('duplicates and events from another model/fan are never relayed; newer event renews TTL',async()=>{
 const f=fixture(),r=await start(f);f.socket.onmessage({data:JSON.stringify(event())});await r.next();const before=f.checks;
 for(const e of [event(),event({account_id:'acct_other',event_id:'other'}),event({event_id:'otherfan'},{user_id:'456'})])f.socket.onmessage({data:JSON.stringify(e)});
 await tick();assert.equal(f.checks,before);
 await f.advance(2000);f.socket.onmessage({data:JSON.stringify(event({event_id:'new',occurred_at:new Date(base+2000).toISOString()}))});assert.equal((await r.next()).expiresAt,'2026-11-05T12:00:08.000Z');await r.reader.cancel();
});
test('permission revoked before a pending event publishes closes the stream with no typing data',async()=>{
 const f=fixture({authorize:n=>n===1?binding:'acct_other'}),r=await start(f);f.socket.onmessage({data:JSON.stringify(event())});assert.deepEqual(await r.next(),{type:'denied'});assert.equal(await r.next(),null);assert.equal(f.socket.closed,true);assert.equal(f.tasks.size,0);
});
test('authorization latency coalesces to the newest stop without displaying obsolete typing first',async()=>{
 let resolve;const f=fixture({authorize:n=>n===1?binding:new Promise(r=>resolve=r)}),r=await start(f);
 f.socket.onmessage({data:JSON.stringify(event())});await tick();f.socket.onmessage({data:JSON.stringify(event({event_id:'stop'},{conversation_id:fan,typing:false}))});resolve(binding);await tick();assert.deepEqual(await r.next(),{type:'stopped'});assert.equal(f.checks,2);await r.reader.cancel();
});
test('permission timer revokes idle subscription, temporary SQL outage is unavailable',async()=>{
 for(const status of [403,503]){const f=fixture({authorize:n=>{if(n>1)throw Object.assign(Error('database'),{status});return binding}}),r=await start(f);await f.advance(5000);assert.deepEqual(await r.next(),{type:status===403?'denied':'unavailable'});assert.equal(await r.next(),null);assert.equal(f.tasks.size,0)}
});
test('aborted subscriber closes upstream socket, clears timers and ignores pending authorization',async()=>{
 let resolve;const f=fixture({authorize:n=>n===1?binding:new Promise(r=>resolve=r)}),r=await start(f);f.socket.onmessage({data:JSON.stringify(event())});await tick();f.abort.abort();resolve(binding);await tick();assert.equal(await r.next(),null);assert.equal(f.socket.closed,true);assert.equal(f.tasks.size,0);
});
test('missing subscription ack, provider errors and duration never leave a stale live stream',async()=>{
 for(const mode of ['timeout','error','duration']){const f=fixture(),r=await start(f);if(mode==='duration'){f.socket.onmessage({data:JSON.stringify({type:'subscribed'})});await r.next();await f.advance(120000)}else if(mode==='error')f.socket.onerror();else await f.advance(10000);const values=[];for(;;){const value=await r.next();if(!value)break;values.push(value.type)}assert.equal(values.at(-1),mode==='duration'?'reconnect':'unavailable');assert.equal(f.tasks.size,0)}
});
test('initial model change during token request returns no stream or provider credential',async()=>{
 const f=fixture({authorize:()=>null});await assert.rejects(f.create(),e=>e.status===403);assert.equal(f.socket,undefined);
});
test('slow client is disconnected instead of buffering events without bound',async()=>{
 const f=fixture(),r=await start(f);for(let i=0;i<20;i++){f.socket.onmessage({data:JSON.stringify(event({event_id:'e'+i}))});await tick()}assert.equal(f.socket.closed,true);assert.equal(f.tasks.size,0);await r.reader.cancel();
});
const w='00000000-0000-0000-0000-000000000001',c='00000000-0000-0000-0000-000000000002';
test('handler requires real session, read permission and valid model-bound fan; denied requests never mint provider token',async()=>{
 for(const mode of ['anonymous','denied','invalid']){const calls=[];const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',providerKey:'secret',fetcher:async(url,input)=>{calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:'worker',email_confirmed_at:'yes'});if(url.includes('bruff_live_authorize')){assert.equal(JSON.parse(input.body).p,'read');return mode==='denied'?Response.json({}, {status:403}):Response.json(binding)}throw Error('Must not call provider')}});const req=new Request('https://bruff.test',{method:'POST',headers:{Authorization:mode==='anonymous'?'':'Bearer session','Content-Type':'application/json'},body:JSON.stringify({workspace_id:w,creator_id:c,operation:'typing_stream',conversation_id:mode==='invalid'?'../other':fan})});assert.equal((await handler(req)).status,{anonymous:401,denied:403,invalid:400}[mode]);assert.equal(calls.some(x=>x.includes('ofmapi')),false)}
});
