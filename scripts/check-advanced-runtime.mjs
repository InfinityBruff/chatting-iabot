import {runAdvancedTick} from '../server/advanced-worker.js';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {newAutoMessage,autoMessagePayload} from '../src/auto-messages.js';
import {advancedStore} from '../server/advanced-store.js';
import {deliverAdvanced} from '../server/advanced-delivery.js';
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
 for(const name of ['202610300001_private_foundation','202610310002_membership_rpc','202610310003_team','202610310004_role_scopes','202610310005_team_names','202610310006_live_read','202610310007_live_send_vault','202610310008_chat_safety','202611010011_message_authorship','202611020016_auto_message_drafts','202611020017_mass_message_drafts','202611020018_fan_custom_names','202611020019_advanced_delivery_queue','202611020020_audience_checkpoints','202611020021_advanced_run_controls','202611020022_mass_execution_preparation','202611020023_advanced_mass_runtime','202611020024_transport_authorization','202611020025_native_mass','202611020026_native_mass_recovery','202611020027_native_queue','202611020028_scheduler_safe_update','202611020029_mass_drain_cycles'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 await db.exec(`insert into auth.users values('${owner}','o@example.test',now()),('${manager}','m@example.test',now()),('${worker}','c@example.test',now());insert into bruff_private.workspaces(id,name) values('${w}','Prueba A'),('${other}','Prueba B');insert into bruff_private.memberships(workspace_id,user_id,role,status) values('${w}','${owner}','owner','active'),('${w}','${manager}','admin','active'),('${w}','${worker}','operator','active');`);
 for(const [i,m]of models.entries())await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[w,m,'Modelo '+i]);
 await db.query('insert into bruff_private.creator_accounts(workspace_id,id,display_name)values($1,$2,$3)',[other,foreign,'Modelo ajena']);await login(owner);
 await db.exec('reset role');eq(await q('select approved as value from bruff_private.advanced_runtime'),false);
 await db.exec('set role service_role');await reject(()=>q("select public.bruff_advanced_poll('wrong',true) as value"));
 const draft=newAutoMessage('mass');draft.name='Runtime fixture';draft.messages[0].text='Hola';
 await login(owner);const saved=await rpc(models[0],'save',null,null,autoMessagePayload(draft));
 await db.exec('reset role');await db.query("update bruff_private.creator_accounts set provider='ofmapi',external_id='acct_test',connection_status='connected' where id=$1",[models[0]]);
 const plan={startAt:new Date().toISOString(),endsAt:new Date(Date.now()+86400000).toISOString(),cycles:1,intervalMs:null,missedPolicy:'skip'};
 await db.exec('set role service_role');
 const prepared=await q('select public.bruff_prepare_mass($1,$2,$3,1,$4,$5,$6,$7) as value',[w,models[0],saved.savedId,owner,'acct_test',['123'],plan]);eq(prepared.state,'paused');
 const activate=()=>q('select public.bruff_activate_mass($1,$2,$3,1) as value',[w,models[0],prepared.id]);
 await login(owner);await reject(activate);eq((await q('select public.bruff_mass_status($1,$2,$3) as value',[w,models[0],prepared.id])).canActivate,false);
 await db.exec('reset role');eq(await q('select count(*)::int as value from bruff_private.advanced_deliveries'),0);
 const token='local-fixture-secret-not-for-production-123456';await db.query('update bruff_private.advanced_runtime set approved=true,secret_hash=md5($1)',[token]);
 await db.exec('set role service_role');const poll=enabled=>q('select public.bruff_advanced_poll($1,$2) as value',[token,enabled]);eq((await poll(false)).ready,false);await poll(true);
 await login(owner);eq((await activate()).state,'active');
 await db.exec('set role service_role');eq((await poll(true)).deliveries.length,1);eq((await poll(true)).deliveries.length,1);
 await db.exec('reset role');eq(await q('select count(*)::int as value from bruff_private.advanced_deliveries'),1);
 await db.query("update bruff_private.creator_accounts set external_id='changed' where id=$1",[models[0]]);await db.exec('set role service_role');eq((await poll(true)).deliveries.length,0);
 // Re-preparing an activated run cannot replace recipients or reset its revision.
 await db.exec('set role service_role');const repeated=await q('select public.bruff_prepare_mass($1,$2,$3,1,$4,$5,$6,$7) as value',[w,models[0],saved.savedId,owner,'changed',['456'],plan]);eq(repeated.prepared,false);
 await db.exec('reset role');eq(await q('select audience_ids as value from bruff_private.advanced_runs where id=$1',[prepared.id]),['123']);
 // Exercise durable reservation, moderation and authorship without a provider.
 await db.exec('reset role');await db.query("update bruff_private.creator_accounts set external_id='acct_test' where id=$1",[models[0]]);
 await db.exec('set role service_role');const item=(await poll(true)).deliveries[0];
 const execute=(op,lease=null,revision=null,value=null)=>q('select public.bruff_advanced_execute($1,$2,$3,$4,$5) as value',[op,item.id,lease,revision,value]);
 const claim=await execute('claim');eq(claim.scope,{workspace:w,creator:models[0],fan:'123'});
 eq(await execute('claim'),null);
 eq(await execute('begin',claim.lease,claim.revision,{text:'Hola',media:[],price:0,lockedText:false}),true);
 eq(await q('select public.bruff_advanced_transport_authorize($1,$2,$3) as value',[item.id,claim.lease,claim.revision]),true);
 eq(await q('select public.bruff_advanced_transport_authorize($1,$2,$3) as value',[item.id,claim.lease,claim.revision+1]),false);
 eq(await execute('finish',claim.lease,claim.revision,{status:'sent',providerId:'999'}),true);
 await db.exec('reset role');eq(await q('select actor_id::text as value from bruff_private.message_authorship where request_id=$1',[item.id]),owner);
 eq(await q('select message_id as value from bruff_private.message_authorship where request_id=$1',[item.id]),'999');
 await login(worker);await reject(()=>q('select public.bruff_activate_mass($1,$2,$3,1) as value',[w,models[0],prepared.id]));
 await reject(()=>execute('claim'));
 await login(owner);await reject(()=>q('select public.bruff_activate_mass($1,$2,$3,1) as value',[other,foreign,prepared.id]));
 // Full durable SQL worker with an entirely fictitious HTTP provider.
 await db.exec('reset role');await db.query("insert into bruff_private.advanced_deliveries(run_id,fan_id,cycle,step_index,due_at) values($1,'456',0,0,now())",[prepared.id]);
 await db.exec('set role service_role');let simulatedWrites=0;
 const tick=await runAdvancedTick({token,writeEnabled:true,providerKey:'fixture',rpc:async(name,args)=>{
  const fields={bruff_advanced_poll:['token','can_send'],bruff_advanced_execute:['op','delivery_id','lease_id','expected_revision','value'],bruff_advanced_context:['op','delivery_id','lease_id','expected_revision','body'],bruff_advanced_transport_authorize:['delivery_id','lease_id','expected_revision']}[name];
  if(!fields)throw Error('Unexpected RPC');return q('select public.'+name+'('+fields.map((_,i)=>String.fromCharCode(36)+(i+1)).join(',')+') as value',fields.map(k=>args[k]??null));
 },fetcher:async(url,options)=>{if(options.method==='POST'){simulatedWrites++;return new Response(JSON.stringify({id:'888'}))}return new Response(JSON.stringify({id:456,name:'John Smith'}))}});
 eq(tick.results,['sent']);eq(simulatedWrites,1);
 await db.exec('reset role');eq(await q("select message_id as value from bruff_private.message_authorship where fan_id='456'"),'888');

 await db.exec('set role service_role');
 const ncall=(op,run_id=null,expected_revision=null,value=null,who=owner)=>q('select public.bruff_native_mass($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10) as value',[w,models[0],who,op,run_id,saved.savedId,'acct_test',['123'],expected_revision,value]);
 const native=await ncall('prepare');eq(native.state,'prepared');
 await login(owner);eq((await q('select public.bruff_native_status($1,$2,$3) as value',[w,models[0],native.id])).canActivate,true);
 await db.exec('set role service_role');await reject(()=>ncall('begin',native.id,1,{},worker));
 eq(await ncall('begin',native.id,1,{text:'Hola'}),true);eq(await ncall('begin',native.id,1,{}),false);
 eq((await ncall('finish',native.id,1,{state:'accepted',queueId:'777'})).state,'accepted');
 await reject(()=>ncall('context',native.id,1));eq((await ncall('prepare')).state,'accepted');
 await login(owner);eq((await q('select public.bruff_native_for_draft($1,$2,$3) as value',[w,models[0],saved.savedId])).state,'accepted');
 await db.exec('set role service_role');
 const queue=(op,who=owner,model=models[0],value=null)=>q('select public.bruff_native_queue($1,$2,$3,$4,$5,$6) as value',[w,model,who,native.id,op,value]);
 eq((await queue('context')).queueId,'777');eq(await queue('authorize'),'acct_test');
 await reject(()=>queue('context',worker));await reject(()=>queue('context',owner,models[1]));await reject(()=>queue('cancel_context',manager));
 eq((await queue('cancel_context')).id,native.id);
 eq(await queue('record',owner,models[0],{state:'cancelled',queueId:'777'}),true);
 await reject(()=>queue('record',owner,models[0],{state:'cancelled',queueId:'999'}));
 await login(owner);await reject(()=>queue('context'));
 // Slow personalized campaign: crossing every interval and planned end must not drop fans.
 await db.exec('reset role');
 await db.query("update bruff_private.auto_message_drafts set config=jsonb_set(jsonb_set(config,'{bulk,repeat}','true'),'{bulk,endMode}','\"runs\"') where id=$1",[saved.savedId]);
 await db.query("update bruff_private.advanced_runs set state='active',last_cycle=0,activated_at=now()-interval '4 hours',ends_at=now()-interval '1 hour',execution_plan=jsonb_build_object('cycles',3,'intervalMs',3600000,'missedPolicy','drain') where id=$1",[prepared.id]);
 await db.query("insert into bruff_private.advanced_deliveries(run_id,fan_id,cycle,step_index,due_at) select $1,x::text,0,0,now()-interval '3 hours' from generate_series(900,911)x",[prepared.id]);
 await db.exec('set role service_role');
 const drainPoll=()=>q('select public.bruff_advanced_poll($1,true) as value',[token]);
 eq((await drainPoll()).deliveries.length,4);
 await db.exec('reset role');
 eq(await q("select count(*)::int as value from bruff_private.advanced_deliveries where run_id=$1 and state='pending'",[prepared.id]),12);
 eq(await q('select last_cycle as value from bruff_private.advanced_runs where id=$1',[prepared.id]),0);
 eq(await q("select count(*)::int as value from bruff_private.advanced_deliveries where run_id=$1 and state='blocked'",[prepared.id]),0);
 for(const cycle of [1,2]){
  await db.query("update bruff_private.advanced_deliveries set state='sent' where run_id=$1 and state='pending'",[prepared.id]);
  await db.exec('set role service_role');await drainPoll();await db.exec('reset role');
  eq(await q('select last_cycle as value from bruff_private.advanced_runs where id=$1',[prepared.id]),cycle);
  eq(await q('select count(*)::int as value from bruff_private.advanced_deliveries where run_id=$1 and cycle=$2',[prepared.id,cycle]),1);
 }
 await db.query("update bruff_private.advanced_deliveries set state='sent' where run_id=$1 and state='pending'",[prepared.id]);
 await db.exec('set role service_role');await drainPoll();await db.exec('reset role');
 eq(await q('select state as value from bruff_private.advanced_runs where id=$1',[prepared.id]),'completed');
 console.log(checks+' runtime schema checks passed; no provider calls');
}finally{await db.close()}
