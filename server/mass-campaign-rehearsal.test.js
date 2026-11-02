import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newAutoMessage,autoMessagePayload} from '../src/auto-messages.js';
import {resolveMassAudience} from '../supabase/functions/bruff-live/advanced-audience.js';
import {preparationPlan} from './advanced-preparation.js';
import {nextMassCycle} from './advanced-schedule.js';
import {deliverAdvanced} from './advanced-delivery.js';
// No environment variables, real credentials, HTTP client or production database.
const start=Date.parse('2030-01-01T10:00:00Z');
for(const model of ['A','B','C'])test(`complete mass rehearsal ${model}: 1207 fans, all pages, exclusions, paid media, names, three cycles`,async()=>{
 const draft=newAutoMessage('mass');draft.name='Ficticia '+model;
 Object.assign(draft.bulk,{audience:'all',repeat:true,intervalMinutes:120,endMode:'runs',maxRuns:3});
 draft.audience.excludeLists=['excluded'];
 Object.assign(draft.messages[0],{text:'Hola {nombre}, novedades del perfil.',nameMode:'custom_fan',firstName:true,fallback:'amigo',paidMedia:true,price:12.5,media:[{id:'11',type:'photo',slot:'paid'},{id:'12',type:'video',slot:'paid'}]});
 const config=autoMessagePayload(draft),binding='acct_fixture_'+model;
 const fans=Array.from({length:1207},(_,i)=>({id:i+1}));let page=0,reads=0;
 const audience=await resolveMassAudience({config,binding,providerKey:'FAKE',authorize:async()=>binding,fetcher:async(url,o)=>{
  assert.equal(o.method,'GET');reads++;
  if(url.includes('/lists/'))return {ok:true,json:async()=>({id:'excluded',usersCount:2,users:[{id:2},{id:5}]})};
  const index=page++,items=fans.slice(index*100,(index+1)*100),hasMore=(index+1)*100<fans.length;
  return {ok:true,json:async()=>({fans:items,hasMore,...(hasMore?{cursor:'page-'+page}:{})})};
 }});
 assert.equal(audience.complete,true);assert.equal(audience.recipientIds.length,1205);assert.equal(reads,14);
 assert.ok(!audience.recipientIds.includes('2')&&!audience.recipientIds.includes('5'));
 const plan=preparationPlan(config,new Date(start).toISOString()),sent=new Map(),records=new Map();
 let active=false,time=start,simulatedPosts=0;
 async function deliver(fan,cycle){
  const scope={workspace:'fixture-agency',creator:model,fan},id=`${model}:${cycle}:${fan}`;
  const claim={id,scope,activationId:'fixture-run-'+model,status:'claimed',lease:'fixture',revision:1,stepIndex:0,trigger:'mass',message:config.messages[0],dueAt:new Date(time).toISOString(),expiresAt:new Date(time+60000).toISOString()};
  const custom=Number(fan)%3===0?'Alex Bravo':'',fanName=Number(fan)%3===1?'John Smith':'';
  const store={claim:async()=>records.has(id)?null:claim,authorize:async()=>active,context:async()=>({scope,fanName,customName:custom}),moderate:async()=>true,begin:async(_,payload)=>{if(!active||records.has(id))return false;records.set(id,{state:'sending',payload});return true},finish:async(_,r)=>records.set(id,r),release:async()=>{}};
  const provider={resolveMedia:async(s,items)=>({scope:s,verified:true,items}),send:async(s,payload,{idempotencyKey})=>{
   assert.deepEqual(s,scope);assert.equal(payload.price,12.5);assert.equal(payload.media.length,2);assert.equal(payload.lockedText,false);
   const expected=custom?'Alex':fanName?'John':'amigo';assert.equal(payload.text,`Hola ${expected}, novedades del perfil.`);
   assert.ok(!sent.has(idempotencyKey));sent.set(idempotencyKey,payload);simulatedPosts++;return {id:String(simulatedPosts)};
  }};
  return deliverAdvanced({delivery:claim,store,provider,enabled:true,now:()=>time});
 }
 // Preparation and paused state must not produce any simulated send.
 assert.equal((await deliver('1',0)).status,'stopped');assert.equal(simulatedPosts,0);
 active=true;
 for(let cycle=0;cycle<3;cycle++){
  time=start+cycle*120*60000;assert.equal(nextMassCycle(plan,{now:time,lastCycle:cycle-1}).cycle,cycle);
  for(const fan of audience.recipientIds)assert.equal((await deliver(fan,cycle)).status,'sent');
  assert.equal((await deliver('1',cycle)).status,'not_claimed');
  active=false;assert.equal((await deliver('9999',cycle)).status,'stopped');active=true;
 }
 assert.equal(simulatedPosts,3615);assert.equal(nextMassCycle(plan,{now:time,lastCycle:2}).status,'completed');
});
test('unsupported mass settings fail before audience or delivery, never silently disappear',()=>{
 for(const key of ['unsend','resend']){const d=newAutoMessage('mass');d.name='Fixture';d.messages[0].text='Hola';d[key].enabled=true;assert.throws(()=>preparationPlan(d,new Date(start).toISOString()))}
 const d=newAutoMessage('mass');d.name='Fixture';d.messages[0].text='Hola';d.messages[0].tags=['test'];assert.equal(preparationPlan(d,new Date(start).toISOString()).cycles,1);
});
