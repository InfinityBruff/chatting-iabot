-- Separate manual draft generation and owner-reviewed teaching. SQL040/041,
-- bot routing and fan transports are unchanged. No transcript is stored here.
begin;

create table bruff_private.model_knowledge (
 workspace_id uuid not null,
 creator_id uuid not null,
 id uuid not null default gen_random_uuid(),
 version bigint not null default 1 check(version>0),
 kind text not null check(kind in ('style_rule','model_fact','boundary')),
 fact_key text,
 body text not null check(length(btrim(body)) between 1 and 1200 and translate(body,E'\t\n\r','') !~ '[[:cntrl:]]' and position('{{' in body)=0 and position('}}' in body)=0),
 reference_id text not null check(reference_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
 label text not null check(length(btrim(label)) between 1 and 160 and label !~ '[[:cntrl:]]'),
 source_version text not null check(source_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$' and source_version<>'0'),
 state text not null default 'draft' check(state in ('draft','verified','archived')),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(workspace_id,creator_id,id),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 check((kind='model_fact' and fact_key is not null and fact_key in ('public_name','age','country','city','language','about')) or (kind<>'model_fact' and fact_key is null)),
 check(state<>'verified' or (reviewed_by is not null and reviewed_at is not null))
);
create index model_knowledge_scope_state on bruff_private.model_knowledge(workspace_id,creator_id,state);
create unique index model_knowledge_verified_fact on bruff_private.model_knowledge(workspace_id,creator_id,fact_key) where kind='model_fact' and state='verified';
create table bruff_private.generation_settings (
 workspace_id uuid not null,
 creator_id uuid not null,
 settings jsonb not null,
 version bigint not null default 1 check(version>0),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(workspace_id,creator_id),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 check((jsonb_typeof(settings)='object' and settings ?& array['enabled','dailyLimit','maxResults']
  and (settings-'enabled'-'dailyLimit'-'maxResults')='{}'::jsonb
  and jsonb_typeof(settings->'enabled')='boolean'
  and jsonb_typeof(settings->'dailyLimit')='number' and (settings->>'dailyLimit')::numeric between 1 and 12 and (settings->>'dailyLimit')::numeric=trunc((settings->>'dailyLimit')::numeric)
  and jsonb_typeof(settings->'maxResults')='number' and (settings->>'maxResults')::numeric between 1 and 3 and (settings->>'maxResults')::numeric=trunc((settings->>'maxResults')::numeric)) is true)
);
create table bruff_private.generation_reservations (
 request_id uuid primary key,
 workspace_id uuid not null,
 creator_id uuid not null,
 actor_id uuid not null references auth.users(id),
 fan_id text not null check(fan_id ~ '^[0-9]{1,24}$'),
 revision text not null check(revision ~ '^[0-9a-f]{32}$'),
 context_hash text not null check(context_hash ~ '^[0-9a-f]{64}$'),
 estimated_neurons integer not null default 600 check(estimated_neurons=600),
 created_at timestamptz not null,
 usage_day date not null,
 expires_at timestamptz not null,
 payload jsonb,
 committed_at timestamptz,
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 check(usage_day=(created_at at time zone 'UTC')::date),
 check(expires_at=created_at+interval '10 minutes'),
 check((payload is null)=(committed_at is null)),
 check(payload is null or octet_length(payload::text)<=32768)
);
create index generation_usage_model_day on bruff_private.generation_reservations(workspace_id,creator_id,usage_day);
create index generation_usage_global_day on bruff_private.generation_reservations(usage_day);
create index generation_usage_actor_minute on bruff_private.generation_reservations(actor_id,created_at);
create index generation_payload_expiry on bruff_private.generation_reservations(expires_at) where payload is not null;
alter table bruff_private.model_knowledge enable row level security;
alter table bruff_private.generation_settings enable row level security;
alter table bruff_private.generation_reservations enable row level security;
revoke all on bruff_private.model_knowledge,bruff_private.generation_settings,bruff_private.generation_reservations from public,anon,authenticated,service_role;

-- Fixed-actor authorization for the service-only canonical commit. This helper
-- never changes JWT claims and never treats a caller's actor as auth.uid().
create function bruff_private.generation_actor_allowed(w uuid,c uuid,a uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
  select 1 from bruff_private.memberships m
  join bruff_private.creator_accounts account on account.workspace_id=m.workspace_id and account.id=c
  join auth.users u on u.id=m.user_id
  where m.workspace_id=w and m.user_id=a and m.status='active' and u.email_confirmed_at is not null
  and (m.role in ('owner','admin') or (m.role='operator'
   and exists(select 1 from bruff_private.account_grants g where g.workspace_id=w and g.creator_id=c and g.user_id=a and g.permission='read')
   and exists(select 1 from bruff_private.account_grants g where g.workspace_id=w and g.creator_id=c and g.user_id=a and g.permission='send')))
 )
$$;

-- The same explicit (w,c) snapshot is used by user reads, reservations and the
-- service commit. md5 is only a deterministic freshness marker, not a signature.
create function bruff_private.generation_snapshot(w uuid,c uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare config jsonb; config_version bigint; example_rows jsonb; knowledge_rows jsonb; approved_count integer; snapshot jsonb;
begin
 select s.settings,s.version into config,config_version from bruff_private.generation_settings s where s.workspace_id=w and s.creator_id=c;
 if not found then config='{"enabled":false,"dailyLimit":4,"maxResults":3}'::jsonb;config_version=0;end if;
 select count(*) into approved_count from bruff_private.chat_direct_examples e where e.workspace_id=w and e.creator_id=c and e.state='verified';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'trigger',trigger,'english',english,'spanish',spanish,'referenceId',reference_id,'label',label,'sourceVersion',source_version) order by id),'[]'::jsonb) into example_rows
 from (select e.* from bruff_private.chat_direct_examples e where e.workspace_id=w and e.creator_id=c and e.state='verified' order by e.id limit 50) examples;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'kind',kind,'key',fact_key,'text',body,'referenceId',reference_id,'label',label,'sourceVersion',source_version,'state',state) order by id),'[]'::jsonb) into knowledge_rows
 from (select k.* from bruff_private.model_knowledge k where k.workspace_id=w and k.creator_id=c and k.state='verified' order by k.id limit 100) knowledge;
 snapshot=jsonb_build_object('settings',config,'version',config_version,'examples',example_rows,'knowledge',knowledge_rows,'approvedCount',approved_count);
 return snapshot||jsonb_build_object('revision',md5(snapshot::text));
