import {readFile,readdir} from 'node:fs/promises';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';import {newAutoMessage,autoMessagePayload} from '../src/auto-messages.js';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0;
const q=async(sql,params=[])=>(await db.query(sql,params)).rows[0]?.value;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++};const reject=async fn=>{await assert.rejects(fn);checks++};
const w='00000000-0000-0000-0000-000000000001',foreignW='00000000-0000-0000-0000-000000000002';
const owner='10000000-0000-0000-0000-000000000001',manager='10000000-0000-0000-0000-000000000002',worker='10000000-0000-0000-0000-000000000003',foreignOwner='10000000-0000-0000-0000-000000000004';
const models=[1,2,3].map(n=>'20000000-0000-0000-0000-00000000000'+n),foreign='20000000-0000-0000-0000-000000000004';
const login=async id=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`);
const overview=(creator=models[0],workspace=w)=>q('select public.bruff_mass_overview($1,$2) as value',[workspace,creator]);
try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;");
 const migrations=await readdir(new URL('../supabase/migrations/',import.meta.url));
 for(const name of migrations.sort()){const n=Number(name.match(/^\d{8}(\d{4})_/)?.[1]);if([1,2,3,4,5,6,7,8,11].includes(n)||n>=16&&n<=39)await db.exec(await readFile(new URL('../supabase/migrations/'+name,import.meta.url),'utf8'))}
 await db.query('insert into auth.users values($1,$2,now()),($3,$4,now()),($5,$6,now()),($7,$8,now())',[owner,'o@example.test',manager,'m@example.test',worker,'c@example.test',foreignOwner,'f@example.test']);
 await db.query("insert into bruff_private.workspaces(id,name)values($1,'A'),($2,'B')",[w,foreignW]);
 for(const [actor,role,workspace]of[[owner,'owner',w],[manager,'admin',w],[worker,'operator',w],[foreignOwner,'owner',foreignW]])await db.query("insert into bruff_private.memberships(workspace_id,user_id,role,status)values($1,$2,$3,'active')",[workspace,actor,role]);
 for(const model of models)await db.query("insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,'Fixture')",[w,model]);
 await db.query("insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,'Foreign')",[foreignW,foreign]);
 const createDraft=async(creator,workspace=w,actor=owner)=>{await login(actor);const d=newAutoMessage('mass');d.name='Fixture';d.messages[0].text='Hola';const saved=await q("select public.bruff_auto_message_drafts($1,$2,'save',null,null,$3) as value",[workspace,creator,autoMessagePayload(d)]);return {id:saved.savedId,config:autoMessagePayload(d)}};
 const native=await createDraft(models[0]),advanced=await createDraft(models[0]),prepared=await createDraft(models[0]),old=await createDraft(models[0]),other=await createDraft(models[1]),outside=await createDraft(foreign,foreignW,foreignOwner);
 await db.exec('reset role');
 const addNative=async(d,creator,workspace=w,actor=owner)=>q("insert into bruff_private.native_mass_runs(workspace_id,creator_id,draft_id,draft_version,binding,recipients,config,actor,state,queue_id)values($1,$2,$3,1,'acct_fixture','[\"123\",\"456\"]',$4,$5,'accepted','77')returning id as value",[workspace,creator,d.id,d.config,actor]);
 const nativeId=await addNative(native,models[0]);await addNative(other,models[1]);await addNative(outside,foreign,foreignW,foreignOwner);
 const addAdvanced=async(d,state,started)=>q("insert into bruff_private.advanced_runs(workspace_id,creator_id,draft_id,draft_version,activated_by,state,activated_at,ends_at,binding,audience_ids,execution_plan)values($1,$2,$3,1,$4,$5,case when $6 then now() else null end,now()+interval '1 day','acct_fixture','[\"123\",\"456\"]','{}')returning id as value",[w,models[0],d.id,owner,state,started]);
 const advancedId=await addAdvanced(advanced,'active',true);await addAdvanced(prepared,'paused',false);await addAdvanced(old,'completed',true);
 const delivery=await q("insert into bruff_private.advanced_deliveries(run_id,fan_id,cycle,step_index,due_at,state,provider_id)values($1,'123',0,0,now(),'sent','999')returning id as value",[advancedId]);
 await db.query("insert into bruff_private.advanced_withdrawals(delivery_id,run_id,fan_id,message_id,binding,mode,due_at,state)values($1,$2,'123','999','acct_fixture','all',now(),'removed')",[delivery,advancedId]);
 await login(owner);await q("select public.bruff_auto_message_drafts($1,$2,'save',$3,1,$4) as value",[w,models[0],old.id,{...old.config,name:'Version two'}]);
 let result=await overview();eq(result.workspaceId,w);eq(result.creatorId,models[0]);eq(result.runs.length,3);
 eq(result.runs.find(x=>x.draftId===native.id).counts.sent,null);eq(result.runs.find(x=>x.draftId===native.id).counts.removed,null);eq(result.runs.find(x=>x.draftId===native.id).state,'accepted');
 eq(result.runs.find(x=>x.draftId===advanced.id).counts.sent,1);eq(result.runs.find(x=>x.draftId===advanced.id).counts.removed,1);eq(result.runs.find(x=>x.draftId===prepared.id).state,'prepared');eq(result.runs.some(x=>x.draftId===old.id),false);
 eq((await overview(models[1])).runs.length,1);eq((await overview(models[2])).runs,[]);await reject(()=>overview(foreign,foreignW));
 await db.exec('reset role');await db.query("insert into bruff_private.native_queue_events(run_id,actor,result)values($1,$2,'cancelled')",[nativeId,owner]);
 await login(owner);eq((await overview()).runs.find(x=>x.id===nativeId).state,'cancelled');
 await login(manager);eq((await overview()).runs.length,3);await login(worker);await reject(overview);
 await db.exec('reset role');await db.query("update bruff_private.memberships set status='disabled' where workspace_id=$1 and user_id=$2",[w,manager]);await login(manager);await reject(overview);
 await db.exec('set role anon');await reject(overview);
 await db.exec('reset role');eq(await q("select has_table_privilege('authenticated','bruff_private.native_mass_runs','select') as value"),false);
 eq(await q("select count(*)::int as value from bruff_private.advanced_deliveries"),1);
 // Both kinds are individually unique. Defensive cross-kind projection must
 // use chronology, never random UUID ordering, and a dormant preparation must
 // not hide an earlier execution that really started.
 const cross=await createDraft(models[0]);await db.exec('reset role');
 const crossNative=await addNative(cross,models[0]),crossAdvanced=await addAdvanced(cross,'stopped',true);
 const olderId='ffffffff-ffff-ffff-ffff-ffffffffffff',newerId='00000000-0000-0000-0000-000000000010';
 await db.query("update bruff_private.native_mass_runs set id=$2,prepared_at=now()-interval '2 hours' where id=$1",[crossNative,olderId]);
 await db.query("update bruff_private.advanced_runs set id=$2,prepared_at=now()-interval '1 hour',activated_at=now()-interval '1 hour' where id=$1",[crossAdvanced,newerId]);
 await reject(()=>addNative(cross,models[0]));await reject(()=>addAdvanced(cross,'active',true));
 await login(owner);const latest=(await overview()).runs.find(x=>x.draftId===cross.id);eq(latest.id,newerId);eq(latest.state,'stopped');
 await db.exec('reset role');await db.query("update bruff_private.advanced_runs set state='paused',activated_at=null,prepared_at=now() where id=$1",[newerId]);
 await login(owner);eq((await overview()).runs.find(x=>x.draftId===cross.id).id,olderId);
 const archived=await q("select public.bruff_auto_message_drafts($1,$2,'archive',$3,1,null) as value",[w,models[0],cross.id]);
 eq(archived.rows.find(x=>x.id===cross.id).version,2);eq(archived.rows.find(x=>x.id===cross.id).archived,true);eq((await overview()).runs.some(x=>x.draftId===cross.id),false);
 console.log(checks+' mass overview SQL checks passed; no provider calls');
}finally{await db.close()}
