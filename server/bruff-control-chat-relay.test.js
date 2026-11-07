import test from 'node:test';
import assert from 'node:assert/strict';
import {runChatRelay,ChatRelayError} from '../supabase/functions/bruff-control/chat-relay.js';
import {reservedUsage,ENGINE_VERSION} from '../supabase/functions/bruff-drafts/usage.js';
const actor='11111111-1111-4111-8111-111111111111',w='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333',request='44444444-4444-4444-8444-444444444444',other='55555555-5555-4555-8555-555555555555',example='66666666-6666-4666-8666-666666666666';
const at=Date.parse('2026-11-06T12:00:00Z'),scope={workspace_id:w,model_id:c};
const quota=()=>({usageDay:'2026-11-06',resetsAt:'2026-11-07T00:00:00.000Z',modelQueries:1,modelDailyLimit:100,sharedBudgetNeurons:7500,calculatedNeurons:0,reservedNeurons:600,chargedNeurons:600,remainingNeurons:6900,observedRequests:0,reservedRequests:1});
const draft=(patch={})=>({id:'1',english:'Hello! How is your morning?',spanish:'¡Hola! ¿Cómo va tu mañana?',exampleIds:[example],knowledgeIds:[],...patch});
const generated=(patch={})=>({actorId:actor,workspaceId:w,creatorId:c,fanId:'123',requestId:request,generationId:request,revision:'a'.repeat(32),contextHash:'b'.repeat(64),expiresAt:'2026-11-06T12:10:00Z',engine:'generative',engineVersion:ENGINE_VERSION,engineInvoked:true,reused:false,valid:true,aiGenerated:true,aiVerified:false,approvedCount:1,usage:reservedUsage(),quota:quota(),drafts:[draft()],unknowns:[],...patch});
const list=()=>({observedAt:'2026-11-06T12:00:00Z',data:{cursor:'opaque-next',hasMore:true,conversations:[{id:'999',userId:'123',name:'Fictional fan',username:'fictional',lastMessage:'Good morning',lastMessageTime:'2026-11-06T11:59:00Z',lastMessageIsFromMe:false,unreadCount:2}]}});
const history=()=>({observedAt:'2026-11-06T12:00:00Z',data:{cursor:null,hasMore:false,messages:[{id:'10',text:'Good morning',isFromMe:false,createdAt:'2026-11-06T11:59:00Z',price:0,isTip:false,isOpened:false,mediaCount:0}]}});
function fixture(options={}){
 const calls=[],events=[];
 const run=(operation,args={},extra={})=>runChatRelay({operation,args:{...scope,...args},actor,w,c,now:()=>at,call:async(path,body)=>{calls.push({path,body});events.push('relay');if(options.call)return options.call(path,body);return {ok:true,status:200,data:options.data??(operation==='list'?list():operation==='read'?history():generated(operation==='verify'?{engineInvoked:false,reused:false}:{}))}},recheckOwner:async()=>{events.push('owner');if(options.owner)return options.owner();return true},...extra});
 return {run,calls,events};
}
const fail=(action,status,code)=>assert.rejects(action,error=>error instanceof ChatRelayError&&error.status===status&&(!code||error.code===code));

test('listing and reading use only fixed scoped background endpoints and one provider page',async()=>{
 const f=fixture(),data=await f.run('list',{query:'fictional',cursor:'page2'});assert.deepEqual(f.calls,[{path:'/functions/v1/bruff-live',body:{workspace_id:w,creator_id:c,operation:'inbox',fast:true,background:true,query:'fictional',cursor:'page2'}}]);assert.equal(data.partial,true);assert.equal(data.hasMore,true);assert.equal(data.cursor,'opaque-next');assert.equal(data.conversations[0].fanId,'123');assert.equal(data.modelId,c);assert.deepEqual(f.events,['relay','owner']);
 const h=fixture(),read=await h.run('read',{fan_id:'123',cursor:'older'});assert.deepEqual(h.calls[0],{path:'/functions/v1/bruff-live',body:{workspace_id:w,creator_id:c,operation:'messages',conversation_id:'123',background:true,cursor:'older'}});assert.equal(read.fanId,'123');assert.equal(read.partial,true);assert.equal(read.messages[0].text,'Good morning');assert.equal(read.hasMore,false);
});