end $$;

create function bruff_private.generation_record_json(r bruff_private.generation_reservations) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('generationId',r.request_id,'actorId',r.actor_id,'workspaceId',r.workspace_id,'creatorId',r.creator_id,'fanId',r.fan_id,
  'revision',r.revision,'contextHash',r.context_hash,'expiresAt',to_char(r.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'drafts',r.payload->'drafts','unknowns',r.payload->'unknowns','aiGenerated',true,'aiVerified',false)
$$;

-- Opportunistic cleanup on an authorized claim, including denied/duplicate
-- claims that return normally. Logical expiry is always enforced on reads.
-- Keep today's reservations and their full 600 estimate, even after failures.
create function bruff_private.generation_prune() returns void
language plpgsql security definer set search_path='' as $$
declare moment timestamptz:=clock_timestamp();
begin
 update bruff_private.generation_reservations set payload=null,committed_at=null where expires_at<=moment and payload is not null;
 delete from bruff_private.generation_reservations where usage_day<(moment at time zone 'UTC')::date-30 and expires_at<=moment;
end $$;

create function public.bruff_model_knowledge(w uuid,c uuid,op text default 'list',entry_id uuid default null,expected bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare k bruff_private.model_knowledge; result jsonb; total_count integer; active_count integer; target_state text; target_key text; saved_id uuid;
begin
 perform bruff_private.require_owner(w);
 if not bruff_private.can_access(w,c,'settings') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op is null or op not in ('list','save','archive') then raise exception 'Operación no válida' using errcode='22023';end if;
 if op='list' then
  if entry_id is not null or expected is not null or value is not null then raise exception 'Consulta no válida' using errcode='22023';end if;
 else
  if entry_id is not null then
   select * into k from bruff_private.model_knowledge where workspace_id=w and creator_id=c and id=entry_id for update;
   if not found then raise exception 'Entrada no disponible en esta modelo' using errcode='42501';end if;
   if expected is distinct from k.version then raise exception 'La entrada cambió. Recarga antes de guardar.' using errcode='40001';end if;
  elsif op<>'save' or expected is distinct from 0::bigint then raise exception 'Entrada o versión no válida' using errcode='22023';end if;
  if op='archive' then
   if value is not null then raise exception 'Operación no válida' using errcode='22023';end if;
   update bruff_private.model_knowledge set state='archived',version=version+1,updated_at=now(),updated_by=auth.uid() where workspace_id=w and creator_id=c and id=k.id returning * into k;
  else
   if value is null or jsonb_typeof(value)<>'object' or (value-'kind'-'key'-'text'-'referenceId'-'label'-'sourceVersion'-'state')<>'{}'::jsonb
    or not (value ?& array['kind','text','referenceId','label','sourceVersion'])
    or jsonb_typeof(value->'kind') is distinct from 'string' or value->>'kind' not in ('style_rule','model_fact','boundary')
    or jsonb_typeof(value->'text') is distinct from 'string' or length(btrim(value->>'text')) not between 1 and 1200
    or translate(value->>'text',E'\t\n\r','') ~ '[[:cntrl:]]' or position('{{' in value->>'text')>0 or position('}}' in value->>'text')>0
    or jsonb_typeof(value->'referenceId') is distinct from 'string' or value->>'referenceId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    or jsonb_typeof(value->'label') is distinct from 'string' or length(btrim(value->>'label')) not between 1 and 160 or value->>'label' ~ '[[:cntrl:]]'
    or jsonb_typeof(value->'sourceVersion') is distinct from 'string' or value->>'sourceVersion' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$' or value->>'sourceVersion'='0'
    or value ? 'state' and (jsonb_typeof(value->'state') is distinct from 'string' or value->>'state' not in ('draft','verified','archived'))
   then raise exception 'Entrada documental no válida' using errcode='22023';end if;
   target_state=coalesce(value->>'state','draft');target_key=value->>'key';
   if value->>'kind'='model_fact' then
    if jsonb_typeof(value->'key') is distinct from 'string' or target_key not in ('public_name','age','country','city','language','about') then raise exception 'Clave de dato no válida' using errcode='22023';end if;
   elsif value ? 'key' and value->'key'<>'null'::jsonb then raise exception 'Las reglas y límites no admiten clave de dato' using errcode='22023';end if;
   select count(*),count(*) filter(where state<>'archived') into total_count,active_count from bruff_private.model_knowledge where workspace_id=w and creator_id=c;
   if k.id is null and total_count>=200 then raise exception 'Límite de 200 entradas por modelo' using errcode='23514';end if;
   if target_state<>'archived' and (k.id is null or k.state='archived') and active_count>=100 then raise exception 'Límite de 100 entradas activas por modelo' using errcode='23514';end if;
   if k.id is null then
    insert into bruff_private.model_knowledge(workspace_id,creator_id,kind,fact_key,body,reference_id,label,source_version,state,reviewed_by,reviewed_at,updated_by)
    values(w,c,value->>'kind',target_key,value->>'text',value->>'referenceId',btrim(value->>'label'),value->>'sourceVersion',target_state,case when target_state='verified' then auth.uid() end,case when target_state='verified' then now() end,auth.uid()) returning * into k;
   else
    update bruff_private.model_knowledge set kind=value->>'kind',fact_key=target_key,body=value->>'text',reference_id=value->>'referenceId',label=btrim(value->>'label'),source_version=value->>'sourceVersion',state=target_state,
     reviewed_by=case when target_state='verified' then auth.uid() end,reviewed_at=case when target_state='verified' then now() end,version=version+1,updated_by=auth.uid(),updated_at=now()
    where workspace_id=w and creator_id=c and id=k.id returning * into k;
   end if;
  end if;
  saved_id=k.id;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'model_knowledge_'||op,k.id);
 end if;
 select count(*) into total_count from bruff_private.model_knowledge where workspace_id=w and creator_id=c;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'kind',kind,'key',fact_key,'text',body,'referenceId',reference_id,'label',label,'sourceVersion',source_version,'state',state) order by updated_at desc,id),'[]'::jsonb) into result
 from (select * from bruff_private.model_knowledge where workspace_id=w and creator_id=c order by updated_at desc,id limit 200) entries;
 return jsonb_build_object('schemaVersion',1,'actorId',auth.uid(),'workspaceId',w,'creatorId',c,'canEdit',true,'items',result,'total',total_count,'limit',200,'complete',total_count<=200,'savedId',saved_id);
