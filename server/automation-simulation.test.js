import {test} from 'node:test';
import assert from 'node:assert/strict';
import {newAutoMessage,autoMessagePayload,validateAutoMessage,newAutoMessageStep} from '../src/auto-messages.js';
import {personalizeMessage} from '../src/dynamic-name.js';
import {advancedStore} from './advanced-store.js';
import {deliverAdvanced} from './advanced-delivery.js';
const now=Date.parse('2026-11-02T12:00:00Z');
// Entirely in memory: no Supabase client, credentials, network or real recipients.
function simulation(d,model='model-1',overrides={}){
 const scope={workspace:'fixture-agency',creator:model,fan:'123'},events=[];
 const claim={id:'fixture-delivery',activationId:'fixture-run',status:'claimed',scope,lease:'fixture-lease',revision:1,stepIndex:0,trigger:d.trigger,message:d.messages[0],dueAt:new Date(now-1).toISOString(),expiresAt:new Date(now+60000).toISOString(),...overrides};
 const rpc=async(name,args)=>{assert.equal(name,'bruff_advanced_delivery');events.push({op:args.op,value:args.value});return {error:null,data:args.op==='claim'?claim:true}};
 const store=advancedStore({rpc,context:async()=>({scope,fanName:'John Smith',customName:'Johnny Bravo',online:true,presenceAt:new Date(now).toISOString(),replyAfterPrevious:false}),moderate:async()=>true});
 const provider={resolveMedia:async(s,items)=>({scope:s,verified:true,items:structuredClone(items)}),send:async(s,payload)=>{events.push({op:'fake-send',scope:s,payload});return {id:'999'}}};
 return {events,claim,store,provider,args:{delivery:claim,store,provider,enabled:true,now:()=>now}};
}
for(const model of ['model-1','model-2','model-3'])for(const trigger of ['mass','welcome','online','expired','expiring'])for(const nameMode of ['none','custom','fan','fan_custom','custom_fan'])for(const firstName of [false,true])for(const mediaMode of ['none','free','paid','text']){
 test(`simulation ${model}/${trigger}/${nameMode}/first=${firstName}/${mediaMode}`,async()=>{
  const d=newAutoMessage(trigger);d.name='Fixture';Object.assign(d.messages[0],{text:nameMode==='none'?'Hola':'Hola {nombre}',nameMode,firstName,fallback:'Amigo'});
  const m=d.messages[0];
  if(mediaMode==='free')m.media=[{id:'11',type:'photo',slot:'free'},{id:'12',type:'video',slot:'free'}];
  if(mediaMode==='paid'){m.paidMedia=true;m.price='15,50';m.media=[{id:'11',type:'photo',slot:'free'},{id:'12',type:'video',slot:'paid'}]}
  if(mediaMode==='text'){m.paidText=true;m.price='5.00'}
  assert.equal(validateAutoMessage(d),'');const config=autoMessagePayload(d),f=simulation(config,model);
  assert.equal((await deliverAdvanced(f.args)).status,'sent');
  const send=f.events.find(e=>e.op==='fake-send');assert.equal(send.scope.creator,model);
  assert.equal(send.payload.text,personalizeMessage(m,{fan:'John Smith',custom:'Johnny Bravo'}).text);
  assert.equal(send.payload.price,mediaMode==='paid'?15.5:mediaMode==='text'?5:0);
  assert.deepEqual(send.payload.media,config.messages[0].media);
  assert.equal(send.payload.lockedText,mediaMode==='text');
  assert.deepEqual(f.events.map(e=>e.op),['claim','authorize','begin','fake-send','finish']);
 });
}
test('all audiences, recurrence endings, time windows and filters survive draft persistence',()=>{
 for(const audience of ['all','collections','selected'])for(const endMode of ['duration','date','runs']){
  const d=newAutoMessage('mass');d.name='Fixture';d.messages[0].text='Hola';Object.assign(d.bulk,{audience,listIds:['1'],recipients:['2'],repeat:true,intervalMinutes:180,endMode,endAt:'2030-01-02T10:00',durationMinutes:3000,maxRuns:5});
  d.audience.excludeLists=['3'];assert.deepEqual(autoMessagePayload(d).bulk,d.bulk);
 }
 for(const trigger of ['welcome','online','expired','expiring']){
  const d=newAutoMessage(trigger);d.name='Fixture';d.messages[0].text='Hola';d.timeWindow={enabled:true,start:'22:00',end:'06:00',zone:'Europe/Madrid'};
  for(const key of ['modelSpend','agencySpend','modelPurchase','agencyPurchase','buyingPower'])d.audience[key]={enabled:true,min:1,max:4};
  d.unsend.enabled=true;if(trigger==='online')d.resend.enabled=true;
  d.messages.push(...Array.from({length:4},()=>({...newAutoMessageStep(),text:'Seguimiento'})));
  assert.equal(validateAutoMessage(d),'');const out=autoMessagePayload(d);assert.deepEqual(out.audience,d.audience);assert.deepEqual(out.timeWindow,d.timeWindow);assert.equal(out.messages.length,5);
 }
});
test('future and expired deliveries do not contact the fake provider',async()=>{
 for(const time of [{dueAt:new Date(now+1).toISOString()},{expiresAt:new Date(now).toISOString()}]){
  const d=newAutoMessage('mass');d.messages[0].text='Hola';const f=simulation(d,'model-1',time);
  assert.equal((await deliverAdvanced(f.args)).status,'stopped');assert.ok(!f.events.some(e=>e.op==='fake-send'));
 }
});
test('database failure before begin produces no provider write',async()=>{
 const d=newAutoMessage('mass');d.messages[0].text='Hola';const f=simulation(d);
 f.store.begin=async()=>{throw Error('database unavailable')};assert.equal((await deliverAdvanced(f.args)).status,'blocked');assert.ok(!f.events.some(e=>e.op==='fake-send'));
});
test('loss of confirmation after provider write is uncertain and not released for retry',async()=>{
 const d=newAutoMessage('mass');d.messages[0].text='Hola';const f=simulation(d);const original=f.store.finish;
 f.store.finish=async(c,r)=>{if(r.status==='sent')throw Error('database timeout');return original(c,r)};
 assert.equal((await deliverAdvanced(f.args)).status,'uncertain');assert.equal(f.events.filter(e=>e.op==='fake-send').length,1);assert.ok(!f.events.some(e=>e.op==='release'));assert.equal(f.events.at(-1).value.status,'uncertain');
});
