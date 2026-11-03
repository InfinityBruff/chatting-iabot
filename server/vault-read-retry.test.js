import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createLiveHandler as sourceHandler} from '../supabase/functions/bruff-live/handler.js';
import {createReadScheduler} from '../src/live-read-scheduler.js';
const createLiveHandler=process.env.BRUFF_TEST_BUNDLE?await(async()=>{const code=await readFile(process.env.BRUFF_TEST_BUNDLE,'utf8');return (await import('data:text/javascript;base64,'+Buffer.from(code.slice(0,code.lastIndexOf('Deno.serve('))).toString('base64'))).createLiveHandler})():sourceHandler;
const w='00000000-0000-4000-8000-000000000001',c='00000000-0000-4000-8000-000000000002';
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers});
function fixture({status=429,retryAfter='1'}={}){
 let reads=0,writes=0;
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'fake',providerKey:'fake',serviceKey:'fake',readSlotEnabled:true,writeEnabled:true,fetcher:async(url,options)=>{
  if(url.includes('/auth/v1/user'))return json({id:'actor',email_confirmed_at:'yes'});
  if(url.includes('bruff_live_authorize'))return json('acct_fixture');
  if(url.includes('bruff_provider_read_slot'))return json(JSON.parse(options.body).op==='acquire'?{allowed:true,lease:crypto.randomUUID()}:{released:true});
  if(url.includes('bruff_provider_read_gate'))return json(JSON.parse(options.body).op==='check'?{allowed:true}:{allowed:false,retryAfter:3600});
  if(url.includes('bruff_chat_screen'))return json({allowed:true,blocked:false});
  if(url.includes('bruff_message_begin'))return json({name:'Fixture',messageId:null});
  if(url.includes('bruff_message_finish'))throw Error('Unexpected attribution after failed write');
  if((options.method||'GET')==='GET')reads++;else writes++;
  return json({detail:'private upstream detail'},status,{'Retry-After':retryAfter});
 }});
 const request=body=>new Request('https://fixture.test',{method:'POST',headers:{Authorization:'Bearer fake','Content-Type':'application/json'},body:JSON.stringify({workspace_id:w,creator_id:c,...body})});
 return {call:async body=>{const response=await handler(request(body));return {response,body:await response.json()}},counts:()=>({reads,writes})};
}
for(const operation of ['vault_media','vault_categories']){
 for(const [label,retryAfter,expected] of [['one second','1',1],['one hour','3600',3600],['HTTP date',new Date(Date.now()+3600000).toUTCString(),null]]){
  test(`${operation} preserves ${label} Retry-After through HTTP and the shared chat scheduler`,async()=>{
   const f=fixture({retryAfter}),before=Date.now(),{response,body}=await f.call({operation}),after=Date.now();
   assert.equal(response.status,429);assert.equal(body.providerStatus,429);assert.equal(response.headers.get('Retry-After'),String(body.retryAfter));
   if(expected!==null)assert.equal(body.retryAfter,expected);else assert.ok(body.retryAfter>=Math.ceil((Date.parse(retryAfter)-after)/1000)&&body.retryAfter<=Math.ceil((Date.parse(retryAfter)-before)/1000));
   assert.match(body.error,/consultas/i);assert.equal(JSON.stringify(body).includes('private upstream detail'),false);assert.deepEqual(f.counts(),{reads:1,writes:0});
   let now=0;const scheduler=createReadScheduler({now:()=>now,schedule:()=>0,cancel:()=>{}});
   // The same error-field/header precedence and fallback used by invokeLive.
   const retry=Number(body.retryAfter??response.headers.get('retry-after'));scheduler.block(Number.isFinite(retry)&&retry>0?retry:60);
   await assert.rejects(scheduler.primary(async()=>{}),error=>error.status===429&&error.retryAfter===body.retryAfter);
   now=body.retryAfter*1000;assert.equal(await scheduler.primary(async()=>'chat resumed'),'chat resumed');
  });
 }
 test(`${operation} reports non-rate-limited failures as reads without exposing provider data`,async()=>{
  for(const status of [403,500]){const f=fixture({status}),{response,body}=await f.call({operation});assert.equal(response.status,502);assert.equal(body.providerStatus,status);assert.match(body.error,/consultar el baúl/i);assert.equal(body.retryAfter,undefined);assert.equal(response.headers.get('Retry-After'),null);assert.equal(JSON.stringify(body).includes('private upstream detail'),false);assert.deepEqual(f.counts(),{reads:1,writes:0})}
 });
}
test('failed sends retain their previous response and are never automatically retried',async()=>{
 const f=fixture(),prepared=await f.call({operation:'prepare_send',conversation_id:'123',text:'Fixture',attachments:[]});assert.equal(prepared.response.status,200);
 const {response,body}=await f.call({operation:'send_message',ticket:prepared.body.data.ticket});
 assert.equal(response.status,429);assert.deepEqual(body,{error:'El proveedor no confirmó la operación. No se reintentará automáticamente.',providerStatus:429});assert.equal(response.headers.get('Retry-After'),null);assert.deepEqual(f.counts(),{reads:0,writes:1});
});