end $$;

create function public.bruff_generation_control(w uuid,c uuid,op text default 'read',expected bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare config jsonb; config_version bigint;
begin
 perform bruff_private.require_owner(w);
 if not bruff_private.can_access(w,c,'settings') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op is null or op not in ('read','save') then raise exception 'Operación no válida' using errcode='22023';end if;
 select s.settings,s.version into config,config_version from bruff_private.generation_settings s where s.workspace_id=w and s.creator_id=c for update;
 if not found then config='{"enabled":false,"dailyLimit":4,"maxResults":3}'::jsonb;config_version=0;end if;
 if op='read' then
  if expected is not null or value is not null then raise exception 'Consulta no válida' using errcode='22023';end if;
 else
  if expected is distinct from config_version then raise exception 'La configuración cambió. Recarga antes de guardar.' using errcode='40001';end if;
  if value is null or jsonb_typeof(value)<>'object' or (value-'enabled'-'dailyLimit'-'maxResults')<>'{}'::jsonb or not (value ?& array['enabled','dailyLimit','maxResults'])
   or jsonb_typeof(value->'enabled') is distinct from 'boolean' or jsonb_typeof(value->'dailyLimit') is distinct from 'number' or jsonb_typeof(value->'maxResults') is distinct from 'number'
  then raise exception 'Configuración no válida' using errcode='22023';end if;
  if (value->>'dailyLimit')::numeric not between 1 and 12 or (value->>'dailyLimit')::numeric<>trunc((value->>'dailyLimit')::numeric)
   or (value->>'maxResults')::numeric not between 1 and 3 or (value->>'maxResults')::numeric<>trunc((value->>'maxResults')::numeric)
  then raise exception 'Límites de generación no válidos' using errcode='22023';end if;
  config=jsonb_build_object('enabled',(value->>'enabled')::boolean,'dailyLimit',(value->>'dailyLimit')::integer,'maxResults',(value->>'maxResults')::integer);
  insert into bruff_private.generation_settings(workspace_id,creator_id,settings,updated_by) values(w,c,config,auth.uid())
  on conflict(workspace_id,creator_id) do update set settings=excluded.settings,version=bruff_private.generation_settings.version+1,updated_by=auth.uid(),updated_at=now() returning version into config_version;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'generation_settings_saved',c);
 end if;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'settings',config,'version',config_version);
