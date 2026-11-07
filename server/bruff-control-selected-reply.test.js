import test from 'node:test';
import assert from 'node:assert/strict';
import {queueSelectedReply,SelectedReplyError} from '../supabase/functions/bruff-control/selected-reply.js';
import {ENGINE_VERSION,reservedUsage} from '../supabase/functions/bruff-drafts/usage.js';
const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',w='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',c='cccccccc-cccc-4ccc-8ccc-cccccccccccc',generation='dddddddd-dddd-4ddd-8ddd-dddddddddddd',request='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',job='ffffffff-ffff-4fff-8fff-ffffffffffff',other='11111111-1111-4111-8111-111111111111',example='22222222-2222-4222-8222-222222222222';
const english='Hello! How is your morning?',args=()=>({workspace_id:w,model_id:c,fan_id:'123',generation_id:generation,draft_id:'2',request_id:request,expected_english:english,confirmed:true});
const canonical=(patch={})=>({actorId:actor,workspaceId:w,creatorId:c,fanId:'123',requestId:generation,generationId:generation,revision:'a'.repeat(32),contextHash:'b'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),engine:'generative',engineVersion:ENGINE_VERSION,engineInvoked:false,reused:false,valid:true,aiGenerated:true,aiVerified:false,approvedCount:1,usage:reservedUsage(),quota:{usageDay:'2026-11-06',resetsAt:'2026-11-07T00:00:00.000Z',modelQueries:1,modelDailyLimit:100,sharedBudgetNeurons:7500,calculatedNeurons:0,reservedNeurons:600,chargedNeurons:600,remainingNeurons:6900,observedRequests:0,reservedRequests:1},drafts:[{id:'2',english,spanish:'¡Hola! ¿Cómo va tu mañana?',exampleIds:[example],knowledgeIds:[]}],unknowns:[],...patch});
const receipt=(patch={})=>({actorId:actor,workspaceId:w,creatorId:c,fanId:'123',generationId:generation,draftId:'2',requestId:request,jobId:job,state:'queued',version:1,newlyQueued:true,...patch});
function fixture(options={}){
 const events=[],calls=[],queues=[],dispatches=[];let checks=0;
 const run=(input=args(),extra={})=>queueSelectedReply({args:input,actor,w,c,call:async(path,body)=>{calls.push({path,body});events.push('verify');if(options.call)return options.call(path,body);return {ok:true,status:200,data:options.canonical??canonical()}},recheckOwner:async()=>{checks++;events.push('owner');return options.owner?options.owner(checks):true},queue:async value=>{queues.push(value);events.push('queue');return options.queue?options.queue(value):options.receipt??receipt()},dispatch:options.noDispatch?undefined:async value=>{dispatches.push(value);events.push('dispatch');return options.dispatch?options.dispatch(value):{state:'sent',privateOpaque:'not-forwarded'}},...extra});
 return {run,events,calls,queues,dispatches};
}
const fail=(run,status,code)=>assert.rejects(run,error=>error instanceof SelectedReplyError&&error.status===status&&(!code||error.code===code));

