// Actual SQL on an in-memory fictional database. No production or network path.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
if(!process.argv[2])throw Error('Pass an installed PGlite module; this script never downloads dependencies.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0;
const w='00000000-0000-0000-0000-000000000001',otherW='00000000-0000-0000-0000-000000000002',owner='10000000-0000-0000-0000-000000000001',admin='10000000-0000-0000-0000-000000000002',unconfirmed='10000000-0000-0000-0000-000000000003';
const models=[1,2,3].map(n=>'20000000-0000-0000-0000-00000000000'+n),foreign='20000000-0000-0000-0000-000000000004';
const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++},reject=async action=>{await assert.rejects(action);checks++};
const as=async(actor,action,role='authenticated')=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);await db.exec('set role '+role);try{return await action()}finally{await db.exec('reset role')}};
const entry=(creatorId,knownVersion=null,delta={})=>({creatorId,initialBaseline:1000,knownVersion,delta});
const batch=(entries,actor=owner,target=w)=>as(actor,()=>q('select public.bruff_notification_sync_batch($1,$2) as value',[target,entries]));
const legacy=sections=>as(owner,()=>q('select public.bruff_notification_sync($1,$2,$3,$4) as value',[w,models[0],1000,sections]));
try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;");
 for(const name of ['202610300001_private_foundation','202610310003_team','202610310004_role_scopes','202611010012_notification_reviews','202611080048_notification_review_batch'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await db.query("insert into auth.users values($1,'owner@example.test',now()),($2,'admin@example.test',now()),($3,'unconfirmed@example.test',null)",[owner,admin,unconfirmed]);
 await db.query("insert into bruff_private.workspaces(id,name) values($1,'Fictional workspace'),($2,'Foreign fictional workspace')",[w,otherW]);
 for(const model of models)await db.query("insert into bruff_private.creator_accounts(workspace_id,id,display_name) values($1,$2,'Fictional model')",[w,model]);
 await db.query("insert into bruff_private.creator_accounts(workspace_id,id,display_name) values($1,$2,'Foreign fictional model')",[otherW,foreign]);
 for(const [actor,role]of [[owner,'owner'],[admin,'admin'],[unconfirmed,'admin']])await db.query("insert into bruff_private.memberships(workspace_id,user_id,role,status) values($1,$2,$3,'active')",[w,actor,role]);
 // Count actual row writes, not just endpoint calls or returned versions.
 await db.exec("create table public.qa_review_writes(n integer not null);insert into public.qa_review_writes values(0);create function public.qa_count_review_write()returns trigger language plpgsql as $$begin update public.qa_review_writes set n=n+1;return new;end$$;create trigger qa_review_write after insert or update on bruff_private.notification_reviews for each row execute function public.qa_count_review_write();");
 const first=await batch(models.map(id=>entry(id,null,{tip:['phone'],all:['desktop']})));eq(first.actorId,owner);eq(first.workspaceId,w);eq(first.models.length,3);eq(await q('select n as value from public.qa_review_writes'),3);
 for(const row of first.models){eq(row.version,1);eq(row.unchanged,false);eq(row.sections,{all:['desktop'],tip:['phone']})}
 const idle=await batch(first.models.map(row=>entry(row.creatorId,row.version)));eq(idle.models.every(row=>row.unchanged===true&&!Object.hasOwn(row,'sections')),true);eq(await q('select n as value from public.qa_review_writes'),3);
 const changed=await batch([entry(models[0],1,{tip:['phone','second']}),entry(models[1],1),entry(models[2],1)]);eq(changed.models[0].version,2);eq(changed.models[0].sections.tip,['phone','second']);eq(changed.models.slice(1).every(row=>row.unchanged),true);eq(await q('select n as value from public.qa_review_writes'),4);
 // Old clients remain visible to versioned peers. Reordering/empty sections
 // are set-equivalent and do not write or bump version in either RPC.
 await legacy({tip:['second','phone'],all:['desktop'],sidebar:[]});eq(await q('select n as value from public.qa_review_writes'),4);
 await legacy({purchases:['legacy-device']});eq(await q('select n as value from public.qa_review_writes'),5);
 const legacyVisible=await batch([entry(models[0],2)]);eq(legacyVisible.models[0].version,3);eq(legacyVisible.models[0].sections.purchases,['legacy-device']);
 const isolation=await batch([entry(models[0])],admin);eq(isolation.models[0].sections,{});eq(isolation.models[0].baseline,1000);
 const denied=await batch([entry(models[0],3),entry(foreign)]);eq(denied.models[0].unchanged,true);eq(denied.models[1],{creatorId:foreign,denied:true});eq(await q('select count(*)::integer as value from bruff_private.notification_reviews where creator_id=$1',[foreign]),0);
 const before=await q('select n as value from public.qa_review_writes');
 for(const entries of [[{...entry(models[0]),userId:admin}],[entry(models[0]),entry(models[0])],[entry(models[0],null,{owner:['x']})],[entry(models[0],null,{tip:[42]})],[entry(models[0],-1)],[entry(models[0],1.5)],[{...entry(models[0]),initialBaseline:-1}],[entry(models[0],null,{tip:['would-write']}),entry(models[1],null,{invalid:['x']})]])await reject(()=>batch(entries));
 eq(await q('select n as value from public.qa_review_writes'),before);eq((await batch([entry(models[0])])).models[0].sections.tip,['phone','second']);
 await reject(()=>batch([entry(models[0])],unconfirmed));await reject(()=>batch([entry(models[0])],owner,otherW));await reject(()=>as(owner,()=>q('select * from bruff_private.notification_reviews')));await reject(()=>as(null,()=>q('select public.bruff_notification_sync_batch($1,$2) as value',[w,[]]),'anon'));
 await db.query("update bruff_private.memberships set status='disabled' where workspace_id=$1 and user_id=$2",[w,admin]);await reject(()=>batch([entry(models[0],1)],admin));
 await db.query("update bruff_private.memberships set status='active',role='operator' where workspace_id=$1 and user_id=$2",[w,admin]);await db.query("insert into bruff_private.account_grants(workspace_id,creator_id,user_id,permission) values($1,$2,$3,'read')",[w,models[0],admin]);await reject(()=>batch([entry(models[0],1)],admin));
 eq(await q("select count(*)::integer as value from bruff_private.schema_versions where version='202611080048_notification_review_batch'"),1);
 console.log(JSON.stringify({checks,result:'passed',realNetworkCalls:0,realFanSends:0,database:'fictional in-memory PGlite'}));
}finally{await db.close()}
