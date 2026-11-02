import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {newAutoMessage,autoMessagePayload} from '../src/auto-messages.js';
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0;
const q=async(sql,params=[])=>(await db.query(sql,params)).rows[0]?.value;
const eq=(a,b)=>{assert.deepEqual(a,b);checks++};
const reject=async(action)=>{await assert.rejects(action);checks++};
const w='00000000-0000-0000-0000-000000000001',other='00000000-0000-0000-0000-000000000002',owner='10000000-0000-0000-0000-000000000001',manager='10000000-0000-0000-0000-000000000002',worker='10000000-0000-0000-0000-000000000003';
const models=[1,2,3].map(n=>'20000000-0000-0000-0000-00000000000'+n),foreign='20000000-0000-0000-0000-000000000004';
const login=async id=>{await db.exec(`reset role;select set_config('request.jwt.claim.sub','${id}',false);set role authenticated`)};
const rpc=(model,op='list',id=null,version=null,value=null,workspace=w)=>q('select public.bruff_auto_message_drafts($1,$2,$3,$4,$5,$6) as value',[workspace,model,op,id,version,value]);
try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated;");
 for(const name of ['202610300001_private_foundation','202610310002_membership_rpc','202610310003_team','202610310004_role_scopes','202611020016_auto_message_drafts','202611020017_mass_message_drafts','202611020018_fan_custom_names','202611020019_advanced_delivery_queue'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await db.exec(`insert into auth.users values('${owner}','o@example.test',now()),('${manager}','m@example.test',now()),('${worker}','c@example.test',now());insert into bruff_private.workspaces(id,name) values('${w}','Prueba A'),('${other}','Prueba B');insert into bruff_private.memberships(workspace_id,user_id,role,status) values('${w}','${owner}','owner','active'),('${w}','${manager}','admin','active'),('${w}','${worker}','operator','active');`);
 for(const [i,m]of models.entries())await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[w,m,'Modelo '+i]);
 await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[other,foreign,'Modelo ajena']);await login(owner);


 const draft=newAutoMessage('mass');draft.name='Prueba cola';draft.messages[0].text='Hola';const saved=await rpc(models[0],'save',null,null,autoMessagePayload(draft));
 await db.exec('reset role');await db.query("update bruff_private.creator_accounts set provider='ofmapi',external_id='acct_test',connection_status='connected' where id=$1",[models[0]]);
 const run=(await db.query("insert into bruff_private.advanced_runs(workspace_id,creator_id,draft_id,draft_version,activated_by,ends_at)values($1,$2,$3,1,$4,now()+interval '1 day')returning id",[w,models[0],saved.savedId,owner])).rows[0].id;
 const delivery=(await db.query("insert into bruff_private.advanced_deliveries(run_id,fan_id,step_index,due_at)values($1,'123',0,now()) returning id",[run])).rows[0].id;
 const call=(op,lease=null,revision=null,value=null)=>q('select public.bruff_advanced_delivery($1,$2,$3,$4,$5) as value',[op,delivery,lease,revision,value]);
 await db.exec('set role service_role');eq(await call('claim'),null);
 await db.exec('reset role');await db.query("update bruff_private.advanced_runs set state='active',activated_at=now() where id=$1",[run]);await db.exec('set role service_role');
 const claim=await call('claim');eq(claim.scope,{workspace:w,creator:models[0],fan:'123'});eq(await call('claim'),null);eq(await call('authorize',claim.lease,claim.revision),true);
 eq(await call('begin','00000000-0000-0000-0000-000000000000',1,{}),false);
 await db.exec('reset role');await db.query("update bruff_private.advanced_runs set state='paused',revision=revision+1 where id=$1",[run]);await db.exec('set role service_role');eq(await call('begin',claim.lease,claim.revision,{}),false);
 await db.exec('reset role');await db.query("update bruff_private.advanced_runs set state='active' where id=$1",[run]);await db.query("update bruff_private.advanced_deliveries set lease_until=now()-interval '1 second' where id=$1",[delivery]);await db.exec('set role service_role');
 const next=await call('claim');eq(next.revision,2);eq(await call('authorize',claim.lease,claim.revision),false);
 const payload={text:'Hola',media:[],price:0,lockedText:false};eq(await call('begin',next.lease,next.revision,payload),true);eq(await call('begin',next.lease,next.revision,payload),false);eq(await call('release',next.lease,next.revision,{}),false);eq(await call('claim'),null);
 eq(await call('finish',next.lease,next.revision,{status:'uncertain'}),true);eq(await call('claim'),null);

 await db.exec('reset role');await db.query("update bruff_private.advanced_deliveries set state='pending',lease=null,lease_until=null where id=$1",[delivery]);await db.query("update bruff_private.memberships set status='disabled' where user_id=$1",[owner]);await db.exec('set role service_role');eq(await call('claim'),null);
 await db.exec('reset role');await db.query("update bruff_private.memberships set status='active' where user_id=$1",[owner]);await db.query('update bruff_private.auto_message_drafts set version=version+1 where id=$1',[saved.savedId]);await db.exec('set role service_role');eq(await call('claim'),null);
 await db.exec('reset role');await login(owner);await reject(()=>call('claim'));await reject(()=>db.query('select * from bruff_private.advanced_deliveries'));
 await db.exec('reset role;set role anon');await reject(()=>call('claim'));
 console.log(checks+' durable queue checks passed');
}finally{await db.close()}
