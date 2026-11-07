import test from 'node:test';
import assert from 'node:assert/strict';
import {createAiRunnerHandler,AUTOPILOT_ENGINE_VERSION} from '../supabase/functions/bruff-ai-runner/handler.js';
import {historyHash,historySnapshot} from '../supabase/functions/bruff-drafts/generation.js';
import {providerUsage,reservedUsage} from '../supabase/functions/bruff-drafts/usage.js';

const w='11111111-1111-4111-8111-111111111111',c='22222222-2222-4222-8222-222222222222',a='33333333-3333-4333-8333-333333333333',id='44444444-4444-4444-8444-444444444444',lease='55555555-5555-4555-8555-555555555555',example='66666666-6666-4666-8666-666666666666',manualGeneration='77777777-7777-4777-8777-777777777777';
const response=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
const identity={actorId:a,workspaceId:w,creatorId:c};
const currentHistory=()=>({messages:[{id:'12',text:'How is your day?',isFromMe:false,createdAt:'2026-11-06T12:00:00Z'}]});
const output=()=>({drafts:[{id:'1',english:'Hello! How has your day been?',spanish:'¡Hola! ¿Cómo ha ido tu día?',exampleIds:['E1'],knowledgeIds:[]}],unknowns:[]});
const answer=()=>({success:true,result:{response:JSON.stringify(output()),usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}}});
function fixture(options={}){
 const calls=[];let state='new',reads=0,pools=0,saved,claimArgs,usage=reservedUsage(),finished=false;
 const job={id,lease,scope:{workspace:w,creator:c,fan:'99'},binding:'acct_fixture',configVersion:1,anchorMessageId:'12',notBefore:new Date(Date.now()-1000).toISOString(),mode:'automatic',kind:'automatic',...options.job};
 const pool={...identity,settings:{enabled:true,dailyLimit:100,maxResults:3},version:1,revision:'a'.repeat(32),approvedCount:1,examples:[{id:example,version:1,trigger:'How is your day?',english:'How is your morning?',spanish:'¿Cómo va tu mañana?',referenceId:'fictional-source',sourceVersion:'1'}],knowledge:[],configVersion:1,policy:{enabled:true,mode:job.mode,fanScope:'all',fanIds:[],delaySeconds:20,maxRepliesPerFanDay:5,contextSharingConfirmed:true,automaticSendingConfirmed:true},...options.pool};
 const canonical=(payload,hash,generationId=id,engine=AUTOPILOT_ENGINE_VERSION)=>({...identity,generationId,engineVersion:engine,fanId:'99',revision:pool.revision,contextHash:hash,expiresAt:new Date(Date.now()+600000).toISOString(),drafts:payload.drafts,unknowns:payload.unknowns,aiGenerated:true,aiVerified:false,usage});
 const fetcher=async(url,request={})=>{
  const method=request.method||'GET',body=typeof request.body==='string'?JSON.parse(request.body):null;calls.push({url,method,body,headers:request.headers});
  if(url==='https://database.test/rest/v1/rpc/bruff_provider_read_gate')return response(body.op==='block'?{allowed:false,retryAfter:body.wait_seconds}:{allowed:true});
  if(url==='https://database.test/rest/v1/rpc/bruff_provider_read_slot'){assert.equal(body.priority,'background');return response(body.op==='acquire'?{allowed:true,lease:body.lease_id}:{allowed:true})}
  if(url==='https://database.test/rest/v1/rpc/bruff_autopilot_worker'){
   assert.equal(request.headers.Authorization,'Bearer fixture-service');if(body.op!=='claim')assert.equal(body.job_id,id);assert.equal(body.lease_id,body.op==='claim'?null:lease);
   if(body.op==='claim'){if(state!=='new'||body.job_id&&body.job_id!==id)return response([]);state='claimed';return response(options.noJobs?[]:[options.claimWrongId?{...job,id:options.claimWrongId}:job])}
   if(body.op==='check')return response(options.revoked!==true&&!(options.revokeBeforePost&&state==='sending'));
   if(body.op==='pool'){pools++;return response(options.changeSources&&pools>1?{...pool,revision:'b'.repeat(32)}:pool)}
   if(body.op==='generation_claim'){claimArgs=body.value;assert.equal(claimArgs.request_id,id);return response({...identity,allowed:true,reason:'allowed',...options.claim})}
   if(body.op==='usage'){
    usage=body.value.input_tokens===null?reservedUsage():providerUsage({result:{usage:{prompt_tokens:body.value.input_tokens,completion_tokens:body.value.output_tokens}}});
    // PostgreSQL JSONB key ordering differs from the local helper's property order.
    return response({...identity,generationId:id,engineVersion:AUTOPILOT_ENGINE_VERSION,usage:{chargedNeurons:usage.chargedNeurons,completionTokens:usage.completionTokens,status:usage.status,promptTokens:usage.promptTokens,calculatedNeurons:usage.calculatedNeurons}});
   }
   if(body.op==='result'){state=job.mode==='drafts'?'draft_ready':'ready';saved=canonical(body.value.payload,claimArgs.context_hash);return response(options.alterCanonical?options.alterCanonical(saved):saved)}
   if(body.op==='begin'){
    state='sending';const chosen=(job.kind==='manual'?job.canonical:saved).drafts.find(d=>d.id===body.value.draftId);
    assert.equal(body.value.generationId,job.kind==='manual'?job.generationId:id);assert.equal(body.value.context_hash,job.kind==='manual'?job.contextHash:claimArgs.context_hash);
    return response({allowed:true,payload:{text:chosen.english,media:[],price:0,lockedText:false},idempotencyKey:'bruff-ai-auto-'+id,binding:job.binding,fan:'99',origin:'BRUFF IA',...options.begin});
   }
   if(body.op==='finish'){state=body.value.status;finished=true;return response({id,status:state,providerId:body.value.providerId??null,scope:job.scope})}
   if(body.op==='release'){if(options.releaseFailure)return response({},503);state=body.value.reason==='send_disabled'?'draft_ready':body.value.reason;return response(true)}
   throw Error('Unexpected RPC op');
  }
  if(url.startsWith('https://api.cloudflare.com/')){
   assert.equal(method,'POST');assert.equal(request.headers.Authorization,'Bearer fixture-cloudflare');
   if(options.cfTimeout)throw Object.assign(Error('fixture'),{name:'TimeoutError'});
   if(options.cfNetworkError)throw new TypeError('fixture network failure');
   if(options.cfStatus)return response({},options.cfStatus,{'Retry-After':'17'});
   const value=answer();if(options.rawOutput)value.result.response=JSON.stringify(options.rawOutput);return response(value);
  }
  if(url==='https://api.ofmapi.com/v1/accounts/acct_fixture/conversations/99?pages=1'){
   reads++;assert.equal(method,'GET');assert.equal(request.headers.Authorization,'Bearer fixture-provider');
   if(options.historyNetworkError)throw new TypeError('fixture network failure');
   if(options.historyStatus)return response({},options.historyStatus,{'Retry-After':'9'});
   if(options.history)return response(options.history(reads));
   return response(currentHistory());
  }
  if(url==='https://api.ofmapi.com/v1/accounts/acct_fixture/conversations/99/messages'){
   assert.equal(method,'POST');assert.equal(state,'sending');assert.equal(request.headers['Idempotency-Key'],'bruff-ai-auto-'+id);
   if(options.sendTimeout)throw Object.assign(Error('fixture'),{name:'TimeoutError'});
   return response(options.sendResponse??{id:90});
  }
  throw Error('Unexpected network path');
 };
 const config={url:'https://database.test',serviceKey:'fixture-service',providerKey:'fixture-provider',cloudflareAccountId:'a'.repeat(32),cloudflareToken:' fixture-cloudflare\n',freeTierConfirmed:true,enabled:true,sendEnabled:true,fetcher,...options.config};
 const handler=createAiRunnerHandler(config);
 return {calls,job,pool,canonical,get state(){return state},get finished(){return finished},async enableSendTick(){return createAiRunnerHandler({...config,sendEnabled:true})(new Request('https://runner.test',{method:'POST',headers:{Authorization:'Bearer fixture-service','Content-Type':'application/json'},body:'{}'}))},async run(body={},headers={}){return handler(new Request('https://runner.test',{method:'POST',headers:{Authorization:'Bearer fixture-service','Content-Type':'application/json',...headers},body:JSON.stringify(body)}))}};
}
const ops=f=>f.calls.filter(x=>x.url.endsWith('/bruff_autopilot_worker'));
const cf=f=>f.calls.filter(x=>x.url.startsWith('https://api.cloudflare.com/'));
const sends=f=>f.calls.filter(x=>x.url.endsWith('/messages')&&x.method==='POST');

