-- Dormant queue infrastructure. No scheduler, activation route or provider calls.
begin;
create table bruff_private.advanced_runs(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,creator_id uuid not null,
 draft_id uuid not null references bruff_private.auto_message_drafts(id),draft_version bigint not null,
 activated_by uuid not null,activated_at timestamptz,
 state text not null default 'paused' check(state in ('active','paused','stopped','completed')),
 revision bigint not null default 1,ends_at timestamptz not null,
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 foreign key(workspace_id,activated_by) references bruff_private.memberships(workspace_id,user_id)
);
create table bruff_private.advanced_deliveries(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references bruff_private.advanced_runs(id),
 fan_id text not null check(fan_id ~ '^[0-9]{1,24}$'),cycle bigint not null default 0 check(cycle>=0),
 step_index int not null check(step_index between 0 and 4),due_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','claimed','sending','sent','uncertain','blocked')),
 lease uuid,lease_until timestamptz,run_revision bigint,payload jsonb,provider_id text,
 detail text,updated_at timestamptz not null default now(),
 unique(run_id,cycle,fan_id,step_index)
);
alter table bruff_private.advanced_runs enable row level security;
alter table bruff_private.advanced_deliveries enable row level security;
revoke all on bruff_private.advanced_runs,bruff_private.advanced_deliveries from public,anon,authenticated,service_role;
create index advanced_deliveries_due on bruff_private.advanced_deliveries(state,due_at);

create function bruff_private.advanced_allowed(r bruff_private.advanced_runs) returns boolean
language sql stable security definer set search_path='' as $$
 select r.state='active' and r.activated_at is not null and r.activated_at<=now() and r.ends_at>now()
 and exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id
 where m.workspace_id=r.workspace_id and m.user_id=r.activated_by and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null)
 and exists(select 1 from bruff_private.auto_message_drafts d where d.id=r.draft_id and d.workspace_id=r.workspace_id and d.creator_id=r.creator_id and d.version=r.draft_version and not d.archived)
 and exists(select 1 from bruff_private.creator_accounts c where c.workspace_id=r.workspace_id and c.id=r.creator_id and c.connection_status='connected');
$$;
revoke all on function bruff_private.advanced_allowed(bruff_private.advanced_runs) from public,anon,authenticated,service_role;

create function public.bruff_advanced_delivery(op text,delivery_id uuid,lease_id uuid default null,expected_revision bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d bruff_private.advanced_deliveries;r bruff_private.advanced_runs;config jsonb;w uuid;rid uuid;
begin
 if op is null or op not in ('claim','authorize','begin','finish','release') then raise exception 'Operación inválida';end if;
 select x.workspace_id,x.id into w,rid from bruff_private.advanced_runs x join bruff_private.advanced_deliveries y on y.run_id=x.id where y.id=delivery_id;
 if w is null then return null;end if;
 -- Same lock order as permissions and pause: workspace, run, delivery.
 perform 1 from bruff_private.workspaces where id=w for update;
 select * into r from bruff_private.advanced_runs where id=rid for update;
 select * into d from bruff_private.advanced_deliveries where id=delivery_id for update;
 if op='claim' then
  if d.state='sending' and d.lease_until<=now() then update bruff_private.advanced_deliveries set state='uncertain',detail='Proceso interrumpido después de iniciar el envío',updated_at=now() where id=d.id;return null;end if;
  if not bruff_private.advanced_allowed(r) or d.due_at>now() or d.state not in ('pending','claimed') or d.state='claimed' and d.lease_until>now() then return null;end if;
  if d.step_index>0 and not exists(select 1 from bruff_private.advanced_deliveries p where p.run_id=d.run_id and p.cycle=d.cycle and p.fan_id=d.fan_id and p.step_index=d.step_index-1 and p.state='sent') then return null;end if;
  select a.config into config from bruff_private.auto_message_drafts a where a.id=r.draft_id;
  if config->'messages'->d.step_index is null then raise exception 'Mensaje ausente';end if;
  update bruff_private.advanced_deliveries set state='claimed',lease=gen_random_uuid(),lease_until=now()+interval '60 seconds',run_revision=r.revision,updated_at=now() where id=d.id returning * into d;
  return jsonb_build_object('id',d.id,'activationId',r.id,'status','claimed','lease',d.lease,'revision',r.revision,'scope',jsonb_build_object('workspace',r.workspace_id,'creator',r.creator_id,'fan',d.fan_id),'dueAt',d.due_at,'expiresAt',d.lease_until,'stepIndex',d.step_index,'trigger',config->>'trigger','message',config->'messages'->d.step_index);
 end if;
 if lease_id is distinct from d.lease or expected_revision is distinct from d.run_revision then return 'false'::jsonb;end if;
 if op='finish' then
  if d.state<>'sending' then return 'false'::jsonb;end if;
  if value->>'status'='sent' and coalesce(value->>'providerId','')~'^[0-9]{1,24}$' then
   update bruff_private.advanced_deliveries set state='sent',provider_id=value->>'providerId',updated_at=now() where id=d.id;
  elsif value->>'status'='uncertain' then update bruff_private.advanced_deliveries set state='uncertain',detail='Resultado pendiente de revisión',updated_at=now() where id=d.id;
  else raise exception 'Resultado inválido';end if;return 'true'::jsonb;
 end if;
 if op='release' then
  if d.state<>'claimed' then return 'false'::jsonb;end if;
  update bruff_private.advanced_deliveries set state='blocked',detail=left(coalesce(value->>'reason','Preparación interrumpida'),200),updated_at=now() where id=d.id;return 'true'::jsonb;
 end if;
 if d.state<>'claimed' or d.lease_until<=now() or r.revision<>expected_revision or not bruff_private.advanced_allowed(r) then return 'false'::jsonb;end if;
 if op='authorize' then return 'true'::jsonb;end if;
 if value is null or jsonb_typeof(value)<>'object' or jsonb_typeof(value->'text') is distinct from 'string' or length(value->>'text')>3000 or jsonb_typeof(value->'media') is distinct from 'array' or jsonb_typeof(value->'price') is distinct from 'number' or (value->>'price')::numeric<0 then raise exception 'Payload inválido';end if;
 update bruff_private.advanced_deliveries set state='sending',payload=value,updated_at=now() where id=d.id;return 'true'::jsonb;
end $$;
revoke all on function public.bruff_advanced_delivery(text,uuid,uuid,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.bruff_advanced_delivery(text,uuid,uuid,bigint,jsonb) to service_role;
commit;
