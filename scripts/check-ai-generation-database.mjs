import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
if(!process.argv[2])throw Error('Pass the installed PGlite module path; this script uses fictional in-memory data only.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0,currentActor=null;
const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++};
const reject=async(action,code)=>{await assert.rejects(action,error=>!code||error.code===code);checks++};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
const w='00000000-0000-0000-0000-000000000001',otherW='00000000-0000-0000-0000-000000000002';
const actors={owner:'10000000-0000-0000-0000-000000000001',admin:'10000000-0000-0000-0000-000000000002',operator:'10000000-0000-0000-0000-000000000003',viewer:'10000000-0000-0000-0000-000000000004',unconfirmed:'10000000-0000-0000-0000-000000000005',outsider:'10000000-0000-0000-0000-000000000006'};
const [c,c2,c3,c4,foreignC]=[1,2,3,4,5].map(n=>'20000000-0000-0000-0000-00000000000'+n);
const fingerprint='a'.repeat(64),missing=randomUUID();
const login=async actor=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');currentActor=actor};
const service=async()=>{await db.exec("reset role;select set_config('request.jwt.claim.sub','',false);set role service_role");currentActor=null};
const identity=(result,creator,workspace)=>{eq(result.actorId,currentActor);eq(result.workspaceId,workspace);eq(result.creatorId,creator);return result};
const kb=async(op='list',id=null,expected=null,value=null,creator=c,workspace=w)=>identity(await q('select public.bruff_model_knowledge($1,$2,$3,$4,$5,$6) as value',[workspace,creator,op,id,expected,value]),creator,workspace);
const settings=async(op='read',expected=null,value=null,creator=c,workspace=w)=>identity(await q('select public.bruff_generation_control($1,$2,$3,$4,$5) as value',[workspace,creator,op,expected,value]),creator,workspace);
const pool=async(creator=c,workspace=w)=>identity(await q('select public.bruff_generation_pool($1,$2) as value',[workspace,creator]),creator,workspace);
const claim=async(id,revision,fan='123',creator=c,workspace=w,hash=fingerprint)=>identity(await q('select public.bruff_generation_claim($1,$2,$3,$4,$5,$6) as value',[workspace,creator,id,fan,revision,hash]),creator,workspace);
const result=async(id,fan='123',creator=c,workspace=w)=>identity(await q('select public.bruff_generation_result($1,$2,$3,$4) as value',[workspace,creator,id,fan]),creator,workspace);
const commit=(id,payload,actor=actors.owner,creator=c,workspace=w)=>q('select public.bruff_generation_commit($1,$2,$3,$4,$5) as value',[workspace,creator,id,actor,payload]);
const entry=(patch={})=>({kind:'style_rule',text:'Use short, friendly sentences.',referenceId:'teaching.turn-1',label:'Owner reviewed style',sourceVersion:'v1',state:'draft',...patch});
const config=(patch={})=>({enabled:true,dailyLimit:4,maxResults:3,...patch});
const example=(patch={})=>({trigger:'hello morning',english:'Good morning!',spanish:'¡Buenos días!',state:'verified',referenceId:'guide.greeting',label:'Reviewed greeting',sourceVersion:'v1',reviewed:true,...patch});
const addExample=(value,creator=c)=>q("select public.bruff_chat_direct_knowledge($1,$2,'save',null,0,$3) as value",[w,creator,value]);
const payload=(exampleId,knowledgeId,patch={})=>({drafts:[{id:'1',english:'Hello! How are you today?',spanish:'¡Hola! ¿Cómo estás hoy?',exampleIds:[exampleId],knowledgeIds:knowledgeId?[knowledgeId]:[]}],unknowns:[],...patch});
try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;");
 for(const name of ['202610300001_private_foundation','202610310003_team','202610310004_role_scopes','202611060040_chat_direct_knowledge','202611060041_ai_control','202611060042_ai_generation_knowledge'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 for(const [role,id]of Object.entries(actors))await db.query('insert into auth.users values($1,$2,case when $3 then null else now() end)',[id,role+'@example.test',role==='unconfirmed']);
 await db.query('insert into bruff_private.workspaces(id,name)values($1,$2),($3,$4)',[w,'Fictional A',otherW,'Fictional B']);
 for(const [role,id]of Object.entries(actors))if(role!=='outsider')await db.query("insert into bruff_private.memberships(workspace_id,user_id,role,status)values($1,$2,$3,'active')",[w,id,role==='unconfirmed'?'owner':role]);
 await db.query("insert into bruff_private.memberships(workspace_id,user_id,role,status)values($1,$2,'owner','active')",[otherW,actors.owner]);
 for(const [index,id]of [c,c2,c3,c4,foreignC].entries())await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[id===foreignC?otherW:w,id,'Fictional model '+index]);
 await login(actors.owner);
 const initial=await settings();eq(initial.settings,{enabled:false,dailyLimit:4,maxResults:3});eq(initial.version,0);eq((await kb()).items,[]);
 const empty=await pool();eq(empty.examples,[]);eq(empty.knowledge,[]);eq(empty.approvedCount,0);eq((await pool()).revision,empty.revision);
 eq((await claim(randomUUID(),empty.revision)).reason,'disabled');
 for(const value of [null,{},config({enabled:1}),config({dailyLimit:0}),config({dailyLimit:13}),config({dailyLimit:1.2}),config({maxResults:0}),config({maxResults:4}),config({maxResults:1.5}),config({mode:'all'})])await reject(()=>settings('save',0,value),'22023');
 await reject(()=>settings('save',1,config()),'40001');eq((await settings('save',0,config({dailyLimit:12}))).version,1);await reject(()=>settings('save',0,config()),'40001');
 const noSources=await pool();eq((await claim(randomUUID(),noSources.revision)).reason,'no_sources');
 for(const patch of [{kind:'other'},{kind:'model_fact'},{kind:'model_fact',key:'spending'},{key:'age'},{text:''},{text:'x'.repeat(1201)},{text:'Bad\u0007control'},{text:'Hello {{NAME}}'},{referenceId:'https://example.test'},{label:'x'.repeat(161)},{sourceVersion:'0'},{state:'approved'},{actorId:actors.outsider}])await reject(()=>kb('save',null,0,entry(patch)),'22023');
 const draft=await kb('save',null,0,entry()),knowledgeId=draft.savedId;eq(draft.items[0].key,null);eq(draft.items[0].version,1);eq((await pool()).knowledge,[]);
 await reject(()=>kb('save',knowledgeId,0,entry()),'40001');
 await kb('save',knowledgeId,1,entry({state:'verified'}));eq((await pool()).knowledge[0].id,knowledgeId);eq((await pool()).knowledge[0].version,2);
 const verifiedRevision=(await pool()).revision;
 const reverted=await kb('save',knowledgeId,2,entry({state:undefined,text:'Keep replies brief.'}));eq(reverted.items.find(item=>item.id===knowledgeId).state,'draft');eq((await pool()).knowledge,[]);eq((await pool()).revision===verifiedRevision,false);
 await kb('save',knowledgeId,3,entry({state:'verified'}));
 const fact=await kb('save',null,0,entry({kind:'model_fact',key:'public_name',text:'Nora',state:'verified'}));
 await reject(()=>kb('save',null,0,entry({kind:'model_fact',key:'public_name',text:'Other',referenceId:'teaching.other',state:'verified'})),'23505');
 const factDraft=await kb('save',null,0,entry({kind:'model_fact',key:'public_name',text:'Other',referenceId:'teaching.other'}));eq(factDraft.items.find(item=>item.id===factDraft.savedId).state,'draft');
 const savedExample=await addExample(example()),exampleId=savedExample.savedId;await addExample(example({state:'draft',reviewed:false,referenceId:'guide.draft'}));await addExample(example({state:'archived',reviewed:false,referenceId:'guide.archived'}));
 let snapshot=await pool();eq(snapshot.examples.length,1);eq(snapshot.examples[0].id,exampleId);eq(snapshot.examples[0].version,1);eq(snapshot.knowledge.length,2);eq(snapshot.approvedCount,1);eq((await claim(randomUUID(),'0'.repeat(32))).reason,'revision_changed');
 for(const [fan,hash]of [['bad',fingerprint],['1'.repeat(25),fingerprint],['123','invalid']])await reject(()=>claim(randomUUID(),snapshot.revision,fan,c,w,hash),'22023');
 const request=randomUUID();eq((await claim(request,snapshot.revision)).allowed,true);eq((await claim(request,snapshot.revision)).reason,'duplicate');await reject(()=>result(request),'40001');
 const canonical=payload(exampleId,knowledgeId);
 await reject(()=>commit(request,canonical),'42501');
 await service();eq(await q('select auth.uid() as value'),null);await reject(()=>commit(request,canonical,actors.outsider),'42501');await reject(()=>commit(request,canonical,actors.owner,c2),'42501');
 for(const value of [{},payload(exampleId,knowledgeId,{extra:true}),payload(exampleId,knowledgeId,{unknowns:Array(6).fill('unknown')}),payload(exampleId,knowledgeId,{unknowns:['x'.repeat(161)]}),payload(missing,knowledgeId),payload(exampleId,missing),payload(exampleId,knowledgeId,{drafts:[{...canonical.drafts[0],english:'x'.repeat(701)}]}),payload(exampleId,knowledgeId,{drafts:[{...canonical.drafts[0],exampleIds:[exampleId,exampleId]}]}),payload(exampleId,knowledgeId,{drafts:[{...canonical.drafts[0],knowledgeIds:[knowledgeId,knowledgeId]}]}),payload(exampleId,knowledgeId,{drafts:[canonical.drafts[0],canonical.drafts[0]]})])await reject(()=>commit(request,value),'22023');
 const committed=await commit(request,canonical);eq(committed.generationId,request);eq(committed.actorId,actors.owner);eq(committed.workspaceId,w);eq(committed.creatorId,c);eq(committed.fanId,'123');eq(committed.contextHash,fingerprint);eq(committed.aiGenerated,true);eq(committed.aiVerified,false);eq(committed.drafts,canonical.drafts);eq(committed.unknowns,[]);eq(/Z$/.test(committed.expiresAt),true);eq(await q('select auth.uid() as value'),null);
 await reject(()=>commit(request,canonical),'40001');
 await login(actors.owner);eq(await result(request),committed);await reject(()=>result(request,'456'),'40001');await reject(()=>result(request,'123',c2),'40001');
 const staleRequest=randomUUID();snapshot=await pool();eq((await claim(staleRequest,snapshot.revision)).allowed,true);eq((await claim(randomUUID(),snapshot.revision)).reason,'actor_minute_limit');
 await login(actors.admin);const emptyRequest=randomUUID(),emptyPool=await pool();eq((await claim(emptyRequest,emptyPool.revision)).allowed,true);
 const emptyPayload={drafts:[],unknowns:['No hay suficiente contexto no explícito para proponer una respuesta.']};await service();const emptyCanonical=await commit(emptyRequest,emptyPayload,actors.admin);eq(emptyCanonical.drafts,[]);eq(emptyCanonical.unknowns,emptyPayload.unknowns);eq(emptyCanonical.aiVerified,false);await login(actors.admin);eq(await result(emptyRequest),emptyCanonical);await login(actors.owner);
 await kb('archive',knowledgeId,4);await reject(()=>result(request),'40001');
 await service();await reject(()=>commit(staleRequest,canonical),'40001');await login(actors.owner);
 // Age reservations only in this in-memory fixture, preserving exact ten-minute TTL.
 await db.exec('reset role');await db.exec("update bruff_private.generation_reservations set created_at=created_at-interval '2 minutes',usage_day=((created_at-interval '2 minutes') at time zone 'UTC')::date,expires_at=expires_at-interval '2 minutes'");await login(actors.owner);
 const expired=randomUUID();snapshot=await pool();eq((await claim(expired,snapshot.revision)).allowed,true);
 await db.exec('reset role');await db.query("with clock as(select clock_timestamp()-interval '11 minutes' as t) update bruff_private.generation_reservations set created_at=clock.t,usage_day=(clock.t at time zone 'UTC')::date,expires_at=clock.t+interval '10 minutes' from clock where request_id=$1",[expired]);await service();await reject(()=>commit(expired,payload(exampleId,null)),'40001');await login(actors.owner);
 // Canonical payloads expire, while reservations keep their charged estimate.
 await db.exec('reset role');await db.query("with clock as(select clock_timestamp()-interval '11 minutes' as t) update bruff_private.generation_reservations set created_at=clock.t,usage_day=(clock.t at time zone 'UTC')::date,expires_at=clock.t+interval '10 minutes' from clock where request_id=$1",[request]);
 const chargedBefore=await q('select coalesce(sum(estimated_neurons),0)::integer as value from bruff_private.generation_reservations');
 const oldId=randomUUID();await db.query("insert into bruff_private.generation_reservations(request_id,workspace_id,creator_id,actor_id,fan_id,revision,context_hash,created_at,usage_day,expires_at)select $1,$2,$3,$4,'123',$5,$6,t,(t at time zone 'UTC')::date,t+interval '10 minutes' from(select clock_timestamp()-interval '31 days' as t) clock",[oldId,w,c2,actors.owner,snapshot.revision,fingerprint]);
 await login(actors.owner);const disabledPool=await pool(c2);eq((await claim(randomUUID(),disabledPool.revision,'123',c2)).reason,'disabled');eq((await claim(request,(await pool()).revision)).reason,'duplicate');
 await db.exec('reset role');eq(await q('select payload is null and committed_at is null as value from bruff_private.generation_reservations where request_id=$1',[request]),true);eq(await q('select estimated_neurons as value from bruff_private.generation_reservations where request_id=$1',[request]),600);eq(await q('select count(*)::integer as value from bruff_private.generation_reservations where request_id=$1',[oldId]),0);eq(await q('select coalesce(sum(estimated_neurons),0)::integer as value from bruff_private.generation_reservations'),chargedBefore);await login(actors.owner);
 const unchangedBank=await q("select public.bruff_ai_control($1,$2,'read',null,null) as value",[w,c]);eq(unchangedBank.settings,{mode:'bank',maxResults:3,minScore:0.65,dailyLimit:20});eq(unchangedBank.version,0);eq((await q('select public.bruff_chat_direct_suggestions($1,$2,$3) as value',[w,c,'morning'])).rows[0].id,exampleId);
 // Real authorization gates, including fixed-actor revocation at service commit.
 for(const role of ['admin','operator','viewer','unconfirmed','outsider']){await login(actors[role]);await reject(()=>kb(),'42501');await reject(()=>settings(),'42501')}
 await login(actors.admin);eq((await pool()).examples.length,1);
 for(const role of ['operator','viewer','unconfirmed','outsider']){await login(actors[role]);await reject(()=>pool(),'42501');await reject(()=>claim(randomUUID(),snapshot.revision),'42501')}
 await db.exec('reset role');for(const permission of ['read','send'])await db.query('insert into bruff_private.account_grants(workspace_id,user_id,creator_id,permission)values($1,$2,$3,$4)',[w,actors.operator,c,permission]);await login(actors.operator);eq((await pool()).examples.length,1);await reject(()=>pool(c2),'42501');await reject(()=>result(request),'40001');
 const operatorRequest=randomUUID(),operatorPool=await pool();eq((await claim(operatorRequest,operatorPool.revision)).allowed,true);
 await db.exec('reset role');await db.query("update bruff_private.memberships set status='disabled' where workspace_id=$1 and user_id=$2",[w,actors.operator]);await service();await reject(()=>commit(operatorRequest,payload(exampleId,null),actors.operator),'42501');await login(actors.operator);await reject(()=>pool(),'42501');await reject(()=>result(operatorRequest),'42501');
 await login(actors.owner);await reject(()=>kb('save',fact.savedId,1,entry(),c2),'42501');await reject(()=>pool(foreignC),'42501');
 for(const table of ['model_knowledge','generation_settings','generation_reservations']){await reject(()=>db.query('select * from bruff_private.'+table),'42501');await reject(()=>db.query('insert into bruff_private.'+table+' default values'),'42501')}
 await reject(()=>q('select bruff_private.generation_snapshot($1,$2) as value',[w,c]),'42501');
 // Capacity checks exercise the owner RPC, not direct authenticated table writes.
 while((await kb('list',null,null,null,c2)).total<100){const total=(await kb('list',null,null,null,c2)).total;await kb('save',null,0,entry({referenceId:'capacity.active-'+total}),c2)}
 await reject(()=>kb('save',null,0,entry(),c2),'23514');
 for(let n=100;n<200;n++)await kb('save',null,0,entry({state:'archived',referenceId:'capacity.archive-'+n}),c2);
 const full=await kb('list',null,null,null,c2);eq(full.total,200);eq(full.items.length,200);eq(full.complete,true);await reject(()=>kb('save',null,0,entry({state:'archived'}),c2),'23514');
 await reject(()=>kb('save',full.items.find(item=>item.state==='archived').id,1,entry(),c2),'23514');
 // Separate models/agency exercise fixed per-model and generation-only global budgets.
 await settings('save',0,config({dailyLimit:1}),c3);await addExample(example({referenceId:'guide.c3'}),c3);const modelPool=await pool(c3),one=randomUUID();eq((await claim(one,modelPool.revision,'123',c3)).allowed,true);eq((await claim(randomUUID(),modelPool.revision,'123',c3)).reason,'model_daily_limit');
 await db.exec('reset role');const today=await q("select (clock_timestamp() at time zone 'UTC')::date::text as value");const count=await q('select count(*)::integer as value from bruff_private.generation_reservations where usage_day=$1',[today]);
 for(let n=count;n<12;n++)await db.query("insert into bruff_private.generation_reservations(request_id,workspace_id,creator_id,actor_id,fan_id,revision,context_hash,created_at,usage_day,expires_at) select $1,$2,$3,$4,'123',$5,$6,t,(t at time zone 'UTC')::date,t+interval '10 minutes' from(select clock_timestamp() as t) clock",[randomUUID(),w,c4,actors.admin,modelPool.revision,fingerprint]);
 await login(actors.owner);await settings('save',0,config({dailyLimit:12}),c4);await addExample(example({referenceId:'guide.c4'}),c4);const globalPool=await pool(c4),global=await claim(randomUUID(),globalPool.revision,'123',c4);eq(global.reason,'global_daily_limit');eq(global.retryAfter>0&&global.retryAfter<=86400,true);
 await db.exec('reset role');eq(await q('select sum(estimated_neurons)::integer as value from bruff_private.generation_reservations where usage_day=$1',[today]),7200);eq(await q('select count(*)::integer as value from bruff_private.ai_manual_usage'),0);
 eq(await q('select count(*)::integer as value from bruff_private.fans'),0);eq(await q('select count(*)::integer as value from bruff_private.bruff_settings'),0);
 // Owner revocation and anonymous callers cannot retain any relevant access.
 await db.query("update bruff_private.memberships set status='disabled' where workspace_id=$1 and user_id=$2",[w,actors.owner]);await login(actors.owner);await reject(()=>kb(),'42501');await reject(()=>settings(),'42501');await reject(()=>pool(),'42501');await reject(()=>result(request),'42501');await service();await reject(()=>commit(operatorRequest,payload(exampleId,null),actors.owner),'42501');
 await db.exec('reset role;set role anon');await reject(()=>pool(),'42501');await reject(()=>commit(request,canonical),'42501');
 console.log(checks+' generation/teaching database checks passed (in-memory fictional data only)');
}catch(error){console.error('Generation DB verification failed:',{code:error.code,message:error.message,where:error.where});process.exitCode=1}finally{await db.close()}
