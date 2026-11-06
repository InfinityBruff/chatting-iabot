-- Manual-only generation accounting and exact-context reuse. Existing rows
-- keep their 600-neuron reservation; no saved enabled or dailyLimit is changed.
begin;
alter table bruff_private.generation_reservations
 add column engine_version text not null default 'legacy-v1' check(engine_version in ('legacy-v1','bruff-drafts-v2')),
 add column prompt_tokens bigint,
 add column completion_tokens bigint,
 add column actual_neurons bigint,
 add column finished_at timestamptz,
 add constraint generation_observed_usage check(
  (prompt_tokens is null and completion_tokens is null and actual_neurons is null)
  or (prompt_tokens is not null and completion_tokens is not null and actual_neurons is not null and prompt_tokens between 1 and 1000000 and completion_tokens between 0 and 1000000
   and actual_neurons=greatest(1,ceil((prompt_tokens::numeric*31876+completion_tokens::numeric*50488)/1000000))
   and finished_at is not null)
 );
create index generation_context_reuse on bruff_private.generation_reservations
 (actor_id,workspace_id,creator_id,fan_id,revision,context_hash,engine_version,created_at desc);
alter table bruff_private.generation_settings drop constraint generation_settings_settings_check;
alter table bruff_private.generation_settings add constraint generation_settings_settings_v2_check check((
 jsonb_typeof(settings)='object' and settings ?& array['enabled','dailyLimit','maxResults']
 and (settings-'enabled'-'dailyLimit'-'maxResults')='{}'::jsonb and jsonb_typeof(settings->'enabled')='boolean'
 and jsonb_typeof(settings->'dailyLimit')='number' and (settings->>'dailyLimit')::numeric between 1 and 1000 and (settings->>'dailyLimit')::numeric=trunc((settings->>'dailyLimit')::numeric)
 and jsonb_typeof(settings->'maxResults')='number' and (settings->>'maxResults')::numeric between 1 and 3 and (settings->>'maxResults')::numeric=trunc((settings->>'maxResults')::numeric)
) is true);

create or replace function bruff_private.generation_snapshot(w uuid,c uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare config jsonb; config_version bigint; example_rows jsonb; knowledge_rows jsonb; approved_count integer; snapshot jsonb;
begin
 select s.settings,s.version into config,config_version from bruff_private.generation_settings s where s.workspace_id=w and s.creator_id=c;
 if not found then config='{"enabled":false,"dailyLimit":100,"maxResults":3}'::jsonb;config_version=0;end if;
 select count(*) into approved_count from bruff_private.chat_direct_examples e where e.workspace_id=w and e.creator_id=c and e.state='verified';
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'trigger',trigger,'english',english,'spanish',spanish,'referenceId',reference_id,'label',label,'sourceVersion',source_version) order by id),'[]'::jsonb) into example_rows
 from (select e.* from bruff_private.chat_direct_examples e where e.workspace_id=w and e.creator_id=c and e.state='verified' order by e.id limit 50) examples;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'kind',kind,'key',fact_key,'text',body,'referenceId',reference_id,'label',label,'sourceVersion',source_version,'state',state) order by id),'[]'::jsonb) into knowledge_rows
 from (select k.* from bruff_private.model_knowledge k where k.workspace_id=w and k.creator_id=c and k.state='verified' order by k.id limit 100) knowledge;
 snapshot=jsonb_build_object('settings',config,'version',config_version,'examples',example_rows,'knowledge',knowledge_rows,'approvedCount',approved_count);
 return snapshot||jsonb_build_object('revision',md5(snapshot::text));
end $$;

-- Cost comes only from the fixed Edge attestation, never a browser claim.
create function bruff_private.generation_usage_json(r bruff_private.generation_reservations) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('status',case when r.actual_neurons is null then 'reserved' else 'observed' end,
  'promptTokens',r.prompt_tokens,'completionTokens',r.completion_tokens,'calculatedNeurons',r.actual_neurons,
  'chargedNeurons',coalesce(r.actual_neurons,r.estimated_neurons))
