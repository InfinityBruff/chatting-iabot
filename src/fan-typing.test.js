import test from 'node:test';
import assert from 'node:assert/strict';
import {createFanTyping,createTypingSSEParser} from './fan-typing.js';

const base=Date.parse('2026-11-05T12:00:00Z'),encoder=new TextEncoder(),flush=()=>new Promise(resolve=>setImmediate(resolve));
const iso=at=>new Date(at).toISOString(),frame=value=>'data: '+JSON.stringify(value)+'\n\n';
function clock(){let at=base,id=0;const tasks=new Map();return {now:()=>at,schedule:(fn,delay)=>{tasks.set(++id,{fn,at:at+delay});return id},cancel:id=>tasks.delete(id),advance:ms=>at+=ms,nextAt:()=>tasks.size?Math.min(...[...tasks.values()].map(x=>x.at)):null,fire:async()=>{const first=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!first)return;tasks.delete(first[0]);at=Math.max(at,first[1].at);first[1].fn();await flush()}}}
function stream(){let source,cancelled=0;const body=new ReadableStream({start(controller){source=controller},cancel(){cancelled++}});return {response:new Response(body,{headers:{'content-type':'text/event-stream; charset=utf-8'}}),send:value=>source.enqueue(encoder.encode(typeof value==='string'?value:frame(value))),bytes:value=>source.enqueue(value),end:()=>source.close(),fail:()=>source.error(Error('Offline')),cancelled:()=>cancelled}}
function fixture(options={}){
 const time=clock(),calls=[],streams=[];let shown=true,connected=true,epoch=0;
 const reader=createFanTyping({actor:'actor',workspace:'workspace',account:'account',fan:'123',...time,visible:()=>shown,online:()=>connected,cacheEpoch:()=>epoch,random:()=>0,...options,request:async opts=>{calls.push(opts);assert.equal(opts.active(),true);if(options.request)return options.request(opts);const next=stream();streams.push(next);return next.response}});
 return {reader,time,calls,streams,show:value=>shown=value,online:value=>connected=value,epoch:value=>epoch=value};
}

test('SSE parser handles fragmented CRLF, comments, multiline data, BOM and multiple events',()=>{
 const events=[],parser=createTypingSSEParser({onEvent:event=>events.push(event)});
 const text='\ufeff: keepalive\r\nevent: signal\r\ndata: {"type":"typing",\r\ndata: "typing":true}\r\n\r\ndata: {"type":"stopped"}\n\n';
 for(const letter of text)parser.feed(letter);parser.finish();assert.deepEqual(events,[{type:'typing',typing:true},{type:'stopped'}]);
});

test('malformed/primitive frames are ignored and EOF never dispatches an unfinished data frame',()=>{
 const events=[],parser=createTypingSSEParser({onEvent:event=>events.push(event)});parser.feed('data: broken\n\ndata: null\n\ndata: []\n\ndata: 1\n\ndata: {"type":"ready"}\n\ndata: {"type":"typing"}');parser.finish();assert.deepEqual(events,[{type:'ready'}]);
 const cr=createTypingSSEParser({onEvent:event=>events.push(event)});cr.feed('data: {"type":"heartbeat"}\r\r');cr.finish();assert.equal(events.at(-1).type,'heartbeat');
});

test('SSE parser bounds unfinished buffers, accumulated data events and oversized network chunks',()=>{
 for(const run of [parser=>parser.feed('x'.repeat(16385)),parser=>parser.feed('data: '+JSON.stringify({text:'x'.repeat(8192)})+'\n\n'),parser=>parser.feed('data: '+('x'.repeat(5000))+'\ndata: '+('x'.repeat(5000))+'\n\n'),parser=>parser.feed('x'.repeat(65537))])assert.throws(()=>run(createTypingSSEParser({onEvent:()=>{}})),/unavailable/);
});

test('invalid scope cannot connect and a valid controller makes no request until start',async()=>{
 for(const part of ['actor','workspace','account','fan'])assert.throws(()=>createFanTyping({actor:'u',workspace:'w',account:'a',fan:'1',request:()=>{},[part]:''}),TypeError);
 const f=fixture();assert.equal(f.reader.getSnapshot(),false);assert.equal(f.time.nextAt(),null);f.reader.start();await f.time.fire();assert.equal(f.calls.length,1);f.reader.start();f.reader.resume();await flush();assert.equal(f.calls.length,1);f.reader.stop();await flush();
});

