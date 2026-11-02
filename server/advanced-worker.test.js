import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runAdvancedTick} from './advanced-worker.js';

function fixture({mode}={}){
 const scope={workspace:'w',creator:'c',fan:'123'},calls=[],writes=[];
 const delivery={id:'delivery',activationId:'run',binding:'acct_a',scope};
 const claim={...delivery,status:'claimed',lease:'lease',revision:1,trigger:mode==='welcome'?'welcome':'mass',stepIndex:0,dueAt:new Date(Date.now()-1000).toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),message:{text:'Hola {nombre}',nameMode:'fan',firstName:true,fallback:'Amigo',media:[]}};
 const rpc=async(name,args)=>{
  calls.push({name,args});
  if(name==='bruff_advanced_transport_authorize')return true;
  if(name==='bruff_advanced_poll')return {ready:true,deliveries:[delivery]};
  if(name==='bruff_advanced_context')return args.op==='screen'?{allowed:mode!=='moderation'}:{scope,binding:mode==='binding'?'acct_other':'acct_a',customName:''};
  if(name==='bruff_advanced_execute'){
   if(args.op==='claim')return claim;
   if(args.op==='begin')return mode!=='paused';
   return true;
  }
  throw Error('RPC inesperada');
 };
 const fetcher=async(url,options)=>{
  if(options.method==='POST'){writes.push(JSON.parse(options.body));if(mode==='timeout')throw Error('timeout');return new Response(JSON.stringify({id:'888'}))}
  return new Response(JSON.stringify({id:123,name:'John Smith'}));
 };
 return {calls,writes,args:{token:'fixture',rpc,providerKey:'fixture',fetcher,writeEnabled:true}};
}
test('worker defaults to disabled and tells scheduler it cannot send',async()=>{
 const f=fixture();delete f.args.writeEnabled;
 assert.deepEqual(await runAdvancedTick(f.args),{ready:false,processed:0});
 assert.equal(f.calls.length,1);assert.equal(f.calls[0].args.can_send,false);assert.equal(f.writes.length,0);
});
test('worker integrates RPC, names and provider with fictitious transport only',async()=>{
 const f=fixture();assert.deepEqual(await runAdvancedTick(f.args),{ready:true,processed:1,results:['sent']});
 assert.equal(f.writes.length,1);assert.equal(f.writes[0].text,'Hola John');
 assert.equal(f.calls.find(c=>c.args.op==='finish').args.value.providerId,'888');
});
test('pause, moderation, changed binding and unsupported triggers prevent writes',async()=>{
 for(const mode of ['paused','moderation','binding','welcome']){
  const f=fixture({mode});await runAdvancedTick(f.args);assert.equal(f.writes.length,0,mode);
 }
});
test('uncertain provider write is persisted without automatic retry',async()=>{
 const f=fixture({mode:'timeout'});const result=await runAdvancedTick(f.args);
 assert.deepEqual(result.results,['uncertain']);assert.equal(f.writes.length,1);
 assert.equal(f.calls.find(c=>c.args.op==='finish').args.value.status,'uncertain');
 assert.equal(f.calls.some(c=>c.args.op==='release'),false);
});
test('malformed scheduler batches fail closed',async()=>{
 for(const batch of [null,{ready:'true',deliveries:[]},{ready:true,deliveries:Array(5).fill({})}]){
  const f=fixture();f.args.rpc=async()=>batch;await assert.rejects(runAdvancedTick(f.args));assert.equal(f.writes.length,0);
 }
});