test('relay rejects operations, cross-scopes, unacknowledged generation and forged payload fields before any call',async()=>{
 const cases=[['send',{}],['list',{workspace_id:other}],['list',{model_id:other}],['list',{url:'https://evil.test'}],['list',{operation:'prepare_send'}],['list',{query:'x'.repeat(151)}],['list',{cursor:'x'.repeat(2049)}],['list',{cursor:'x\nheader'}],['read',{fan_id:'../123'}],['read',{fan_id:123}],['read',{fan_id:'1'.repeat(25)}],['read',{fan_id:'123',text:'injected'}],['generate',{fan_id:'123',request_id:request}],['generate',{fan_id:'123',request_id:request,share_context:false}],['generate',{fan_id:'123',request_id:request,share_context:true,force:'true'}],['generate',{fan_id:'123',request_id:request,share_context:true,history:[]}],['generate',{fan_id:'123',request_id:request,share_context:true,prompt:'injected'}],['generate',{fan_id:'123',request_id:request,share_context:true,price:0}],['verify',{fan_id:'123',generation_id:request,draft_id:'gen.'+request+'.1'}],['verify',{fan_id:'123',generation_id:request,draft_id:'4'}],['verify',{fan_id:'123',generation_id:request,draft_id:'1',english:'forged'}]];
 for(const [op,args]of cases){const f=fixture();await fail(()=>f.run(op,args),400,'CHAT_RELAY_INPUT');assert.equal(f.calls.length,0);assert.equal(f.events.length,0)}
 const f=fixture();await fail(()=>f.run('list',{}, {actor:'invalid'}),503);assert.equal(f.calls.length,0);
 for(const op of ['__proto__','constructor','toString']){const invalid=fixture();await fail(()=>invalid.run(op),400,'CHAT_RELAY_INPUT');assert.equal(invalid.calls.length,0)}
});

test('read projections omit media, attachment capabilities, authors and opaque top-level provider fields',async()=>{
 const poisoned=history();poisoned.providerToken='private-secret';poisoned.data.capability='private-secret';Object.assign(poisoned.data.messages[0],{media:[{url:'https://signed.private/secret',attachment:'private-capability'}],sentBy:'private-worker',token:'private-secret',provider:{opaque:'private-secret'}});poisoned.data.messages[0].text='Hello https://signed.private/secret and data:private';
 const f=fixture({data:poisoned}),data=await f.run('read',{fan_id:'123'}),serialized=JSON.stringify(data);for(const hidden of ['private-secret','signed.private','private-capability','private-worker','attachment','providerToken','media":'])assert.ok(!serialized.includes(hidden),hidden);assert.match(data.messages[0].text,/enlace omitido/);
 const poisonedList=list();Object.assign(poisonedList.data.conversations[0],{avatar:'https://signed.private/profile',spend:{total:999},accountBinding:'acct_private'});poisonedList.data.conversations[0].name='https://signed.private/name';const listed=await fixture({data:poisonedList}).run('list');assert.ok(!JSON.stringify(listed).includes('signed.private'));assert.equal(listed.conversations[0].spend,undefined);
 const poisonedCursor=list();poisonedCursor.data.cursor='https://signed.private/next';await fail(()=>fixture({data:poisonedCursor}).run('list'),503);const denied=fixture();await fail(()=>denied.run('list',{cursor:'https://signed.private/next'}),400);assert.equal(denied.calls.length,0);
});

test('read text is bounded with explicit truncation and no invented complete-history totals',async()=>{
 const data=history();data.data.messages=Array.from({length:8},(_,i)=>({...data.data.messages[0],id:String(i+1),text:'a'.repeat(5000)}));const out=await fixture({data}).run('read',{fan_id:'123'});assert.equal(out.messages.length,8);assert.equal(out.messages.reduce((n,m)=>n+m.text.length,0),16000);assert.ok(out.messages.every(m=>m.textTruncated));assert.equal(out.partial,true);assert.equal(out.total,undefined);assert.equal(out.complete,undefined);
});

