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
 for(const name of ['202610300001_private_foundation','202610310002_membership_rpc','202610310003_team','202610310004_role_scopes','202611020016_auto_message_drafts'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await db.exec(`insert into auth.users values('${owner}','o@example.test',now()),('${manager}','m@example.test',now()),('${worker}','c@example.test',now());insert into bruff_private.workspaces(id,name) values('${w}','Prueba A'),('${other}','Prueba B');insert into bruff_private.memberships(workspace_id,user_id,role,status) values('${w}','${owner}','owner','active'),('${w}','${manager}','admin','active'),('${w}','${worker}','operator','active');`);
 for(const [i,m]of models.entries())await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[w,m,'Modelo '+i]);
 await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[other,foreign,'Modelo ajena']);await login(owner);
 const ids=[];
 for(const [i,m]of models.entries()){
  eq((await rpc(m)).rows.length,0);
  const d=newAutoMessage(['welcome','online','expired'][i]);d.name='Modelo '+i;d.messages[0].text='Hola de prueba';
  const r=await rpc(m,'save',null,null,autoMessagePayload(d));ids.push(r.savedId);eq(r.rows.length,1);eq(r.rows[0].status,'draft');eq(r.rows[0].version,1);
 }
 await reject(()=>rpc(models[1],'archive',ids[0],1));await reject(()=>rpc(foreign));await reject(()=>rpc(foreign,'list',null,null,null,other));
 await reject(()=>rpc(models[0],'activate',ids[0],1));await reject(()=>rpc(models[0],'send',ids[0],1));
 let r=await rpc(models[0],'archive',ids[0],1);eq(r.rows[0].archived,true);await reject(()=>rpc(models[0],'restore',ids[0],1));r=await rpc(models[0],'restore',ids[0],2);eq(r.rows[0].archived,false);
 await login(manager);eq((await rpc(models[0])).rows[0].id,ids[0]);let d=(await rpc(models[0])).rows[0];d.messages[0].text='Edición compartida';r=await rpc(models[0],'save',d.id,d.version,autoMessagePayload(d));eq(r.rows[0].updatedBy,manager);eq(r.rows[0].version,4);
 await db.exec(`reset role;update bruff_private.memberships set role='operator' where user_id='${manager}';set role authenticated`);await reject(()=>rpc(models[0]));
 await login(worker);await reject(()=>rpc(models[0]));await login(owner);await db.exec(`reset role;update bruff_private.memberships set status='disabled' where user_id='${owner}';set role authenticated`);await reject(()=>rpc(models[0]));
 await db.exec(`reset role;update bruff_private.memberships set status='active' where user_id='${owner}';set role authenticated`);
 const bad=autoMessagePayload(d);bad.messages[0].media=[{id:'1',type:'photo',slot:'free',token:'SECRET',preview:'https://private.example'}];bad.status='active';r=await rpc(models[0],'save',d.id,4,bad);eq(r.rows[0].status,'draft');eq(r.rows[0].messages[0].media[0].token,undefined);eq(r.rows[0].messages[0].media[0].preview,undefined);
 await reject(()=>rpc(models[0],'save',null,null,{schemaVersion:1}));await reject(()=>db.exec('select * from bruff_private.auto_message_drafts'));
 await db.exec('reset role');eq(await q("select has_function_privilege('anon','public.bruff_auto_message_drafts(uuid,uuid,text,uuid,bigint,jsonb)','execute') as value"),false);
 eq(await q("select to_regclass('bruff_private.automations') is null as value"),true);
 console.log(`${checks} PostgreSQL checks passed: three models, agency isolation, live revocation, version conflicts, draft-only operations and no sender dependency.`);
}finally{await db.close()}
