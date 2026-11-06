import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeKey,validateSuggestions,validateChatDirectSuggestions,materializeChatDirectSuggestion} from './chat-direct.js';
import {createChatDirectSource,validateGenerationQuota,validateGenerationUsage} from './chat-direct-source.js';
const actor='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',example='55555555-5555-4555-8555-555555555555';
const context={actor,workspace,account,fanId:'123',revision:'ui-revision',canRead:true,canInsert:true,messages:[{id:'99',isFromMe:false,text:'hello from client; not authoritative'}]};context.scope=scopeKey(context);
const request=(patch={})=>({context,scope:context.scope,revision:context.revision,input:'',...patch});
const quota=patch=>({usageDay:'2026-11-06',resetsAt:'2026-11-07T00:00:00.000Z',modelQueries:1,modelDailyLimit:100,sharedBudgetNeurons:7500,calculatedNeurons:12,reservedNeurons:600,chargedNeurons:612,remainingNeurons:6888,observedRequests:1,reservedRequests:1,...patch});
const usage=patch=>({status:'observed',promptTokens:200,completionTokens:100,calculatedNeurons:12,chargedNeurons:12,...patch});
const result=id=>({engine:'generative',engineVersion:'bruff-drafts-v2',valid:true,aiGenerated:true,aiVerified:false,requestId:id,generationId:id,actorId:actor,workspaceId:workspace,creatorId:account,fanId:'123',revision:'a'.repeat(32),contextHash:'b'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),drafts:[{id:'1',english:'hey! how is your day?',spanish:'¡Hola! ¿Cómo va tu día?',exampleIds:[example],knowledgeIds:[]}],unknowns:['No hay datos de ubicación.'],approvedCount:1,engineInvoked:true,reused:false,usage:usage(),quota:quota()});
function fixture(options={}){
 const calls=[];let saved;
 const client={rpc(name,args){calls.push({name,args});if(name==='bruff_generation_quota'){const data={actorId:actor,workspaceId:workspace,creatorId:account,quota:quota()};return Promise.resolve(options.quotaError?{error:options.quotaError}:{data:options.quota?options.quota(data):data})}const data={actorId:actor,workspaceId:workspace,creatorId:account,settings:{enabled:true},version:1,approvedCount:1};return Promise.resolve(options.poolError?{error:options.poolError}:{data:options.pool?options.pool(data):data})},functions:{async invoke(name,args){calls.push({name,args});if(options.invokeError)return{error:options.invokeError};const body=args.body;if(body.operation==='generate'){saved=result(body.request_id);if(options.generated)saved=options.generated(saved);return{data:saved}}const data={...saved,requestId:body.request_id,engineInvoked:false,reused:false};return{data:options.verified?options.verified(data):data}}}};
 return{calls,source:createChatDirectSource(client,{actor,workspace,engineEndpoint:true,generationEndpoint:true})};
}
test('generated flow sends only fixed active scope IDs; no client transcript, operator prompt or source text',async()=>{
 const f=fixture(),payload=await f.source(request());assert.equal(payload.knowledge.engine,'generative');assert.equal(payload.candidates[0].aiGenerated,true);assert.equal(payload.candidates[0].source.verified,false);assert.equal(payload.knowledge.unknowns.length,1);
 const call=f.calls.find(x=>x.name==='bruff-drafts');assert.deepEqual(Object.keys(call.args.body).sort(),['operation','workspace_id','creator_id','conversation_id','request_id','force'].sort());assert.equal(call.args.body.force,false);assert.equal(call.args.body.conversation_id,'123');assert.ok(!JSON.stringify(call.args.body).includes('client;'));
 assert.throws(()=>validateSuggestions(payload,{scope:context.scope,revision:context.revision}));
 const checked=validateChatDirectSuggestions(payload,{scope:context.scope,revision:context.revision});assert.equal(materializeChatDirectSuggestion(checked[0]).complete,true);assert.equal(materializeChatDirectSuggestion(checked[0],{NAME:'fake'}).complete,false);
 assert.equal(await f.source.verify(request({candidate:checked[0]})),true);assert.equal(f.calls.filter(x=>x.name==='bruff-drafts').length,2);
});
test('generated response cannot cross actor, workspace, model, fan or request identity',async()=>{
 for(const patch of [{actorId:example},{workspaceId:example},{creatorId:example},{fanId:'999'},{generationId:example},{requestId:example},{aiVerified:true},{engineInvoked:false},{reused:'yes'},{engineVersion:'legacy-v1'},{valid:false},{revision:'not-a-version'},{expiresAt:'not-a-date'}]){const f=fixture({generated:data=>({...data,...patch})});await assert.rejects(()=>f.source(request()))}
});
test('changed exact text, cited source, history/version or expiry prevents insertion verification',async()=>{
 for(const verified of [data=>({...data,drafts:[{...data.drafts[0],english:'changed'}]}),data=>({...data,drafts:[{...data.drafts[0],exampleIds:[actor]}]}),data=>({...data,revision:'c'.repeat(32)}),data=>({...data,expiresAt:new Date(Date.now()-1).toISOString()}),data=>({...data,drafts:[]})]){const f=fixture({verified}),payload=await f.source(request());await assert.rejects(()=>f.source.verify(request({candidate:payload.candidates[0]})))}
 const f=fixture(),payload=await f.source(request());await assert.rejects(()=>f.source.verify(request({candidate:{...payload.candidates[0],english:'altered in browser'}})));
});
test('mixed generated/literal batches, media, variables, duplicate IDs and false verified claims fail separately',async()=>{
 const f=fixture(),payload=await f.source(request()),draft=payload.candidates[0],options={scope:context.scope,revision:context.revision};
 for(const patch of [{aiVerified:true},{source:{...draft.source,verified:true}},{source:{...draft.source,modelId:example}},{content:{mediaIds:['1']}},{variables:[{key:'NAME'}]},{exampleIds:[]},{knowledgeIds:[example,example]},{generationId:'invalid'}])assert.throws(()=>validateChatDirectSuggestions({...payload,candidates:[{...draft,...patch}]},options));
 assert.throws(()=>validateChatDirectSuggestions({...payload,candidates:[draft,{...draft,aiGenerated:false}]},options));assert.throws(()=>validateChatDirectSuggestions({...payload,candidates:[draft,draft]},options));assert.throws(()=>validateChatDirectSuggestions(payload,{...options,allowedSourceModels:[]}));
});
test('revoked or stale configurations never become silent bank fallbacks',async()=>{
 for(const poolError of [{code:'42501'},{code:'XX000'},{status:403}]){const f=fixture({poolError});await assert.rejects(()=>f.source(request()));assert.equal(f.calls.length,1)}
 for(const pool of [x=>({...x,creatorId:example}),x=>({...x,settings:{enabled:'yes'}}),x=>({...x,version:-1})]){const f=fixture({pool});await assert.rejects(()=>f.source(request()));assert.equal(f.calls.length,1)}
 for(const status of [401,403,409,429,503]){const f=fixture({invokeError:{context:{status},message:'raw secret'}});await assert.rejects(()=>f.source(request()),e=>!e.message.includes('secret'));assert.equal(f.calls.length,2)}
});
test('changing scope or cancelling while generation is pending discards its result',async()=>{
 let complete;const pending=new Promise(resolve=>{complete=resolve}),f=fixture();const controller=new AbortController(),client={rpc:()=>Promise.resolve({data:{actorId:actor,workspaceId:workspace,creatorId:account,settings:{enabled:true},version:1,approvedCount:1}}),functions:{invoke:async(name,args)=>{await pending;return{data:result(args.body.request_id)}}}};
 const source=createChatDirectSource(client,{actor,workspace,generationEndpoint:true}),job=source(request({signal:controller.signal}));await Promise.resolve();await Promise.resolve();controller.abort();complete();await assert.rejects(job,{name:'AbortError'});
 await assert.rejects(()=>f.source(request({context:{...context,fanId:'999'}})));assert.equal(f.calls.length,0);
});
test('generation disabled, no approved sources and missing RPC are explicit and never silently query the bank',async()=>{
 for(const [options,reason] of [[{pool:x=>({...x,settings:{enabled:false},approvedCount:0})},'disabled'],[{pool:x=>({...x,approvedCount:0})},'no_sources'],[{poolError:{code:'PGRST202'}},'rpc_missing']]){const f=fixture(options);await assert.rejects(()=>f.source(request()),e=>e.diagnostic?.reason===reason&&e.diagnostic?.engine==='generative');assert.equal(f.calls.length,1);assert.equal(f.calls[0].name,'bruff_generation_pool')}
});
test('explicit bank selection skips generation readiness and preserves exact approved originals',async()=>{
 const calls=[],candidate={id:'example1',english:'Thanks for asking!',spanish:'¡Gracias por preguntar!',source:{kind:'document',modelId:account,referenceId:'guide1',label:'Approved guide',version:'1.r1',verified:true}};
 const client={functions:{async invoke(name,args){calls.push({name,args});assert.equal(name,'bruff-ai');return{data:{actorId:actor,workspaceId:workspace,creatorId:account,status:'connected',approvedCount:1,rows:[candidate],engine:'bank',configured:true,engineInvoked:false}}}},rpc(){throw Error('Unexpected generation readiness call')}};
 const source=createChatDirectSource(client,{actor,workspace,engineEndpoint:true,generationEndpoint:true}),payload=await source(request({mode:'bank',input:'How are you?'}));assert.equal(payload.knowledge.engine,'bank');assert.equal(payload.candidates[0].english,candidate.english);assert.equal(calls.length,1);
 await assert.rejects(()=>source(request({mode:'unknown'})),/Elige/);assert.equal(calls.length,1);
});
test('server cache hits keep the original generation identity and verify it without another generation',async()=>{
 const f=fixture({generated:data=>({...data,generationId:example,reused:true,engineInvoked:false})}),payload=await f.source(request());
 assert.equal(payload.knowledge.reused,true);assert.equal(payload.knowledge.engineInvoked,false);assert.equal(payload.candidates[0].generationId,example);assert.deepEqual(payload.knowledge.usage,usage());assert.deepEqual(payload.quota,quota());
 assert.ok(!Object.hasOwn(payload.candidates[0],'usage'));assert.ok(!Object.hasOwn(payload.candidates[0],'reused'));
 const generated=f.calls.find(x=>x.name==='bruff-drafts');assert.notEqual(generated.args.body.request_id,example);
 assert.equal(await f.source.verify(request({candidate:payload.candidates[0]})),true);
 const verify=f.calls.filter(x=>x.name==='bruff-drafts').at(-1);assert.equal(verify.args.body.request_id,example);assert.equal(verify.args.body.operation,'verify');assert.ok(!Object.hasOwn(verify.args.body,'force'));
});
test('explicit regeneration alone sets force and cannot accept a purported reused forced result',async()=>{
 const f=fixture();await f.source(request());await f.source(request({force:true}));
 const requests=f.calls.filter(x=>x.name==='bruff-drafts');assert.deepEqual(requests.map(x=>x.args.body.force),[false,true]);assert.notEqual(requests[0].args.body.request_id,requests[1].args.body.request_id);
 const reused=fixture({generated:data=>({...data,reused:true,engineInvoked:false})});await assert.rejects(()=>reused.source(request({force:true})));
 const invalid=fixture();await assert.rejects(()=>invalid.source(request({force:'true'})));assert.ok(!invalid.calls.some(x=>x.name==='bruff-drafts'));
});
test('successful empty generations and empty cache hits preserve expiry and allow an explicit later regeneration',async()=>{
 for(const reused of [false,true]){
  const f=fixture({generated:data=>({...data,drafts:[],unknowns:['Falta contexto confirmado.'],reused,engineInvoked:!reused})});const payload=await f.source(request());
  assert.equal(payload.candidates.length,0);assert.equal(payload.knowledge.reused,reused);assert.ok(Date.parse(payload.knowledge.expiresAt)>Date.now());assert.equal(payload.knowledge.generationId,f.calls.find(x=>x.name==='bruff-drafts').args.body.request_id);
 }
});
test('legacy verification is explicit and still validates canonical identity, usage and current quota',async()=>{
 const f=fixture({verified:data=>({...data,engineVersion:'legacy-v1',usage:{status:'reserved',promptTokens:null,completionTokens:null,calculatedNeurons:null,chargedNeurons:600}})}),payload=await f.source(request());
 assert.equal(await f.source.verify(request({candidate:payload.candidates[0]})),true);
 for(const patch of [{requestId:example},{reused:true},{engineInvoked:true},{engineVersion:'unknown'}]){
  const bad=fixture({verified:data=>({...data,...patch})}),result=await bad.source(request());await assert.rejects(()=>bad.source.verify(request({candidate:result.candidates[0]})));
 }
});
test('quota reads are authenticated and scoped but never invoke an engine or send client history',async()=>{
 const f=fixture(),data=await f.source.readQuota(request());assert.deepEqual(data,quota());assert.deepEqual(f.calls,[{name:'bruff_generation_quota',args:{w:workspace,c:account}}]);
 for(const patch of [{actorId:example},{workspaceId:example},{creatorId:example}]){const bad=fixture({quota:data=>({...data,...patch})});await assert.rejects(()=>bad.source.readQuota(request()),e=>e.diagnostic?.reason==='access')}
 const denied=fixture({quotaError:{code:'42501'}});await assert.rejects(()=>denied.source.readQuota(request()),e=>e.diagnostic?.reason==='access');
 const controller=new AbortController();controller.abort();await assert.rejects(()=>f.source.readQuota(request({signal:controller.signal})),{name:'AbortError'});assert.equal(f.calls.length,1);
});
test('observed consumption and conservative reservations cannot be conflated or fabricated',()=>{
 assert.deepEqual(validateGenerationUsage(usage()),usage());assert.deepEqual(validateGenerationUsage({status:'reserved',promptTokens:null,completionTokens:null,calculatedNeurons:null,chargedNeurons:600}),{status:'reserved',promptTokens:null,completionTokens:null,calculatedNeurons:null,chargedNeurons:600});
 for(const patch of [{promptTokens:null},{promptTokens:0},{completionTokens:-1},{calculatedNeurons:null},{chargedNeurons:600},{status:'billed'}])assert.throws(()=>validateGenerationUsage(usage(patch)));
 assert.throws(()=>validateGenerationUsage({status:'reserved',promptTokens:0,completionTokens:0,calculatedNeurons:0,chargedNeurons:600}));
 for(const patch of [{modelDailyLimit:1001},{modelQueries:-1},{remainingNeurons:7500},{sharedBudgetNeurons:10000},{chargedNeurons:0},{usageDay:'2026-02-31'},{resetsAt:'2026-11-08T00:00:00Z'}])assert.throws(()=>validateGenerationQuota(quota(patch)));
 assert.equal(validateGenerationQuota(quota({modelDailyLimit:1000})).modelDailyLimit,1000);
});
test('malformed successful response usage or quota prevents presenting generated cards',async()=>{
 for(const patch of [{usage:null},{usage:usage({chargedNeurons:0})},{quota:null},{quota:quota({reservedNeurons:-1})}]){const f=fixture({generated:data=>({...data,...patch})});await assert.rejects(()=>f.source(request()))}
});