test('malformed pages and inconsistent optional scope echoes fail closed after owner revalidation',async()=>{
 for(const modify of [x=>({...x,actorId:other}),x=>({...x,workspaceId:other}),x=>({...x,data:{...x.data,creatorId:other}}),x=>({...x,data:{...x.data,fanId:'456'}}),x=>({...x,data:{...x.data,messages:[{id:'../10'}]}}),x=>({...x,data:{...x.data,messages:[x.data.messages[0],x.data.messages[0]]}}),x=>({...x,data:{...x.data,hasMore:true,cursor:null}}),x=>({...x,data:{...x.data,hasMore:'false'}}),x=>({...x,data:{...x.data,messages:Array(201).fill(x.data.messages[0])}})]){const f=fixture({data:modify(history())});await assert.rejects(()=>f.run('read',{fan_id:'123'}),error=>error instanceof ChatRelayError&&[403,503].includes(error.status));assert.deepEqual(f.events,['relay','owner'])}
});

test('manual generation requires explicit context consent, passes UUID and force once and returns canonical unverified drafts',async()=>{
 for(const force of [undefined,false,true]){const f=fixture(),args={fan_id:'123',request_id:request,share_context:true,...(force!==undefined?{force}:{})},data=await f.run('generate',args);assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0],{path:'/functions/v1/bruff-drafts',body:{workspace_id:w,creator_id:c,operation:'generate',conversation_id:'123',request_id:request,force:force===true}});assert.equal(data.drafts.length,1);assert.equal(data.drafts[0].id,'1');assert.equal(data.drafts[0].english,draft().english);assert.equal(data.aiGenerated,true);assert.equal(data.aiVerified,false);assert.equal(data.requiresHumanReview,true);assert.equal(data.contextHash,undefined);assert.equal(data.revision,undefined)}
});

test('exact-context reuse is returned truthfully without requesting a forced regeneration or inventing options',async()=>{
 const data=generated({generationId:other,engineInvoked:false,reused:true,drafts:[]}),f=fixture({data}),out=await f.run('generate',{fan_id:'123',request_id:request,share_context:true});assert.equal(f.calls.length,1);assert.equal(f.calls[0].body.force,false);assert.equal(out.generationId,other);assert.equal(out.requestId,request);assert.equal(out.reused,true);assert.equal(out.engineInvoked,false);assert.deepEqual(out.drafts,[]);
 await fail(()=>fixture({data}).run('generate',{fan_id:'123',request_id:request,share_context:true,force:true}),503);
});

test('generation output rejects cross-actor/model/fan, invented provenance, invalid accounting and expired drafts',async()=>{
 const changes=[{actorId:other},{workspaceId:other},{creatorId:other},{fanId:'456'},{requestId:other},{generationId:other},{aiVerified:true},{aiGenerated:false},{engineVersion:'untrusted'},{expiresAt:'bad'},{expiresAt:'2026-11-06T11:59:00Z'},{revision:'bad'},{contextHash:'bad'},{usage:{status:'observed',chargedNeurons:1}},{quota:{remainingNeurons:7500}},{drafts:[draft({id:'4'})]},{drafts:[draft(),draft()]},{drafts:[draft({exampleIds:[]})]},{drafts:[draft({exampleIds:['https://private.test']})]},{drafts:[draft({english:'https://signed.private/secret'})]},{drafts:[draft({spanish:'x'.repeat(1001)})]}];
 for(const patch of changes){const f=fixture({data:generated(patch)});await assert.rejects(()=>f.run('generate',{fan_id:'123',request_id:request,share_context:true}),error=>error instanceof ChatRelayError&&[403,503].includes(error.status));assert.equal(f.calls.length,1);assert.deepEqual(f.events,['relay','owner'])}
});

test('generation projections do not forward arbitrary source URLs or capabilities hidden in metadata',async()=>{
 const data=generated({providerKey:'private-secret',usage:{...reservedUsage(),token:'private-secret'},quota:{...quota(),url:'https://signed.private/billing'},drafts:[draft({source:{url:'https://private-source'},media:[{token:'private-capability'}],price:99})]}),out=await fixture({data}).run('generate',{fan_id:'123',request_id:request,share_context:true});for(const value of ['private-secret','private-capability','private-source','signed.private','"price"','"media"'])assert.ok(!JSON.stringify(out).includes(value));assert.deepEqual(out.usage,reservedUsage());
});

