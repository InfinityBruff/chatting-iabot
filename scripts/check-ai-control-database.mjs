import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
if(!process.argv[2])throw Error('Pass an installed PGlite module path; only an in-memory fictional database is used.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0,currentActor;
const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++};
const reject=async(action,code)=>{await assert.rejects(action,error=>!code||error.code===code);checks++};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
const w='00000000-0000-0000-0000-000000000001',otherW='00000000-0000-0000-0000-000000000002',foreignW='00000000-0000-0000-0000-000000000003';
const actorIds={owner:'10000000-0000-0000-0000-000000000001',admin:'10000000-0000-0000-0000-000000000002',operator:'10000000-0000-0000-0000-000000000003',viewer:'10000000-0000-0000-0000-000000000004',unconfirmed:'10000000-0000-0000-0000-000000000005',outsider:'10000000-0000-0000-0000-000000000006'};
const models=[1,2,3,4,5].map(n=>'20000000-0000-0000-0000-00000000000'+n),[c,c2,c3,c4,cOther]=models;
const login=async id=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);await db.exec('set role authenticated');currentActor=id};
const scoped=async(promise,creator,workspace)=>{const result=await promise;eq(result.actorId,currentActor);eq(result.workspaceId,workspace);eq(result.creatorId,creator);return result};
const list=async workspace=>{const result=await q('select public.bruff_ai_models($1) as value',[workspace??null]);eq(result.actorId,currentActor);return result};
const control=(op='read',expected=null,value=null,creator=c,workspace=w)=>scoped(q('select public.bruff_ai_control($1,$2,$3,$4,$5) as value',[workspace,creator,op,expected,value]),creator,workspace);
const pool=(creator=c,workspace=w)=>scoped(q('select public.bruff_ai_pool($1,$2) as value',[workspace,creator]),creator,workspace);
const claim=(id=randomUUID(),creator=c,workspace=w)=>scoped(q('select public.bruff_ai_claim($1,$2,$3) as value',[workspace,creator,id]),creator,workspace);
const config=(patch={})=>({mode:'semantic',maxResults:3,minScore:0.65,dailyLimit:20,...patch});
const knowledge=(patch={})=>({trigger:'hello morning',english:'Good morning!',spanish:'¡Buenos días!',state:'verified',referenceId:'guide.greeting',label:'Reviewed greeting',sourceVersion:'v1',reviewed:true,...patch});
const addExample=value=>q("select public.bruff_chat_direct_knowledge($1,$2,'save',null,0,$3) as value",[w,c,value]);
const ageUsage=async()=>{await db.exec('reset role');await db.exec("update bruff_private.ai_manual_usage set created_at=clock_timestamp()-interval '2 minutes',usage_day=((clock_timestamp()-interval '2 minutes') at time zone 'UTC')::date");await login(actorIds.owner)};
try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;");
 for(const name of ['202610300001_private_foundation','202610310003_team','202610310004_role_scopes','202611060040_chat_direct_knowledge','202611060041_ai_control'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 for(const [role,id]of Object.entries(actorIds))await db.query('insert into auth.users values($1,$2,case when $3 then null else now() end)',[id,role+'@example.test',role==='unconfirmed']);
 await db.query('insert into bruff_private.workspaces(id,name)values($1,$2),($3,$4),($5,$6)',[w,'Fictional A',otherW,'Fictional B',foreignW,'Fictional C']);
 for(const [role,id]of Object.entries(actorIds))if(role!=='outsider')await db.query('insert into bruff_private.memberships(workspace_id,user_id,role,status)values($1,$2,$3,$4)',[w,id,role==='unconfirmed'?'owner':role,'active']);
 await db.query("insert into bruff_private.memberships(workspace_id,user_id,role,status)values($1,$2,'owner','active')",[otherW,actorIds.owner]);
 for(const [i,id]of models.entries())await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[id===cOther?otherW:w,id,'Fictional model '+i]);
 await login(actorIds.owner);
 eq((await list()).workspaces.map(row=>row.id),[w,otherW]);eq((await list(w)).workspaces.length,1);eq((await list(w)).workspaces[0].models.map(row=>row.id),[c,c2,c3,c4]);await reject(()=>list(foreignW),'42501');
 const defaults=await control();eq(defaults.settings,{mode:'bank',maxResults:3,minScore:0.65,dailyLimit:20});eq(defaults.version,0);eq((await pool()).rows,[]);
 eq((await claim()).reason,'bank');
 await reject(()=>control('save',1,config()),'40001');
 for(const value of [null,{},config({mode:'all'}),config({maxResults:0}),config({maxResults:4}),config({maxResults:1.5}),config({minScore:0.49}),config({minScore:1}),config({minScore:'0.65'}),config({dailyLimit:0}),config({dailyLimit:101}),config({dailyLimit:1.1}),config({actorId:actorIds.outsider}),config({query:'not stored'})])await reject(()=>control('save',0,value),'22023');
 const saved=await control('save',0,config({dailyLimit:2,minScore:0.5,maxResults:1}));eq(saved.version,1);eq(saved.settings.dailyLimit,2);await reject(()=>control('save',0,config()),'40001');await reject(()=>control('read',0),'22023');
 await reject(()=>control('save',0,config(),cOther,w),'42501');
 await control('save',1,config({dailyLimit:2,minScore:0.99}));eq((await control()).version,2);
 const example=await addExample(knowledge());await addExample(knowledge({state:'draft',reviewed:false,referenceId:'guide.draft'}));await addExample(knowledge({state:'archived',reviewed:false,referenceId:'guide.archived'}));
 const bank=await pool();eq(bank.approvedCount,1);eq(bank.rows.length,1);eq(bank.rows[0].trigger,'hello morning');eq(bank.rows[0].english,'Good morning!');eq(bank.rows[0].source.version,'v1.r1');eq(bank.rows[0].source.kind,'document');eq(bank.version,2);eq(bank.rows[0].id,example.savedId);
 await control('save',2,config({mode:'bank',dailyLimit:2}));const metadataOnly=await pool();eq(metadataOnly.rows,[]);eq(metadataOnly.approvedCount,1);eq(metadataOnly.settings.mode,'bank');eq(metadataOnly.version,3);eq((await claim()).reason,'bank');
 await control('save',3,config({dailyLimit:2,minScore:0.99}));
 const request=randomUUID();eq((await claim(request)).allowed,true);eq((await claim(request)).reason,'duplicate');eq((await claim(randomUUID())).allowed,true);
 const daily=await claim();eq(daily.allowed,false);eq(daily.reason,'model_daily_limit');eq(daily.retryAfter>0&&daily.retryAfter<=86400,true);
 await control('save',0,config({dailyLimit:100}),c2);await control('save',0,config({dailyLimit:100}),cOther,otherW);
 for(let i=0;i<8;i++)eq((await claim(randomUUID(),c2)).allowed,true);
 const minute=await claim(randomUUID(),c2);eq(minute.reason,'actor_minute_limit');eq(minute.retryAfter>0&&minute.retryAfter<=60,true);eq((await claim(randomUUID(),cOther,otherW)).reason,'actor_minute_limit');
 await ageUsage();
 // Seed prior metadata only to test the hard workspace boundary without waiting
 // or making 200 remote/engine calls. Claims themselves remain the actual RPC.
 await db.exec('reset role');
 const currentDay=await q("select (clock_timestamp() at time zone 'UTC')::date::text as value");
 const existing=await q('select count(*)::int as value from bruff_private.ai_manual_usage where workspace_id=$1 and usage_day=$2',[w,currentDay]);
 for(let i=existing;i<199;i++)await db.query("insert into bruff_private.ai_manual_usage values($1,$2,$3,$4,1,clock_timestamp(),(clock_timestamp() at time zone 'UTC')::date)",[w,i%2?c3:c4,randomUUID(),actorIds.admin]);
 await login(actorIds.owner);eq((await claim(randomUUID(),c2)).allowed,true);eq((await claim(randomUUID(),c2)).reason,'workspace_daily_limit');
 const sameUuidOtherModel=await claim(request,c2);eq(sameUuidOtherModel.reason,'duplicate');
 await db.exec('reset role');eq(await q('select count(*)::int as value from bruff_private.ai_manual_usage where workspace_id=$1 and usage_day=$2',[w,currentDay]),200);
 const usageColumns=(await db.query("select column_name from information_schema.columns where table_schema='bruff_private' and table_name='ai_manual_usage' order by ordinal_position")).rows.map(row=>row.column_name);eq(usageColumns,['workspace_id','creator_id','request_id','actor_id','settings_version','created_at','usage_day']);
 for(const role of ['admin','operator','viewer','unconfirmed','outsider']){await login(actorIds[role]);await reject(()=>list(),'42501');await reject(()=>control(),'42501');await reject(()=>control('save',2,config()),'42501')}
 await login(actorIds.admin);eq((await pool()).rows.length,1);
 for(const role of ['operator','viewer','unconfirmed','outsider']){await login(actorIds[role]);await reject(()=>pool(),'42501');await reject(()=>claim(),'42501')}
 await db.exec('reset role');await db.query("insert into bruff_private.account_grants(workspace_id,user_id,creator_id,permission)values($1,$2,$3,'read')",[w,actorIds.operator,c]);await login(actorIds.operator);await reject(()=>pool(),'42501');await reject(()=>claim(),'42501');
 await db.exec('reset role');await db.query("insert into bruff_private.account_grants(workspace_id,user_id,creator_id,permission)values($1,$2,$3,'send')",[w,actorIds.operator,c]);await login(actorIds.operator);eq((await pool()).rows.length,1);await reject(()=>pool(c2),'42501');await reject(()=>claim(randomUUID(),c2),'42501');
 for(const table of ['ai_manual_settings','ai_manual_usage']){await reject(()=>db.query('select * from bruff_private.'+table),'42501');await reject(()=>db.query('insert into bruff_private.'+table+' default values'),'42501')}
 await db.exec('reset role');await db.query("update bruff_private.memberships set status='disabled' where workspace_id=$1 and user_id=$2",[w,actorIds.operator]);await login(actorIds.operator);await reject(()=>pool(),'42501');await reject(()=>claim(),'42501');
 await db.exec('reset role;set role anon');await reject(()=>list(),'42501');await reject(()=>control(),'42501');await reject(()=>pool(),'42501');await reject(()=>claim(),'42501');
 await db.exec('reset role');await db.query("update bruff_private.memberships set status='disabled' where workspace_id=$1 and user_id=$2",[w,actorIds.owner]);await login(actorIds.owner);eq((await list()).workspaces.map(row=>row.id),[otherW]);await reject(()=>list(w),'42501');await reject(()=>control(),'42501');await reject(()=>pool(),'42501');await reject(()=>claim(),'42501');
 await db.exec('reset role');eq(await q('select count(*)::int as value from bruff_private.fans'),0);eq(await q('select count(*)::int as value from bruff_private.bruff_settings'),0);eq(await q('select count(*)::int as value from bruff_private.bruff_chat_overrides'),0);
 console.log(checks+' manual AI control database checks passed (in-memory fictional data only)');
}catch(error){console.error('AI control DB verification failed:',{code:error.code,message:error.message,where:error.where});process.exitCode=1}finally{await db.close()}