end $$;

create function public.bruff_generation_pool(w uuid,c uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not bruff_private.generation_actor_allowed(w,c,auth.uid()) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 return bruff_private.generation_snapshot(w,c)||jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c);
end $$;

create function public.bruff_generation_claim(w uuid,c uuid,request_id uuid,fan text,revision text,context_hash text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid(); req uuid:=request_id; target_fan text:=fan; expected_revision text:=revision; fingerprint text:=context_hash; identity jsonb; snapshot jsonb; moment timestamptz; day_key date; used integer; first_at timestamptz; retry_seconds integer;
begin
 if not bruff_private.generation_actor_allowed(w,c,a) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if req is null or target_fan is null or target_fan !~ '^[0-9]{1,24}$' or expected_revision is null or expected_revision !~ '^[0-9a-f]{32}$' or fingerprint is null or fingerprint !~ '^[0-9a-f]{64}$' then raise exception 'Reserva no válida' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('bruff.generation.actor:'||a::text,0));
 perform pg_advisory_xact_lock(hashtextextended('bruff.generation.global.daily',0));
 perform 1 from bruff_private.workspaces where id=w for update;
 if not bruff_private.generation_actor_allowed(w,c,a) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 perform bruff_private.generation_prune();
 identity=jsonb_build_object('actorId',a,'workspaceId',w,'creatorId',c);
 if exists(select 1 from bruff_private.generation_reservations r where r.request_id=req) then return identity||jsonb_build_object('allowed',false,'reason','duplicate');end if;
 snapshot=bruff_private.generation_snapshot(w,c);
 if snapshot->'settings'->'enabled'<>'true'::jsonb then return identity||jsonb_build_object('allowed',false,'reason','disabled');end if;
 if (snapshot->>'approvedCount')::integer<1 or jsonb_array_length(snapshot->'examples')<1 then return identity||jsonb_build_object('allowed',false,'reason','no_sources');end if;
 if snapshot->>'revision'<>expected_revision then return identity||jsonb_build_object('allowed',false,'reason','revision_changed');end if;
 moment=clock_timestamp();day_key=(moment at time zone 'UTC')::date;
 retry_seconds=greatest(1,ceil(extract(epoch from (((day_key+1)::timestamp at time zone 'UTC')-moment)))::integer);
 select count(*) into used from bruff_private.generation_reservations r where r.workspace_id=w and r.creator_id=c and r.usage_day=day_key;
 if used>=(snapshot->'settings'->>'dailyLimit')::integer then return identity||jsonb_build_object('allowed',false,'reason','model_daily_limit','retryAfter',retry_seconds);end if;
 -- Fixed generation-only estimates, not measurement of all Cloudflare usage.
 -- Existing semantic reranking is deliberately not charged to this module.
 select coalesce(sum(r.estimated_neurons),0) into used from bruff_private.generation_reservations r where r.usage_day=day_key;
 if used+600>7500 then return identity||jsonb_build_object('allowed',false,'reason','global_daily_limit','retryAfter',retry_seconds);end if;
 select count(*),min(r.created_at) into used,first_at from bruff_private.generation_reservations r where r.actor_id=a and r.created_at>moment-interval '1 minute';
 if used>=2 then return identity||jsonb_build_object('allowed',false,'reason','actor_minute_limit','retryAfter',greatest(1,ceil(extract(epoch from (first_at+interval '1 minute'-moment)))::integer));end if;
 insert into bruff_private.generation_reservations(request_id,workspace_id,creator_id,actor_id,fan_id,revision,context_hash,created_at,usage_day,expires_at) values(req,w,c,a,target_fan,expected_revision,fingerprint,moment,day_key,moment+interval '10 minutes');
 return identity||jsonb_build_object('allowed',true,'reason','allowed');