test('fresh typing expires after six seconds, duplicates never extend it and fresh repeated events renew it',async()=>{
 const f=fixture();f.reader.start();await f.time.fire();const first={type:'typing',typing:true,expiresAt:iso(base+6000)};f.streams[0].send(first);await flush();assert.equal(f.reader.getSnapshot(),true);assert.equal(f.time.nextAt(),base+6000);
 f.time.advance(2000);f.streams[0].send(first);await flush();assert.equal(f.time.nextAt(),base+6000);f.streams[0].send({type:'typing',typing:true,expiresAt:iso(base+8000)});await flush();assert.equal(f.time.nextAt(),base+8000);await f.time.fire();assert.equal(f.reader.getSnapshot(),false);assert.equal(f.calls.length,1);f.reader.stop();await flush();
});

test('observedAt provides only its remaining TTL; malformed, stale and future timestamps never show typing',async()=>{
 const f=fixture();f.reader.start();await f.time.fire();for(const event of [{observedAt:iso(base-6001)},{expiresAt:iso(base-1)},{expiresAt:iso(base+7001)},{observedAt:base},{expiresAt:'not a date'},{observedAt:'2026-11-05T12:00:00'},{observedAt:'2026-02-30T12:00:00Z'},{observedAt:iso(base),expiresAt:'invalid'},{}, {expiresAt:iso(base+6000),observedAt:iso(base-1000)}]){f.streams[0].send({type:'typing',typing:true,...event});await flush();assert.equal(f.reader.getSnapshot(),false)}
 f.streams[0].send({type:'typing',typing:true,observedAt:iso(base-2000)});await flush();assert.equal(f.reader.getSnapshot(),true);assert.equal(f.time.nextAt(),base+4000);await f.time.fire();assert.equal(f.reader.getSnapshot(),false);f.reader.stop();await flush();
});

test('up to one second of server clock skew is accepted with a strict six-second local TTL and server watermark',async()=>{
 const f=fixture();f.reader.start();await f.time.fire();f.streams[0].send({type:'typing',typing:true,observedAt:iso(base+1001),expiresAt:iso(base+7001)});await flush();assert.equal(f.reader.getSnapshot(),false);
 const event={type:'typing',typing:true,observedAt:iso(base+500),expiresAt:iso(base+6500)};f.streams[0].send(event);await flush();assert.equal(f.reader.getSnapshot(),true);assert.equal(f.time.nextAt(),base+6000);f.time.advance(2000);f.streams[0].send(event);await flush();assert.equal(f.time.nextAt(),base+6000);await f.time.fire();assert.equal(f.reader.getSnapshot(),false);f.streams[0].send(event);await flush();assert.equal(f.reader.getSnapshot(),false);f.reader.stop();await flush();
});

test('ready, heartbeat, unknown types and nonboolean typing never manufacture or extend a signal',async()=>{
 const f=fixture();f.reader.start();await f.time.fire();for(const type of ['ready','heartbeat','unknown'])f.streams[0].send({type,typing:true,expiresAt:iso(base+6000)});f.streams[0].send({type:'typing',typing:'true',expiresAt:iso(base+6000)});await flush();assert.equal(f.reader.getSnapshot(),false);
 f.streams[0].send({type:'typing',typing:true,expiresAt:iso(base+6000)});await flush();f.time.advance(3000);f.streams[0].send({type:'heartbeat'});await flush();assert.equal(f.time.nextAt(),base+6000);f.reader.stop();await flush();
});

test('stopped and explicit typing false clear immediately without replaying the old true frame',async()=>{
 for(const stop of [{type:'stopped'},{type:'typing',typing:false}]){const f=fixture();f.reader.start();await f.time.fire();const event={type:'typing',typing:true,expiresAt:iso(base+6000)};f.streams[0].send(event);await flush();assert.equal(f.reader.getSnapshot(),true);f.streams[0].send(stop);f.streams[0].send(event);await flush();assert.equal(f.reader.getSnapshot(),false);assert.equal(f.time.nextAt(),null);f.reader.stop();await flush()}
});

