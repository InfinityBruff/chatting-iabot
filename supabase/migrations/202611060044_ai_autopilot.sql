-- Dormant, non-explicit AI delegation. No cron, webhook subscription, runtime
-- credential, provider request or enabled configuration is installed here.
begin;
alter table bruff_private.generation_reservations drop constraint generation_reservations_engine_version_check;
alter table bruff_private.generation_reservations add constraint generation_reservations_engine_version_check check(engine_version in ('legacy-v1','bruff-drafts-v2','bruff-autopilot-v1'));
create table bruff_private.ai_autopilot_configs(
 workspace_id uuid not null,creator_id uuid not null,version bigint not null default 1 check(version>0),
 owner_id uuid not null,binding text,settings jsonb not null,activated_at timestamptz,updated_at timestamptz not null default now(),
 primary key(workspace_id,creator_id),foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 foreign key(workspace_id,owner_id) references bruff_private.memberships(workspace_id,user_id)
);
create table bruff_private.ai_autopilot_events(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,creator_id uuid not null,binding text not null,
 event_id uuid not null,fan_id text not null,message_id text not null,direction text not null check(direction in ('received','sent')),
 occurred_at timestamptz not null,ingested_at timestamptz not null,received_at timestamptz not null default clock_timestamp(),
 source text not null check(source in ('ws','reconcile')),fingerprint text not null,
 unique(binding,event_id),unique(workspace_id,creator_id,fan_id,message_id,direction),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id)
);
create table bruff_private.ai_autopilot_jobs(
 id uuid primary key default gen_random_uuid(),event_id uuid unique references bruff_private.ai_autopilot_events(id),kind text not null default 'automatic' check(kind in ('automatic','manual')),version bigint not null default 1 check(version>0),draft_id text check(draft_id in ('1','2','3')),
 workspace_id uuid not null,creator_id uuid not null,owner_id uuid not null,config_version bigint not null,binding text not null,
 fan_id text not null,anchor_message_id text,state text not null default 'queued'
 check(state in ('queued','claimed','generating','ready','draft_ready','sending','sent','skipped','blocked','uncertain')),
 due_at timestamptz not null,created_at timestamptz not null default clock_timestamp(),expires_at timestamptz not null default clock_timestamp()+interval '1 hour',
 lease uuid,lease_until timestamptz,generation_id uuid,context_hash text,source_revision text,payload jsonb,payload_hash text,
 attempted_at timestamptz,provider_id text,detail text,updated_at timestamptz not null default now(),
 uncertain_reviewed_at timestamptz,uncertain_reviewed_by uuid references auth.users(id),uncertain_review_note text,
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 foreign key(workspace_id,owner_id) references bruff_private.memberships(workspace_id,user_id),
 check(fan_id ~ '^[1-9][0-9]{0,23}$' and (anchor_message_id is null or anchor_message_id ~ '^[1-9][0-9]{0,23}$')),
 check((kind='manual' and event_id is null and draft_id is not null) or (kind='automatic' and event_id is not null and anchor_message_id is not null)),
 check(provider_id is null or provider_id ~ '^[1-9][0-9]{0,23}$'),
 check(context_hash is null or context_hash ~ '^[0-9a-f]{64}$'),check(source_revision is null or source_revision ~ '^[0-9a-f]{32}$'),
 check(payload is null or octet_length(payload::text)<=16384),unique(workspace_id,creator_id,fan_id,provider_id)
 ,check((uncertain_reviewed_at is null and uncertain_reviewed_by is null and uncertain_review_note is null) or (uncertain_reviewed_at is not null and uncertain_reviewed_by is not null and length(btrim(uncertain_review_note)) between 1 and 500 and uncertain_review_note !~ '[[:cntrl:]]'))
);
create index ai_autopilot_due on bruff_private.ai_autopilot_jobs(state,due_at);
create index ai_autopilot_fan on bruff_private.ai_autopilot_jobs(workspace_id,creator_id,fan_id,created_at desc);
create unique index ai_selected_reply_once on bruff_private.ai_autopilot_jobs(owner_id,workspace_id,creator_id,fan_id,generation_id,draft_id) where kind='manual';
create function bruff_private.ai_job_version() returns trigger language plpgsql set search_path='' as $$begin new.version=old.version+1;return new;end$$;
create trigger ai_job_version before update on bruff_private.ai_autopilot_jobs for each row execute function bruff_private.ai_job_version();
alter table bruff_private.ai_autopilot_configs enable row level security;
alter table bruff_private.ai_autopilot_events enable row level security;
alter table bruff_private.ai_autopilot_jobs enable row level security;
revoke all on bruff_private.ai_autopilot_configs,bruff_private.ai_autopilot_events,bruff_private.ai_autopilot_jobs from public,anon,authenticated,service_role;

create function bruff_private.ai_autopilot_defaults() returns jsonb language sql immutable set search_path='' as $$
 select '{"enabled":false,"mode":"drafts","fanScope":"selected","fanIds":[],"delaySeconds":20,"maxRepliesPerFanDay":5,"contextSharingConfirmed":false,"automaticSendingConfirmed":false}'::jsonb
$$;
create function bruff_private.ai_autopilot_allowed(cfg bruff_private.ai_autopilot_configs) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(cfg.settings->'enabled'='true'::jsonb and cfg.settings->'contextSharingConfirmed'='true'::jsonb
 and (cfg.settings->>'mode'='drafts' or cfg.settings->'automaticSendingConfirmed'='true'::jsonb)
 and exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=cfg.workspace_id and m.user_id=cfg.owner_id and m.role='owner' and m.status='active' and u.email_confirmed_at is not null)
 and bruff_private.generation_actor_allowed(cfg.workspace_id,cfg.creator_id,cfg.owner_id)
 and exists(select 1 from bruff_private.creator_accounts a where a.workspace_id=cfg.workspace_id and a.id=cfg.creator_id and a.provider='ofmapi' and a.connection_status='connected' and a.external_id=cfg.binding)
 and exists(select 1 from bruff_private.generation_settings s where s.workspace_id=cfg.workspace_id and s.creator_id=cfg.creator_id and s.settings->'enabled'='true'::jsonb)
 and exists(select 1 from bruff_private.bruff_settings s where s.workspace_id=cfg.workspace_id and s.creator_id=cfg.creator_id and s.mode<>'off' and (cfg.settings->>'mode'='drafts' or not s.review_required))
 and not exists(select 1 from bruff_private.ai_autopilot_jobs j where j.workspace_id=cfg.workspace_id and j.creator_id=cfg.creator_id and j.state='uncertain' and j.uncertain_reviewed_at is null),false)
