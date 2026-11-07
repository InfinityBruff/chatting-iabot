// Actual SQL/RLS/leases with fictional in-memory data only. No network, fan
// request, provider credential, deployment, cron or real delivery is used.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
if(!process.argv[2])throw Error('Pass an installed PGlite module path.');
const {PGlite}=await import(pathToFileURL(process.argv[2]).href),db=new PGlite();let checks=0;
const w='00000000-0000-0000-0000-000000000001',w2='00000000-0000-0000-0000-000000000002',owner='10000000-0000-0000-0000-000000000001',worker='10000000-0000-0000-0000-000000000002',c='20000000-0000-0000-0000-000000000001',c2='20000000-0000-0000-0000-000000000002';
const hash='a'.repeat(64),eq=(a,b)=>{assert.deepEqual(a,b);checks++},ok=a=>{assert.ok(a);checks++};
const q=async(sql,args=[])=>(await db.query(sql,args)).rows[0]?.value;
const as=async(role,actor,action)=>{await db.exec('reset role');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[actor||'']);await db.exec('set role '+role);try{return await action()}finally{await db.exec('reset role')}};
const auth=action=>as('authenticated',owner,action),service=action=>as('service_role',null,action);
const reject=async(action,code)=>{await assert.rejects(action,error=>error.code===code);checks++};
const control=(op='read',expected=null,value=null,creator=c)=>auth(()=>q('select public.bruff_autopilot_control($1,$2,$3,$4,$5) as value',[w,creator,op,expected,value]));
const config=patch=>({enabled:true,mode:'automatic',fanScope:'all',fanIds:[],delaySeconds:10,maxRepliesPerFanDay:5,contextSharingConfirmed:true,automaticSendingConfirmed:true,...patch});
const job=(op,id=null,lease=null,value=null)=>service(()=>q('select public.bruff_autopilot_worker($1,$2,$3,$4) as value',[op,id,lease,value]));
const stamp=()=>q("select to_char((clock_timestamp()+interval '1 second') at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as value");
const event=async(patch={})=>({event_id:randomUUID(),account_id:'acct_fictional',fan_id:'123',message_id:'10',direction:'received',occurred_at:await stamp(),ingested_at:await stamp(),source:'ws',...patch});
const ingest=e=>service(()=>q('select public.bruff_ai_event_ingest($1) as value',[e]));
const due=()=>db.exec("update bruff_private.ai_autopilot_jobs set due_at=clock_timestamp()-interval '1 second' where state='queued'");
const payload=id=>({drafts:[{id:'1',english:'hello there',spanish:'hola',exampleIds:[id],knowledgeIds:[]}],unknowns:[]});
const pool=()=>auth(()=>q('select public.bruff_generation_pool($1,$2) as value',[w,c]));
const reserve=async item=>{const p=await job('pool',item.id,item.lease);return job('generation_claim',item.id,item.lease,{request_id:item.id,revision:p.revision,context_hash:hash})};
const begin=async(item,gen=item.id,isFromMe=false)=>job('begin',item.id,item.lease,{generationId:gen,draftId:'1',context_hash:hash,latest_message_id:item.anchorMessageId||'99',latest_is_from_me:isFromMe});
const manual=(req,gen,text='hello there',confirmed=true,fan='456')=>auth(()=>q('select public.bruff_queue_selected_reply($1,$2,$3,$4,$5,$6,$7,$8) as value',[w,c,fan,req,gen,'1',text,confirmed]));
try{
 await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email text,email_confirmed_at timestamptz);create function auth.uid()returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth to authenticated,service_role;");
 for(const name of ['202610300001_private_foundation','202610310003_team','202610310004_role_scopes','202610310005_team_names','202610310008_chat_safety','202610310009_bot_scope','202611010011_message_authorship','202611060040_chat_direct_knowledge','202611060041_ai_control','202611060042_ai_generation_knowledge','202611060043_ai_generation_budget','202611060044_ai_autopilot'])await db.exec(await readFile(new URL('../supabase/migrations/'+name+'.sql',import.meta.url),'utf8'));
 for(const [id,name]of [[owner,'owner'],[worker,'worker']])await db.query('insert into auth.users values($1,$2,now())',[id,name+'@example.test']);
 await db.query('insert into bruff_private.workspaces(id,name)values($1,$2),($3,$4)',[w,'Fictional A',w2,'Fictional B']);
 await db.query("insert into bruff_private.memberships(workspace_id,user_id,role,status,display_name)values($1,$2,'owner','active','Owner'),($1,$3,'operator','active','Worker')",[w,owner,worker]);
 await db.query("insert into bruff_private.creator_accounts(workspace_id,id,display_name,provider,external_id,connection_status)values($1,$2,'Fictional model','ofmapi','acct_fictional','connected'),($3,$4,'Foreign model','ofmapi','acct_foreign','connected')",[w,c,w2,c2]);
 const initial=await control();eq(initial.version,0);eq(initial.settings.enabled,false);eq(initial.settings.delaySeconds,20);eq(initial.settings.maxRepliesPerFanDay,5);eq(initial.effectiveEnabled,false);eq(await job('claim'),[]);
 eq((await ingest(await event())).reason,'disabled');eq(await q('select count(*)::integer as value from bruff_private.ai_autopilot_events'),0);
 await reject(()=>control('save',0,config()),'22023');
 await auth(()=>q("select public.bruff_generation_control($1,$2,'save',0,$3) as value",[w,c,{enabled:true,dailyLimit:100,maxResults:3}]));
 const example=(await auth(()=>q("select public.bruff_chat_direct_knowledge($1,$2,'save',null,0,$3) as value",[w,c,{trigger:'hello',english:'hello there',spanish:'hola',state:'verified',referenceId:'fictional.hello',label:'Fictional reviewed source',sourceVersion:'v1',reviewed:true}]))).savedId;
 for(const patch of [{enabled:'true'},{mode:null},{fanScope:null},{contextSharingConfirmed:false},{automaticSendingConfirmed:false},{delaySeconds:9},{delaySeconds:10.5},{maxRepliesPerFanDay:21},{fanScope:'selected',fanIds:[]},{fanIds:['1']},{extra:true}])await reject(()=>control('save',0,config(patch)),'22023');
 let cfg=await control('save',0,config());eq(cfg.version,1);eq(cfg.effectiveEnabled,true);eq(await q('select mode as value from bruff_private.bruff_settings where workspace_id=$1 and creator_id=$2',[w,c]),'all');
 await reject(()=>control('pause',0),'40001');
 const e=await event(),ingested=await ingest(e);eq(ingested.queued,true);ok(ingested.jobId);eq((await ingest(e)).reason,'duplicate');eq((await ingest(e)).jobId,undefined);eq((await ingest({...e,event_id:randomUUID()})).reason,'duplicate');await reject(()=>ingest({...e,fan_id:'456'}),'22023');
 for(const patch of [{text:'must not persist'},{actor:owner},{fan_id:'01'},{source:'untrusted'},{direction:null},{occurred_at:'invalid'}]){const invalid={...await event({message_id:'11'}),...patch};await reject(()=>ingest(invalid),'22023')}
 eq(await q('select count(*)::integer as value from bruff_private.ai_autopilot_jobs'),1);eq(await job('claim'),[]);eq(await job('claim',ingested.jobId),[]);await due();eq(await job('claim',randomUUID()),[]);const item=(await job('claim',ingested.jobId))[0];ok(item);eq(item.scope,{workspace:w,creator:c,fan:'123'});eq(item.kind,'automatic');eq(await job('check',item.id,item.lease),true);eq(await job('claim'),[]);
 const p=await job('pool',item.id,item.lease);eq(p.actorId,owner);eq(p.policy.mode,'automatic');eq(p.configVersion,1);eq((await reserve(item)).allowed,true);
 await reject(()=>job('generation_claim',item.id,item.lease,{request_id:randomUUID(),revision:p.revision,context_hash:hash}),'22023');
 const settled=await job('usage',item.id,item.lease,{input_tokens:1000,output_tokens:100});eq(settled.engineVersion,'bruff-autopilot-v1');eq(settled.usage.chargedNeurons,37);eq(await service(()=>q('select auth.uid() as value')),null);
 const result=await job('result',item.id,item.lease,{payload:payload(example)});eq(result.generationId,item.id);eq(result.engineVersion,'bruff-autopilot-v1');eq(result.aiVerified,false);
 const permit=await begin(item);eq(permit.allowed,true);eq(permit.payload,{text:'hello there',media:[],price:0,lockedText:false});eq(permit.idempotencyKey,'bruff-ai-auto-'+item.id);eq(permit.origin,'BRUFF IA');eq(await job('check',item.id,item.lease),true);await reject(()=>begin(item),'42501');
 const sent=await job('finish',item.id,item.lease,{status:'sent',providerId:'777'});eq(sent.status,'sent');eq((await job('finish',item.id,item.lease,{status:'uncertain'})).status,'sent');await reject(()=>job('finish',item.id,item.lease,{status:'sent',providerId:'778'}),'40001');await reject(()=>job('release',item.id,item.lease,{reason:'retry'}),'40001');
 const authors=await auth(()=>q('select public.bruff_message_authors($1,$2,$3,$4) as value',[w,c,'123',['777']]));ok(authors['777'].startsWith('BRUFF IA'));
 let activity=await control('activity');eq(activity.activity[0].drafts.length,1);eq(activity.activity[0].usage.chargedNeurons,37);eq(activity.activity[0].aiVerified,false);ok(!JSON.stringify(activity).includes('providerKey'));
 // Existing CRM switches and per-fan manual overrides stop work immediately.
 eq((await ingest(await event({message_id:'20'}))).queued,true);await due();const crm=(await job('claim'))[0];await db.query("update bruff_private.bruff_settings set mode='off' where workspace_id=$1 and creator_id=$2",[w,c]);eq(await job('check',crm.id,crm.lease),false);await reject(()=>job('pool',crm.id,crm.lease),'42501');
 cfg=await control('save',cfg.version,config({fanScope:'selected',fanIds:['123']}));eq(await q('select mode as value from bruff_private.bruff_chat_overrides where workspace_id=$1 and creator_id=$2 and fan_id=$3',[w,c,'123']),'enabled');
 await db.query("update bruff_private.bruff_chat_overrides set mode='manual' where workspace_id=$1 and creator_id=$2 and fan_id='123'",[w,c]);eq((await ingest(await event({message_id:'21'}))).reason,'disabled');
 cfg=await control('save',cfg.version,config());eq(await q("select mode as value from bruff_private.bruff_chat_overrides where workspace_id=$1 and creator_id=$2 and fan_id='123'",[w,c]),'manual');
 // A one-off owner selection is independent of the disabled autopilot.
 cfg=await control('pause',cfg.version);const manualGeneration=randomUUID(),source=await pool();
 eq((await auth(()=>q('select public.bruff_generation_claim_v2($1,$2,$3,$4,$5,$6,$7,$8) as value',[w,c,manualGeneration,'456',source.revision,hash,'bruff-drafts-v2',false]))).allowed,true);
 await service(()=>q('select public.bruff_generation_usage($1,$2,$3,$4,$5,$6) as value',[w,c,manualGeneration,owner,1000,100]));
 await service(()=>q('select public.bruff_generation_commit($1,$2,$3,$4,$5) as value',[w,c,manualGeneration,owner,payload(example)]));
 await reject(()=>manual(randomUUID(),manualGeneration,'changed text'),'40001');await reject(()=>manual(randomUUID(),manualGeneration,'hello there',false),'22023');
 const request=randomUUID(),queued=await manual(request,manualGeneration);eq(queued.newlyQueued,true);eq(queued.state,'queued');eq(queued.version,1);eq((await manual(request,manualGeneration)).newlyQueued,false);const duplicate=await manual(randomUUID(),manualGeneration);eq(duplicate.jobId,request);eq(duplicate.newlyQueued,false);
 const chosen=(await job('claim'))[0];eq(chosen.id,request);eq(chosen.kind,'manual');eq(chosen.canonical.engineVersion,'bruff-drafts-v2');eq(chosen.contextHash,hash);eq(await job('check',chosen.id,chosen.lease),true);const manualPermit=await begin(chosen,manualGeneration,true);eq(manualPermit.allowed,true);eq((await job('finish',chosen.id,chosen.lease,{status:'sent',providerId:'888'})).status,'sent');
 // Signed metadata invalidates a pending manual selection even while the
 // autopilot is off, independently of a lagging provider head response.
 await db.query("update bruff_private.generation_reservations set created_at=created_at-interval '61 seconds',usage_day=((created_at-interval '61 seconds') at time zone 'UTC')::date,expires_at=expires_at-interval '61 seconds'");
 const extraManuals=[];
 for(const fan of ['789','790']){
  const generation=randomUUID(),snapshot=await pool();eq((await auth(()=>q('select public.bruff_generation_claim_v2($1,$2,$3,$4,$5,$6,$7,$8) as value',[w,c,generation,fan,snapshot.revision,hash,'bruff-drafts-v2',false]))).allowed,true);
  await service(()=>q('select public.bruff_generation_usage($1,$2,$3,$4,$5,$6) as value',[w,c,generation,owner,1000,100]));await service(()=>q('select public.bruff_generation_commit($1,$2,$3,$4,$5) as value',[w,c,generation,owner,payload(example)]));
  const receipt=await manual(randomUUID(),generation,'hello there',true,fan),claim=(await job('claim',receipt.jobId))[0];extraManuals.push({generation,fan,claim});
 }
 eq((await ingest(await event({fan_id:'789',message_id:'104'}))).reason,'manual_context_changed');eq(await job('check',extraManuals[0].claim.id,extraManuals[0].claim.lease),false);await reject(()=>begin(extraManuals[0].claim,extraManuals[0].generation),'42501');await reject(()=>manual(randomUUID(),extraManuals[0].generation,'hello there',true,'789'),'40001');
 await job('release',extraManuals[1].claim.id,extraManuals[1].claim.lease,{reason:'send_disabled'});eq(await q('select state as value from bruff_private.ai_autopilot_jobs where id=$1',[extraManuals[1].claim.id]),'draft_ready');eq(await job('claim',extraManuals[1].claim.id),[]);
 // Ambiguous cross-agency bindings never broadcast events into either agency.
 await db.query("update bruff_private.creator_accounts set external_id='acct_fictional' where id=$1",[c2]);eq((await ingest(await event({fan_id:'999',message_id:'100'}))).reason,'binding_unavailable');await db.query("update bruff_private.creator_accounts set external_id='acct_foreign' where id=$1",[c2]);
 // A changed source invalidates prepared text; a CRM manual begin cancels only
 // preparation, preserving the immutable generation accounting for cleanup.
 await db.query("update bruff_private.generation_reservations set created_at=created_at-interval '61 seconds',usage_day=((created_at-interval '61 seconds') at time zone 'UTC')::date,expires_at=expires_at-interval '61 seconds'");
 cfg=await control('save',cfg.version,config());
 const changedEvent=await ingest(await event({fan_id:'321',message_id:'101'}));await due();const changed=(await job('claim',changedEvent.jobId))[0];eq((await reserve(changed)).allowed,true);await job('usage',changed.id,changed.lease,{input_tokens:1000,output_tokens:100});await job('result',changed.id,changed.lease,{payload:payload(example)});
 await auth(()=>q("select public.bruff_chat_direct_knowledge($1,$2,'save',$3,1,$4) as value",[w,c,example,{trigger:'hello',english:'hello there',spanish:'hola',state:'verified',referenceId:'fictional.hello',label:'Fictional reviewed source',sourceVersion:'v2',reviewed:true}]));eq(await job('check',changed.id,changed.lease),false);eq((await begin(changed)).allowed,false);await job('release',changed.id,changed.lease,{reason:'context_changed'});
 const takeoverEvent=await ingest(await event({fan_id:'333',message_id:'102'}));await due();const takeover=(await job('claim',takeoverEvent.jobId))[0];eq((await reserve(takeover)).allowed,true);await job('usage',takeover.id,takeover.lease,{input_tokens:1000,output_tokens:100});await job('result',takeover.id,takeover.lease,{payload:payload(example)});
 const manualAuthor=await auth(()=>q('select public.bruff_message_begin($1,$2,$3,$4) as value',[w,c,'333',randomUUID()]));eq(manualAuthor.name,'Owner');eq(await job('check',takeover.id,takeover.lease),false);await reject(()=>begin(takeover),'42501');eq((await job('usage',takeover.id,takeover.lease,{input_tokens:1000,output_tokens:100})).usage.chargedNeurons,37);
 await db.query("update bruff_private.bruff_settings set config='{"+'"kept":true'+"}'::jsonb where workspace_id=$1 and creator_id=$2",[w,c]);
 // Moderation pauses only the delegated engine and records an AI-labelled
 // incident. It never blocks the owner's manual account or initiates a send.
 await db.query("update bruff_private.generation_reservations set created_at=created_at-interval '61 seconds',usage_day=((created_at-interval '61 seconds') at time zone 'UTC')::date,expires_at=expires_at-interval '61 seconds'");
 const moderatedEvent=await ingest(await event({fan_id:'444',message_id:'103'}));await due();const moderated=(await job('claim',moderatedEvent.jobId))[0];eq((await reserve(moderated)).allowed,true);await job('usage',moderated.id,moderated.lease,{input_tokens:1000,output_tokens:100});const bad=payload(example);bad.drafts[0].english='Telegram';await job('result',moderated.id,moderated.lease,{payload:bad});eq((await begin(moderated)).reason,'moderation');cfg=await control();eq(cfg.settings.enabled,false);eq(await q('select count(*)::integer as value from bruff_private.chat_safety_blocks where workspace_id=$1 and user_id=$2',[w,owner]),0);eq(await q("select count(*)::integer as value from bruff_private.chat_safety_events where workspace_id=$1 and actor_name='BRUFF IA'",[w]),1);eq(await q('select config as value from bruff_private.bruff_settings where workspace_id=$1 and creator_id=$2',[w,c]),{kept:true});
 // Source changes, leases, owner revocation and connection changes fail closed.
 await db.query("update bruff_private.generation_reservations set created_at=created_at-interval '61 seconds',usage_day=((created_at-interval '61 seconds') at time zone 'UTC')::date,expires_at=expires_at-interval '61 seconds'");
 cfg=await control('save',cfg.version,config());await db.query("delete from bruff_private.bruff_chat_overrides where workspace_id=$1 and creator_id=$2 and fan_id='123'",[w,c]);
 eq((await ingest(await event({message_id:'30'}))).queued,true);await due();const revoked=(await job('claim'))[0];eq((await reserve(revoked)).allowed,true);await db.query("update bruff_private.memberships set status='disabled' where workspace_id=$1 and user_id=$2",[w,owner]);eq(await job('check',revoked.id,revoked.lease),false);eq((await job('usage',revoked.id,revoked.lease,{input_tokens:1000,output_tokens:100})).usage.chargedNeurons,37);await reject(()=>job('result',revoked.id,revoked.lease,{payload:payload(example)}),'42501');await reject(()=>control(),'42501');
 eq((await job('finish',revoked.id,revoked.lease,{status:'uncertain'})).status,'uncertain');await reject(()=>control('review_uncertain',1,{jobId:revoked.id,reviewNote:'Cannot review while revoked.'}),'42501');await db.query("update bruff_private.memberships set status='active' where workspace_id=$1 and user_id=$2",[w,owner]);eq((await control()).effectiveEnabled,false);await reject(()=>control('save',cfg.version,config()),'22023');
 // Review acknowledges uncertainty without inventing delivery evidence. It
 // stays terminal and requires a separate, fresh owner activation for new work.
 const jobVersion=await q('select version::integer as value from bruff_private.ai_autopilot_jobs where id=$1',[revoked.id]);
 for(const value of [{jobId:revoked.id,reviewNote:''},{jobId:revoked.id,reviewNote:'x'.repeat(501)},{jobId:revoked.id,reviewNote:'control\ntext'},{jobId:revoked.id,reviewNote:'A note',state:'sent'},{jobId:'bad',reviewNote:'A note'}])await reject(()=>control('review_uncertain',jobVersion,value),'22023');
 await reject(()=>control('review_uncertain',jobVersion-1,{jobId:revoked.id,reviewNote:'Stale review'}),'40001');await reject(()=>control('review_uncertain',jobVersion,{jobId:randomUUID(),reviewNote:'A different scope'}),'42501');await reject(()=>control('review_uncertain',jobVersion,{jobId:revoked.id,reviewNote:'Wrong model'},c2),'42501');
 // More than one activity page must not hide the exact acknowledged receipt.
 for(let n=0;n<55;n++){
  const ev=await q("insert into bruff_private.ai_autopilot_events(workspace_id,creator_id,binding,event_id,fan_id,message_id,direction,occurred_at,ingested_at,source,fingerprint) values($1,$2,'acct_fictional',$3,'999',$4,'received',clock_timestamp(),clock_timestamp(),'ws','fixture') returning id as value",[w,c,randomUUID(),String(1000+n)]);
  await db.query("insert into bruff_private.ai_autopilot_jobs(event_id,workspace_id,creator_id,owner_id,config_version,binding,fan_id,anchor_message_id,state,due_at,created_at) values($1,$2,$3,$4,1,'acct_fictional','999',$5,'skipped',clock_timestamp(),clock_timestamp()+interval '2 seconds')",[ev,w,c,owner,String(1000+n)]);
 }
 eq((await control('activity')).activity.some(row=>row.id===revoked.id),false);
 const beforeReview=await control(),note='  Reviewed uncertainty; do not retry this reply. 🙂  ',reviewed=await control('review_uncertain',jobVersion,{jobId:revoked.id,reviewNote:note});
 eq(reviewed.settings.enabled,false);eq(reviewed.effectiveEnabled,false);eq(reviewed.version,beforeReview.version+1);eq(reviewed.activity.length,50);eq(reviewed.activity[0].id,revoked.id);
 const reviewedRow=reviewed.activity[0];eq(reviewedRow.state,'uncertain');eq(reviewedRow.providerId,null);eq(reviewedRow.version,jobVersion+1);eq(reviewedRow.uncertainReviewedBy,owner);eq(reviewedRow.uncertainReviewNote,note);ok(Number.isFinite(Date.parse(reviewedRow.uncertainReviewedAt)));eq(reviewedRow.selectedDraftId,null);eq(await q('select mode as value from bruff_private.bruff_settings where workspace_id=$1 and creator_id=$2',[w,c]),'off');
 await reject(()=>control('review_uncertain',jobVersion,{jobId:revoked.id,reviewNote:note}),'40001');await reject(()=>control('review_uncertain',jobVersion+1,{jobId:revoked.id,reviewNote:note}),'40001');eq(await job('claim',revoked.id),[]);eq((await ingest(await event({message_id:'31'}))).reason,'disabled');
 cfg=await control('save',reviewed.version,config());eq(cfg.settings.enabled,true);eq(cfg.effectiveEnabled,true);eq(await job('claim',revoked.id),[]);const future=await ingest(await event({message_id:'32'}));eq(future.queued,true);ok(future.jobId!==revoked.id);await due();const futureJob=(await job('claim',future.jobId))[0];eq(futureJob.id,future.jobId);await job('release',futureJob.id,futureJob.lease,{reason:'needs_review'});eq(await q('select state as value from bruff_private.ai_autopilot_jobs where id=$1',[revoked.id]),'uncertain');
 await reject(()=>as('authenticated',worker,()=>q('select public.bruff_autopilot_control($1,$2) as value',[w,c])),'42501');await reject(()=>auth(()=>q('select public.bruff_autopilot_worker($1) as value',['claim'])),'42501');await reject(()=>auth(()=>q('select public.bruff_ai_event_ingest($1) as value',[e])),'42501');await reject(()=>service(()=>q('select public.bruff_autopilot_control($1,$2) as value',[w,c])),'42501');
 for(const table of ['ai_autopilot_configs','ai_autopilot_events','ai_autopilot_jobs']){await reject(()=>auth(()=>db.query('select * from bruff_private.'+table)),'42501');await reject(()=>service(()=>db.query('select * from bruff_private.'+table)),'42501')}
 eq(await service(()=>q('select auth.uid() as value')),null);eq(await q("select count(*)::integer as value from bruff_private.schema_versions where version='202611060044_ai_autopilot'"),1);
 console.log(JSON.stringify({checks,realNetworkCalls:0,realFanSends:0,database:'fictional in-memory PGlite',result:'passed'}));
}catch(error){console.error('Autopilot SQL verification failed:',{code:error.code,message:error.message,where:error.where,position:error.position,internalPosition:error.internalPosition,stack:error.stack});process.exitCode=1}finally{await db.close()}