test('a new fan message clears typing and blocks delayed pre-message events but permits genuinely new typing',async()=>{
 const f=fixture();f.reader.start();await f.time.fire();f.streams[0].send({type:'typing',typing:true,observedAt:iso(base)});await flush();f.time.advance(1000);f.reader.clear();assert.equal(f.reader.getSnapshot(),false);f.streams[0].send({type:'typing',typing:true,expiresAt:iso(base+6500)});await flush();assert.equal(f.reader.getSnapshot(),false);f.time.advance(1000);f.streams[0].send({type:'typing',typing:true,observedAt:iso(base+2000)});await flush();assert.equal(f.reader.getSnapshot(),true);f.reader.stop();await flush();
});

test('hidden visibility aborts/cancels and clears, with exactly one new connection on return',async()=>{
 const f=fixture();f.reader.start();await f.time.fire();f.streams[0].send({type:'typing',typing:true,expiresAt:iso(base+6000)});await flush();f.show(false);f.reader.resume();await flush();assert.equal(f.reader.getSnapshot(),false);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.streams[0].cancelled(),1);assert.equal(f.time.nextAt(),null);
 f.show(true);f.reader.resume();f.reader.resume();await f.time.fire();assert.equal(f.calls.length,2);f.reader.stop();await flush();
});

test('initial hidden/offline scopes wait for resume and offline transitions never spin new attempts',async()=>{
 const f=fixture();f.show(false);f.reader.start();assert.equal(f.time.nextAt(),null);f.show(true);f.online(false);f.reader.resume();assert.equal(f.time.nextAt(),null);f.online(true);f.reader.resume();await f.time.fire();assert.equal(f.calls.length,1);f.online(false);f.reader.resume();await flush();assert.equal(f.time.nextAt(),null);assert.equal(f.calls[0].signal.aborted,true);f.reader.stop();
});

test('stop drops a late response, cancels its body and cannot restart a request for another scope',async()=>{
 let release;const old=stream(),f=fixture({request:()=>new Promise(resolve=>release=resolve)});f.reader.start();await f.time.fire();f.reader.stop();release(old.response);await flush();assert.equal(f.calls[0].signal.aborted,true);assert.equal(old.cancelled(),1);assert.equal(f.reader.getSnapshot(),false);assert.equal(f.time.nextAt(),null);
 const next=fixture({fan:'999'});next.reader.start();await next.time.fire();assert.equal(next.reader.getSnapshot(),false);assert.equal(next.calls.length,1);next.reader.stop();await flush();
});

test('StrictMode stop/start before request settlement never creates overlapping connections',async()=>{
 let release;const old=stream();let reads=0;const f=fixture({request:()=>++reads===1?new Promise(resolve=>release=resolve):stream().response});f.reader.start();await f.time.fire();f.reader.stop();f.reader.start();await f.time.fire();assert.equal(f.calls.length,1);release(old.response);await flush();await f.time.fire();assert.equal(f.calls.length,2);f.reader.stop();await flush();
});

test('401/403 responses and denied frames are terminal through hide/show and restarts',async()=>{
 for(const status of [401,403]){const f=fixture({request:async()=>{throw Object.assign(Error('Denied'),{status})}});f.reader.start();await f.time.fire();assert.equal(f.time.nextAt(),null);f.reader.stop();f.reader.start();f.reader.resume();await f.time.fire();assert.equal(f.calls.length,1);assert.equal(f.reader.getSnapshot(),false)}
 const f=fixture();f.reader.start();await f.time.fire();f.streams[0].send({type:'typing',typing:true,expiresAt:iso(base+6000)});f.streams[0].send({type:'denied'});await flush();assert.equal(f.reader.getSnapshot(),false);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.time.nextAt(),null);f.reader.resume();assert.equal(f.time.nextAt(),null);f.reader.stop();
});

test('cache epoch revocation clears a live signal and discards late chunks and reconnects',async()=>{
 const f=fixture();f.reader.start();await f.time.fire();f.streams[0].send({type:'typing',typing:true,expiresAt:iso(base+6000)});await flush();f.epoch(1);f.streams[0].send({type:'heartbeat'});await flush();assert.equal(f.reader.getSnapshot(),false);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.streams[0].cancelled(),1);assert.equal(f.time.nextAt(),null);f.reader.resume();f.reader.stop();f.reader.start();assert.equal(f.time.nextAt(),null);
});