$$;
create or replace function bruff_private.generation_record_json(r bruff_private.generation_reservations) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('generationId',r.request_id,'actorId',r.actor_id,'workspaceId',r.workspace_id,'creatorId',r.creator_id,'fanId',r.fan_id,
  'revision',r.revision,'contextHash',r.context_hash,'expiresAt',to_char(r.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'drafts',r.payload->'drafts','unknowns',r.payload->'unknowns','aiGenerated',true,'aiVerified',false,
  'engineVersion',r.engine_version,'usage',bruff_private.generation_usage_json(r))
$$;

-- Usage is deliberately outside generation_snapshot and its source revision.
create function bruff_private.generation_quota_snapshot(w uuid,c uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare moment timestamptz:=clock_timestamp();day_key date;model_queries integer;daily_limit integer;observed bigint;reserved bigint;observed_requests integer;reserved_requests integer;
begin
 day_key=(moment at time zone 'UTC')::date;
 select (settings->>'dailyLimit')::integer into daily_limit from bruff_private.generation_settings where workspace_id=w and creator_id=c;
 if not found then daily_limit=100;end if;
 select count(*)::integer into model_queries from bruff_private.generation_reservations where workspace_id=w and creator_id=c and usage_day=day_key;
 select coalesce(sum(actual_neurons),0),coalesce(sum(estimated_neurons) filter(where actual_neurons is null),0),
  count(*) filter(where actual_neurons is not null)::integer,count(*) filter(where actual_neurons is null)::integer
 into observed,reserved,observed_requests,reserved_requests from bruff_private.generation_reservations where usage_day=day_key;
 return jsonb_build_object('usageDay',day_key::text,'resetsAt',to_char(((day_key+1)::timestamp) at time zone 'UTC' at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'modelQueries',model_queries,'modelDailyLimit',daily_limit,'sharedBudgetNeurons',7500,'calculatedNeurons',observed,'reservedNeurons',reserved,
  'chargedNeurons',observed+reserved,'remainingNeurons',greatest(0,7500-observed-reserved),'observedRequests',observed_requests,'reservedRequests',reserved_requests);
end $$;
create function public.bruff_generation_quota(w uuid,c uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not bruff_private.generation_actor_allowed(w,c,auth.uid()) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'quota',bruff_private.generation_quota_snapshot(w,c));
end $$;

create function public.bruff_generation_claim_v2(w uuid,c uuid,request_id uuid,fan text,revision text,context_hash text,engine_version text,force boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid();req uuid:=request_id;target_fan text:=fan;expected_revision text:=revision;fingerprint text:=context_hash;engine text:=engine_version;forced boolean:=force;
 identity jsonb;snapshot jsonb;r bruff_private.generation_reservations;moment timestamptz;day_key date;used bigint;first_at timestamptz;retry_seconds integer;
begin
 if not bruff_private.generation_actor_allowed(w,c,a) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if req is null or target_fan is null or target_fan !~ '^[0-9]{1,24}$' or expected_revision is null or expected_revision !~ '^[0-9a-f]{32}$'
  or fingerprint is null or fingerprint !~ '^[0-9a-f]{64}$' or engine is null or engine not in ('legacy-v1','bruff-drafts-v2') or forced is null
 then raise exception 'Reserva no válida' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('bruff.generation.actor:'||a::text,0));
 perform pg_advisory_xact_lock(hashtextextended('bruff.generation.global.daily',0));
 perform 1 from bruff_private.workspaces where id=w for update;
 if not bruff_private.generation_actor_allowed(w,c,a) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 perform bruff_private.generation_prune();
 identity=jsonb_build_object('actorId',a,'workspaceId',w,'creatorId',c);moment=clock_timestamp();
 snapshot=bruff_private.generation_snapshot(w,c);
 if snapshot->'settings'->'enabled'<>'true'::jsonb then return identity||jsonb_build_object('allowed',false,'reason','disabled');end if;
 if (snapshot->>'approvedCount')::integer<1 or jsonb_array_length(snapshot->'examples')<1 then return identity||jsonb_build_object('allowed',false,'reason','no_sources');end if;
 if snapshot->>'revision'<>expected_revision then return identity||jsonb_build_object('allowed',false,'reason','revision_changed');end if;
 -- A repeated UUID can never trigger another inference. For v2, an exact
 -- completed or pending repeat returns its truthful current state.
 select * into r from bruff_private.generation_reservations where generation_reservations.request_id=req;
 if found then
  if engine='bruff-drafts-v2' and r.actor_id=a and r.workspace_id=w and r.creator_id=c and r.fan_id=target_fan
   and r.revision=expected_revision and r.context_hash=fingerprint and r.engine_version=engine and r.expires_at>moment then
   if r.payload is not null then return identity||jsonb_build_object('allowed',false,'reason','cached','cached',bruff_private.generation_record_json(r));end if;
   if r.created_at>moment-interval '45 seconds' then return identity||jsonb_build_object('allowed',false,'reason','pending','retryAfter',greatest(1,ceil(extract(epoch from(r.created_at+interval '45 seconds'-moment)))::integer));end if;
  end if;
  return identity||jsonb_build_object('allowed',false,'reason','duplicate');
 end if;
 if not forced then
  select * into r from bruff_private.generation_reservations where actor_id=a and workspace_id=w and creator_id=c and fan_id=target_fan
   and generation_reservations.revision=expected_revision and generation_reservations.context_hash=fingerprint and generation_reservations.engine_version=engine
   and payload is not null and expires_at>moment order by created_at desc,generation_reservations.request_id limit 1;
  if found then return identity||jsonb_build_object('allowed',false,'reason','cached','cached',bruff_private.generation_record_json(r));end if;
 end if;
 -- Settlement finishes accounting, not history validation or canonical commit.
 -- The full 45-second window protects that gap, including failed requests.
 -- Even an explicit regeneration cannot overlap an identical active request.
 select * into r from bruff_private.generation_reservations where actor_id=a and workspace_id=w and creator_id=c and fan_id=target_fan
  and generation_reservations.revision=expected_revision and generation_reservations.context_hash=fingerprint and generation_reservations.engine_version=engine
  and payload is null and created_at>moment-interval '45 seconds' and expires_at>moment order by created_at desc,generation_reservations.request_id limit 1;
 if found then return identity||jsonb_build_object('allowed',false,'reason','pending','retryAfter',greatest(1,ceil(extract(epoch from(r.created_at+interval '45 seconds'-moment)))::integer));end if;
 day_key=(moment at time zone 'UTC')::date;
 retry_seconds=greatest(1,ceil(extract(epoch from(((day_key+1)::timestamp at time zone 'UTC')-moment)))::integer);
 select count(*) into used from bruff_private.generation_reservations where workspace_id=w and creator_id=c and usage_day=day_key;
 if used>=(snapshot->'settings'->>'dailyLimit')::integer then return identity||jsonb_build_object('allowed',false,'reason','model_daily_limit','retryAfter',retry_seconds);end if;
 select coalesce(sum(coalesce(actual_neurons,estimated_neurons)),0) into used from bruff_private.generation_reservations where usage_day=day_key;
 if used+600>7500 then return identity||jsonb_build_object('allowed',false,'reason','global_daily_limit','retryAfter',retry_seconds);end if;
 select count(*),min(created_at) into used,first_at from bruff_private.generation_reservations where actor_id=a and created_at>moment-interval '1 minute';
 if used>=2 then return identity||jsonb_build_object('allowed',false,'reason','actor_minute_limit','retryAfter',greatest(1,ceil(extract(epoch from(first_at+interval '1 minute'-moment)))::integer));end if;
 insert into bruff_private.generation_reservations(request_id,workspace_id,creator_id,actor_id,fan_id,revision,context_hash,engine_version,created_at,usage_day,expires_at)
 values(req,w,c,a,target_fan,expected_revision,fingerprint,engine,moment,day_key,moment+interval '10 minutes');
 return identity||jsonb_build_object('allowed',true,'reason','allowed');
end $$;
-- Keep the six-argument route unambiguous during rolling deployment.
create or replace function public.bruff_generation_claim(w uuid,c uuid,request_id uuid,fan text,revision text,context_hash text) returns jsonb
language sql security definer set search_path='' as $$
 select public.bruff_generation_claim_v2(w,c,request_id,fan,revision,context_hash,'legacy-v1',true)
$$;

create function public.bruff_generation_usage(w uuid,c uuid,request_id uuid,actor uuid,input_tokens bigint default null,output_tokens bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid:=actor;req uuid:=request_id;r bruff_private.generation_reservations;observed bigint;
begin
 if a is null or req is null or (input_tokens is null) is distinct from (output_tokens is null)
  or input_tokens is not null and (input_tokens not between 1 and 1000000 or output_tokens not between 0 and 1000000)
 then raise exception 'Uso no válido' using errcode='22023';end if;
 perform pg_advisory_xact_lock(hashtextextended('bruff.generation.actor:'||a::text,0));
 perform pg_advisory_xact_lock(hashtextextended('bruff.generation.global.daily',0));
 perform 1 from bruff_private.workspaces where id=w for update;
 select * into r from bruff_private.generation_reservations where workspace_id=w and creator_id=c and generation_reservations.request_id=req for update;
 if not found or r.actor_id is distinct from a then raise exception 'Reserva no disponible' using errcode='42501';end if;
 -- The first settlement is immutable, including an unknown result. A late
 -- duplicate cannot refund twice, overwrite real cost or reveal a payload.
 if r.finished_at is null then
  if input_tokens is not null then observed=greatest(1,ceil((input_tokens::numeric*31876+output_tokens::numeric*50488)/1000000))::bigint;end if;
  update bruff_private.generation_reservations set prompt_tokens=input_tokens,completion_tokens=output_tokens,actual_neurons=observed,finished_at=clock_timestamp()
   where generation_reservations.request_id=req returning * into r;
 end if;
 return jsonb_build_object('actorId',r.actor_id,'workspaceId',r.workspace_id,'creatorId',r.creator_id,'generationId',r.request_id,
  'engineVersion',r.engine_version,'usage',bruff_private.generation_usage_json(r));
end $$;

revoke all on function bruff_private.generation_usage_json(bruff_private.generation_reservations),bruff_private.generation_quota_snapshot(uuid,uuid) from public,anon,authenticated,service_role;
revoke all on function public.bruff_generation_claim_v2(uuid,uuid,uuid,text,text,text,text,boolean),public.bruff_generation_quota(uuid,uuid) from public,anon,service_role;
grant execute on function public.bruff_generation_claim_v2(uuid,uuid,uuid,text,text,text,text,boolean),public.bruff_generation_quota(uuid,uuid) to authenticated;
revoke all on function public.bruff_generation_usage(uuid,uuid,uuid,uuid,bigint,bigint) from public,anon,authenticated;
grant execute on function public.bruff_generation_usage(uuid,uuid,uuid,uuid,bigint,bigint) to service_role;
insert into bruff_private.schema_versions(version) values('202611060043_ai_generation_budget');
notify pgrst,'reload schema';
create or replace function public.bruff_generation_control(w uuid,c uuid,op text default 'read',expected bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare config jsonb; config_version bigint;
begin
 perform bruff_private.require_owner(w);
 if not bruff_private.can_access(w,c,'settings') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op is null or op not in ('read','save') then raise exception 'Operación no válida' using errcode='22023';end if;
 select s.settings,s.version into config,config_version from bruff_private.generation_settings s where s.workspace_id=w and s.creator_id=c for update;
 if not found then config='{"enabled":false,"dailyLimit":100,"maxResults":3}'::jsonb;config_version=0;end if;
 if op='read' then
  if expected is not null or value is not null then raise exception 'Consulta no válida' using errcode='22023';end if;
 else
  if expected is distinct from config_version then raise exception 'La configuración cambió. Recarga antes de guardar.' using errcode='40001';end if;
  if value is null or jsonb_typeof(value)<>'object' or (value-'enabled'-'dailyLimit'-'maxResults')<>'{}'::jsonb or not (value ?& array['enabled','dailyLimit','maxResults'])
   or jsonb_typeof(value->'enabled') is distinct from 'boolean' or jsonb_typeof(value->'dailyLimit') is distinct from 'number' or jsonb_typeof(value->'maxResults') is distinct from 'number'
  then raise exception 'Configuración no válida' using errcode='22023';end if;
  if (value->>'dailyLimit')::numeric not between 1 and 1000 or (value->>'dailyLimit')::numeric<>trunc((value->>'dailyLimit')::numeric)
   or (value->>'maxResults')::numeric not between 1 and 3 or (value->>'maxResults')::numeric<>trunc((value->>'maxResults')::numeric)
  then raise exception 'Límites de generación no válidos' using errcode='22023';end if;
  config=jsonb_build_object('enabled',(value->>'enabled')::boolean,'dailyLimit',(value->>'dailyLimit')::integer,'maxResults',(value->>'maxResults')::integer);
  insert into bruff_private.generation_settings(workspace_id,creator_id,settings,updated_by) values(w,c,config,auth.uid())
  on conflict(workspace_id,creator_id) do update set settings=excluded.settings,version=bruff_private.generation_settings.version+1,updated_by=auth.uid(),updated_at=now() returning version into config_version;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'generation_settings_saved',c);
 end if;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'settings',config,'version',config_version);
end $$;


commit;
