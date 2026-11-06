-- Private controls for MANUAL example retrieval only. No bot routing, provider
-- transport, fan storage, generation job or automatic schedule is changed.
begin;

create table bruff_private.ai_manual_settings (
 workspace_id uuid not null,
 creator_id uuid not null,
 settings jsonb not null,
 version bigint not null default 1 check(version>0),
 updated_by uuid not null references auth.users(id),
 updated_at timestamptz not null default now(),
 primary key(workspace_id,creator_id),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 check(jsonb_typeof(settings)='object' and (settings-'mode'-'maxResults'-'minScore'-'dailyLimit')='{}'::jsonb
  and settings ?& array['mode','maxResults','minScore','dailyLimit']
  and jsonb_typeof(settings->'mode')='string' and settings->>'mode' in ('bank','semantic')
  and jsonb_typeof(settings->'maxResults')='number' and (settings->>'maxResults')::numeric between 1 and 3 and (settings->>'maxResults')::numeric=trunc((settings->>'maxResults')::numeric)
  and jsonb_typeof(settings->'minScore')='number' and (settings->>'minScore')::numeric between 0.5 and 0.99
  and jsonb_typeof(settings->'dailyLimit')='number' and (settings->>'dailyLimit')::numeric between 1 and 100 and (settings->>'dailyLimit')::numeric=trunc((settings->>'dailyLimit')::numeric))
);
create table bruff_private.ai_manual_usage (
 workspace_id uuid not null,
 creator_id uuid not null,
 request_id uuid not null,
 actor_id uuid not null references auth.users(id),
 settings_version bigint not null check(settings_version>0),
 created_at timestamptz not null,
 usage_day date not null,
 primary key(workspace_id,request_id),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 check(usage_day=(created_at at time zone 'UTC')::date)
);
alter table bruff_private.ai_manual_settings enable row level security;
alter table bruff_private.ai_manual_usage enable row level security;
revoke all on bruff_private.ai_manual_settings,bruff_private.ai_manual_usage from public,anon,authenticated;
create index ai_manual_usage_workspace_day on bruff_private.ai_manual_usage(workspace_id,usage_day);
create index ai_manual_usage_model_day on bruff_private.ai_manual_usage(workspace_id,creator_id,usage_day);
create index ai_manual_usage_actor_minute on bruff_private.ai_manual_usage(actor_id,created_at);

create function public.bruff_ai_models(w uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
  or not exists(select 1 from bruff_private.memberships m where m.user_id=auth.uid() and m.role='owner' and m.status='active' and (w is null or m.workspace_id=w))
 then raise exception 'Solo el propietario confirmado puede consultar el control de IA' using errcode='42501';end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'models',
  coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name) order by a.display_name,a.id) from bruff_private.creator_accounts a where a.workspace_id=s.id),'[]'::jsonb)) order by s.name,s.id),'[]'::jsonb) into result
 from bruff_private.workspaces s join bruff_private.memberships m on m.workspace_id=s.id
 where m.user_id=auth.uid() and m.role='owner' and m.status='active' and (w is null or s.id=w);
 return jsonb_build_object('actorId',auth.uid(),'workspaces',result);
end $$;

create function public.bruff_ai_control(w uuid,c uuid,op text default 'read',expected bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare config jsonb; config_version bigint;
begin
 perform bruff_private.require_owner(w);
 if not bruff_private.can_access(w,c,'settings') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op is null or op not in ('read','save') then raise exception 'Operación no válida' using errcode='22023';end if;
 select s.settings,s.version into config,config_version from bruff_private.ai_manual_settings s where s.workspace_id=w and s.creator_id=c for update;
 if not found then config='{"mode":"bank","maxResults":3,"minScore":0.65,"dailyLimit":20}'::jsonb;config_version=0;end if;
 if op='read' then
  if expected is not null or value is not null then raise exception 'Consulta no válida' using errcode='22023';end if;
 else
  if expected is distinct from config_version then raise exception 'La configuración cambió. Recarga antes de guardar.' using errcode='40001';end if;
  if value is null or jsonb_typeof(value)<>'object' or (value-'mode'-'maxResults'-'minScore'-'dailyLimit')<>'{}'::jsonb or not (value ?& array['mode','maxResults','minScore','dailyLimit'])
   or jsonb_typeof(value->'mode') is distinct from 'string' or value->>'mode' not in ('bank','semantic')
   or jsonb_typeof(value->'maxResults') is distinct from 'number' or jsonb_typeof(value->'minScore') is distinct from 'number' or jsonb_typeof(value->'dailyLimit') is distinct from 'number'
  then raise exception 'Configuración de recuperación manual no válida' using errcode='22023';end if;
  if (value->>'maxResults')::numeric not between 1 and 3 or (value->>'maxResults')::numeric<>trunc((value->>'maxResults')::numeric)
   or (value->>'minScore')::numeric not between 0.5 and 0.99
   or (value->>'dailyLimit')::numeric not between 1 and 100 or (value->>'dailyLimit')::numeric<>trunc((value->>'dailyLimit')::numeric)
  then raise exception 'Límites de recuperación manual no válidos' using errcode='22023';end if;
  config=jsonb_build_object('mode',value->>'mode','maxResults',(value->>'maxResults')::integer,'minScore',(value->>'minScore')::numeric,'dailyLimit',(value->>'dailyLimit')::integer);
  insert into bruff_private.ai_manual_settings(workspace_id,creator_id,settings,updated_by)
  values(w,c,config,auth.uid()) on conflict(workspace_id,creator_id) do update
  set settings=excluded.settings,version=bruff_private.ai_manual_settings.version+1,updated_by=auth.uid(),updated_at=now() returning version into config_version;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'ai_manual_settings_saved',c);
 end if;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'settings',config,'version',config_version);
