import {test} from 'node:test';import assert from 'node:assert/strict';import {newAutoMessage} from '../src/auto-messages.js';import {nativeMassPayload,submitNativeMass} from './native-mass.js';
const fixture=()=>{const config=newAutoMessage('mass');config.name='Fixture';config.messages[0].text='Hola';return {id:'fixture',workspace:'w',creator:'c',binding:'acct_fixture',config,recipients:['123','456']}};
test('native message preserves exact audience and does not claim per-recipient delivery',async()=>{
 const record=fixture(),writes=[],finished=[];const store={authorize:async()=>record.binding,moderate:async()=>true,begin:async()=>true,finish:async(_,r)=>finished.push(r)};
 const r=await submitNativeMass({record,store,providerKey:'fixture',enabled:true,fetcher:async(url,o)=>{writes.push({url,body:JSON.parse(o.body)});return new Response(JSON.stringify({queueId:88}))}});
 assert.equal(writes.length,1);assert.deepEqual(writes[0].body.recipients,[123,456]);assert.equal(r.state,'accepted');assert.equal(r.deliveredCount,null);assert.equal(finished[0].queueId,'88');
});
test('native mode rejects repetition, per-fan names and incomplete recipients',()=>{
 for(const mode of ['repeat','name','empty','unsafe']){const r=fixture();if(mode==='repeat')r.config.bulk.repeat=true;if(mode==='name')r.config.messages[0].text='Hola {nombre}';if(mode==='empty')r.recipients=[];if(mode==='unsafe')r.recipients=['99999999999999999999'];assert.throws(()=>nativeMassPayload(r.config,r.recipients))}
});
test('no writes without switch, moderation or durable reservation',async()=>{
 for(const mode of ['disabled','moderation','reservation']){let writes=0;const r=fixture();await assert.rejects(submitNativeMass({record:r,enabled:mode!=='disabled',providerKey:'fixture',store:{authorize:async()=>r.binding,moderate:async()=>mode!=='moderation',begin:async()=>mode!=='reservation'},fetcher:async()=>{writes++;throw Error('unexpected')}}));assert.equal(writes,0)}
});
test('uncertain native response is recorded without retry',async()=>{
 const record=fixture(),states=[];let writes=0;const r=await submitNativeMass({record,enabled:true,providerKey:'fixture',store:{authorize:async()=>record.binding,moderate:async()=>true,begin:async()=>true,finish:async(_,r)=>states.push(r.state)},fetcher:async()=>{writes++;throw Error('timeout')}});assert.equal(writes,1);assert.equal(r.state,'uncertain');assert.deepEqual(states,['uncertain']);
});
import {createLiveHandler} from '../supabase/functions/bruff-live/handler.js';
test('native activation route uses stored campaign and durable begin before provider write',async()=>{
 const w='00000000-0000-0000-0000-000000000001',c='00000000-0000-0000-0000-000000000002',id='00000000-0000-0000-0000-000000000003';let begun=false,writes=0;const record={...fixture(),id,workspace:w,creator:c};
 const handler=createLiveHandler({url:'https://auth.test',anonKey:'public',serviceKey:'fixture-secret',providerKey:'fixture-provider',writeEnabled:true,fetcher:async(url,o)=>{
  const json=x=>new Response(JSON.stringify(x));
  if(url.endsWith('/auth/v1/user'))return json({id:w,email_confirmed_at:'yes'});
  if(url.includes('bruff_my_workspaces'))return json([{id:w,role:'owner'}]);
  if(url.includes('bruff_live_authorize'))return json('acct_fixture');
  if(url.includes('bruff_chat_screen'))return json({allowed:true});
  if(url.includes('bruff_native_mass')){const b=JSON.parse(o.body);assert.equal(b.actor,w);assert.equal(b.c,c);if(b.op==='context')return json(record);if(b.op==='authorize')return json(record.binding);if(b.op==='begin'){begun=true;return json(true)}if(b.op==='finish')return json({state:'accepted'});throw Error('Unexpected operation')}
  assert.equal(begun,true);assert.match(url,/accounts\/acct_fixture\/mass-messages$/);assert.equal(o.method,'POST');writes++;return json({queueId:77});
 }});
 const response=await handler(new Request('https://bruff.test',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({operation:'native_activate',workspace_id:w,creator_id:c,run_id:id,expected_revision:1})}));
 assert.equal(response.status,200);assert.equal((await response.json()).data.state,'accepted');assert.equal(writes,1);
});
