import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

if(!process.argv[2])throw Error('Pass an installed PGlite module path; this script uses only an in-memory test database.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0;
const eq=(actual,expected)=>{assert.deepEqual(actual,expected);checks++};
const reject=async(action,code)=>{await assert.rejects(action,error=>!code||error.code===code);checks++};
const query=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
const w='00000000-0000-0000-0000-000000000001',foreignW='00000000-0000-0000-0000-000000000002';
const ids={owner:'10000000-0000-0000-0000-000000000001',admin:'10000000-0000-0000-0000-000000000002',operator:'10000000-0000-0000-0000-000000000003',viewer:'10000000-0000-0000-0000-000000000004',unconfirmed:'10000000-0000-0000-0000-000000000005',outsider:'10000000-0000-0000-0000-000000000006'};
const c='20000000-0000-0000-0000-000000000001',otherC='20000000-0000-0000-0000-000000000002',foreignC='20000000-0000-0000-0000-000000000003';
let currentActor=null;
const login=async(actor)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor]);await db.exec('set role authenticated');currentActor=actor};
const manage=(op='list',example_id=null,expected=null,value=null,creator=c,workspace=w)=>query('select public.bruff_chat_direct_knowledge($1,$2,$3,$4,$5,$6) as value',[workspace,creator,op,example_id,expected,value]);
const scoped=async(promise,creator,workspace)=>{const result=await promise;eq(result.actorId,currentActor);eq(result.workspaceId,workspace);eq(result.creatorId,creator);const {actorId,workspaceId,creatorId,...payload}=result;return payload};
const suggest=(text='hello morning',creator=c,workspace=w)=>scoped(query('select public.bruff_chat_direct_suggestions($1,$2,$3) as value',[workspace,creator,text]),creator,workspace);
const reference=(id,version,creator=c,workspace=w)=>scoped(query('select public.bruff_chat_direct_reference($1,$2,$3,$4) as value',[workspace,creator,id,version]),creator,workspace);
const example=(patch={})=>({trigger:'hello morning how are you today',english:'Good morning! How are you today?',spanish:'¡Buenos días! ¿Cómo estás hoy?',state:'verified',referenceId:'guide.page-1',label:'Reviewed general greeting',sourceVersion:'v1',reviewed:true,...patch});
try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;");
 for(const name of ['202610300001_private_foundation','202610310003_team','202610310004_role_scopes','202611060040_chat_direct_knowledge'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 for(const [role,id]of Object.entries(ids))await db.query('insert into auth.users(id,email,email_confirmed_at) values($1,$2,case when $3 then null else now() end)',[id,role+'@example.test',role==='unconfirmed']);
 await db.query('insert into bruff_private.workspaces(id,name) values($1,$2),($3,$4)',[w,'Fictional agency A',foreignW,'Fictional agency B']);
 for(const [role,id]of Object.entries(ids))if(role!=='outsider')await db.query('insert into bruff_private.memberships(workspace_id,user_id,role,status)values($1,$2,$3,$4)',[w,id,role==='unconfirmed'?'owner':role,'active']);
 for(const [workspace,creator]of [[w,c],[w,otherC],[foreignW,foreignC]])await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[workspace,creator,'Fictional model']);
 await login(ids.owner);
 eq(await suggest(),{status:'empty',approvedCount:0,rows:[]});eq((await manage()).items,[]);
 const created=await manage('save',null,0,example()),id=created.savedId;eq(created.total,1);eq(created.complete,true);eq(created.items[0].version,1);eq(created.items[0].reviewedBy,ids.owner);
 const found=await suggest();eq(found.status,'connected');eq(found.approvedCount,1);eq(found.rows.length,1);eq(found.rows[0].source,{kind:'document',modelId:c,referenceId:'guide.page-1',label:'Reviewed general greeting',version:'v1.r1',verified:true});eq(found.rows[0].variables,[]);eq(await reference(id,'v1.r1'),{valid:true});eq(await reference(null,'v1.r1'),{valid:false});eq(await reference(id,null),{valid:false});eq(await reference(id,'x'.repeat(129)),{valid:false});
 eq((await suggest('unrelated weather question')).rows,[]);eq((await suggest('unrelated weather question')).status,'connected');eq((await suggest('the and')).rows,[]);eq((await suggest('')).rows,[]);
 await reject(()=>suggest('a'.repeat(2001)),'22023');
 await reject(()=>manage('save',null,0,example({reviewed:false})),'22023');await reject(()=>manage('save',null,0,example({reviewed:'true'})),'22023');
 for(const patch of [{english:'Hello {{NAME}}'},{spanish:'Hola }}'},{english:'Bad\u0007control'},{spanish:'Bad\u007fcontrol'},{variables:[]},{content:{mediaIds:['42']}},{referenceId:'https://example.test/source'},{sourceVersion:'0'}])await reject(()=>manage('save',null,0,example(patch)),'22023');
 await reject(()=>manage('save',null,0,example({english:'Bad\u0000control'})),'22P05');
 await reject(()=>manage('save',id,0,example()),'40001');
 await reject(()=>manage('save',null,0,example({trigger:'HELLO MORNING HOW ARE YOU TODAY'})),'23505');
 const edited=await manage('save',id,1,example({english:'Good morning!'}));eq(edited.items[0].version,2);eq(await reference(id,'v1.r1'),{valid:false});eq(await reference(id,'v1.r2'),{valid:true});
 await manage('archive',id,2);eq(await reference(id,'v1.r2'),{valid:false});eq(await suggest(),{status:'empty',approvedCount:0,rows:[]});
 const draft=await manage('save',null,0,example({state:'draft',reviewed:false,referenceId:'guide.page-2'}));eq(draft.total,2);eq((await suggest()).rows,[]);
 const multiline='First line\nSecond\tline\r\n',preserved=await manage('save',draft.savedId,1,example({state:'draft',reviewed:false,referenceId:'guide.page-2',english:multiline}));eq(preserved.items.find(item=>item.id===draft.savedId).english,multiline);
 await manage('save',id,3,example());eq((await suggest()).approvedCount,1);eq(await reference(id,'v1.r4'),{valid:true});
 for(let n=0;n<4;n++)await manage('save',null,0,example({referenceId:'guide.extra-'+n,english:'Hello option '+n,spanish:'Hola opción '+n}));
 const ranked=await suggest();eq(ranked.rows.length,3);eq((await suggest()).rows.map(row=>row.id),ranked.rows.map(row=>row.id));eq(ranked.approvedCount,5);
 await manage('save',null,0,example({trigger:'How are you',referenceId:'guide.short'}));
 eq((await suggest('  HOW   ARE YOU ')).rows[0].source.referenceId,'guide.short');eq((await suggest('and the')).rows,[]);
 await manage('save',null,0,example({trigger:'Hi',referenceId:'guide.hi'}));eq((await suggest('hi')).rows[0].source.referenceId,'guide.hi');
 eq((await suggest('hello',otherC)).approvedCount,0);eq(await reference(id,'v1.r4',otherC),{valid:false});await reject(()=>manage('save',id,4,example(),otherC),'42501');await reject(()=>suggest('hello',foreignC,foreignW),'42501');
 for(const role of ['admin','operator','viewer','unconfirmed','outsider']){await login(ids[role]);await reject(()=>manage(),'42501');await reject(()=>manage('save',null,0,example()),'42501');await reject(()=>manage('archive',id,4),'42501');await reject(()=>manage('delete',id,4),'42501')}
 await login(ids.admin);eq((await suggest()).approvedCount,7);
 for(const role of ['operator','viewer','unconfirmed','outsider']){await login(ids[role]);await reject(()=>suggest(),'42501');await reject(()=>reference(id,'v1.r4'),'42501')}
 await db.exec('reset role');await db.query("insert into bruff_private.account_grants(workspace_id,user_id,creator_id,permission)values($1,$2,$3,'read')",[w,ids.operator,c]);await login(ids.operator);await reject(()=>suggest(),'42501');
 await db.exec('reset role');await db.query("insert into bruff_private.account_grants(workspace_id,user_id,creator_id,permission)values($1,$2,$3,'send')",[w,ids.operator,c]);await login(ids.operator);eq((await suggest()).rows.length,3);eq(await reference(id,'v1.r4'),{valid:true});await reject(()=>suggest('hello',otherC),'42501');
 await reject(()=>db.query('select * from bruff_private.chat_direct_examples'),'42501');await reject(()=>db.query("insert into bruff_private.chat_direct_examples default values"),'42501');
 await db.exec('reset role');await db.query("update bruff_private.memberships set status='disabled' where workspace_id=$1 and user_id=$2",[w,ids.operator]);await login(ids.operator);await reject(()=>suggest(),'42501');await reject(()=>reference(id,'v1.r4'),'42501');
 await db.exec('reset role;set role anon');await reject(()=>suggest(),'42501');await reject(()=>manage(),'42501');await reject(()=>reference(id,'v1.r4'),'42501');
 await login(ids.owner);await reject(()=>manage('delete',id,4),'22023');eq(await reference(id,'v1.r4'),{valid:true});
 // Fill only this in-memory model. All rows, including archived/draft examples,
 // count toward a maintainable bank; retrieval never scans an unbounded model.
 while((await manage()).total<200){const total=(await manage()).total;await manage('save',null,0,example({state:'draft',reviewed:false,referenceId:'capacity.'+total}))}
 const full=await manage();eq(full.items.length,200);eq(full.total,200);eq(full.complete,true);eq(full.limit,200);await reject(()=>manage('save',null,0,example({referenceId:'over-capacity'})),'23514');
 await db.exec('reset role');eq(await query('select count(*)::int as value from bruff_private.fans'),0);eq(await query('select count(*)::int as value from bruff_private.fan_notes'),0);
 eq(await query("select count(*)::int as value from bruff_private.team_audit where action like 'chat_direct_example_%'")>0,true);
 console.log(checks+' chat-direct knowledge database checks passed (in-memory fictional data only)');
}catch(error){console.error('Knowledge DB verification failed:',{code:error.code,message:error.message,where:error.where});process.exitCode=1}finally{await db.close()}