test('selection verification returns only the actual canonical option and never persists, inserts or sends it',async()=>{
 const data=generated({engineInvoked:false,drafts:[draft(),draft({id:'3',english:'A second neutral option.',spanish:'Otra opción neutral.'})]}),f=fixture({data}),out=await f.run('verify',{fan_id:'123',generation_id:request,draft_id:'3'});assert.deepEqual(f.calls,[{path:'/functions/v1/bruff-drafts',body:{workspace_id:w,creator_id:c,operation:'verify',conversation_id:'123',request_id:request}}]);assert.equal(out.selectionValid,true);assert.equal(out.selectedDraft.id,'3');assert.equal(out.selectedDraft.english,data.drafts[1].english);assert.equal(out.aiVerified,false);assert.equal(out.drafts,undefined);assert.equal(out.engineInvoked,false);
 await fail(()=>fixture({data}).run('verify',{fan_id:'123',generation_id:request,draft_id:'2'}),409,'AI_CONTEXT_CHANGED');
 const legacy={...data,engineVersion:'legacy-v1'};assert.equal((await fixture({data:legacy}).run('verify',{fan_id:'123',generation_id:request,draft_id:'1'})).engineVersion,'legacy-v1');
});

test('owner revocation after a successful relay prevents all returned chat or generation data',async()=>{
 for(const operation of ['list','read','generate','verify']){const args=operation==='list'?{}:operation==='read'?{fan_id:'123'}:operation==='generate'?{fan_id:'123',request_id:request,share_context:true}:{fan_id:'123',generation_id:request,draft_id:'1'},f=fixture({owner:()=>{throw Object.assign(Error('private revoked details'),{status:403})}});await fail(()=>f.run(operation,args),403,'CHAT_RELAY_ACCESS');assert.equal(f.calls.length,1);assert.deepEqual(f.events,['relay','owner'])}
 await fail(()=>fixture({owner:()=>false}).run('list'),403);
});

test('owner revalidation also happens on errors and cancellation, without returning upstream messages or retrying',async()=>{
 const errors=[{ok:false,status:429,data:{code:'AI_PROVIDER_LIMIT',error:'private token'},retryAfter:19},{ok:false,status:409,data:{code:'AI_PENDING',error:'private fan'},retryAfter:3},{ok:false,status:503,data:{code:'AI_PROVIDER_AUTH',error:'private secret'}},{ok:false,status:502,data:{error:'private provider body'}},{ok:false,status:401,data:{error:'private actor'}}];
 for(const upstream of errors){const f=fixture({call:()=>upstream});await assert.rejects(()=>f.run('list'),error=>error instanceof ChatRelayError&&!error.message.includes('private')&&(upstream.status===429?error.retryAfter===19:true));assert.equal(f.calls.length,1);assert.deepEqual(f.events,['relay','owner'])}
 const aborted=fixture({call:()=>{throw Object.assign(Error('private abort body'),{name:'AbortError'})}});await fail(()=>aborted.run('list'),408,'AI_CANCELLED');assert.deepEqual(aborted.events,['relay','owner']);
 const revoked=fixture({call:()=>({ok:false,status:503,data:{code:'AI_PROVIDER_AUTH'}}),owner:()=>{throw Object.assign(Error('private'),{status:403})}});await fail(()=>revoked.run('list'),403);
});

test('error codes and Retry-After are allowlisted and cannot echo arbitrary URLs or invalid delays',async()=>{
 for(const wait of ['7',-1,0,86401,Infinity]){const f=fixture({call:()=>({ok:false,status:429,data:{code:'https://private.test',retryAfter:wait}})});await assert.rejects(()=>f.run('list'),e=>e instanceof ChatRelayError&&e.code==='CHAT_RELAY_LIMIT'&&e.retryAfter===60&&!e.message.includes('private'))}
 const f=fixture({call:()=>({ok:false,status:500,data:{code:'AI_DISABLED',error:'private'}})});await fail(()=>f.run('list'),503,'CHAT_RELAY_UNAVAILABLE');assert.equal(f.calls.length,1);
 for(const response of [{ok:true,status:503,data:list()},{ok:false,status:200,data:list()},null])await fail(()=>fixture({call:()=>response}).run('list'),503);
});

test('expiry is checked after owner revalidation rather than before a delayed authorization round trip',async()=>{
 let clock=at;const data=generated({expiresAt:'2026-11-06T12:00:01Z'}),f=fixture({data,owner:()=>{clock+=2000;return true}});await fail(()=>f.run('generate',{fan_id:'123',request_id:request,share_context:true},{now:()=>clock}),503);assert.deepEqual(f.events,['relay','owner']);
});