$$;
create function bruff_private.ai_autopilot_fan_allowed(cfg bruff_private.ai_autopilot_configs,fan text) returns boolean
language sql stable security definer set search_path='' as $$
 select bruff_private.ai_autopilot_allowed(cfg)
 and not exists(select 1 from bruff_private.bruff_chat_overrides o where o.workspace_id=cfg.workspace_id and o.creator_id=cfg.creator_id and o.fan_id=fan and o.mode='manual')
 and (cfg.settings->>'fanScope'='all' or cfg.settings->'fanIds' @> jsonb_build_array(fan))
 and exists(select 1 from bruff_private.bruff_settings s where s.workspace_id=cfg.workspace_id and s.creator_id=cfg.creator_id and (s.mode='all' or s.mode='selected' and exists(select 1 from bruff_private.bruff_chat_overrides o where o.workspace_id=s.workspace_id and o.creator_id=s.creator_id and o.fan_id=fan and o.mode='enabled')))
$$;
create function bruff_private.ai_manual_job_allowed(j bruff_private.ai_autopilot_jobs) returns boolean
language sql stable security definer set search_path='' as $$
 select j.kind='manual' and exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=j.workspace_id and m.user_id=j.owner_id and m.role='owner' and m.status='active' and u.email_confirmed_at is not null)
 and bruff_private.generation_actor_allowed(j.workspace_id,j.creator_id,j.owner_id)
 and exists(select 1 from bruff_private.creator_accounts a where a.workspace_id=j.workspace_id and a.id=j.creator_id and a.provider='ofmapi' and a.connection_status='connected' and a.external_id=j.binding)
 and not exists(select 1 from bruff_private.ai_autopilot_jobs other where other.workspace_id=j.workspace_id and other.creator_id=j.creator_id and other.fan_id=j.fan_id and other.state='uncertain' and other.uncertain_reviewed_at is null)