test('explicit selection is freshly verified before one canonical queue and one fixed-job dispatch',async()=>{
 const f=fixture(),out=await f.run();assert.deepEqual(f.calls,[{path:'/functions/v1/bruff-drafts',body:{workspace_id:w,creator_id:c,operation:'verify',conversation_id:'123',request_id:generation}}]);assert.deepEqual(f.queues,[{w,c,fan:'123',request_id:request,generation_id:generation,draft_id:'2',expected_english:english,confirmed:true}]);assert.deepEqual(f.dispatches,[job]);assert.deepEqual(f.events,['verify','owner','queue','owner','dispatch','owner']);assert.deepEqual(out,{...receipt(),dispatchRequested:true,dispatchUnconfirmed:false});assert.equal(out.sent,undefined);assert.equal(out.state,'queued');assert.equal(out.expected_english,undefined);
});
test('unconfirmed, cross-scope, injected or incomplete selections make no request and never queue',async()=>{
 const changes=[{confirmed:false},{confirmed:'true'},{workspace_id:other},{model_id:other},{fan_id:'0'},{fan_id:'0123'},{fan_id:123},{fan_id:'1'.repeat(25)},{generation_id:'bad'},{draft_id:'4'},{request_id:'bad'},{expected_english:''},{expected_english:' '},{expected_english:'x'.repeat(701)},{expected_english:'hello\u0000'},{text:'forged'},{price:0},{media:[]},{operation:'send'},{url:'https://private.test'},{history:[]},{actor_id:other}];
 for(const change of changes){const f=fixture();await fail(()=>f.run({...args(),...change}),400,'SELECTED_REPLY_INPUT');assert.deepEqual(f.events,[]);assert.equal(f.queues.length,0)}
 for(const missing of Object.keys(args())){const value=args();delete value[missing];const f=fixture();await fail(()=>f.run(value),400);assert.deepEqual(f.events,[])}
 const inherited=Object.create(args()),f=fixture();await fail(()=>f.run(inherited),400);assert.equal(f.calls.length,0);
});
test('the exact confirmed English is immutable across asynchronous verification',async()=>{
 for(const inputText of [english+' ',english.replace('morning','evening')]){const f=fixture();await fail(()=>f.run({...args(),expected_english:inputText}),409,'SELECTED_REPLY_CHANGED');assert.deepEqual(f.events,['verify','owner']);assert.equal(f.queues.length,0)}
 const input=args(),changedText='A different canonical reply.',f=fixture({call:()=>{input.expected_english=changedText;return {ok:true,status:200,data:canonical({drafts:[{...canonical().drafts[0],english:changedText}]})}}});await fail(()=>f.run(input),409);assert.equal(f.queues.length,0);
});
test('canonical identity, expiry, option and legacy engine mismatches cannot enqueue',async()=>{
 for(const patch of [{actorId:other},{workspaceId:other},{creatorId:other},{fanId:'456'},{generationId:other},{expiresAt:new Date(Date.now()-1000).toISOString()},{drafts:[]},{aiVerified:true},{engineVersion:'legacy-v1'}]){const f=fixture({canonical:canonical(patch)});await assert.rejects(()=>f.run(),error=>error instanceof SelectedReplyError&&[403,409,503].includes(error.status));assert.equal(f.calls.length,1);assert.equal(f.queues.length,0);assert.equal(f.dispatches.length,0)}
});
test('owner revocation immediately after verification prevents queueing',async()=>{
 const f=fixture({owner:()=>false});await fail(()=>f.run(),403,'SELECTED_REPLY_ACCESS');assert.deepEqual(f.events,['verify','owner']);assert.equal(f.queues.length,0);assert.equal(f.dispatches.length,0);
});
test('owner is rechecked after queue success or failure and before a dispatch can be requested',async()=>{
 for(const queue of [()=>receipt(),()=>{throw Error('private database details')}]){const f=fixture({queue,owner:n=>n===1});await fail(()=>f.run(),403,'SELECTED_REPLY_ACCESS');assert.deepEqual(f.events,['verify','owner','queue','owner']);assert.equal(f.queues.length,1);assert.equal(f.dispatches.length,0)}
});
test('failed or uncertain queue calls are not retried and do not echo backend details',async()=>{
 const f=fixture({queue:()=>{throw Error('private-key private fan https://private.test')}});await assert.rejects(()=>f.run(),error=>error instanceof SelectedReplyError&&error.status===503&&error.code==='SELECTED_REPLY_QUEUE'&&!error.message.includes('private'));assert.equal(f.queues.length,1);assert.equal(f.dispatches.length,0);assert.deepEqual(f.events,['verify','owner','queue','owner']);
});
test('a concurrent SQL context change remains a safe conflict after the owner recheck',async()=>{
 const f=fixture({queue:()=>{throw Object.assign(Error('private SQL conflict body'),{status:409,code:'arbitrary'})}});await fail(()=>f.run(),409,'SELECTED_REPLY_CHANGED');assert.equal(f.queues.length,1);assert.equal(f.dispatches.length,0);assert.deepEqual(f.events,['verify','owner','queue','owner']);
 for(const status of [401,403]){const denied=fixture({queue:()=>{throw Object.assign(Error('private SQL access body'),{status})}});await fail(()=>denied.run(),status,status===401?'SELECTED_REPLY_AUTH':'SELECTED_REPLY_ACCESS');assert.equal(denied.dispatches.length,0)}
});
test('queue receipt must bind every identity, choice, request nonce and valid ledger state',async()=>{
 const changes=[{actorId:other},{workspaceId:other},{creatorId:other},{fanId:'456'},{generationId:other},{draftId:'1'},{requestId:other},{jobId:'bad'},{state:'unknown'},{version:0},{version:1.5},{newlyQueued:'true'},{newlyQueued:true,state:'sending'},{newlyQueued:true,state:'sent'},{newlyQueued:true,state:'uncertain'}];
 for(const patch of changes){const f=fixture({receipt:receipt(patch)});await fail(()=>f.run(),503,'SELECTED_REPLY_UNAVAILABLE');assert.equal(f.queues.length,1);assert.equal(f.dispatches.length,0);assert.deepEqual(f.events,['verify','owner','queue','owner'])}
});
test('idempotent known jobs in every valid state are never dispatched again',async()=>{
 for(const state of ['queued','claimed','generating','ready','draft_ready','sending','sent','skipped','blocked','uncertain']){const f=fixture({receipt:receipt({state,newlyQueued:false,version:3})}),out=await f.run();assert.equal(out.state,state);assert.equal(out.dispatchRequested,false);assert.equal(out.dispatchUnconfirmed,false);assert.equal(f.queues.length,1);assert.equal(f.dispatches.length,0)}
 const f=fixture({receipt:receipt({newlyQueued:false,requestId:other})}),out=await f.run({...args(),request_id:other});assert.equal(out.jobId,job);assert.equal(out.requestId,other);assert.equal(f.dispatches.length,0);
});
test('dispatch failure returns only the current queued receipt with an explicit uncertainty flag and no retry',async()=>{
 const f=fixture({dispatch:()=>{throw Error('private runner key and provider details')}}),out=await f.run();assert.equal(out.state,'queued');assert.equal(out.dispatchRequested,true);assert.equal(out.dispatchUnconfirmed,true);assert.equal(out.sent,undefined);assert.equal(f.queues.length,1);assert.equal(f.dispatches.length,1);assert.ok(!JSON.stringify(out).includes('private'));
});
test('dispatch results never replace the ledger receipt or imply delivery',async()=>{
 const f=fixture({dispatch:()=>({state:'sent',providerId:'private-provider',email:'private-email',token:'private-key',media:[{url:'https://signed.private'}]})}),out=await f.run();assert.equal(out.state,'queued');for(const text of ['private','providerId','email','token','media','https'])assert.ok(!JSON.stringify(out).includes(text));assert.equal(out.dispatchUnconfirmed,false);
 const queued=fixture({noDispatch:true}),saved=await queued.run();assert.equal(saved.state,'queued');assert.equal(saved.dispatchRequested,false);assert.equal(queued.dispatches.length,0);
});
test('owner revocation during dispatch hides the receipt without requeueing or redispatching',async()=>{
 const f=fixture({owner:n=>n<3});await fail(()=>f.run(),403,'SELECTED_REPLY_ACCESS');assert.equal(f.queues.length,1);assert.equal(f.dispatches.length,1);assert.deepEqual(f.events,['verify','owner','queue','owner','dispatch','owner']);
});
test('UUIDs are canonicalized while literal English and a canonical original job remain unchanged',async()=>{
 const f=fixture({receipt:receipt({actorId:actor.toUpperCase(),workspaceId:w.toUpperCase(),creatorId:c.toUpperCase(),generationId:generation.toUpperCase(),requestId:request.toUpperCase(),jobId:job.toUpperCase(),privateEmail:'never expose',capability:'never expose'})}),input=args(),snapshot=structuredClone(input),out=await f.run({...input,workspace_id:w.toUpperCase(),model_id:c.toUpperCase(),generation_id:generation.toUpperCase(),request_id:request.toUpperCase()},{actor:actor.toUpperCase(),w:w.toUpperCase(),c:c.toUpperCase()});assert.equal(out.jobId,job);assert.equal(out.actorId,actor);assert.deepEqual(input,snapshot);assert.equal(f.queues[0].expected_english,english);assert.equal(out.privateEmail,undefined);assert.equal(out.capability,undefined);
});
test('upstream failures and cancellation remain sanitized and cannot queue or retry a reply',async()=>{
 for(const response of [{ok:false,status:409,data:{code:'AI_CONTEXT_CHANGED',error:'private'}},{ok:false,status:403,data:{error:'private'}},{ok:false,status:429,data:{code:'AI_PROVIDER_LIMIT',retryAfter:12,error:'private'}},{ok:false,status:500,data:{error:'private'}}]){const f=fixture({call:()=>response});await assert.rejects(()=>f.run(),error=>error instanceof SelectedReplyError&&!error.message.includes('private')&&(response.status===429?error.retryAfter===12:true));assert.equal(f.calls.length,1);assert.equal(f.queues.length,0)}
 const aborted=fixture({call:()=>{throw Object.assign(Error('private abort'),{name:'AbortError'})}});await fail(()=>aborted.run(),408,'AI_CANCELLED');assert.equal(aborted.queues.length,0);
});