test('disabled runner, wrong service credentials, browser origins and invalid request fields never reach providers',async()=>{
 const off=fixture({config:{enabled:false}});assert.equal((await off.run()).status,200);assert.equal(off.calls.length,0);
 const auth=fixture();assert.equal((await auth.run({}, {Authorization:'Bearer wrong'})).status,401);assert.equal((await auth.run({}, {Origin:'https://app.test'})).status,403);assert.equal(auth.calls.length,0);
 const invalid=fixture();assert.equal((await invalid.run({actor:a,fan:'99'})).status,400);assert.equal(invalid.calls.length,0);
 const missing=fixture({config:{providerKey:''}});assert.equal((await missing.run()).status,503);assert.equal(missing.calls.length,0);
});
test('one automatic job uses only DB-derived scope, shared read gates and fixed text-only send with truthful AI origin',async()=>{
 const f=fixture(),r=await f.run(),data=await r.json();assert.equal(data.status,'sent');assert.equal(data.providerId,'90');assert.equal(cf(f).length,1);assert.equal(sends(f).length,1);
 assert.deepEqual(sends(f)[0].body,{text:output().drafts[0].english,media:[],price:0,lockedText:false,typingWpm:0});assert.equal(ops(f).filter(x=>x.body.op==='usage').length,1);
 assert.ok(cf(f)[0].body.messages[0].content.includes('explicitly delegated automated assistant'));assert.ok(!cf(f)[0].body.messages[0].content.includes('for a human operator'));assert.ok(!JSON.stringify(cf(f)[0].body).includes('acct_fixture'));assert.ok(!JSON.stringify(cf(f)[0].body).includes(a));
 assert.deepEqual(Object.keys(data).sort(),['enabled','processed','providerId','status','jobId'].sort());
});
test('off policy, missing consent or approved evidence, actor revocation and generation caps produce no inference or send',async()=>{
 for(const options of [{pool:{policy:{enabled:false}}},{pool:{policy:{enabled:true,mode:'automatic',fanScope:'all',fanIds:[],delaySeconds:20,maxRepliesPerFanDay:5,contextSharingConfirmed:true,automaticSendingConfirmed:false}}},{pool:{examples:[],approvedCount:0}},{revoked:true},{claim:{allowed:false,reason:'global_daily_limit',retryAfter:120}}]){const f=fixture(options);await f.run();assert.equal(cf(f).length,0);assert.equal(sends(f).length,0)}
});
test('the worker accepts the full SQL-selected fan limit without broadening the configured audience',async()=>{
 const f=fixture();f.pool.policy={...f.pool.policy,fanScope:'selected',fanIds:Array.from({length:500},(_,i)=>String(i+1))};assert.equal((await (await f.run()).json()).status,'sent');
 const excluded=fixture();excluded.pool.policy={...excluded.pool.policy,fanScope:'selected',fanIds:['100']};await excluded.run();assert.equal(cf(excluded).length,0);assert.equal(sends(excluded).length,0);
});
test('an outgoing human head, a later incoming anchor or changed sources stop before provider send',async()=>{
 for(const options of [{history:()=>({messages:[{...currentHistory().messages[0],isFromMe:true}]})},{history:n=>({messages:[{...currentHistory().messages[0],id:n>1?'13':'12'}]})},{changeSources:true}]){const f=fixture(options);await f.run();assert.equal(sends(f).length,0);assert.ok(['human_takeover','context_changed','needs_review'].includes(f.state))}
});
test('a provider head change after the canonical result is stored still prevents begin and send',async()=>{
 const f=fixture({history:read=>({messages:[{...currentHistory().messages[0],...(read>=3?{text:'A different question arrived.'}:{})}]})}),data=await (await f.run()).json();
 assert.equal(data.reason,'context_changed');assert.equal(cf(f).length,1);assert.equal(sends(f).length,0);assert.ok(ops(f).some(x=>x.body.op==='result'));assert.ok(!ops(f).some(x=>x.body.op==='begin'));
 const result=f.calls.findIndex(x=>x.body?.op==='result'),lastHead=f.calls.findLastIndex(x=>x.method==='GET'&&x.url.includes('/conversations/'));assert.ok(lastHead>result);
});
test('zero drafts, unknowns or invalid generated text cannot become automatic replies but usage stays charged',async()=>{
 for(const rawOutput of [{drafts:[],unknowns:[]},{...output(),unknowns:['Falta contexto confirmado.']},{...output(),drafts:[{...output().drafts[0],english:'I promise to send it.'}]}]){const f=fixture({rawOutput});await f.run();assert.equal(sends(f).length,0);assert.equal(ops(f).filter(x=>x.body.op==='usage').length,1);assert.equal(f.state,'needs_review')}
});
test('a changed canonical result or mutable begin payload cannot replace the validated reply',async()=>{
 for(const options of [{alterCanonical:data=>({...data,drafts:[{...data.drafts[0],english:'A different reply.'}]})},{begin:{fan:'100'}},{begin:{payload:{text:'A different reply.',media:[],price:0,lockedText:false}}}]){const f=fixture(options);await f.run();assert.equal(sends(f).length,0)}
});
test('revocation at the final write fence prevents the OFMAPI POST and leaves uncertainty durable',async()=>{
 const f=fixture({revokeBeforePost:true}),data=await (await f.run()).json();assert.equal(sends(f).length,0);assert.equal(data.status,'uncertain');assert.equal(f.finished,true);
});
test('timeouts or ambiguous send responses mark uncertainty, pause the job and never resend on the next tick',async()=>{
 for(const options of [{sendTimeout:true},{sendResponse:{}},{sendResponse:{id:90,queueId:4}},{cfTimeout:true},{cfNetworkError:true}]){
  const f=fixture(options),first=await (await f.run()).json();assert.equal(first.status,'uncertain');const count=sends(f).length;assert.equal((await (await f.run()).json()).status,'idle');assert.equal(sends(f).length,count);assert.equal(f.state,'uncertain');
 }
});
test('provider cooldowns are preserved without hot retries or a new inference',async()=>{
 const f=fixture({historyStatus:429});await f.run();assert.equal(cf(f).length,0);assert.equal(sends(f).length,0);const release=ops(f).find(x=>x.body.op==='release');assert.equal(release.body.value.retryAfter,9);
});
test('a failed history network read before any inference or send is not mislabeled as an uncertain write',async()=>{
 const f=fixture({historyNetworkError:true}),data=await (await f.run()).json();assert.equal(data.status,'stopped');assert.equal(cf(f).length,0);assert.equal(sends(f).length,0);assert.ok(!ops(f).some(x=>x.body.op==='finish'));assert.notEqual(f.state,'uncertain');
});
test('draft-only policy preserves the durable draft-ready result and never advances to send',async()=>{
 const f=fixture({job:{mode:'drafts'}}),data=await (await f.run()).json();assert.equal(data.status,'needs_review');assert.equal(f.state,'draft_ready');assert.equal(sends(f).length,0);assert.ok(!ops(f).some(x=>['begin','release'].includes(x.body.op)));
});
test('processing enabled with the separate send flag off can create drafts but never enters the write fence',async()=>{
 for(const sendEnabled of [false,undefined]){const f=fixture({config:{sendEnabled}}),data=await (await f.run()).json();assert.equal(data.status,'needs_review');assert.equal(data.reason,'send_disabled');assert.equal(f.state,'draft_ready');assert.equal(cf(f).length,1);assert.equal(sends(f).length,0);assert.ok(!ops(f).some(x=>x.body.op==='begin'));assert.equal(ops(f).find(x=>x.body.op==='release').body.value.reason,'send_disabled');assert.equal((await (await f.enableSendTick()).json()).status,'idle');assert.equal(cf(f).length,1);assert.equal(sends(f).length,0);}
});
test('an unconfirmed send-disabled parking operation becomes uncertain instead of leaving an automatically reusable send',async()=>{
 const f=fixture({config:{sendEnabled:false},releaseFailure:true}),data=await (await f.run()).json();assert.equal(data.status,'uncertain');assert.equal(f.state,'uncertain');assert.equal(sends(f).length,0);assert.equal((await (await f.run()).json()).status,'idle');
});
test('service-only targeted dispatch supplies only the stored job ID and cannot inject a scope or operation',async()=>{
 const f=fixture();assert.equal((await (await f.run({job_id:id})).json()).status,'sent');assert.equal(ops(f)[0].body.job_id,id);
 const absent=fixture();assert.equal((await (await absent.run({job_id:example})).json()).status,'idle');assert.equal(cf(absent).length,0);assert.equal(sends(absent).length,0);
 for(const body of [{operation:'tick'},{job_id:'bad'},{job_id:id,actor:a}]){const bad=fixture();assert.equal((await bad.run(body)).status,400);assert.equal(bad.calls.length,0)}
});
test('a targeted claim returning another job is rejected before pool or provider access and does not expose its identity',async()=>{
 const f=fixture({claimWrongId:example}),r=await f.run({job_id:id}),data=await r.json();assert.equal(r.status,503);assert.equal(data.jobId,undefined);assert.equal(ops(f).length,1);assert.equal(ops(f)[0].body.op,'claim');assert.equal(cf(f).length,0);assert.equal(sends(f).length,0);assert.ok(!f.calls.some(x=>x.url.startsWith('https://api.ofmapi.com/')));
});
test('manual stored intent sends only its chosen v2 draft without CF, generation claims or a new quota charge',async()=>{
 const f=fixture({job:{kind:'manual',anchorMessageId:null,mode:undefined},pool:{policy:{enabled:false}},config:{cloudflareToken:'',freeTierConfirmed:false}});
 const history={messages:[...currentHistory().messages,{id:'13',text:'A previous own reply',isFromMe:true,createdAt:'2026-11-06T12:01:00Z'}]};
 const hash=await historyHash(historySnapshot({data:history})),payload={drafts:[{...output().drafts[0],exampleIds:[example]},{...output().drafts[0],id:'2',english:'Hi! What are your plans today?',spanish:'¡Hola! ¿Qué planes tienes hoy?',exampleIds:[example]}],unknowns:[]};
 Object.assign(f.job,{generationId:manualGeneration,draftId:'2',contextHash:hash,sourceRevision:f.pool.revision,canonical:f.canonical(payload,hash,manualGeneration,'bruff-drafts-v2')});
 // Replace only the fixed history response for this independent manual intent.
 const manual=fixture({job:f.job,pool:{policy:{enabled:false}},history:()=>history,config:{cloudflareToken:'',freeTierConfirmed:false}});
 const data=await (await manual.run()).json();assert.equal(data.status,'sent');assert.equal(cf(manual).length,0);assert.ok(!ops(manual).some(x=>['generation_claim','usage','result'].includes(x.body.op)));assert.equal(sends(manual)[0].body.text,payload.drafts[1].english);
});
test('stale or expired manual intents stop with no fallback generation and no send',async()=>{
 for(const patch of [{contextHash:'b'.repeat(64)},{sourceRevision:'b'.repeat(32)},{expired:true}]){
  const f=fixture({job:{kind:'manual',anchorMessageId:null,mode:undefined}}),hash=await historyHash(historySnapshot({data:currentHistory()}));
  Object.assign(f.job,{generationId:manualGeneration,draftId:'1',contextHash:hash,sourceRevision:f.pool.revision,canonical:f.canonical({drafts:[{...output().drafts[0],exampleIds:[example]}],unknowns:[]},hash,manualGeneration,'bruff-drafts-v2')},patch);if(patch.expired)f.job.canonical.expiresAt=new Date(Date.now()-1).toISOString();
  await f.run();assert.equal(cf(f).length,0);assert.equal(sends(f).length,0);assert.ok(!ops(f).some(x=>x.body.op==='generation_claim'));
 }
});