$$;
create function public.bruff_autopilot_control(w uuid,c uuid,op text default 'read',expected bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg bruff_private.ai_autopilot_configs;v jsonb:=value;binding_now text;items jsonb;fan_value jsonb;review_job bruff_private.ai_autopilot_jobs;
begin
 perform bruff_private.require_owner(w);
 if not bruff_private.can_access(w,c,'settings') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op is null or op not in ('read','save','pause','activity','review_uncertain') then raise exception 'Operación no válida' using errcode='22023';end if;
 select * into cfg from bruff_private.ai_autopilot_configs where workspace_id=w and creator_id=c for update;
 if op in ('read','activity') then
  if expected is not null or value is not null then raise exception 'Consulta no válida' using errcode='22023';end if;
 elsif op='review_uncertain' then
  if v is null or jsonb_typeof(v)<>'object' or not(v ?& array['jobId','reviewNote']) or (v-'jobId'-'reviewNote')<>'{}'::jsonb
   or jsonb_typeof(v->'jobId') is distinct from 'string' or v->>'jobId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(v->'reviewNote') is distinct from 'string' or length(v->>'reviewNote')>500 or length(btrim(v->>'reviewNote'))<1 or v->>'reviewNote' ~ '[[:cntrl:]]'
  then raise exception 'Revisión no válida' using errcode='22023';end if;
  select * into review_job from bruff_private.ai_autopilot_jobs where id=(v->>'jobId')::uuid and workspace_id=w and creator_id=c for update;
  if not found then raise exception 'Trabajo no disponible en esta modelo' using errcode='42501';end if;
  if expected is distinct from review_job.version or review_job.state<>'uncertain' or review_job.uncertain_reviewed_at is not null then raise exception 'La revisión cambió o ya fue realizada' using errcode='40001';end if;
  -- This records acknowledgement, never a claim that delivery failed or that
  -- it succeeded. The original job stays terminal and is never re-enqueued.
  update bruff_private.ai_autopilot_jobs set uncertain_reviewed_at=clock_timestamp(),uncertain_reviewed_by=auth.uid(),uncertain_review_note=v->>'reviewNote',updated_at=now() where id=review_job.id;
  insert into bruff_private.ai_autopilot_configs(workspace_id,creator_id,owner_id,binding,settings)
   values(w,c,auth.uid(),null,jsonb_set(coalesce(cfg.settings,bruff_private.ai_autopilot_defaults()),'{enabled}','false'::jsonb))
   on conflict(workspace_id,creator_id) do update set settings=jsonb_set(bruff_private.ai_autopilot_configs.settings,'{enabled}','false'::jsonb),version=bruff_private.ai_autopilot_configs.version+1,activated_at=null,updated_at=now() returning * into cfg;
  insert into bruff_private.bruff_settings(workspace_id,creator_id,mode) values(w,c,'off') on conflict(workspace_id,creator_id) do update set mode='off',version=bruff_private.bruff_settings.version+1;
  update bruff_private.ai_autopilot_jobs set state='blocked',detail='Delegación pausada tras revisión de entrega incierta',updated_at=now() where workspace_id=w and creator_id=c and kind='automatic' and state in ('queued','claimed','generating','ready');
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'ai_autopilot_uncertain_reviewed',review_job.id);
 else
  if expected is distinct from coalesce(cfg.version,0) then raise exception 'La delegación cambió' using errcode='40001';end if;
  if op='pause' then
   if value is not null then raise exception 'Pausa no válida' using errcode='22023';end if;
   v=jsonb_set(coalesce(cfg.settings,bruff_private.ai_autopilot_defaults()),'{enabled}','false'::jsonb);
  end if;
  if v is null or jsonb_typeof(v)<>'object' or not(v ?& array['enabled','mode','fanScope','fanIds','delaySeconds','maxRepliesPerFanDay','contextSharingConfirmed','automaticSendingConfirmed'])
   or (v-'enabled'-'mode'-'fanScope'-'fanIds'-'delaySeconds'-'maxRepliesPerFanDay'-'contextSharingConfirmed'-'automaticSendingConfirmed')<>'{}'::jsonb
   or jsonb_typeof(v->'enabled') is distinct from 'boolean' or jsonb_typeof(v->'contextSharingConfirmed') is distinct from 'boolean' or jsonb_typeof(v->'automaticSendingConfirmed') is distinct from 'boolean'
   or jsonb_typeof(v->'mode') is distinct from 'string' or v->>'mode' not in ('drafts','automatic') or jsonb_typeof(v->'fanScope') is distinct from 'string' or v->>'fanScope' not in ('all','selected') or jsonb_typeof(v->'fanIds') is distinct from 'array' or jsonb_array_length(v->'fanIds')>500
   or jsonb_typeof(v->'delaySeconds') is distinct from 'number' or jsonb_typeof(v->'maxRepliesPerFanDay') is distinct from 'number'
  then raise exception 'Configuración no válida' using errcode='22023';end if;
  if (v->>'delaySeconds')::numeric not between 10 and 120 or (v->>'delaySeconds')::numeric<>trunc((v->>'delaySeconds')::numeric)
   or (v->>'maxRepliesPerFanDay')::numeric not between 1 and 20 or (v->>'maxRepliesPerFanDay')::numeric<>trunc((v->>'maxRepliesPerFanDay')::numeric)
   or exists(select 1 from jsonb_array_elements(v->'fanIds') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[1-9][0-9]{0,23}$')
   or (select count(*)<>count(distinct x) from jsonb_array_elements(v->'fanIds') x)
   or v->>'fanScope'='all' and jsonb_array_length(v->'fanIds')<>0
  then raise exception 'Límites o fans no válidos' using errcode='22023';end if;
  select external_id into binding_now from bruff_private.creator_accounts where workspace_id=w and id=c and provider='ofmapi' and connection_status='connected';
  if v->'enabled'='true'::jsonb and (v->'contextSharingConfirmed'<>'true'::jsonb or v->>'mode'='automatic' and v->'automaticSendingConfirmed'<>'true'::jsonb
   or v->>'fanScope'='selected' and jsonb_array_length(v->'fanIds')=0 or binding_now is null
   or not exists(select 1 from bruff_private.generation_settings s where s.workspace_id=w and s.creator_id=c and s.settings->'enabled'='true'::jsonb)
   or exists(select 1 from bruff_private.ai_autopilot_jobs where workspace_id=w and creator_id=c and state='uncertain' and uncertain_reviewed_at is null))
  then raise exception 'Revisa consentimiento, motor, conexión y entregas inciertas antes de activar' using errcode='22023';end if;
  insert into bruff_private.ai_autopilot_configs(workspace_id,creator_id,owner_id,binding,settings,activated_at)
   values(w,c,auth.uid(),binding_now,v,case when v->'enabled'='true'::jsonb then clock_timestamp() end)
  on conflict(workspace_id,creator_id) do update set version=bruff_private.ai_autopilot_configs.version+1,owner_id=auth.uid(),binding=excluded.binding,settings=excluded.settings,activated_at=excluded.activated_at,updated_at=now() returning * into cfg;
  insert into bruff_private.bruff_settings(workspace_id,creator_id,mode,review_required) values(w,c,case when v->'enabled'='true'::jsonb then v->>'fanScope' else 'off' end,v->>'mode'='drafts')
   on conflict(workspace_id,creator_id) do update set mode=excluded.mode,review_required=excluded.review_required,version=bruff_private.bruff_settings.version+1;
  if v->'enabled'='true'::jsonb and v->>'fanScope'='selected' then
   for fan_value in select * from jsonb_array_elements(v->'fanIds') loop
    insert into bruff_private.fans(workspace_id,creator_id,id,display_name) values(w,c,fan_value#>>'{}','Fan '||(fan_value#>>'{}')) on conflict do nothing;
    insert into bruff_private.bruff_chat_overrides(workspace_id,creator_id,fan_id,mode) values(w,c,fan_value#>>'{}','enabled') on conflict(workspace_id,creator_id,fan_id) do update set mode='enabled';
   end loop;
  end if;
  update bruff_private.ai_autopilot_jobs set state='blocked',detail='Delegación pausada o modificada',updated_at=now()
   where workspace_id=w and creator_id=c and kind='automatic' and state in ('queued','claimed','generating','ready');
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'ai_autopilot_'||op,c);
 end if;
 select coalesce(jsonb_agg(x order by case when op='review_uncertain' and x->>'id'=v->>'jobId' then 0 else 1 end,x->>'createdAt' desc),'[]'::jsonb) into items from(
  select jsonb_build_object('id',j.id,'kind',j.kind,'version',j.version,'fanId',j.fan_id,'anchorMessageId',j.anchor_message_id,'state',j.state,'createdAt',j.created_at,'dueAt',j.due_at,'providerId',j.provider_id,'detail',j.detail,'generationId',j.generation_id,'selectedDraftId',j.draft_id,'engineVersion',r.engine_version,'aiGenerated',true,'aiVerified',false,'drafts',coalesce(r.payload->'drafts','[]'::jsonb),'unknowns',coalesce(r.payload->'unknowns','[]'::jsonb),'usage',case when r.request_id is not null then bruff_private.generation_usage_json(r) else null end,'uncertainReviewedAt',j.uncertain_reviewed_at,'uncertainReviewedBy',j.uncertain_reviewed_by,'uncertainReviewNote',j.uncertain_review_note) x
  from bruff_private.ai_autopilot_jobs j left join bruff_private.generation_reservations r on r.request_id=j.generation_id where j.workspace_id=w and j.creator_id=c order by case when op='review_uncertain' and j.id=(v->>'jobId')::uuid then 0 else 1 end,j.created_at desc,j.id limit 50) rows;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'settings',coalesce(cfg.settings,bruff_private.ai_autopilot_defaults()),'version',coalesce(cfg.version,0),'effectiveEnabled',bruff_private.ai_autopilot_allowed(cfg),'activity',case when op in ('activity','review_uncertain') then items else '[]'::jsonb end);
end $$;

create function public.bruff_ai_event_ingest(event jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e jsonb:=event;a bruff_private.creator_accounts;cfg bruff_private.ai_autopilot_configs;old bruff_private.ai_autopilot_events;eid uuid;new_job uuid;occurred timestamptz;ingested timestamptz;fingerprint text;n integer;auto_allowed boolean;manual_pending boolean;
begin
 if e is null or jsonb_typeof(e)<>'object' or not(e ?& array['event_id','account_id','fan_id','message_id','direction','occurred_at','ingested_at','source'])
  or (e-'event_id'-'account_id'-'fan_id'-'message_id'-'direction'-'occurred_at'-'ingested_at'-'source')<>'{}'::jsonb
  or jsonb_typeof(e->'event_id') is distinct from 'string' or e->>'event_id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  or jsonb_typeof(e->'account_id') is distinct from 'string' or length(e->>'account_id')>128 or e->>'account_id' !~ '^acct_[A-Za-z0-9_-]+$'
  or jsonb_typeof(e->'fan_id') is distinct from 'string' or e->>'fan_id' !~ '^[1-9][0-9]{0,23}$' or jsonb_typeof(e->'message_id') is distinct from 'string' or e->>'message_id' !~ '^[1-9][0-9]{0,23}$'
  or jsonb_typeof(e->'direction') is distinct from 'string' or e->>'direction' not in ('received','sent') or jsonb_typeof(e->'source') is distinct from 'string' or e->>'source' not in ('ws','reconcile')
  or jsonb_typeof(e->'occurred_at') is distinct from 'string' or jsonb_typeof(e->'ingested_at') is distinct from 'string'
  or e->>'occurred_at' !~ '^\d{4}-\d{2}-\d{2}T.*Z$' or e->>'ingested_at' !~ '^\d{4}-\d{2}-\d{2}T.*Z$'
 then raise exception 'Evento no válido' using errcode='22023';end if;
 begin occurred=(e->>'occurred_at')::timestamptz;ingested=(e->>'ingested_at')::timestamptz;exception when others then raise exception 'Fecha de evento no válida' using errcode='22023';end;
 if occurred>clock_timestamp()+interval '5 minutes' or ingested>clock_timestamp()+interval '5 minutes' then raise exception 'Evento futuro no válido' using errcode='22023';end if;
 select count(*) into n from bruff_private.creator_accounts where provider='ofmapi' and connection_status='connected' and external_id=e->>'account_id';
 if n<>1 then return jsonb_build_object('accepted',true,'queued',false,'reason','binding_unavailable');end if;
 select * into a from bruff_private.creator_accounts where provider='ofmapi' and connection_status='connected' and external_id=e->>'account_id';
 perform 1 from bruff_private.workspaces where id=a.workspace_id for update;
 select * into cfg from bruff_private.ai_autopilot_configs where workspace_id=a.workspace_id and creator_id=a.id for update;
 auto_allowed=bruff_private.ai_autopilot_fan_allowed(cfg,e->>'fan_id');
 select exists(select 1 from bruff_private.ai_autopilot_jobs j where j.workspace_id=a.workspace_id and j.creator_id=a.id and j.fan_id=e->>'fan_id' and j.kind='manual' and j.state in ('queued','claimed','ready','sending') and bruff_private.ai_manual_job_allowed(j)) into manual_pending;
 if not auto_allowed and not manual_pending then return jsonb_build_object('accepted',true,'queued',false,'reason','disabled');end if;
 fingerprint=md5(jsonb_build_array(e->>'account_id',e->>'fan_id',e->>'message_id',e->>'direction',occurred)::text);
 select * into old from bruff_private.ai_autopilot_events where binding=e->>'account_id' and event_id=(e->>'event_id')::uuid;
 if found then
  if old.fingerprint<>fingerprint then raise exception 'Identificador de evento contradictorio' using errcode='22023';end if;
  return jsonb_build_object('accepted',true,'queued',false,'reason','duplicate');
 end if;
 insert into bruff_private.ai_autopilot_events(workspace_id,creator_id,binding,event_id,fan_id,message_id,direction,occurred_at,ingested_at,source,fingerprint)
 values(a.workspace_id,a.id,e->>'account_id',(e->>'event_id')::uuid,e->>'fan_id',e->>'message_id',e->>'direction',occurred,ingested,e->>'source',fingerprint)
 on conflict do nothing returning id into eid;
 if eid is null then return jsonb_build_object('accepted',true,'queued',false,'reason','duplicate');end if;
 if e->>'direction'='sent' then
  update bruff_private.ai_autopilot_jobs set state='skipped',detail='Salida observada; intervención o respuesta ya realizada',updated_at=now()
   where workspace_id=a.workspace_id and creator_id=a.id and fan_id=e->>'fan_id' and state in ('queued','claimed','generating','ready');
  return jsonb_build_object('accepted',true,'queued',false,'reason','outgoing');
 end if;
 if manual_pending then update bruff_private.ai_autopilot_jobs set state='skipped',detail='Mensaje recibido después de la selección manual',updated_at=now() where workspace_id=a.workspace_id and creator_id=a.id and fan_id=e->>'fan_id' and kind='manual' and state in ('queued','claimed','ready');end if;
 if not auto_allowed then return jsonb_build_object('accepted',true,'queued',false,'reason','manual_context_changed');end if;
 if occurred<cfg.activated_at or cfg.settings->>'fanScope'='selected' and not(cfg.settings->'fanIds' @> jsonb_build_array(e->>'fan_id'))
  or exists(select 1 from bruff_private.ai_autopilot_events x where x.workspace_id=a.workspace_id and x.creator_id=a.id and x.fan_id=e->>'fan_id' and x.id<>eid and (x.occurred_at>occurred or x.occurred_at=occurred and x.message_id::numeric>(e->>'message_id')::numeric))
 then return jsonb_build_object('accepted',true,'queued',false,'reason','not_current');end if;
 update bruff_private.ai_autopilot_jobs set state='skipped',detail='Mensaje recibido más reciente',updated_at=now()
  where workspace_id=a.workspace_id and creator_id=a.id and fan_id=e->>'fan_id' and state in ('queued','claimed','generating','ready');
 insert into bruff_private.ai_autopilot_jobs(event_id,workspace_id,creator_id,owner_id,config_version,binding,fan_id,anchor_message_id,due_at)
 values(eid,a.workspace_id,a.id,cfg.owner_id,cfg.version,cfg.binding,e->>'fan_id',e->>'message_id',clock_timestamp()+make_interval(secs=>(cfg.settings->>'delaySeconds')::integer)) returning id into new_job;
 return jsonb_build_object('accepted',true,'queued',true,'reason','queued','jobId',new_job);
end $$;

create function public.bruff_queue_selected_reply(w uuid,c uuid,fan text,request_id uuid,generation_id uuid,draft_id text,expected_english text,confirmed boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bruff_private.generation_reservations;j bruff_private.ai_autopilot_jobs;selected jsonb;binding_now text;req uuid:=request_id;gen uuid:=generation_id;draft text:=draft_id;target_fan text:=fan;created boolean:=false;
begin
 perform bruff_private.require_owner(w);
 if not bruff_private.generation_actor_allowed(w,c,auth.uid()) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if req is null or gen is null or target_fan is null or target_fan !~ '^[1-9][0-9]{0,23}$' or draft not in ('1','2','3') or draft is null or confirmed is distinct from true or expected_english is null or length(expected_english) not between 1 and 700 then raise exception 'Selección no válida' using errcode='22023';end if;
 select external_id into binding_now from bruff_private.creator_accounts where workspace_id=w and id=c and provider='ofmapi' and connection_status='connected';
 if binding_now is null then raise exception 'Conexión no vigente' using errcode='42501';end if;
 select * into r from bruff_private.generation_reservations where workspace_id=w and creator_id=c and generation_reservations.request_id=gen and actor_id=auth.uid() and fan_id=target_fan;
 if not found or r.engine_version<>'bruff-drafts-v2' or r.payload is null or r.expires_at<=clock_timestamp() or r.revision<>bruff_private.generation_snapshot(w,c)->>'revision' then raise exception 'Borrador o contexto no vigente' using errcode='40001';end if;
 if exists(select 1 from bruff_private.ai_autopilot_events e where e.workspace_id=w and e.creator_id=c and e.fan_id=target_fan and e.received_at>r.created_at) then raise exception 'Hay actividad posterior al borrador' using errcode='40001';end if;
 select x into selected from jsonb_array_elements(r.payload->'drafts') x where x->>'id'=draft;
 if selected is null or selected->>'english' is distinct from expected_english then raise exception 'El texto seleccionado cambió' using errcode='40001';end if;
 select * into j from bruff_private.ai_autopilot_jobs where id=req;
 if found and (j.kind<>'manual' or j.owner_id<>auth.uid() or j.workspace_id<>w or j.creator_id<>c or j.fan_id<>target_fan or j.generation_id<>gen or j.draft_id<>draft) then raise exception 'Petición ajena' using errcode='42501';end if;
 if not found then select * into j from bruff_private.ai_autopilot_jobs where kind='manual' and workspace_id=w and creator_id=c and owner_id=auth.uid() and fan_id=target_fan and ai_autopilot_jobs.generation_id=gen and ai_autopilot_jobs.draft_id=draft;end if;
 if j.id is null then
  if exists(select 1 from bruff_private.ai_autopilot_jobs where workspace_id=w and creator_id=c and fan_id=target_fan and (state='sending' or state='uncertain' and uncertain_reviewed_at is null)) then raise exception 'Hay una entrega pendiente de confirmar' using errcode='40001';end if;
  update bruff_private.ai_autopilot_jobs set state='skipped',detail='Respuesta elegida por el propietario',updated_at=now() where workspace_id=w and creator_id=c and fan_id=target_fan and kind='automatic' and state in ('queued','claimed','generating','ready');
  insert into bruff_private.ai_autopilot_jobs(id,kind,workspace_id,creator_id,owner_id,config_version,binding,fan_id,due_at,expires_at,generation_id,context_hash,source_revision,draft_id,payload,payload_hash)
   values(req,'manual',w,c,auth.uid(),0,binding_now,target_fan,clock_timestamp(),r.expires_at,gen,r.context_hash,r.revision,draft,jsonb_build_object('text',expected_english,'media','[]'::jsonb,'price',0,'lockedText',false),md5(expected_english)) returning * into j;
  created=true;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'ai_selected_reply_queued',j.id);
 end if;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'fanId',target_fan,'generationId',gen,'draftId',draft,'requestId',req,'jobId',j.id,'state',j.state,'version',j.version,'newlyQueued',created);
end $$;

create function public.bruff_autopilot_worker(op text,job_id uuid default null,lease_id uuid default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j bruff_private.ai_autopilot_jobs;cfg bruff_private.ai_autopilot_configs;candidate uuid;cfg_snapshot jsonb;result jsonb;v jsonb:=value;r bruff_private.generation_reservations;moment timestamptz;day_key date;used bigint;first_at timestamptz;wait_seconds integer;text_body text;hits jsonb;incident uuid;actor_name text;draft jsonb;
begin
 if op is null or op not in ('claim','check','pool','generation_claim','usage','result','begin','finish','release') then raise exception 'Operación no válida' using errcode='22023';end if;
 if op='claim' then
  if lease_id is not null or value is not null then raise exception 'Reserva no válida' using errcode='22023';end if;
  update bruff_private.ai_autopilot_jobs set state='uncertain',detail='Envío iniciado sin confirmación; no se reintenta',updated_at=now() where state='sending' and lease_until<=clock_timestamp();
  for candidate in select id from bruff_private.ai_autopilot_jobs where (job_id is null or id=job_id) and state in ('queued','claimed','generating','ready') and due_at<=clock_timestamp() and (lease_until is null or lease_until<=clock_timestamp()) order by due_at,id limit 20 loop
   select * into j from bruff_private.ai_autopilot_jobs where id=candidate;
   perform 1 from bruff_private.workspaces where id=j.workspace_id for update;
   select * into cfg from bruff_private.ai_autopilot_configs where workspace_id=j.workspace_id and creator_id=j.creator_id for update;
   select * into j from bruff_private.ai_autopilot_jobs where id=candidate for update skip locked;
   if not found then continue;end if;
   if j.state not in ('queued','claimed','generating','ready') or j.lease_until>clock_timestamp() then continue;end if;
   if (j.kind='manual' and not bruff_private.ai_manual_job_allowed(j)) or (j.kind='automatic' and (not bruff_private.ai_autopilot_fan_allowed(cfg,j.fan_id) or cfg.version<>j.config_version or cfg.owner_id<>j.owner_id or cfg.binding<>j.binding)) or j.expires_at<=clock_timestamp() then
    update bruff_private.ai_autopilot_jobs set state='blocked',detail='Delegación, conexión o vigencia no autorizada',lease=null,lease_until=null where id=j.id;continue;
   end if;
   update bruff_private.ai_autopilot_jobs set state='claimed',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '90 seconds',updated_at=now() where id=j.id returning * into j;
   return jsonb_build_array(jsonb_build_object('id',j.id,'kind',j.kind,'lease',j.lease,'scope',jsonb_build_object('workspace',j.workspace_id,'creator',j.creator_id,'fan',j.fan_id),'binding',j.binding,'configVersion',j.config_version,'anchorMessageId',j.anchor_message_id,'notBefore',j.due_at,'mode',case when j.kind='manual' then 'manual' else cfg.settings->>'mode' end,'generationId',j.generation_id,'draftId',j.draft_id,'contextHash',j.context_hash,'sourceRevision',j.source_revision,'canonical',case when j.kind='manual' then (select bruff_private.generation_record_json(canonical_row) from bruff_private.generation_reservations canonical_row where canonical_row.request_id=j.generation_id and canonical_row.actor_id=j.owner_id) else null end));
  end loop;return '[]'::jsonb;
 end if;
 select * into j from bruff_private.ai_autopilot_jobs where id=job_id;
 if not found then raise exception 'Trabajo no disponible' using errcode='42501';end if;
 -- Keep the shared generation lock order: actor, global budget, workspace.
 if op in ('generation_claim','usage') then perform pg_advisory_xact_lock(hashtextextended('bruff.generation.actor:'||j.owner_id::text,0));perform pg_advisory_xact_lock(hashtextextended('bruff.generation.global.daily',0));end if;
 perform 1 from bruff_private.workspaces where id=j.workspace_id for update;
 select * into cfg from bruff_private.ai_autopilot_configs where workspace_id=j.workspace_id and creator_id=j.creator_id for update;
 select * into j from bruff_private.ai_autopilot_jobs where id=job_id for update;
 if j.lease is distinct from lease_id or lease_id is null then raise exception 'Reserva ajena' using errcode='42501';end if;
 if op='finish' then
  if v is null or jsonb_typeof(v)<>'object' or (v-'status'-'providerId')<>'{}'::jsonb or jsonb_typeof(v->'status') is distinct from 'string' or v->>'status' not in ('sent','uncertain') or v->>'status'='sent' and (jsonb_typeof(v->'providerId') is distinct from 'string' or v->>'providerId' !~ '^[1-9][0-9]{0,23}$') then raise exception 'Confirmación no válida' using errcode='22023';end if;
  if j.state='sent' then
   if v ? 'providerId' and v->>'providerId'<>j.provider_id then raise exception 'Confirmación contradictoria' using errcode='40001';end if;
  elsif j.state in ('sending','uncertain') or v->>'status'='uncertain' and j.state in ('claimed','generating','ready') then
   update bruff_private.ai_autopilot_jobs set state=v->>'status',provider_id=case when v->>'status'='sent' then v->>'providerId' end,detail=case when v->>'status'='uncertain' then 'Resultado sin confirmar; requiere revisión' end,updated_at=now() where id=j.id returning * into j;
   if j.state='sent' then perform public.bruff_message_finish(j.workspace_id,j.creator_id,j.fan_id,j.id,j.owner_id,j.provider_id);end if;
  else raise exception 'No se inició una entrega' using errcode='40001';end if;
  return jsonb_build_object('id',j.id,'status',j.state,'providerId',j.provider_id,'scope',jsonb_build_object('workspace',j.workspace_id,'creator',j.creator_id,'fan',j.fan_id));
 end if;
 if op='usage' then
  if j.kind<>'automatic' or j.generation_id is null or v is null or jsonb_typeof(v)<>'object' or not(v ?& array['input_tokens','output_tokens']) or (v-'input_tokens'-'output_tokens')<>'{}'::jsonb then raise exception 'Consumo no válido' using errcode='22023';end if;
  if jsonb_typeof(v->'input_tokens') not in ('number','null') or jsonb_typeof(v->'output_tokens') not in ('number','null')
   or jsonb_typeof(v->'input_tokens')='number' and ((v->>'input_tokens')::numeric<>trunc((v->>'input_tokens')::numeric) or (v->>'input_tokens')::numeric not between 1 and 1000000)
   or jsonb_typeof(v->'output_tokens')='number' and ((v->>'output_tokens')::numeric<>trunc((v->>'output_tokens')::numeric) or (v->>'output_tokens')::numeric not between 0 and 1000000) then raise exception 'Consumo no válido' using errcode='22023';end if;
  return public.bruff_generation_usage(j.workspace_id,j.creator_id,j.generation_id,j.owner_id,(v->>'input_tokens')::bigint,(v->>'output_tokens')::bigint);
 end if;
 if op='release' then
  if j.state in ('sending','sent','uncertain') then raise exception 'Entrega iniciada; no se libera para reenvío' using errcode='40001';end if;
  if v is null or jsonb_typeof(v)<>'object' or (v-'reason'-'retryAfter')<>'{}'::jsonb or jsonb_typeof(v->'reason') is distinct from 'string' or length(v->>'reason') not between 1 and 120 then raise exception 'Liberación no válida' using errcode='22023';end if;
  if v ? 'retryAfter' and (jsonb_typeof(v->'retryAfter')<>'number' or (v->>'retryAfter')::numeric not between 1 and 86400 or (v->>'retryAfter')::numeric<>trunc((v->>'retryAfter')::numeric)) then raise exception 'Espera no válida' using errcode='22023';end if;
  update bruff_private.ai_autopilot_jobs set state=case when v->>'reason'='send_disabled' and generation_id is not null then 'draft_ready' when v ? 'retryAfter' and generation_id is null and bruff_private.ai_autopilot_allowed(cfg) and cfg.version=j.config_version then 'queued' else 'blocked' end,due_at=case when v ? 'retryAfter' then clock_timestamp()+make_interval(secs=>(v->>'retryAfter')::integer) else due_at end,detail=v->>'reason',lease=null,lease_until=null,updated_at=now() where id=j.id;return 'true'::jsonb;
 end if;
 if (j.kind='manual' and not bruff_private.ai_manual_job_allowed(j)) or (j.kind='automatic' and (not bruff_private.ai_autopilot_fan_allowed(cfg,j.fan_id) or cfg.version<>j.config_version or cfg.owner_id<>j.owner_id or cfg.binding<>j.binding)) or j.lease_until<=clock_timestamp() or j.expires_at<=clock_timestamp() or (j.state not in ('claimed','generating','ready') and not(op='check' and j.state='sending')) then
  if op='check' then return 'false'::jsonb;end if;raise exception 'Delegación o reserva no vigente' using errcode='42501';
 end if;
 if op='check' then
  if value is not null then raise exception 'Consulta no válida' using errcode='22023';end if;
  if j.generation_id is not null then
   select * into r from bruff_private.generation_reservations where request_id=j.generation_id;
   if not found or r.actor_id<>j.owner_id or r.workspace_id<>j.workspace_id or r.creator_id<>j.creator_id or r.fan_id<>j.fan_id or r.context_hash is distinct from j.context_hash or r.expires_at<=clock_timestamp() or r.revision is distinct from bruff_private.generation_snapshot(j.workspace_id,j.creator_id)->>'revision' then return 'false'::jsonb;end if;
  end if;
  return 'true'::jsonb;
 end if;
 cfg_snapshot=bruff_private.generation_snapshot(j.workspace_id,j.creator_id);
 if op='pool' then
  if value is not null then raise exception 'Consulta no válida' using errcode='22023';end if;
  return cfg_snapshot||jsonb_build_object('actorId',j.owner_id,'workspaceId',j.workspace_id,'creatorId',j.creator_id,'policy',cfg.settings,'configVersion',cfg.version);
 end if;
 if op='generation_claim' then
  if j.kind<>'automatic' or v is null or jsonb_typeof(v)<>'object' or not(v ?& array['request_id','revision','context_hash']) or (v-'request_id'-'revision'-'context_hash')<>'{}'::jsonb or jsonb_typeof(v->'request_id') is distinct from 'string' or jsonb_typeof(v->'revision') is distinct from 'string' or jsonb_typeof(v->'context_hash') is distinct from 'string' or v->>'request_id'<>j.id::text or v->>'revision' !~ '^[0-9a-f]{32}$' or v->>'context_hash' !~ '^[0-9a-f]{64}$' then raise exception 'Reserva generativa no válida' using errcode='22023';end if;
  result=jsonb_build_object('actorId',j.owner_id,'workspaceId',j.workspace_id,'creatorId',j.creator_id);
  if cfg_snapshot->>'revision'<>v->>'revision' or (cfg_snapshot->>'approvedCount')::integer<1 then return result||jsonb_build_object('allowed',false,'reason','revision_changed');end if;
  select * into r from bruff_private.generation_reservations where request_id=j.id;
  if found then
   if r.actor_id=j.owner_id and r.workspace_id=j.workspace_id and r.creator_id=j.creator_id and r.fan_id=j.fan_id and r.context_hash=v->>'context_hash' and r.revision=v->>'revision' and r.engine_version='bruff-autopilot-v1' and r.payload is not null and r.expires_at>clock_timestamp() then return result||jsonb_build_object('allowed',false,'reason','cached','cached',bruff_private.generation_record_json(r));end if;
   return result||jsonb_build_object('allowed',false,'reason','duplicate');
  end if;
  moment=clock_timestamp();day_key=(moment at time zone 'UTC')::date;wait_seconds=greatest(1,ceil(extract(epoch from(((day_key+1)::timestamp at time zone 'UTC')-moment)))::integer);
  select count(*) into used from bruff_private.ai_autopilot_jobs where workspace_id=j.workspace_id and creator_id=j.creator_id and fan_id=j.fan_id and state in ('sending','sent','uncertain') and (attempted_at at time zone 'UTC')::date=day_key;
  if used>=(cfg.settings->>'maxRepliesPerFanDay')::integer then return result||jsonb_build_object('allowed',false,'reason','fan_daily_limit','retryAfter',wait_seconds);end if;
  select count(*) into used from bruff_private.generation_reservations where workspace_id=j.workspace_id and creator_id=j.creator_id and usage_day=day_key;
  if used>=(cfg_snapshot->'settings'->>'dailyLimit')::integer then return result||jsonb_build_object('allowed',false,'reason','model_daily_limit','retryAfter',wait_seconds);end if;
  select coalesce(sum(coalesce(actual_neurons,estimated_neurons)),0) into used from bruff_private.generation_reservations where usage_day=day_key;
  if used+600>7500 then return result||jsonb_build_object('allowed',false,'reason','global_daily_limit','retryAfter',wait_seconds);end if;
  select count(*),min(created_at) into used,first_at from bruff_private.generation_reservations where actor_id=j.owner_id and created_at>moment-interval '1 minute';
  if used>=2 then return result||jsonb_build_object('allowed',false,'reason','actor_minute_limit','retryAfter',greatest(1,ceil(extract(epoch from(first_at+interval '1 minute'-moment)))::integer));end if;
  insert into bruff_private.generation_reservations(request_id,workspace_id,creator_id,actor_id,fan_id,revision,context_hash,engine_version,created_at,usage_day,expires_at)
   values(j.id,j.workspace_id,j.creator_id,j.owner_id,j.fan_id,v->>'revision',v->>'context_hash','bruff-autopilot-v1',moment,day_key,moment+interval '10 minutes');
  update bruff_private.ai_autopilot_jobs set state='generating',generation_id=id,context_hash=v->>'context_hash',source_revision=v->>'revision' where id=j.id;
  return result||jsonb_build_object('allowed',true,'reason','allowed');
 end if;
 if op='result' then
  if j.kind<>'automatic' or v is null or jsonb_typeof(v)<>'object' or (v-'payload')<>'{}'::jsonb or not(v ? 'payload') or j.generation_id is null then raise exception 'Resultado no válido' using errcode='22023';end if;
  result=public.bruff_generation_commit(j.workspace_id,j.creator_id,j.generation_id,j.owner_id,v->'payload');
  update bruff_private.ai_autopilot_jobs set state=case when cfg.settings->>'mode'='drafts' then 'draft_ready' else 'ready' end,updated_at=now() where id=j.id;
  return result;
 end if;
 if op='begin' then
  perform pg_advisory_xact_lock(hashtextextended('bruff.ai.fan:'||j.workspace_id::text||':'||j.creator_id::text||':'||j.fan_id,0));
  if v is null or jsonb_typeof(v)<>'object' or not(v ?& array['generationId','draftId','context_hash','latest_message_id','latest_is_from_me']) or (v-'generationId'-'draftId'-'context_hash'-'latest_message_id'-'latest_is_from_me')<>'{}'::jsonb
   or jsonb_typeof(v->'generationId') is distinct from 'string' or jsonb_typeof(v->'draftId') is distinct from 'string' or jsonb_typeof(v->'context_hash') is distinct from 'string' or jsonb_typeof(v->'latest_message_id') is distinct from 'string' or jsonb_typeof(v->'latest_is_from_me') is distinct from 'boolean'
   or v->>'generationId' is distinct from j.generation_id::text or v->>'draftId' not in ('1','2','3') or v->>'context_hash' is distinct from j.context_hash
   or j.kind='automatic' and (v->>'latest_message_id' is distinct from j.anchor_message_id or v->'latest_is_from_me' is distinct from 'false'::jsonb or cfg.settings->>'mode'<>'automatic' or cfg.settings->'automaticSendingConfirmed'<>'true'::jsonb or j.state<>'ready')
   or j.kind='manual' and (v->>'draftId'<>j.draft_id or v->>'latest_message_id' !~ '^[1-9][0-9]{0,23}$' or jsonb_typeof(v->'latest_is_from_me') is distinct from 'boolean') then return jsonb_build_object('allowed',false);end if;
  select * into r from bruff_private.generation_reservations where request_id=j.generation_id;
  if r.payload is null or r.expires_at<=clock_timestamp() or r.revision<>cfg_snapshot->>'revision' or r.context_hash<>j.context_hash or r.engine_version<>(case when j.kind='manual' then 'bruff-drafts-v2' else 'bruff-autopilot-v1' end) then return jsonb_build_object('allowed',false);end if;
  if j.kind='automatic' and jsonb_array_length(r.payload->'unknowns')<>0 then return jsonb_build_object('allowed',false);end if;
  select d into draft from jsonb_array_elements(r.payload->'drafts') d where d->>'id'=v->>'draftId';
  text_body=draft->>'english';if text_body is null or length(btrim(text_body)) not between 1 and 700 then return jsonb_build_object('allowed',false);end if;
  if exists(select 1 from bruff_private.ai_autopilot_events e where e.workspace_id=j.workspace_id and e.creator_id=j.creator_id and e.fan_id=j.fan_id and e.received_at>j.created_at and (j.kind='manual' or e.message_id is distinct from j.anchor_message_id or e.direction='sent')) then return jsonb_build_object('allowed',false);end if;
  select count(*) into used from bruff_private.ai_autopilot_jobs where workspace_id=j.workspace_id and creator_id=j.creator_id and fan_id=j.fan_id and state in ('sending','sent','uncertain') and (attempted_at at time zone 'UTC')::date=(clock_timestamp() at time zone 'UTC')::date;
  if j.kind='automatic' and used>=(cfg.settings->>'maxRepliesPerFanDay')::integer then return jsonb_build_object('allowed',false);end if;
  select jsonb_agg(jsonb_build_object('term',term,'category',category) order by category,term) into hits from bruff_private.chat_safety_terms where position(bruff_private.chat_normalize(term) in bruff_private.chat_normalize(text_body))>0;
  if hits is not null then
   insert into bruff_private.chat_safety_events(workspace_id,actor_id,creator_id,actor_name,actor_role,model_name,fan_id,message_text,matches)
    values(j.workspace_id,j.owner_id,j.creator_id,'BRUFF IA','owner',(select display_name from bruff_private.creator_accounts where workspace_id=j.workspace_id and id=j.creator_id),j.fan_id,text_body,hits) returning id into incident;
   update bruff_private.ai_autopilot_jobs set state='blocked',detail='Moderación: revisión del propietario requerida',updated_at=now() where id=j.id;
   update bruff_private.ai_autopilot_configs set settings=jsonb_set(settings,'{enabled}','false'::jsonb),version=version+1,updated_at=now() where workspace_id=j.workspace_id and creator_id=j.creator_id;
   update bruff_private.bruff_settings set mode='off',version=version+1 where workspace_id=j.workspace_id and creator_id=j.creator_id;
   return jsonb_build_object('allowed',false,'reason','moderation');
  end if;
  select 'BRUFF IA · '||coalesce(nullif(btrim(display_name),''),'Propietario') into actor_name from bruff_private.memberships where workspace_id=j.workspace_id and user_id=j.owner_id;
  insert into bruff_private.message_authorship(workspace_id,creator_id,fan_id,request_id,actor_id,actor_name) values(j.workspace_id,j.creator_id,j.fan_id,j.id,j.owner_id,actor_name) on conflict do nothing;
  if not exists(select 1 from bruff_private.message_authorship where workspace_id=j.workspace_id and creator_id=j.creator_id and request_id=j.id and actor_id=j.owner_id and fan_id=j.fan_id and message_id is null) then raise exception 'Autoría de otra entrega' using errcode='42501';end if;
  result=jsonb_build_object('text',text_body,'media','[]'::jsonb,'price',0,'lockedText',false);
  update bruff_private.ai_autopilot_jobs set state='sending',draft_id=v->>'draftId',payload=result,payload_hash=md5(result::text),attempted_at=clock_timestamp(),updated_at=now() where id=j.id;
  return jsonb_build_object('allowed',true,'payload',result,'idempotencyKey','bruff-ai-auto-'||j.id::text,'binding',j.binding,'fan',j.fan_id,'origin','BRUFF IA');
 end if;
 raise exception 'Operación no válida' using errcode='22023';
end $$;
-- Preserve the manual API/authorship contract while cancelling preparation for
-- the same fan. A provider request already in flight cannot be recalled.
create or replace function public.bruff_message_begin(w uuid,c uuid,fan text,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n text;a bruff_private.message_authorship;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if fan is null or fan !~ '^[0-9]{1,24}$' or request_id is null or not bruff_private.can_access(w,c,'send') or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 perform pg_advisory_xact_lock(hashtextextended('bruff.ai.fan:'||w::text||':'||c::text||':'||fan,0));
 select coalesce(nullif(btrim(display_name),''),case when role='owner' then 'Propietario' else 'Trabajador sin nombre' end) into n from bruff_private.memberships where workspace_id=w and user_id=auth.uid();
 insert into bruff_private.message_authorship(workspace_id,creator_id,fan_id,request_id,actor_id,actor_name) values(w,c,fan,request_id,auth.uid(),n) on conflict do nothing;
 select * into a from bruff_private.message_authorship m where m.workspace_id=w and m.creator_id=c and m.request_id=bruff_message_begin.request_id;
 if a.actor_id is distinct from auth.uid() or a.fan_id is distinct from fan then raise exception 'Envío ajeno' using errcode='42501';end if;
 update bruff_private.ai_autopilot_jobs set state='skipped',detail='Preparación interrumpida por envío manual',updated_at=now() where workspace_id=w and creator_id=c and fan_id=fan and state in ('queued','claimed','generating','ready');
 return jsonb_build_object('name',a.actor_name,'messageId',a.message_id);
end $$;
revoke all on function bruff_private.ai_autopilot_defaults(),bruff_private.ai_autopilot_allowed(bruff_private.ai_autopilot_configs),bruff_private.ai_autopilot_fan_allowed(bruff_private.ai_autopilot_configs,text),bruff_private.ai_manual_job_allowed(bruff_private.ai_autopilot_jobs),bruff_private.ai_job_version() from public,anon,authenticated,service_role;
revoke all on function public.bruff_autopilot_control(uuid,uuid,text,bigint,jsonb) from public,anon,service_role;
grant execute on function public.bruff_autopilot_control(uuid,uuid,text,bigint,jsonb) to authenticated;
revoke all on function public.bruff_queue_selected_reply(uuid,uuid,text,uuid,uuid,text,text,boolean) from public,anon,service_role;
grant execute on function public.bruff_queue_selected_reply(uuid,uuid,text,uuid,uuid,text,text,boolean) to authenticated;
revoke all on function public.bruff_ai_event_ingest(jsonb),public.bruff_autopilot_worker(text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bruff_ai_event_ingest(jsonb),public.bruff_autopilot_worker(text,uuid,uuid,jsonb) to service_role;
insert into bruff_private.schema_versions(version) values('202611060044_ai_autopilot');
notify pgrst,'reload schema';
commit;
