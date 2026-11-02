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
 for(const name of ['202610300001_private_foundation','202610310002_membership_rpc','202610310003_team','202610310004_role_scopes','202611020016_auto_message_drafts','202611020017_mass_message_drafts','202611020018_fan_custom_names'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await db.exec(`insert into auth.users values('${owner}','o@example.test',now()),('${manager}','m@example.test',now()),('${worker}','c@example.test',now());insert into bruff_private.workspaces(id,name) values('${w}','Prueba A'),('${other}','Prueba B');insert into bruff_private.memberships(workspace_id,user_id,role,status) values('${w}','${owner}','owner','active'),('${w}','${manager}','admin','active'),('${w}','${worker}','operator','active');`);
 for(const [i,m]of models.entries())await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[w,m,'Modelo '+i]);
 await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[other,foreign,'Modelo ajena']);await login(owner);

 const names=(model,fan=null,value=null,expected=null,space=w)=>q('select public.bruff_fan_names($1,$2,$3,$4,$5) as value',[space,model,fan,value,expected]);
 eq((await names(models[0])).rows,[]);
 const saved=await names(models[0],'123','Johnny Smith',0);eq(saved.name,'Johnny Smith');eq(saved.version,1);
 eq((await names(models[1],'123')).rows,[]);eq((await names(models[0],'456')).rows,[]);
 await reject(()=>names(foreign,'123',null,null,other));await reject(()=>names(models[0],'123','Other',0));
 await names(models[0],'123','',1);eq((await names(models[0],'123')).rows[0].name,'');
 await login(worker);await reject(()=>names(models[0]));
 await db.exec('reset role');await db.query('insert into bruff_private.account_grants(workspace_id,user_id,creator_id,permission)values($1,$2,$3,$4)',[w,worker,models[0],'read']);await login(worker);
 eq((await names(models[0])).rows.length,1);await reject(()=>names(models[0],'123','Name',2));
 await db.exec('reset role');await db.query('insert into bruff_private.account_grants(workspace_id,user_id,creator_id,permission)values($1,$2,$3,$4)',[w,worker,models[0],'send']);await login(worker);eq((await names(models[0],'123','New',2)).version,3);
 await db.exec('reset role');await db.query("update bruff_private.memberships set status='disabled' where user_id=$1",[worker]);await login(worker);await reject(()=>names(models[0]));await reject(()=>names(models[0],'123','Gone',3));
 console.log(checks+' custom-name database checks passed');
}finally{await db.close()}
