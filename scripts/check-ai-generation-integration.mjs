// Local contract verification only: the actual Edge handler and migrations run
// against fictional in-memory data. Neither Auth, OFMAPI nor Cloudflare is used.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {createDraftsHandler} from '../supabase/functions/bruff-drafts/handler.js';
import {ENGINE_VERSION} from '../supabase/functions/bruff-drafts/usage.js';

if(!process.argv[2])throw Error('Pass an installed PGlite module path; no network or real accounts are used.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();
const w='00000000-0000-0000-0000-000000000001',otherW='00000000-0000-0000-0000-000000000002';
const owner='10000000-0000-0000-0000-000000000001',worker='10000000-0000-0000-0000-000000000002',outsider='10000000-0000-0000-0000-000000000003';
const c='20000000-0000-0000-0000-000000000001',c2='20000000-0000-0000-0000-000000000002',foreignC='20000000-0000-0000-0000-000000000003';
const sessions=new Map([['Bearer fictional-owner-session',owner],['Bearer fictional-worker-session',worker]]);
const base='https://fictional-auth.example.test';
const publicKey='fictional-public-anon',serviceKey='fictional-service-key';
let checks=0,inferences=0,historyReads=0,exampleId,knowledgeId,lastClaim,probePending=false,pendingProbes=0,revokeOnInference=false;
let historyText='Hello! How is your day?';
const calls=[];
const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++};
const ok=(value,message)=>{assert.ok(value,message);checks++};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
const query=async(sql,params=[])=>(await db.query(sql,params)).rows[0]?.value;
const as=async(role,actor,action)=>{
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);
 await db.exec('set role '+role);
 try{return await action()}finally{await db.exec('reset role')}
};
const rpcSql={
 bruff_generation_pool:['w','c'],
 bruff_generation_claim_v2:['w','c','request_id','fan','revision','context_hash','engine_version','force'],
 bruff_generation_usage:['w','c','request_id','actor','input_tokens','output_tokens'],
 bruff_generation_commit:['w','c','request_id','actor','payload'],
 bruff_generation_quota:['w','c'],
 bruff_generation_result:['w','c','request_id','fan'],
};
const rpc=async(name,body,{actor=owner,service=false}={})=>{
 const keys=rpcSql[name];if(!keys)throw Error('Unexpected RPC in local transport');
 eq(Object.keys(body).sort(),keys.slice().sort());
 const params=keys.map(key=>body[key]);
 return as(service?'service_role':'authenticated',service?null:actor,()=>query('select public.'+name+'('+params.map((_,i)=>'$'+(i+1)).join(',')+') as value',params));
};
const example=()=>({trigger:'Hello! How is your day?',english:'hey! how is your day going?',spanish:'¡Hola! ¿Cómo va tu día?',state:'verified',referenceId:'fictional.neutral.greeting',label:'Fictional human-reviewed greeting',sourceVersion:'v1',reviewed:true});
const fakeOutput=()=>({drafts:[
 {id:'1',english:'hey! how is your day going?',spanish:'¡Hola! ¿Cómo va tu día?',exampleIds:['E1'],knowledgeIds:['K1']},
 {id:'2',english:'hello! what have you been up to today?',spanish:'¡Hola! ¿Qué has hecho hoy?',exampleIds:['E1'],knowledgeIds:['K1']},
 {id:'3',english:'hey there! anything nice planned for today?',spanish:'¡Hola! ¿Tienes algún buen plan para hoy?',exampleIds:['E1'],knowledgeIds:['K1']},
],unknowns:[]});
const fetcher=async(url,input={})=>{
 const body=input.body?JSON.parse(input.body):null;
 const authorization=input.headers?.Authorization;
 calls.push({url,body,authorization});
 if(url===base+'/auth/v1/user'){
  eq(input.method,'GET');eq(input.headers.apikey,publicKey);
  const actor=sessions.get(authorization);if(!actor)return json({},401);
  const user=await query('select jsonb_build_object(\'id\',id,\'email_confirmed_at\',email_confirmed_at,\'is_anonymous\',false) as value from auth.users where id=$1',[actor]);
  return json(user||{},user?200:401);
 }
 if(url===base+'/functions/v1/bruff-live'){
  historyReads++;ok(sessions.has(authorization));eq(input.headers.apikey,publicKey);
  eq(Object.keys(body).sort(),['background','conversation_id','creator_id','operation','workspace_id']);
  eq(body.operation,'messages');eq(body.background,true);
  if(body.workspace_id!==w||body.creator_id!==c)return json({},403);
  return json({data:{messages:[{id:'10',text:historyText,isFromMe:false,createdAt:'2026-11-06T12:00:00.000Z'}]}});
 }
 if(url.startsWith(base+'/rest/v1/rpc/')){
  const name=url.slice((base+'/rest/v1/rpc/').length),service=authorization==='Bearer '+serviceKey;
  if(service){ok(['bruff_generation_usage','bruff_generation_commit'].includes(name));eq(input.headers.apikey,serviceKey)}
  else{ok(sessions.has(authorization));eq(input.headers.apikey,publicKey)}
  try{
   const result=await rpc(name,body,{actor:sessions.get(authorization),service});
   if(name==='bruff_generation_claim_v2')lastClaim=body;
   if(name==='bruff_generation_usage'&&probePending){
    probePending=false;
    // This is the real race window: accounting is settled, while rechecking
    // history and committing the result have not happened yet.
    for(const force of [false,true]){
     const pending=await rpc('bruff_generation_claim_v2',{...lastClaim,request_id:randomUUID(),force},{actor:body.actor});
     eq(pending.reason,'pending');eq(pending.allowed,false);pendingProbes++;
    }
   }
   return json(result);
  }catch(error){return json({code:error.code||'internal'},error.code==='42501'?403:400)}
 }
 if(url==='https://api.cloudflare.com/client/v4/accounts/'+'b'.repeat(32)+'/ai/run/@cf/mistralai/mistral-small-3.1-24b-instruct'){
  inferences++;eq(authorization,'Bearer fictional-provider-token');eq(input.method,'POST');eq(body.max_tokens,900);
  const sent=JSON.stringify(body);for(const privateValue of [owner,worker,w,c,exampleId,knowledgeId,'fictional-owner-session','fictional-worker-session'])ok(!sent.includes(privateValue));
  if(revokeOnInference){revokeOnInference=false;await db.query("update bruff_private.memberships set status='disabled' where workspace_id=$1 and user_id=$2",[w,worker])}
  return json({success:true,result:{response:JSON.stringify(fakeOutput()),usage:{prompt_tokens:1000,completion_tokens:600,total_tokens:1600}}});
 }
 throw Error('Unrecognized local transport route; no network fallback exists.');
};
const handler=createDraftsHandler({url:base,anonKey:publicKey,serviceKey,cloudflareAccountId:'b'.repeat(32),cloudflareToken:'fictional-provider-token',freeTierConfirmed:true,fetcher});
const run=async({actor=owner,requestId=randomUUID(),operation='generate',force,workspace=w,creator=c,fan='123'}={})=>{
 const body={operation,workspace_id:workspace,creator_id:creator,conversation_id:fan,request_id:requestId,...(force===undefined?{}:{force})};
 const result=await handler(new Request('https://fictional-edge.example.test/functions/v1/bruff-drafts',{method:'POST',headers:{Authorization:actor===owner?'Bearer fictional-owner-session':'Bearer fictional-worker-session','Content-Type':'application/json'},body:JSON.stringify(body)}));
 return {status:result.status,data:await result.json(),headers:result.headers,requestId};
};
const count=()=>query('select count(*)::integer as value from bruff_private.generation_reservations');
const age=async actor=>db.query("with clock as(select clock_timestamp()-interval '61 seconds' as t) update bruff_private.generation_reservations set created_at=clock.t,usage_day=(clock.t at time zone 'UTC')::date,expires_at=clock.t+interval '10 minutes' from clock where actor_id=$1",[actor]);

