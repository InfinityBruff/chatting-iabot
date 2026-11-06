import test from 'node:test';
import assert from 'node:assert/strict';
import {createChatDirectSource} from './chat-direct-source.js';
import {scopeKey} from './chat-direct.js';

const context={actor:'worker',workspace:'agency',account:'model',fanId:'123',revision:'r1',canRead:true,canInsert:true};context.scope=scopeKey(context);
const candidate={id:'example1',english:'Thanks for asking!',spanish:'¡Gracias por preguntar!',source:{kind:'document',modelId:'model',referenceId:'guide1',label:'Approved support guide',version:'1.r1',verified:true}};
const request=(over={})=>({context,scope:context.scope,revision:'r1',input:'How does this work?',...over});
function fixture(data,error=null){
 const scope={actorId:'worker',workspaceId:'agency',creatorId:'model'};if(data&&typeof data==='object')data={...scope,...data};
 const calls=[];const client={rpc:(name,args)=>{let signal;calls.push({name,args});return {abortSignal(value){signal=value;calls.at(-1).signal=value;return this},then(resolve,reject){return Promise.resolve(typeof data==='function'?data():{data,error}).then(resolve,reject)}}}};
 return{client,calls,source:createChatDirectSource(client,{actor:'worker',workspace:'agency'})};
}
test('queries only the selected model and exact input, not transcripts or fan identity',async()=>{
 const {source,calls}=fixture({status:'connected',approvedCount:1,rows:[candidate]});
 const result=await source(request());assert.equal(result.candidates[0].english,candidate.english);
 assert.deepEqual(calls[0].args,{w:'agency',c:'model',query:'How does this work?'});
 assert.equal(result.scope,context.scope);assert.equal(result.revision,'r1');assert.equal(result.knowledge.approvedCount,1);
});
test('an empty authenticated bank produces no invented cards',async()=>{
 const {source}=fixture({status:'empty',approvedCount:0,rows:[]});assert.deepEqual((await source(request())).candidates,[]);
});
test('an approved bank without comparable examples remains distinct from an empty bank',async()=>{
 const {source}=fixture({status:'connected',approvedCount:5,rows:[]});assert.equal((await source(request())).knowledge.status,'connected');
});
test('rejects crossed actor/workspace/fan scope, read-only and stale revisions before RPC',async()=>{
 const {source,calls}=fixture({status:'empty',approvedCount:0,rows:[]});
 for(const changed of [{actor:'other'},{workspace:'other'},{fanId:'456'},{canInsert:false},{canRead:false},{scope:'wrong'},{revision:'r2'}])await assert.rejects(()=>source(request({context:{...context,...changed}})));
 assert.equal(calls.length,0);
});
test('validates the approved source model and rejects a fabricated transcript source',async()=>{
 for(const sourceValue of [{...candidate.source,modelId:'other'},{verified:true,modelId:'model',conversationId:'123',messageId:'1',version:1}]){
  const {source}=fixture({status:'connected',approvedCount:1,rows:[{...candidate,source:sourceValue}]});await assert.rejects(()=>source(request()));
 }
});
test('rejects inconsistent bank counts and malformed responses',async()=>{
 for(const data of [null,{status:'empty',approvedCount:1,rows:[]},{status:'empty',approvedCount:0,rows:[candidate]},{status:'connected',approvedCount:-1,rows:[]},{status:'unknown',approvedCount:0,rows:[]}])await assert.rejects(()=>fixture(data).source(request()));
});
test('empty/oversized inputs cannot issue a cloud read',async()=>{
 const {source,calls}=fixture(null);for(const input of ['', ' ', 'x'.repeat(2001),null])await assert.rejects(()=>source(request({input})));assert.equal(calls.length,0);
});
test('cancellation reaches Supabase and a late result cannot become a suggestion',async()=>{
 let complete;const pending=new Promise(resolve=>{complete=resolve});
 const {source,calls}=fixture(()=>pending),controller=new AbortController();
 const result=source(request({signal:controller.signal}));controller.abort();complete({data:{actorId:'worker',workspaceId:'agency',creatorId:'model',status:'connected',approvedCount:1,rows:[candidate]},error:null});
 await assert.rejects(result,{name:'AbortError'});assert.equal(calls[0].signal,controller.signal);
});
test('never displays provider errors or SQL details',async()=>{
 for(const code of ['42501','PGRST202','XX000']){const {source}=fixture(null,{code,message:'secret SQL/raw transcript'});await assert.rejects(()=>source(request()),error=>!error.message.includes('secret'))}
});
test('rechecks an exact reference version before preparing and denies revoked examples',async()=>{
 const {source,calls}=fixture({valid:true});assert.equal(await source.verify(request({candidate})),true);
 assert.deepEqual(calls[0],{name:'bruff_chat_direct_reference',args:{w:'agency',c:'model',example_id:'example1',expected:'1.r1'}});
 const revoked=fixture({valid:false}).source;await assert.rejects(()=>revoked.verify(request({candidate})),/retirado/);
 const foreign={...candidate,source:{...candidate.source,modelId:'other'}};await assert.rejects(()=>source.verify(request({candidate:foreign})));assert.equal(calls.length,1);
});

test('rejects authoritative actor, agency or model changes even when the old request scope matches',async()=>{
 for(const changed of [{actorId:'other'},{workspaceId:'other'},{creatorId:'other'}]){const {source}=fixture({status:'connected',approvedCount:1,rows:[candidate],valid:true,...changed});await assert.rejects(()=>source(request()),/sesión o la modelo/);await assert.rejects(()=>source.verify(request({candidate})),/sesión o la modelo/)}
});

test('engine bridge passes no fan/history and retains exact approved responses',async()=>{
 const {client}=fixture(null),calls=[];client.functions={invoke:async(name,args)=>{calls.push({name,args});return{data:{actorId:'worker',workspaceId:'agency',creatorId:'model',status:'connected',approvedCount:1,rows:[candidate],engine:'semantic',configured:true,engineInvoked:true},error:null}}};
 const source=createChatDirectSource(client,{actor:'worker',workspace:'agency',engineEndpoint:true}),result=await source(request());
 assert.equal(calls[0].name,'bruff-ai');assert.deepEqual(Object.keys(calls[0].args.body).sort(),['workspace_id','creator_id','query','request_id'].sort());assert.equal(calls[0].args.body.query,'How does this work?');assert.match(calls[0].args.body.request_id,/^[0-9a-f-]{36}$/);assert.equal(result.candidates[0].english,candidate.english);assert.equal(result.knowledge.engine,'semantic');assert.equal(result.knowledge.engineInvoked,true);
});
test('engine missing configuration, limits, revocation and stale results never fall back silently',async()=>{
 for(const status of [401,403,409,429,503,500]){const {client,calls}=fixture(null);client.functions={invoke:async()=>({error:{context:{status},message:'secret'}})};const source=createChatDirectSource(client,{actor:'worker',workspace:'agency',engineEndpoint:true});await assert.rejects(()=>source(request()),error=>!error.message.includes('secret'));assert.equal(calls.length,0)}
 for(const patch of [{configured:false},{engine:'unknown'},{engineInvoked:'yes'}]){const {client}=fixture(null);client.functions={invoke:async()=>({data:{actorId:'worker',workspaceId:'agency',creatorId:'model',status:'empty',approvedCount:0,rows:[],engine:'bank',configured:true,engineInvoked:false,...patch}})};await assert.rejects(()=>createChatDirectSource(client,{actor:'worker',workspace:'agency',engineEndpoint:true})(request()))}
});