end $$;

create function public.bruff_ai_pool(w uuid,c uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare config jsonb; config_version bigint; approved_count integer; result jsonb;
begin
 if not bruff_private.can_access(w,c,'read') or not bruff_private.can_access(w,c,'send')
  or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 select s.settings,s.version into config,config_version from bruff_private.ai_manual_settings s where s.workspace_id=w and s.creator_id=c;
 if not found then config='{"mode":"bank","maxResults":3,"minScore":0.65,"dailyLimit":20}'::jsonb;config_version=0;end if;
 select count(*) into approved_count from bruff_private.chat_direct_examples e where e.workspace_id=w and e.creator_id=c and e.state='verified';
 if config->>'mode'='bank' then return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'settings',config,'version',config_version,'approvedCount',approved_count,'rows','[]'::jsonb);end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'trigger',trigger,'english',english,'spanish',spanish,'variables','[]'::jsonb,'source',jsonb_build_object('kind','document','modelId',c,'referenceId',reference_id,'label',label,'version',source_version||'.r'||version::text,'verified',true)) order by id),'[]'::jsonb) into result
 from (select e.id,e.trigger,e.english,e.spanish,e.reference_id,e.label,e.source_version,e.version from bruff_private.chat_direct_examples e where e.workspace_id=w and e.creator_id=c and e.state='verified' order by e.id limit 200) approved;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'settings',config,'version',config_version,'approvedCount',approved_count,'rows',result);
end $$;

create function public.bruff_ai_claim(w uuid,c uuid,request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); req uuid:=request_id; config jsonb; config_version bigint; moment timestamptz; day_key date; used integer; first_at timestamptz; identity jsonb; retry_seconds integer;
begin
 if req is null then raise exception 'Identificador de petición no válido' using errcode='22023';end if;
 if not bruff_private.can_access(w,c,'read') or not bruff_private.can_access(w,c,'send')
  or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 -- The actor limit is global across agencies/models. Serialize the actor first,
 -- then the workspace, and recheck current grants after either lock has waited.
 perform pg_advisory_xact_lock(hashtextextended('bruff.ai.actor:'||actor::text,0));
 perform 1 from bruff_private.workspaces where id=w for update;
 if not bruff_private.can_access(w,c,'read') or not bruff_private.can_access(w,c,'send')
  or not exists(select 1 from auth.users where id=actor and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 identity=jsonb_build_object('actorId',actor,'workspaceId',w,'creatorId',c);
 select s.settings,s.version into config,config_version from bruff_private.ai_manual_settings s where s.workspace_id=w and s.creator_id=c for update;
 if not found then config='{"mode":"bank","maxResults":3,"minScore":0.65,"dailyLimit":20}'::jsonb;config_version=0;end if;
 if exists(select 1 from bruff_private.ai_manual_usage u where u.workspace_id=w and u.request_id=req) then return identity||jsonb_build_object('allowed',false,'reason','duplicate');end if;
 if config->>'mode'<>'semantic' then return identity||jsonb_build_object('allowed',false,'reason','bank');end if;
 moment=clock_timestamp();day_key=(moment at time zone 'UTC')::date;
 retry_seconds=greatest(1,ceil(extract(epoch from (((day_key+1)::timestamp at time zone 'UTC')-moment)))::integer);
 select count(*) into used from bruff_private.ai_manual_usage u where u.workspace_id=w and u.creator_id=c and u.usage_day=day_key;
 if used>=(config->>'dailyLimit')::integer then return identity||jsonb_build_object('allowed',false,'reason','model_daily_limit','retryAfter',retry_seconds);end if;
 select count(*) into used from bruff_private.ai_manual_usage u where u.workspace_id=w and u.usage_day=day_key;
 if used>=200 then return identity||jsonb_build_object('allowed',false,'reason','workspace_daily_limit','retryAfter',retry_seconds);end if;
 select count(*),min(u.created_at) into used,first_at from bruff_private.ai_manual_usage u where u.actor_id=actor and u.created_at>moment-interval '1 minute';
 if used>=10 then return identity||jsonb_build_object('allowed',false,'reason','actor_minute_limit','retryAfter',greatest(1,ceil(extract(epoch from (first_at+interval '1 minute'-moment)))::integer));end if;
 insert into bruff_private.ai_manual_usage(workspace_id,creator_id,request_id,actor_id,settings_version,created_at,usage_day) values(w,c,req,actor,config_version,moment,day_key);
 return identity||jsonb_build_object('allowed',true,'reason','allowed');
end $$;

revoke all on function public.bruff_ai_models(uuid),public.bruff_ai_control(uuid,uuid,text,bigint,jsonb),public.bruff_ai_pool(uuid,uuid),public.bruff_ai_claim(uuid,uuid,uuid) from public,anon;
grant execute on function public.bruff_ai_models(uuid),public.bruff_ai_control(uuid,uuid,text,bigint,jsonb),public.bruff_ai_pool(uuid,uuid),public.bruff_ai_claim(uuid,uuid,uuid) to authenticated;
insert into bruff_private.schema_versions(version) values('202611060041_ai_control');
notify pgrst,'reload schema';
commit;