test('a current auth denial arriving after visibility cancellation remains terminal until another scope',async()=>{
 for(const response of [false,true]){let resolve,reject;const f=fixture({request:()=>new Promise((yes,no)=>{resolve=yes;reject=no})});f.reader.start();await f.time.fire();f.show(false);f.reader.resume();if(response)resolve(new Response('',{status:403}));else reject(Object.assign(Error('Denied'),{status:401}));await flush();f.show(true);f.reader.resume();await f.time.fire();assert.equal(f.calls.length,1);assert.equal(f.time.nextAt(),null);assert.equal(f.reader.getSnapshot(),false);f.reader.stop()}
});

test('network failures use bounded escalating backoff without overlapping or resetting on ready alone',async()=>{
 const f=fixture({request:async()=>{throw Error('Offline')}});f.reader.start();for(const delay of [2000,5000,10000,30000,30000]){await f.time.fire();assert.equal(f.time.nextAt(),f.time.now()+delay);f.reader.resume();assert.equal(f.time.nextAt(),f.time.now()+delay)}assert.equal(f.calls.length,5);f.reader.stop();
 const ready=fixture();ready.reader.start();await ready.time.fire();ready.streams[0].send({type:'ready'});ready.streams[0].end();await flush();assert.equal(ready.time.nextAt(),base+2000);await ready.time.fire();ready.streams[1].send({type:'ready'});ready.streams[1].end();await flush();assert.equal(ready.time.nextAt(),base+7000);ready.reader.stop();
});

test('rate limit RetryAfter exceeds backoff and visibility cannot bypass its deadline',async()=>{
 const f=fixture({request:async()=>{throw Object.assign(Error('Limited'),{status:429,retryAfter:60})}});f.reader.start();await f.time.fire();assert.equal(f.time.nextAt(),base+60000);f.show(false);f.reader.resume();f.time.advance(5000);f.show(true);f.reader.resume();assert.equal(f.time.nextAt(),base+60000);await f.time.fire();assert.equal(f.calls.length,2);f.reader.stop();
});

test('unavailable/reconnect clear and cancel the stream, then back off instead of retrying in a hot loop',async()=>{
 for(const type of ['unavailable','reconnect']){const f=fixture();f.reader.start();await f.time.fire();f.streams[0].send({type:'typing',typing:true,expiresAt:iso(base+6000)});f.streams[0].send({type});await flush();assert.equal(f.reader.getSnapshot(),false);assert.equal(f.streams[0].cancelled(),1);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.time.nextAt(),base+2000);f.reader.stop()}
});

test('invalid content type and oversized/malformed UTF-8 streams are cancelled and isolated behind backoff',async()=>{
 const invalid=stream(),f=fixture({request:async()=>new Response(invalid.response.body,{headers:{'content-type':'application/json'}})});f.reader.start();await f.time.fire();assert.equal(f.reader.getSnapshot(),false);assert.equal(invalid.cancelled(),1);assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.time.nextAt(),base+2000);f.reader.stop();
 for(const bytes of [encoder.encode('x'.repeat(17000)),new Uint8Array([0xc3,0x28])]){const broken=fixture();broken.reader.start();await broken.time.fire();broken.streams[0].bytes(bytes);await flush();assert.equal(broken.reader.getSnapshot(),false);assert.equal(broken.streams[0].cancelled(),1);assert.equal(broken.time.nextAt(),base+2000);broken.reader.stop()}
});

test('transport decoder handles multibyte UTF-8 split across chunks without replay or storage',async()=>{
 const f=fixture();f.reader.start();await f.time.fire();const bytes=encoder.encode(frame({type:'typing',typing:true,expiresAt:iso(base+6000),note:'escribiendo…'}));for(const byte of bytes)f.streams[0].bytes(new Uint8Array([byte]));await flush();assert.equal(f.reader.getSnapshot(),true);assert.equal(f.calls.length,1);f.reader.stop();await flush();assert.equal(f.reader.getSnapshot(),false);
});