try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;");
 for(const name of ['202610300001_private_foundation','202610310003_team','202610310004_role_scopes','202610310005_team_names','202610310008_chat_safety','202610310009_bot_scope','202611010011_message_authorship','202611060040_chat_direct_knowledge','202611060041_ai_control','202611060042_ai_generation_knowledge','202611060043_ai_generation_budget','202611060044_ai_autopilot','202611080047_fan_memory_engines'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 for(const [actor,label]of [[owner,'owner'],[worker,'worker'],[outsider,'outsider']])await db.query('insert into auth.users values($1,$2,now())',[actor,label+'@example.test']);
 await db.query('insert into bruff_private.workspaces(id,name)values($1,$2),($3,$4)',[w,'Fictional integration A',otherW,'Fictional integration B']);
 for(const [workspace,actor,role]of [[w,owner,'owner'],[w,worker,'operator'],[otherW,outsider,'owner']])await db.query("insert into bruff_private.memberships(workspace_id,user_id,role,status)values($1,$2,$3,'active')",[workspace,actor,role]);
 for(const [creator,workspace,label]of [[c,w,'Fictional A'],[c2,w,'Fictional B'],[foreignC,otherW,'Fictional foreign model']])await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[workspace,creator,label]);
 for(const permission of ['read','send'])await db.query('insert into bruff_private.account_grants(workspace_id,user_id,creator_id,permission)values($1,$2,$3,$4)',[w,worker,c,permission]);
 await as('authenticated',owner,async()=>{
  await query("select public.bruff_generation_control($1,$2,'save',0,$3) as value",[w,c,{enabled:true,dailyLimit:100,maxResults:3}]);
  exampleId=(await query("select public.bruff_chat_direct_knowledge($1,$2,'save',null,0,$3) as value",[w,c,example()])).savedId;
  knowledgeId=(await query("select public.bruff_model_knowledge($1,$2,'save',null,0,$3) as value",[w,c,{kind:'style_rule',key:null,text:'Use brief neutral greetings and ask one friendly question.',referenceId:'fictional.style',label:'Fictional reviewed style',sourceVersion:'v1',state:'verified'}])).savedId;
 });

 probePending=true;
 const first=await run();eq(first.status,200);eq(first.data.drafts.length,3);eq(first.data.engineInvoked,true);eq(first.data.reused,false);eq(first.data.generationId,first.requestId);eq(first.data.requestId,first.requestId);eq(first.data.engineVersion,ENGINE_VERSION);eq(first.data.usage,{status:'observed',promptTokens:1000,completionTokens:600,calculatedNeurons:63,chargedNeurons:63});eq(first.data.quota.modelQueries,1);eq(first.data.quota.calculatedNeurons,63);eq(first.data.quota.reservedNeurons,0);eq(first.data.quota.remainingNeurons,7437);eq(pendingProbes,2);eq(inferences,1);eq(await count(),1);
 for(const draft of first.data.drafts){eq(draft.exampleIds,[exampleId]);eq(draft.knowledgeIds,[knowledgeId])}
 const stored=await as('authenticated',owner,()=>rpc('bruff_generation_result',{w,c,request_id:first.requestId,fan:'123'}));
 eq(stored.drafts,first.data.drafts);eq(stored.usage,first.data.usage);

 const reused=await run();eq(reused.status,200);eq(reused.data.generationId,first.requestId);eq(reused.data.requestId,reused.requestId);ok(reused.requestId!==first.requestId);eq(reused.data.engineInvoked,false);eq(reused.data.reused,true);eq(reused.data.expiresAt,first.data.expiresAt);eq(reused.data.drafts,first.data.drafts);eq(reused.data.quota,first.data.quota);eq(inferences,1);eq(await count(),1);
 const verified=await run({operation:'verify',requestId:first.requestId});eq(verified.status,200);eq(verified.data.engineInvoked,false);eq(verified.data.reused,false);eq(inferences,1);

 const forced=await run({force:true});eq(forced.status,200);eq(forced.data.engineInvoked,true);eq(forced.data.reused,false);ok(forced.data.generationId!==first.requestId);eq(inferences,2);eq(await count(),2);eq(forced.data.quota.chargedNeurons,126);
 const limited=await run({force:true});eq(limited.status,429);eq(limited.data.code,'AI_LOCAL_LIMIT');ok(Number(limited.headers.get('Retry-After'))>0);eq(inferences,2);eq(await count(),2);
 await age(owner);
 const afterWindow=await run({force:true});eq(afterWindow.status,200);eq(afterWindow.data.engineInvoked,true);eq(inferences,3);eq(await count(),3);

 historyText='Hello! What is a nice plan for a quiet day?';
 const changed=await run();eq(changed.status,200);eq(changed.data.engineInvoked,true);eq(changed.data.reused,false);ok(changed.data.contextHash!==first.data.contextHash);eq(inferences,4);
 const stale=await run({operation:'verify',requestId:first.requestId});eq(stale.status,409);eq(stale.data.code,'AI_CONTEXT_CHANGED');eq(stale.data.drafts,undefined);eq(inferences,4);
 const priorReads=historyReads;
 const wrongModel=await run({creator:c2});eq(wrongModel.status,409);eq(wrongModel.data.code,'AI_DISABLED');eq(historyReads,priorReads);eq(inferences,4);
 const foreign=await run({workspace:otherW,creator:foreignC});eq(foreign.status,403);eq(foreign.data.drafts,undefined);eq(historyReads,priorReads);eq(inferences,4);

 const workerResult=await run({actor:worker});eq(workerResult.status,200);eq(workerResult.data.actorId,worker);eq(workerResult.data.engineInvoked,true);eq(workerResult.data.reused,false);ok(workerResult.data.generationId!==changed.data.generationId);eq(inferences,5);
 revokeOnInference=true;
 const revoked=await run({actor:worker,force:true});eq(revoked.status,403);eq(revoked.data.drafts,undefined);eq(inferences,6);
 const lateUsage=await query('select jsonb_build_object(\'payloadAbsent\',payload is null,\'actual\',actual_neurons,\'finished\',finished_at is not null) as value from bruff_private.generation_reservations where request_id=$1',[revoked.requestId]);
 eq(lateUsage,{payloadAbsent:true,actual:63,finished:true});
 const deniedVerify=await run({actor:worker,operation:'verify',requestId:workerResult.requestId});eq(deniedVerify.status,403);eq(deniedVerify.data.drafts,undefined);eq(inferences,6);

 eq(await query('select count(*)::integer as value from bruff_private.fans'),0);
 eq(await query('select count(*)::integer as value from bruff_private.bruff_settings'),0);
 ok(calls.every(call=>!/(?:send|campaign|upload|withdraw)/u.test(call.url)));
 eq(calls.filter(call=>call.authorization==='Bearer '+serviceKey).every(call=>/\/bruff_generation_(?:usage|commit)$/u.test(call.url)),true);
 console.log(JSON.stringify({checks,fakeInferences:inferences,pendingRaceChecks:pendingProbes,realNetworkCalls:0,realFanSends:0,database:'in-memory fictional PGlite',result:'passed'}));
}catch(error){console.error('Local handler/SQL generation verification failed:',{code:error.code,message:error.message,where:error.where,stack:error.stack});process.exitCode=1}finally{await db.close()}
