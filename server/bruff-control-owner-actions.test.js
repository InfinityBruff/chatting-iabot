import test from 'node:test';
import assert from 'node:assert/strict';
import {createBruffControlHandler} from '../supabase/functions/bruff-control/handler.js';
import {ENGINE_VERSION,reservedUsage} from '../supabase/functions/bruff-drafts/usage.js';
const actor='11111111-1111-4111-8111-111111111111',w='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',requestId='55555555-5555-4555-8555-555555555555';
const base='https://unit.supabase.co',token='Bearer owner-test-session',scope={workspace_id:w,model_id:c};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
const source=()=>({id,version:1,state:'draft',trigger:'Good morning',english:'Hello! How is your morning?',spanish:'¡Hola! ¿Cómo va tu mañana?',referenceId:'document.real.1',label:'Neutral source',sourceVersion:'v1'});
const exampleList=row=>({schemaVersion:1,status:'connected',canEdit:true,items:[row],total:1,limit:200,complete:true,savedId:null});
const quota=()=>{const day=new Date().toISOString().slice(0,10);return {usageDay:day,resetsAt:new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString(),modelQueries:1,modelDailyLimit:100,sharedBudgetNeurons:7500,calculatedNeurons:0,reservedNeurons:600,chargedNeurons:600,remainingNeurons:6900,observedRequests:0,reservedRequests:1}};
const delegation=()=>({enabled:false,mode:'drafts',fanScope:'selected',fanIds:[],delaySeconds:20,maxRepliesPerFanDay:5,contextSharingConfirmed:false,automaticSendingConfirmed:false});
const generated=operation=>({actorId:actor,workspaceId:w,creatorId:c,fanId:'123',requestId,generationId:requestId,revision:'a'.repeat(32),contextHash:'b'.repeat(64),expiresAt:new Date(Date.now()+600000).toISOString(),engine:'generative',engineVersion:ENGINE_VERSION,engineInvoked:operation==='generate',reused:false,valid:true,aiGenerated:true,aiVerified:false,approvedCount:1,usage:reservedUsage(),quota:quota(),drafts:[{id:'1',english:'Hello! How is your morning?',spanish:'¡Hola! ¿Cómo va tu mañana?',exampleIds:[id],knowledgeIds:[]}],unknowns:[]});
function fixture(options={}){
 const calls=[],state={revoked:false,row:source(),settings:{enabled:false,dailyLimit:100,maxResults:3},version:2,delegation:delegation(),delegationVersion:0,activity:[]};
 const handler=createBruffControlHandler({url:base,anonKey:'public-test-key',ownerActionsEnabled:options.enabled??true,autopilotEnabled:options.worker??false,autopilotSendEnabled:options.send??false,autopilotRuntimeReady:options.ready??false,dispatchJob:options.dispatch,timeoutMs:options.timeoutMs,draftsTimeoutMs:options.draftsTimeoutMs,fetcher:async(url,request)=>{
  const path=url.slice(base.length),body=request.body?JSON.parse(request.body):null;calls.push({path,body,request});
  const response=await options.respond?.(path,body,state,request);if(response!==undefined)return response;
  if(path==='/auth/v1/user')return json({id:actor,email_confirmed_at:'confirmed',is_anonymous:false});
  if(path==='/rest/v1/rpc/bruff_ai_models')return state.revoked?json({code:'42501'},403):json({actorId:actor,workspaces:[{id:w,name:'Fictional workspace',models:[{id:c,name:'Fictional model'}]}]});
  if(path==='/rest/v1/rpc/bruff_chat_direct_knowledge'){
   if(body.op==='save'){assert.equal(body.expected,state.row.version);state.row={...state.row,version:state.row.version+1,state:body.value.state};return json({...exampleList(state.row),savedId:id})}
   return json(exampleList(state.row));
  }
  if(path==='/rest/v1/rpc/bruff_generation_control'){
   if(body.op==='save'){state.version++;state.settings=body.value}
   return json({actorId:actor,workspaceId:w,creatorId:c,settings:state.settings,version:state.version});
  }
  if(path==='/rest/v1/rpc/bruff_autopilot_control'){
   if(body.op==='review_uncertain'){
    const row=state.activity.find(x=>x.id===body.value.jobId);if(!row||row.version!==body.expected||row.state!=='uncertain'||row.uncertainReviewedAt)return json({code:'40001'},409);
    Object.assign(row,{version:row.version+1,uncertainReviewedAt:new Date().toISOString(),uncertainReviewedBy:actor,uncertainReviewNote:body.value.reviewNote});state.delegationVersion++;state.delegation={...state.delegation,enabled:false};
   }
   if(['save','pause'].includes(body.op)){if(body.expected!==state.delegationVersion)return json({code:'40001'},409);state.delegationVersion++;state.delegation=body.op==='save'?body.value:{...state.delegation,enabled:false}}
   return json({actorId:actor,workspaceId:w,creatorId:c,settings:state.delegation,version:state.delegationVersion,effectiveEnabled:state.delegation.enabled,activity:['activity','review_uncertain'].includes(body.op)?state.activity:[]});
  }
  if(path==='/rest/v1/rpc/bruff_queue_selected_reply')return json({actorId:actor,workspaceId:w,creatorId:c,fanId:body.fan,generationId:body.generation_id,draftId:body.draft_id,requestId:body.request_id,jobId:body.request_id,state:'queued',version:1,newlyQueued:true});
  if(path==='/functions/v1/bruff-drafts')return json(generated(body.operation));
  if(path==='/functions/v1/bruff-live')return json({observedAt:new Date().toISOString(),data:{cursor:null,hasMore:false,...(body.operation==='inbox'?{conversations:[{id:'123',userId:'123',name:'Fictional fan',username:'fictional',lastMessage:'Hello',lastMessageTime:new Date().toISOString(),lastMessageIsFromMe:false,unreadCount:1}]}:{messages:[{id:'10',text:'Hello',isFromMe:false,createdAt:new Date().toISOString(),price:0,isTip:false,isOpened:false,mediaCount:0}]})}});
  throw Error('Unexpected endpoint');
 }});
 const run=(name,args={},headers={})=>handler(new Request(base+'/functions/v1/bruff-control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token,...headers},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name,arguments:{...scope,...args}}})}));
 const list=()=>handler(new Request(base+'/functions/v1/bruff-control',{method:'POST',headers:{'Content-Type':'application/json',Authorization:token},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/list',params:{}})}));
 return {run,list,calls,state};
}
const result=async response=>(await response.json()).result;

test('advanced owner tools are off by default and do not widen legacy discovery or accepted arguments',async()=>{
 for(const enabled of [false,'true',1]){const f=fixture({enabled}),tools=(await result(await f.list())).tools;assert.equal(tools.length,12);const before=f.calls.length;assert.equal((await f.run('bruff_approve_source',{kind:'example',source_id:id,expected_version:1,review_hash:'a'.repeat(64),reviewed:true})).status,400);assert.equal(f.calls.length,before)}
 const f=fixture();const tools=(await result(await f.list())).tools;assert.equal(tools.length,32);assert.ok(tools.some(x=>x.name==='bruff_generate_replies'));assert.ok(!tools.some(x=>/send_message|run_bot/u.test(x.name)));assert.equal(tools.find(x=>x.name==='bruff_generate_replies').annotations.openWorldHint,true);assert.equal(tools.find(x=>x.name==='bruff_queue_selected_reply').annotations.openWorldHint,true);
});

test('review and approval use real owner scope and preserve the exact stored source with fresh CAS',async()=>{
 const f=fixture(),prepared=(await result(await f.run('bruff_prepare_source_approval',{kind:'example',source_id:id,expected_version:1}))).structuredContent;
 assert.equal(prepared.requiresApproval,true);assert.equal(prepared.entry.english,source().english);assert.equal(f.state.row.state,'draft');
 const approved=await result(await f.run('bruff_approve_source',{kind:'example',source_id:id,expected_version:1,review_hash:prepared.reviewHash,reviewed:true}));assert.equal(approved.isError,false);assert.equal(approved.structuredContent.items[0].state,'verified');assert.equal(approved.structuredContent.items[0].version,2);
 const saves=f.calls.filter(x=>x.path.endsWith('/bruff_chat_direct_knowledge')&&x.body.op==='save');assert.equal(saves.length,1);assert.deepEqual(saves[0].body,{w,c,op:'save',example_id:id,expected:1,value:{trigger:source().trigger,english:source().english,spanish:source().spanish,referenceId:source().referenceId,label:source().label,sourceVersion:source().sourceVersion,state:'verified',reviewed:true}});
 for(const call of f.calls){assert.equal(call.request.headers.Authorization,token);assert.equal(call.request.headers.apikey,'public-test-key');assert.equal(call.request.redirect,'error')}
});

test('approval rejects a stale review and unreviewed or injected data without writing',async()=>{
 const f=fixture();const prepared=(await result(await f.run('bruff_prepare_source_approval',{kind:'example',source_id:id,expected_version:1}))).structuredContent;f.state.row.english='Changed after review';
 const stale=await result(await f.run('bruff_approve_source',{kind:'example',source_id:id,expected_version:1,review_hash:prepared.reviewHash,reviewed:true}));assert.equal(stale.isError,true);assert.equal(stale.structuredContent.errorCode,'SOURCE_CHANGED');assert.equal(f.calls.filter(x=>x.body?.op==='save').length,0);
 for(const extra of [{reviewed:false},{value:{state:'verified'}},{actor_id:actor},{text:'replace source'}]){const fresh=fixture();assert.equal((await fresh.run('bruff_approve_source',{kind:'example',source_id:id,expected_version:1,review_hash:'a'.repeat(64),reviewed:true,...extra})).status,400);assert.equal(fresh.calls.length,0)}
});

test('owner removal after approval prevents returned source data and never retries a successful mutation',async()=>{
 const f=fixture({respond:(path,body,state)=>{if(path.endsWith('/bruff_chat_direct_knowledge')&&body.op==='save')state.revoked=true}}),prepared=(await result(await f.run('bruff_prepare_source_approval',{kind:'example',source_id:id,expected_version:1}))).structuredContent;
 const response=await f.run('bruff_approve_source',{kind:'example',source_id:id,expected_version:1,review_hash:prepared.reviewHash,reviewed:true});assert.equal(response.status,403);assert.equal(f.state.row.state,'verified');assert.equal(f.calls.filter(x=>x.body?.op==='save').length,1);assert.ok(!(await response.text()).includes(source().english));
});

test('enabled manual settings require context sharing consent and exact version while the legacy save remains disabled-only',async()=>{
 const settings={enabled:true,dailyLimit:150,maxResults:2},f=fixture();assert.equal((await result(await f.run('bruff_save_generation_preferences',{expected_version:2,settings,context_sharing_confirmed:false}))).isError,true);assert.equal(f.calls.filter(x=>x.body?.op==='save').length,0);
 const saved=await result(await f.run('bruff_save_generation_preferences',{expected_version:2,settings,context_sharing_confirmed:true}));assert.equal(saved.isError,false);assert.deepEqual(saved.structuredContent.settings,settings);assert.equal(saved.structuredContent.version,3);
 const stale=await result(await f.run('bruff_save_generation_preferences',{expected_version:2,settings,context_sharing_confirmed:true}));assert.equal(stale.isError,true);assert.equal(f.calls.filter(x=>x.body?.op==='save').length,1);
 const old=fixture();assert.equal((await old.run('bruff_update_generation_settings',{expected_version:2,settings})).status,400);assert.equal(old.calls.length,0);
});

test('conversation and generation tools route fixed authenticated calls and recheck the owner after results',async()=>{
 const cases=[['bruff_list_conversations',{},'inbox'],['bruff_read_conversation',{fan_id:'123'},'messages'],['bruff_generate_replies',{fan_id:'123',request_id:requestId,share_context:true},'generate'],['bruff_verify_reply_selection',{fan_id:'123',generation_id:requestId,draft_id:'1'},'verify']];
 for(const [name,args,operation]of cases){const f=fixture(),out=await result(await f.run(name,args));assert.equal(out.isError,false,name);const calls=f.calls.filter(x=>x.path.startsWith('/functions/v1/'));assert.equal(calls.length,1);assert.equal(calls[0].body.operation,operation);assert.equal(calls[0].body.workspace_id,w);assert.equal(calls[0].body.creator_id,c);assert.equal(f.calls.filter(x=>x.path.endsWith('/bruff_ai_models')).length,2);assert.ok(!calls.some(x=>/send|prepare_send/u.test(x.body.operation)))}
});

test('revocation after a generated result hides the text and never creates a send or another inference',async()=>{
 const f=fixture({respond:(path,_body,state)=>{if(path==='/functions/v1/bruff-drafts')state.revoked=true}}),response=await f.run('bruff_generate_replies',{fan_id:'123',request_id:requestId,share_context:true});assert.equal(response.status,403);assert.ok(!(await response.text()).includes(source().english));assert.equal(f.calls.filter(x=>x.path==='/functions/v1/bruff-drafts').length,1);
});

test('generation and verification gain their bounded operation deadline after confirmed owner preflight',async()=>{
 const f=fixture({timeoutMs:40,draftsTimeoutMs:500,respond:async(path)=>{if(path==='/functions/v1/bruff-drafts')await new Promise(resolve=>setTimeout(resolve,70))}}),response=await f.run('bruff_generate_replies',{fan_id:'123',request_id:requestId,share_context:true});assert.equal(response.status,200);assert.equal((await result(response)).isError,false);
 const limited=fixture({respond:path=>path==='/functions/v1/bruff-drafts'?json({code:'AI_PROVIDER_LIMIT',error:'private provider detail'},429,{'Retry-After':'17'}):undefined}),out=await result(await limited.run('bruff_generate_replies',{fan_id:'123',request_id:requestId,share_context:true}));assert.equal(out.isError,true);assert.equal(out.structuredContent.retryAfter,17);assert.equal(out.structuredContent.errorCode,'AI_PROVIDER_LIMIT');assert.ok(!JSON.stringify(out).includes('private provider detail'));
});

test('delegation reads report runtime readiness truthfully and disabled configuration can be saved before setup',async()=>{
 const f=fixture(),read=(await result(await f.run('bruff_read_autopilot'))).structuredContent;assert.equal(read.effectiveEnabled,false);assert.equal(read.delegationAuthorized,false);assert.deepEqual(read.runtime,{workerEnabled:false,automaticSendingEnabled:false,backgroundReady:false});
 const saved=await result(await f.run('bruff_save_autopilot',{expected_version:0,settings:{...delegation(),delaySeconds:60}}));assert.equal(saved.isError,false);assert.equal(saved.structuredContent.settings.delaySeconds,60);assert.equal(saved.structuredContent.version,1);
});

test('activation requires exact scope and consents plus ready worker and separate sending flag',async()=>{
 const automatic={...delegation(),enabled:true,mode:'automatic',fanScope:'all',contextSharingConfirmed:true,automaticSendingConfirmed:true};
 for(const options of [{},{worker:true},{worker:true,ready:true},{worker:true,ready:true,send:'true'}]){const f=fixture(options),out=await result(await f.run('bruff_save_autopilot',{expected_version:0,settings:automatic}));assert.equal(out.isError,true);assert.equal(f.calls.filter(x=>x.path.endsWith('/bruff_autopilot_control')).length,0)}
 for(const settings of [{...automatic,contextSharingConfirmed:false},{...automatic,automaticSendingConfirmed:false},{...automatic,fanScope:'selected',fanIds:[]},{...automatic,fanIds:['123']},{...automatic,fanScope:'selected',fanIds:['123','123']}]){const f=fixture({worker:true,send:true,ready:true}),out=await result(await f.run('bruff_save_autopilot',{expected_version:0,settings}));assert.ok(out?.isError||!out);assert.equal(f.calls.filter(x=>x.path.endsWith('/bruff_autopilot_control')).length,0)}
 const f=fixture({worker:true,send:true,ready:true}),out=await result(await f.run('bruff_save_autopilot',{expected_version:0,settings:automatic}));assert.equal(out.isError,false);assert.equal(out.structuredContent.effectiveEnabled,true);assert.equal(f.calls.filter(x=>x.path.endsWith('/bruff_autopilot_control')&&x.body.op==='save').length,1);assert.equal(f.calls.filter(x=>x.path.startsWith('/functions/v1/')).length,0);
 const draft=fixture({worker:true,ready:true}),draftSaved=await result(await draft.run('bruff_save_autopilot',{expected_version:0,settings:{...automatic,mode:'drafts',automaticSendingConfirmed:false}}));assert.equal(draftSaved.isError,false);
});

test('pause is versioned and works while runtime is off; revocation hides all settings after mutation',async()=>{
 const f=fixture();f.state.delegation={...delegation(),enabled:true,fanIds:['123'],contextSharingConfirmed:true};f.state.delegationVersion=4;
 const out=await result(await f.run('bruff_pause_autopilot',{expected_version:4}));assert.equal(out.isError,false);assert.equal(out.structuredContent.settings.enabled,false);assert.equal(out.structuredContent.version,5);assert.equal((await result(await f.run('bruff_pause_autopilot',{expected_version:4}))).isError,true);
 const revoked=fixture({respond:(path,body,state)=>{if(path.endsWith('/bruff_autopilot_control')&&body.op==='pause')state.revoked=true}}),response=await revoked.run('bruff_pause_autopilot',{expected_version:0});assert.equal(response.status,403);assert.equal(revoked.state.delegationVersion,1);assert.ok(!(await response.text()).includes('contextSharingConfirmed'));
});

test('activity projects canonical drafts and receipts without credentials, media, leases or false AI verification',async()=>{
 const f=fixture();f.state.activity=[{id,kind:'automatic',version:2,fanId:'123',anchorMessageId:'10',state:'draft_ready',createdAt:new Date().toISOString(),dueAt:new Date().toISOString(),providerId:null,detail:'send_disabled',generationId:requestId,engineVersion:'bruff-autopilot-v1',drafts:generated('generate').drafts,unknowns:[],usage:{...reservedUsage(),secret:'hidden'},lease:'hidden',binding:'hidden',media:['https://private.invalid/signed'],aiVerified:true}];
 const out=await result(await f.run('bruff_read_autopilot_activity'));assert.equal(out.isError,false);assert.equal(out.structuredContent.activity[0].aiVerified,false);assert.equal(out.structuredContent.activity[0].drafts[0].english,source().english);assert.ok(!JSON.stringify(out).includes('hidden'));assert.ok(!JSON.stringify(out).includes('signed'));
 f.state.activity[0].state='sent';const broken=await result(await f.run('bruff_read_autopilot_activity'));assert.equal(broken.isError,true);f.state.activity[0].providerId='999';assert.equal((await result(await f.run('bruff_read_autopilot_activity'))).isError,false);
});

test('selected reply requires ready runtime and exact confirmation, then queues real owner scope without claiming delivery',async()=>{
 const args={fan_id:'123',generation_id:requestId,draft_id:'1',request_id:id,expected_english:source().english,confirmed:true};
 const off=fixture();assert.equal((await result(await off.run('bruff_queue_selected_reply',args))).isError,true);assert.equal(off.calls.filter(x=>x.path==='/functions/v1/bruff-drafts').length,0);
 const dispatched=[],f=fixture({worker:true,send:true,ready:true,dispatch:job=>dispatched.push(job)}),out=await result(await f.run('bruff_queue_selected_reply',args));assert.equal(out.isError,false);assert.equal(out.structuredContent.state,'queued');assert.equal(out.structuredContent.dispatchRequested,true);assert.deepEqual(dispatched,[id]);assert.ok(!JSON.stringify(out).includes('"state":"sent"'));
 const queue=f.calls.find(x=>x.path.endsWith('/bruff_queue_selected_reply'));assert.deepEqual(queue.body,{w,c,fan:'123',request_id:id,generation_id:requestId,draft_id:'1',expected_english:source().english,confirmed:true});assert.equal(queue.request.headers.Authorization,token);
 const mismatch=fixture({worker:true,send:true,ready:true});assert.equal((await result(await mismatch.run('bruff_queue_selected_reply',{...args,expected_english:'Modified message'}))).isError,true);assert.equal(mismatch.calls.filter(x=>x.path.endsWith('/bruff_queue_selected_reply')).length,0);
 for(const extra of [{confirmed:false},{media:['file']},{actor_id:actor}]){const f=fixture({worker:true,send:true,ready:true});assert.equal((await f.run('bruff_queue_selected_reply',{...args,...extra})).status,400);assert.equal(f.calls.length,0)}
});

test('queue conflict does not retry or dispatch and revocation after queue hides its receipt',async()=>{
 const args={fan_id:'123',generation_id:requestId,draft_id:'1',request_id:id,expected_english:source().english,confirmed:true};let dispatched=0;
 const f=fixture({worker:true,send:true,ready:true,dispatch:()=>dispatched++,respond:path=>path.endsWith('/bruff_queue_selected_reply')?json({code:'40001'},409):undefined}),out=await result(await f.run('bruff_queue_selected_reply',args));assert.equal(out.isError,true);assert.equal(dispatched,0);assert.equal(f.calls.filter(x=>x.path.endsWith('/bruff_queue_selected_reply')).length,1);
 const revoked=fixture({worker:true,send:true,ready:true,dispatch:()=>dispatched++,respond:(path,_body,state)=>{if(path.endsWith('/bruff_queue_selected_reply'))state.revoked=true}}),response=await revoked.run('bruff_queue_selected_reply',args);assert.equal(response.status,403);assert.equal(dispatched,0);assert.ok(!(await response.text()).includes('jobId'));
});

test('uncertain review preserves an unknown receipt, verifies job CAS and exact note, and leaves delegation paused',async()=>{
 const f=fixture({worker:true,send:true,ready:true});f.state.delegation={...delegation(),enabled:true,mode:'automatic',fanScope:'all',contextSharingConfirmed:true,automaticSendingConfirmed:true};f.state.delegationVersion=20;
 f.state.activity=[{id,kind:'automatic',version:8,fanId:'123',anchorMessageId:'10',state:'uncertain',createdAt:new Date().toISOString(),dueAt:new Date().toISOString(),providerId:null,detail:'needs_review',generationId:requestId,engineVersion:'bruff-autopilot-v1',selectedDraftId:'1',drafts:generated('generate').drafts,unknowns:[],usage:reservedUsage(),uncertainReviewedAt:null,uncertainReviewedBy:null,uncertainReviewNote:null}];
 const args={job_id:id,expected_job_version:8,review_note:'Reviewed the provider history; delivery remains unconfirmed.'},out=await result(await f.run('bruff_review_uncertain_reply',args));assert.equal(out.isError,false);assert.equal(out.structuredContent.settings.enabled,false);assert.equal(out.structuredContent.version,21);assert.equal(out.structuredContent.effectiveEnabled,false);const row=out.structuredContent.activity[0];assert.equal(row.state,'uncertain');assert.equal(row.providerId,null);assert.equal(row.version,9);assert.equal(row.uncertainReviewedBy,actor);assert.equal(row.uncertainReviewNote,args.review_note);assert.equal(row.selectedDraftId,'1');
 const again=await result(await f.run('bruff_review_uncertain_reply',args));assert.equal(again.isError,true);assert.equal(f.state.activity[0].version,9);assert.equal(f.calls.filter(x=>x.path.startsWith('/functions/v1/')).length,0);
 const call=f.calls.find(x=>x.path.endsWith('/bruff_autopilot_control')&&x.body.op==='review_uncertain');assert.deepEqual(call.body,{w,c,op:'review_uncertain',expected:8,value:{jobId:id,reviewNote:args.review_note}});
});
