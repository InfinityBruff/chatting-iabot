import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveHandler} from '../supabase/functions/bruff-live/handler.js';
const w='00000000-0000-0000-0000-000000000001',c='00000000-0000-0000-0000-000000000002';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});
test('send persists server-authenticated actor and retry repairs attribution using same idempotency key',async()=>{
 let messageId=null,finishFails=true;const sends=[],finishes=[];
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',serviceKey:'server',providerKey:'key',writeEnabled:true,fetcher:async(url,o)=>{
  if(url.endsWith('/auth/v1/user'))return json({id:'real-actor',email_confirmed_at:'yes'});
  if(url.includes('bruff_live_authorize'))return json('acct_model');
  if(url.includes('bruff_chat_screen'))return json({allowed:true,blocked:false});
  if(url.includes('bruff_message_begin'))return json({name:'Pedro',messageId});
  if(url.includes('bruff_message_finish')){assert.equal(o.headers.Authorization,'Bearer server');finishes.push(JSON.parse(o.body));if(finishFails){finishFails=false;return json({},503)}messageId='99';return json(null)}
  sends.push(o);return json({id:99});
 }});
 const call=async body=>handler(new Request('https://app.test',{method:'POST',headers:{Authorization:'Bearer session'},body:JSON.stringify({workspace_id:w,creator_id:c,...body})}));
 const ticket=(await (await call({operation:'prepare_send',conversation_id:'123',text:'Hola',attachments:[]})).json()).data.ticket;
 assert.equal((await call({operation:'send_message',ticket})).status,503);
 assert.equal((await call({operation:'send_message',ticket})).status,200);
 assert.equal((await call({operation:'send_message',ticket})).status,200);
 assert.equal(sends.length,2);assert.equal(sends[0].headers['Idempotency-Key'],sends[1].headers['Idempotency-Key']);
 assert.equal(finishes[0].actor,'real-actor');assert.equal(finishes[0].fan,'123');assert.equal(finishes[0].message_id,'99');
 assert.deepEqual(finishes[0],finishes[1]);
});
test('attribution read is bound to conversation and only annotates outgoing messages',async()=>{
 for(const fail of [false,true]){
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',providerKey:'key',fetcher:async(url,o)=>{
 if(url.endsWith('/auth/v1/user'))return json({id:'u',email_confirmed_at:'yes'});
 if(url.includes('bruff_live_authorize'))return json('acct_model');
 if(url.includes('bruff_message_authors')){const body=JSON.parse(o.body);assert.equal(body.fan,'123');assert.equal(body.c,c);assert.deepEqual(body.ids,['1','2']);return fail?json({},503):json({'1':'Pedro'})}
 return json({messages:[{id:1,isFromMe:true},{id:2,isFromMe:true},{id:3,isFromMe:false}]});
 }});
 const response=await handler(new Request('https://app.test',{method:'POST',headers:{Authorization:'Bearer session'},body:JSON.stringify({workspace_id:w,creator_id:c,operation:'messages',conversation_id:'123'})}));
 const m=(await response.json()).data.messages;assert.equal(m[0].sentBy,fail?null:'Pedro');assert.equal(m[0].attributionAvailable,!fail);assert.equal(m[1].sentBy,null);assert.equal(m[2].sentBy,undefined);
 }
});
