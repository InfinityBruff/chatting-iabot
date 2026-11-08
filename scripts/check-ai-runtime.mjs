// Offline contract test: actual SQL044 + actual Edge runner, fictional data,
// and a closed fake HTTP transport. There is no real network fallback.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createAiRunnerHandler,AUTOPILOT_ENGINE_VERSION} from '../supabase/functions/bruff-ai-runner/handler.js';
import {ENGINE_VERSION} from '../supabase/functions/bruff-drafts/usage.js';
import {historyHash,historySnapshot,GENERATION_MODEL,buildGenerationContext,generationContextHash,validatedFanMemory} from '../supabase/functions/bruff-drafts/generation.js';

if(!process.argv[2])throw Error('Pass an installed PGlite module path. This test never installs or contacts a provider.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();
const w='00000000-0000-0000-0000-000000000001',owner='10000000-0000-0000-0000-000000000001',c='20000000-0000-0000-0000-000000000001';
const base='https://fictional-runtime.example.test',binding='acct_fictional_runtime',serviceKey='fictional-service',providerKey='fictional-provider';
const eq=(a,b)=>{assert.deepEqual(a,b);checks++},ok=(value,message)=>{assert.ok(value,message);checks++};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
const as=async(role,actor,action)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);await db.exec('set role '+role);try{return await action()}finally{await db.exec('reset role')}};
const auth=action=>as('authenticated',owner,action),service=action=>as('service_role',null,action);
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const output=()=>({drafts:[{id:'1',english:'Hello! How is your day going?',spanish:'¡Hola! ¿Cómo va tu día?',exampleIds:['E1'],knowledgeIds:[]},{id:'2',english:'Hi! What have you been up to today?',spanish:'¡Hola! ¿Qué has hecho hoy?',exampleIds:['E1'],knowledgeIds:[]}],unknowns:[]});
let checks=0,exampleId,inferences=0,posts=0,historyReads=0,globalNetworkAttempts=0,onCommit,onBegin,postFailure=false;
const histories=new Map(),calls=[],originalFetch=globalThis.fetch;
globalThis.fetch=()=>{globalNetworkAttempts++;throw Error('Real network is forbidden in this offline test.');};
function setHistory(fan,message='10',text='How is your day?',ownTail=false){
 histories.set(fan,{messages:[{id:message,text,isFromMe:false,createdAt:'2026-11-06T12:00:00.000Z'},...(ownTail?[{id:String(BigInt(message)+1n),text:'An earlier neutral own reply.',isFromMe:true,createdAt:'2026-11-06T12:01:00.000Z'}]:[])]});
}
const config=()=>({enabled:true,mode:'automatic',fanScope:'all',fanIds:[],delaySeconds:10,maxRepliesPerFanDay:5,contextSharingConfirmed:true,automaticSendingConfirmed:true});
const control=(op='read',expected=null,value=null)=>auth(()=>q('select public.bruff_autopilot_control($1,$2,$3,$4,$5) as value',[w,c,op,expected,value]));
const activate=async()=>{const current=await control();return control('save',current.version,config())};
const pause=async()=>{const current=await control();return control('pause',current.version)};
const jobState=id=>q('select state as value from bruff_private.ai_autopilot_jobs where id=$1',[id]);
const countReservations=()=>q('select count(*)::integer as value from bruff_private.generation_reservations');
// Keep the real accounting invariant when the fictional age crosses UTC midnight.
const ageReservations=()=>db.exec("update bruff_private.generation_reservations set usage_day=((created_at-interval '61 seconds') at time zone 'UTC')::date,created_at=created_at-interval '61 seconds',expires_at=expires_at-interval '61 seconds'");
const queueEvent=async(fan,message)=>{
 const stamp=await q("select to_char((clock_timestamp()+interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as value"),event={event_id:randomUUID(),account_id:binding,fan_id:fan,message_id:message,direction:'received',occurred_at:stamp,ingested_at:stamp,source:'ws'};
 const result=await service(()=>q('select public.bruff_ai_event_ingest($1) as value',[event]));eq(result.accepted,true);eq(result.queued,true);ok(result.jobId);
 await db.query("update bruff_private.ai_autopilot_jobs set due_at=clock_timestamp()-interval '1 second' where id=$1",[result.jobId]);
 return {event,...result};
};
const fetcher=async(url,input={})=>{
 const body=input.body?JSON.parse(input.body):null,method=input.method||'GET';calls.push({url,method,body});
 if(url.startsWith(base+'/rest/v1/rpc/')){
  eq(input.headers.Authorization,'Bearer '+serviceKey);eq(input.headers.apikey,serviceKey);eq(method,'POST');eq(input.redirect,'error');
  const name=url.slice((base+'/rest/v1/rpc/').length),keys={bruff_autopilot_worker:['op','job_id','lease_id','value'],bruff_provider_read_gate:['op','wait_seconds'],bruff_provider_read_slot:['op','lease_id','priority']}[name];
  ok(keys,'No arbitrary RPC is available.');eq(Object.keys(body).sort(),keys.slice().sort());
  if(name==='bruff_provider_read_slot')eq(body.priority,'background');
  if(name==='bruff_autopilot_worker'&&body.op==='begin'&&onBegin){const action=onBegin;onBegin=null;await action()}
  try{const result=await service(()=>q('select public.'+name+'('+keys.map((_,i)=>'$'+(i+1)).join(',')+') as value',keys.map(key=>body[key])));if(name==='bruff_autopilot_worker'&&body.op==='result'&&onCommit){const action=onCommit;onCommit=null;await action()}return response(result)}catch(error){return response({code:error.code},error.code==='42501'?403:error.code==='40001'?409:400)}
 }
 if(url==='https://api.cloudflare.com/client/v4/accounts/'+'a'.repeat(32)+'/ai/run/'+GENERATION_MODEL){
  inferences++;eq(method,'POST');eq(input.headers.Authorization,'Bearer fictional-cloudflare');eq(input.redirect,'error');eq(body.max_tokens,900);
  const prompt=JSON.stringify(body);for(const hidden of [owner,w,c,binding,exampleId,serviceKey,providerKey])ok(!prompt.includes(hidden),'No private identifier is shared with the fake model.');
  return response({success:true,result:{response:JSON.stringify(output()),usage:{prompt_tokens:1000,completion_tokens:100,total_tokens:1100}}});
 }
 const urlValue=new URL(url),match=new RegExp('^/v1/accounts/'+binding+'/conversations/([1-9][0-9]{0,23})(/messages)?$','u').exec(urlValue.pathname);
 if(urlValue.origin==='https://api.ofmapi.com'&&match){
  const fan=match[1];eq(input.headers.Authorization,'Bearer '+providerKey);eq(input.redirect,'error');ok(histories.has(fan));
  if(!match[2]){eq(method,'GET');eq(urlValue.search,'?pages=1');historyReads++;return response(histories.get(fan))}
  eq(method,'POST');eq(urlValue.search,'');const idempotency=input.headers['Idempotency-Key'];ok(typeof idempotency==='string'&&idempotency.startsWith('bruff-ai-auto-'));
  const job=idempotency.slice('bruff-ai-auto-'.length),saved=await q("select jsonb_build_object('state',state,'fan',fan_id,'payload',payload,'owner',owner_id) as value from bruff_private.ai_autopilot_jobs where id=$1",[job]);eq(saved.state,'sending');eq(saved.fan,fan);eq(saved.owner,owner);eq(body,{...saved.payload,typingWpm:0});posts++;
  if(postFailure)throw new TypeError('Fictional connection lost after the POST began.');
  return response({id:9000+posts});
 }
 throw Error('Unknown offline route. There is no real fetch fallback.');
};
const memoryFor=fan=>({actorId:owner,workspaceId:w,creatorId:c,fanId:fan,binding,version:1,contextRevision:'c'.repeat(64),items:[],coverage:{historyComplete:false,cursor:null,pages:0,recentCheckedAt:null,historyCheckedAt:null,messagesObserved:0,contextLimited:false}});
const runner=extra=>createAiRunnerHandler({url:base,serviceKey,providerKey,cloudflareAccountId:'a'.repeat(32),cloudflareToken:'fictional-cloudflare',freeTierConfirmed:true,enabled:true,sendEnabled:true,fanMemoryEnabled:true,fanMemoryReader:async scope=>{eq(scope.ownerId,owner);eq(scope.binding,binding);return memoryFor(scope.fanId)},fetcher,...extra});
const run=async(jobId,handler=runner())=>{const result=await handler(new Request('https://fictional-runner.example.test',{method:'POST',headers:{Authorization:'Bearer '+serviceKey,'Content-Type':'application/json'},body:JSON.stringify(jobId?{job_id:jobId}:{})}));eq(result.status,200);return result.json()};

