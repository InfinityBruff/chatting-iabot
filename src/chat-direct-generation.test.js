import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeKey,validateSuggestions,validateChatDirectSuggestions,materializeChatDirectSuggestion} from './chat-direct.js';
import {createChatDirectSource} from './chat-direct-source.js';
const actor='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333',example='55555555-5555-4555-8555-555555555555';
const context={actor,workspace,account,fanId:'123',revision:'ui-revision',canRead:true,canInsert:true,messages:[{id:'99',isFromMe:false,text:'hello from client; not authoritative'}]};context.scope=scopeKey(context);
const request=(patch={})=>({context,scope:context.scope,revision:context.revision,input:'',...patch});
const result=id=>({engine:'generative',valid:true,aiGenerated:true,aiVerified:false,generationId:id,actorId:actor,workspaceId:workspace,creatorId:account,fanId:'123',revision:'a'.repeat(32),contextHash:'b'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),drafts:[{id:'1',english:'hey! how is your day?',spanish:'¡Hola! ¿Cómo va tu día?',exampleIds:[example],knowledgeIds:[]}],unknowns:['No hay datos de ubicación.'],approvedCount:1,engineInvoked:true});
function fixture(options={}){
 const calls=[];let saved;
 const client={rpc(name,args){calls.push({name,args});const data={actorId:actor,workspaceId:workspace,creatorId:account,settings:{enabled:true},version:1,approvedCount:1};return Promise.resolve(options.poolError?{error:options.poolError}:{data:options.pool?options.pool(data):data})},functions:{async invoke(name,args){calls.push({name,args});if(options.invokeError)return{error:options.invokeError};const body=args.body;if(body.operation==='generate'){saved=result(body.request_id);return{data:options.generated?options.generated(saved):saved}}const data={...saved,engineInvoked:false};return{data:options.verified?options.verified(data):data}}}};
 return{calls,source:createChatDirectSource(client,{actor,workspace,engineEndpoint:true,generationEndpoint:true})};
}
test('generated flow sends only fixed active scope IDs; no client transcript, operator prompt or source text',async()=>{
 const f=fixture(),payload=await f.source(request());assert.equal(payload.knowledge.engine,'generative');assert.equal(payload.candidates[0].aiGenerated,true);assert.equal(payload.candidates[0].source.verified,false);assert.equal(payload.knowledge.unknowns.length,1);
 const call=f.calls.find(x=>x.name==='bruff-drafts');assert.deepEqual(Object.keys(call.args.body).sort(),['operation','workspace_id','creator_id','conversation_id','request_id'].sort());assert.equal(call.args.body.conversation_id,'123');assert.ok(!JSON.stringify(call.args.body).includes('client;'));
 assert.throws(()=>validateSuggestions(payload,{scope:context.scope,revision:context.revision}));
 const checked=validateChatDirectSuggestions(payload,{scope:context.scope,revision:context.revision});assert.equal(materializeChatDirectSuggestion(checked[0]).complete,true);assert.equal(materializeChatDirectSuggestion(checked[0],{NAME:'fake'}).complete,false);
 assert.equal(await f.source.verify(request({candidate:checked[0]})),true);assert.equal(f.calls.filter(x=>x.name==='bruff-drafts').length,2);
});
test('generated response cannot cross actor, workspace, model, fan or request identity',async()=>{
 for(const patch of [{actorId:example},{workspaceId:example},{creatorId:example},{fanId:'999'},{generationId:example},{aiVerified:true},{engineInvoked:false},{valid:false},{revision:'not-a-version'},{expiresAt:'not-a-date'}]){const f=fixture({generated:data=>({...data,...patch})});await assert.rejects(()=>f.source(request()))}
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
