import {test} from 'node:test';
import assert from 'node:assert/strict';
import {advancedStore} from './advanced-store.js';
test('Supabase false and null envelopes never authorize or begin',async()=>{
 for(const data of [false,null,{},'true']){
  const store=advancedStore({rpc:async()=>({data,error:null})});
  assert.equal(await store.authorize({id:'1'}),false);
  assert.equal(await store.begin({id:'1'},{}),false);
 }
});
test('Supabase errors fail closed without leaking provider details',async()=>{
 const store=advancedStore({rpc:async()=>({data:true,error:{message:'private detail'}})});
 await assert.rejects(store.authorize({id:'1'}),/No se pudo verificar/);
});
test('queue adapter unwraps claim and persists exact lease and revision',async()=>{
 const claim={id:'delivery',lease:'lease',revision:7},calls=[];
 const store=advancedStore({rpc:async(name,args)=>{calls.push({name,args});return {data:args.op==='claim'?claim:true,error:null}}});
 assert.deepEqual(await store.claim('delivery'),claim);
 assert.equal(await store.begin(claim,{text:'Hola'}),true);
 assert.equal(calls[1].args.lease_id,'lease');assert.equal(calls[1].args.expected_revision,7);
 assert.deepEqual(calls[1].args.value,{text:'Hola'});
 await store.finish(claim,{status:'sent',providerId:'12'});
});