try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;");
 for(const name of ['202610300001_private_foundation','202610310003_team','202610310004_role_scopes','202610310005_team_names','202610310008_chat_safety','202610310009_bot_scope','202611010011_message_authorship','202611020033_provider_read_cooldown','202611020034_provider_read_slots','202611030035_provider_read_capacity','202611030036_provider_read_waiters','202611060040_chat_direct_knowledge','202611060041_ai_control','202611060042_ai_generation_knowledge','202611060043_ai_generation_budget','202611060044_ai_autopilot','202611080047_fan_memory_engines'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await db.query('insert into auth.users values($1,$2,now())',[owner,'fictional-owner@example.test']);await db.query('insert into bruff_private.workspaces(id,name)values($1,$2)',[w,'Fictional offline runtime']);
 await db.query("insert into bruff_private.memberships(workspace_id,user_id,role,status,display_name)values($1,$2,'owner','active','Fictional owner')",[w,owner]);
 await db.query("insert into bruff_private.creator_accounts(workspace_id,id,display_name,provider,external_id,connection_status)values($1,$2,'Fictional model','ofmapi',$3,'connected')",[w,c,binding]);
 await auth(()=>q("select public.bruff_generation_control($1,$2,'save',0,$3) as value",[w,c,{enabled:true,dailyLimit:100,maxResults:3}]));
 exampleId=(await auth(()=>q("select public.bruff_chat_direct_knowledge($1,$2,'save',null,0,$3) as value",[w,c,{trigger:'How is your day?',english:'Hello! How is your morning?',spanish:'¡Hola! ¿Cómo va tu mañana?',state:'verified',referenceId:'fictional.neutral.greeting',label:'Fictional approved neutral source',sourceVersion:'v1',reviewed:true}]))).savedId;

 // Automatic: the actual queue, quota, canonical commit, send fence and
 // authorship all agree, rather than a mock independently inventing receipts.
 await activate();setHistory('123');const automatic=await queueEvent('123','10');
 eq((await service(()=>q('select public.bruff_ai_event_ingest($1) as value',[automatic.event]))).queued,false);
 const first=await run(automatic.jobId);eq(first.status,'sent');eq(first.jobId,automatic.jobId);eq(first.providerId,'9001');eq(await jobState(automatic.jobId),'sent');eq(inferences,1);eq(posts,1);eq(await countReservations(),1);
 const accounting=await q('select jsonb_build_object(\'actual\',actual_neurons,\'engine\',engine_version,\'committed\',payload is not null) as value from bruff_private.generation_reservations where request_id=$1',[automatic.jobId]);eq(accounting,{actual:37,engine:AUTOPILOT_ENGINE_VERSION,committed:true});
 // Exercise the exact midnight boundary independent of the wall clock. The
 // production constraints stay enabled and all time changes are rolled back.
 await db.exec('begin');
 try{
  await db.query("update bruff_private.generation_reservations set created_at='2026-01-02T00:00:30Z'::timestamptz,expires_at='2026-01-02T00:10:30Z'::timestamptz,usage_day='2026-01-02'::date where request_id=$1",[automatic.jobId]);
  await ageReservations();
  eq(await q("select jsonb_build_object('day',usage_day::text,'expiryValid',expires_at=created_at+interval '10 minutes','createdAt',to_char(created_at at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS')) as value from bruff_private.generation_reservations where request_id=$1",[automatic.jobId]),{day:'2026-01-01',expiryValid:true,createdAt:'2026-01-01T23:59:29'});
 }finally{await db.exec('rollback')}
 const authors=await auth(()=>q('select public.bruff_message_authors($1,$2,$3,$4) as value',[w,c,'123',['9001']]));ok(authors['9001'].startsWith('BRUFF IA'));
 eq((await run(automatic.jobId)).status,'idle');eq(posts,1);eq(inferences,1);

 // A paused automatic engine does not invalidate a separately confirmed v3
 // choice. The manual worker never calls CF or creates another reservation.
 await pause();await ageReservations();setHistory('456','20','How is your day?',true);
 const pool=await auth(()=>q('select public.bruff_generation_pool($1,$2) as value',[w,c])),hash=await generationContextHash(buildGenerationContext(historySnapshot({data:histories.get('456')}),validatedFanMemory(memoryFor('456'),{actor:owner,w,c,fan:'456',binding}))),generation=randomUUID(),manualId=randomUUID();
 eq((await auth(()=>q('select public.bruff_generation_claim_v2($1,$2,$3,$4,$5,$6,$7,$8) as value',[w,c,generation,'456',pool.revision,hash,ENGINE_VERSION,false]))).allowed,true);
 await service(()=>q('select public.bruff_generation_usage($1,$2,$3,$4,$5,$6) as value',[w,c,generation,owner,1000,100]));const chosenOutput=output();chosenOutput.drafts=chosenOutput.drafts.map(d=>({...d,exampleIds:[exampleId]}));
 await service(()=>q('select public.bruff_generation_commit($1,$2,$3,$4,$5) as value',[w,c,generation,owner,chosenOutput]));
 const queueManual=req=>auth(()=>q('select public.bruff_queue_selected_reply($1,$2,$3,$4,$5,$6,$7,$8) as value',[w,c,'456',req,generation,'2',chosenOutput.drafts[1].english,true]));
 const manual=await queueManual(manualId);eq(manual.newlyQueued,true);eq((await queueManual(manualId)).newlyQueued,false);eq((await queueManual(randomUUID())).jobId,manualId);
 const beforeManual=await countReservations(),beforeManualCf=inferences,beforeManualCalls=calls.length;
 const selected=await run(manual.jobId,runner({cloudflareToken:undefined,freeTierConfirmed:false}));eq(selected.status,'sent');eq(await jobState(manual.jobId),'sent');eq(posts,2);eq(inferences,beforeManualCf);eq(await countReservations(),beforeManual);
 const manualCalls=calls.slice(beforeManualCalls);ok(!manualCalls.some(x=>x.url.startsWith('https://api.cloudflare.com/')));ok(!manualCalls.some(x=>x.body&&['generation_claim','usage','result'].includes(x.body.op)));eq(manualCalls.find(x=>x.url.endsWith('/messages')).body.text,chosenOutput.drafts[1].english);
 eq((await run(manual.jobId)).status,'idle');eq(posts,2);eq(inferences,beforeManualCf);

 // The provider head changes just AFTER SQL commits the result, without a
 // webhook. The final fresh read must still prevent a stale provider POST.
 await activate();await ageReservations();setHistory('789','30');const changed=await queueEvent('789','30'),beforeChangedPosts=posts;
 onCommit=()=>setHistory('789','31','A new neutral question.');const changedResult=await run(changed.jobId);eq(changedResult.status,'stopped');eq(changedResult.reason,'context_changed');eq(await jobState(changed.jobId),'blocked');eq(posts,beforeChangedPosts);eq(await q('select actual_neurons as value from bruff_private.generation_reservations where request_id=$1',[changed.jobId]),37);

 // Revoke the delegation immediately before SQL begin, after the worker's
 // preceding check. SQL itself must refuse the write without a provider POST.
 await ageReservations();setHistory('790','40');const paused=await queueEvent('790','40'),beforePausedPosts=posts;onBegin=pause;
 const pausedResult=await run(paused.jobId);eq(pausedResult.status,'stopped');eq(posts,beforePausedPosts);eq(await jobState(paused.jobId),'blocked');eq((await control()).settings.enabled,false);

 // A timeout after POST is ambiguous, so its durable job remains uncertain;
 // another tick cannot recreate the inference or resend the same reply.
 await activate();await ageReservations();setHistory('791','50');const uncertain=await queueEvent('791','50');postFailure=true;
 const uncertainResult=await run(uncertain.jobId);eq(uncertainResult.status,'uncertain');eq(await jobState(uncertain.jobId),'uncertain');const afterUncertainPosts=posts,afterUncertainCf=inferences;
 eq((await run(uncertain.jobId)).status,'idle');eq(posts,afterUncertainPosts);eq(inferences,afterUncertainCf);eq((await control()).effectiveEnabled,false);
 eq(await service(()=>q('select auth.uid() as value')),null);eq(await q('select count(*)::integer as value from bruff_private.provider_read_leases'),0);eq(await q('select count(*)::integer as value from bruff_private.provider_read_waiters'),0);eq(globalNetworkAttempts,0);
 console.log(JSON.stringify({checks,scenarios:5,fakeInferences:inferences,fakeProviderPostAttempts:posts,fakeHistoryReads:historyReads,realNetworkCalls:0,realFanSends:0,database:'fictional in-memory PGlite',result:'passed'}));
}catch(error){console.error('Offline AI runtime integration failed:',{code:error.code,message:error.message,where:error.where,stack:error.stack});process.exitCode=1}finally{globalThis.fetch=originalFetch;await db.close()}