end $$;

-- Only the fixed Edge backend route may attest a canonical generated result.
-- It supplies the previously Auth-verified actor, not a forged JWT context.
create function public.bruff_generation_commit(w uuid,c uuid,request_id uuid,actor uuid,payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bruff_private.generation_reservations; req uuid:=request_id; a uuid:=actor; input jsonb:=payload; snapshot jsonb; d jsonb; ref jsonb; note jsonb; clean jsonb:='[]'; examples jsonb; knowledge jsonb; seen text[]:='{}'; canonical_id text;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if not bruff_private.generation_actor_allowed(w,c,a) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 select * into r from bruff_private.generation_reservations where workspace_id=w and creator_id=c and generation_reservations.request_id=req for update;
 if not found or r.actor_id is distinct from a then raise exception 'Reserva no disponible' using errcode='42501';end if;
 snapshot=bruff_private.generation_snapshot(w,c);
 if r.payload is not null or r.expires_at<=clock_timestamp() or snapshot->>'revision'<>r.revision then raise exception 'La reserva o sus fuentes cambiaron' using errcode='40001';end if;
 if input is null or jsonb_typeof(input)<>'object' or (input-'drafts'-'unknowns')<>'{}'::jsonb or not(input ?& array['drafts','unknowns'])
  or jsonb_typeof(input->'drafts') is distinct from 'array' or jsonb_typeof(input->'unknowns') is distinct from 'array' or octet_length(input::text)>32768
 then raise exception 'Resultado no válido' using errcode='22023';end if;
 if jsonb_array_length(input->'drafts')>least(3,(snapshot->'settings'->>'maxResults')::integer) or jsonb_array_length(input->'unknowns')>5 then raise exception 'Resultado fuera de límites' using errcode='22023';end if;
 for note in select * from jsonb_array_elements(input->'unknowns') loop
  if jsonb_typeof(note)<>'string' or length(btrim(note#>>'{}')) not between 1 and 160 or note#>>'{}' ~ '[[:cntrl:]]' then raise exception 'Dato pendiente no válido' using errcode='22023';end if;
 end loop;
 for d in select * from jsonb_array_elements(input->'drafts') loop
  if jsonb_typeof(d)<>'object' or (d-'id'-'english'-'spanish'-'exampleIds'-'knowledgeIds')<>'{}'::jsonb or not(d ?& array['id','english','spanish','exampleIds','knowledgeIds'])
   or jsonb_typeof(d->'id') is distinct from 'string' or d->>'id' not in ('1','2','3') or d->>'id'=any(seen)
   or jsonb_typeof(d->'english') is distinct from 'string' or length(btrim(d->>'english')) not between 1 and 700
   or jsonb_typeof(d->'spanish') is distinct from 'string' or length(btrim(d->>'spanish')) not between 1 and 1000
   or translate(d->>'english',E'\t\n\r','') ~ '[[:cntrl:]]' or translate(d->>'spanish',E'\t\n\r','') ~ '[[:cntrl:]]'
   or position('{{' in d->>'english')>0 or position('}}' in d->>'english')>0 or position('{{' in d->>'spanish')>0 or position('}}' in d->>'spanish')>0
   or jsonb_typeof(d->'exampleIds') is distinct from 'array' or jsonb_typeof(d->'knowledgeIds') is distinct from 'array'
  then raise exception 'Borrador generado no válido' using errcode='22023';end if;
  if jsonb_array_length(d->'exampleIds') not between 1 and 6 or jsonb_array_length(d->'knowledgeIds')>12 then raise exception 'Referencias fuera de límites' using errcode='22023';end if;
  seen=array_append(seen,d->>'id');examples='[]';knowledge='[]';
  for ref in select * from jsonb_array_elements(d->'exampleIds') loop
   if jsonb_typeof(ref)<>'string' or ref#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Referencia no válida' using errcode='22023';end if;
   canonical_id=((ref#>>'{}')::uuid)::text;
   if examples @> jsonb_build_array(canonical_id) or not exists(select 1 from jsonb_array_elements(snapshot->'examples') e where e->>'id'=canonical_id) then raise exception 'Ejemplo ajeno, retirado o repetido' using errcode='22023';end if;
   examples=examples||jsonb_build_array(canonical_id);
  end loop;
  for ref in select * from jsonb_array_elements(d->'knowledgeIds') loop
   if jsonb_typeof(ref)<>'string' or ref#>>'{}' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'Referencia no válida' using errcode='22023';end if;
   canonical_id=((ref#>>'{}')::uuid)::text;
   if knowledge @> jsonb_build_array(canonical_id) or not exists(select 1 from jsonb_array_elements(snapshot->'knowledge') k where k->>'id'=canonical_id) then raise exception 'Conocimiento ajeno, retirado o repetido' using errcode='22023';end if;
   knowledge=knowledge||jsonb_build_array(canonical_id);
  end loop;
  clean=clean||jsonb_build_array(jsonb_build_object('id',d->>'id','english',d->>'english','spanish',d->>'spanish','exampleIds',examples,'knowledgeIds',knowledge));
 end loop;
 update bruff_private.generation_reservations set payload=jsonb_build_object('drafts',clean,'unknowns',input->'unknowns'),committed_at=clock_timestamp() where generation_reservations.request_id=req returning * into r;
 return bruff_private.generation_record_json(r);
end $$;

create function public.bruff_generation_result(w uuid,c uuid,request_id uuid,fan text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bruff_private.generation_reservations; req uuid:=request_id; target_fan text:=fan; snapshot jsonb;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if not bruff_private.generation_actor_allowed(w,c,auth.uid()) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if req is null or target_fan is null or target_fan !~ '^[0-9]{1,24}$' then raise exception 'Consulta no válida' using errcode='22023';end if;
 select * into r from bruff_private.generation_reservations where workspace_id=w and creator_id=c and generation_reservations.request_id=req and actor_id=auth.uid() and fan_id=target_fan;
 if not found then raise exception 'Borrador no disponible para este contexto' using errcode='40001';end if;
 snapshot=bruff_private.generation_snapshot(w,c);
 if r.payload is null or r.expires_at<=clock_timestamp() or snapshot->>'revision'<>r.revision then raise exception 'El borrador o sus fuentes cambiaron' using errcode='40001';end if;
 return bruff_private.generation_record_json(r);
end $$;

revoke all on function bruff_private.generation_actor_allowed(uuid,uuid,uuid),bruff_private.generation_snapshot(uuid,uuid),bruff_private.generation_record_json(bruff_private.generation_reservations),bruff_private.generation_prune() from public,anon,authenticated,service_role;
revoke all on function public.bruff_model_knowledge(uuid,uuid,text,uuid,bigint,jsonb),public.bruff_generation_control(uuid,uuid,text,bigint,jsonb),public.bruff_generation_pool(uuid,uuid),public.bruff_generation_claim(uuid,uuid,uuid,text,text,text),public.bruff_generation_result(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.bruff_model_knowledge(uuid,uuid,text,uuid,bigint,jsonb),public.bruff_generation_control(uuid,uuid,text,bigint,jsonb),public.bruff_generation_pool(uuid,uuid),public.bruff_generation_claim(uuid,uuid,uuid,text,text,text),public.bruff_generation_result(uuid,uuid,uuid,text) to authenticated;
revoke all on function public.bruff_generation_commit(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bruff_generation_commit(uuid,uuid,uuid,uuid,jsonb) to service_role;
insert into bruff_private.schema_versions(version) values('202611060042_ai_generation_knowledge');
notify pgrst,'reload schema';
commit;
