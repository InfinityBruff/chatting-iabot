begin;
create table bruff_private.native_mass_runs(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,creator_id uuid not null,draft_id uuid not null,draft_version bigint not null,
 binding text not null,recipients jsonb not null,config jsonb not null,revision bigint not null default 1,
 state text not null default 'prepared' check(state in ('prepared','submitting','accepted','uncertain')),
 prepared_at timestamptz not null default now(),actor uuid not null references auth.users(id),payload jsonb,queue_id text,message_id text,
 unique(draft_id,draft_version),foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id)
);
alter table bruff_private.native_mass_runs enable row level security;
revoke all on bruff_private.native_mass_runs from public,anon,authenticated,service_role;
create function public.bruff_native_mass(w uuid,c uuid,actor uuid,op text,run_id uuid default null,d uuid default null,v bigint default null,binding_id text default null,recipients jsonb default null,expected_revision bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bruff_private.native_mass_runs;cfg jsonb;role_name text;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 select m.role into role_name from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=actor and m.status='active' and u.email_confirmed_at is not null;
 if role_name is null or role_name not in ('owner','admin') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op='prepare' then
  select config into cfg from bruff_private.auto_message_drafts where id=d and workspace_id=w and creator_id=c and version=v and not archived;
  if cfg is null or cfg->>'trigger'<>'mass' or (cfg->'bulk'->>'repeat')::boolean or jsonb_array_length(cfg->'messages')<>1 or position('{nombre}' in cfg->'messages'->0->>'text')>0 then raise exception 'Campaña incompatible con masivo nativo';end if;
  if not exists(select 1 from bruff_private.creator_accounts where workspace_id=w and id=c and external_id=binding_id and provider='ofmapi' and connection_status='connected') then raise exception 'Conexión modificada';end if;
  if recipients is null or jsonb_typeof(recipients)<>'array' or jsonb_array_length(recipients) not between 1 and 100000 or exists(select 1 from jsonb_array_elements_text(recipients)x where x !~ '^[1-9][0-9]{0,15}$' or x::numeric>9007199254740991) then raise exception 'Destinatarios inválidos';end if;
  select * into r from bruff_private.native_mass_runs where draft_id=d and draft_version=v for update;
  if r.id is null then
   insert into bruff_private.native_mass_runs(workspace_id,creator_id,draft_id,draft_version,binding,recipients,config,actor) values(w,c,d,v,binding_id,recipients,cfg,actor) returning * into r;
  elsif r.state='prepared' then
   update bruff_private.native_mass_runs set recipients=bruff_native_mass.recipients,binding=binding_id,prepared_at=now(),revision=revision+1 where id=r.id returning * into r;
  end if;
 else
  select * into r from bruff_private.native_mass_runs where id=run_id and workspace_id=w and creator_id=c for update;
  if r.id is null then raise exception 'Ejecución no encontrada';end if;
  if op in ('context','begin','authorize') then
   if role_name<>'owner' or r.revision is distinct from expected_revision or r.state not in ('prepared','submitting') or r.prepared_at<now()-interval '30 minutes' then raise exception 'Preparación caducada, modificada o ya enviada';end if;
   if not exists(select 1 from bruff_private.auto_message_drafts where id=r.draft_id and version=r.draft_version and workspace_id=w and creator_id=c and not archived) or not exists(select 1 from bruff_private.creator_accounts where workspace_id=w and id=c and external_id=r.binding and provider='ofmapi' and connection_status='connected') then raise exception 'Borrador o conexión modificados';end if;
   if op='begin' then
    if r.state<>'prepared' then return 'false'::jsonb;end if;
    update bruff_private.native_mass_runs set state='submitting',payload=value,actor=bruff_native_mass.actor where id=r.id;
    return 'true'::jsonb;
   elsif op='authorize' then return to_jsonb(r.binding);end if;
  elsif op='finish' then
   if r.actor is distinct from actor or r.state<>'submitting' or r.revision is distinct from expected_revision or value->>'state' not in ('accepted','uncertain') then raise exception 'Resultado inválido';end if;
   update bruff_private.native_mass_runs set state=value->>'state',queue_id=value->>'queueId',message_id=value->>'messageId' where id=r.id returning * into r;
  else raise exception 'Operación no disponible';end if;
 end if;
 return jsonb_build_object('id',r.id,'workspace',r.workspace_id,'creator',r.creator_id,'draftId',r.draft_id,'draftVersion',r.draft_version,'binding',r.binding,'config',r.config,'recipients',r.recipients,'revision',r.revision,'state',r.state,'kind','native');
end;$$;
revoke all on function public.bruff_native_mass(uuid,uuid,uuid,text,uuid,uuid,bigint,text,jsonb,bigint,jsonb) from public,anon,authenticated;
grant execute on function public.bruff_native_mass(uuid,uuid,uuid,text,uuid,uuid,bigint,text,jsonb,bigint,jsonb) to service_role;
create function public.bruff_native_status(w uuid,c uuid,run_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bruff_private.native_mass_runs;owner_access boolean;
begin
 if not bruff_private.can_access(w,c,'send') or not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null) then raise exception 'Acceso no permitido';end if;
 select * into r from bruff_private.native_mass_runs where id=run_id and workspace_id=w and creator_id=c;
 if r.id is null then raise exception 'Ejecución no encontrada';end if;
 select exists(select 1 from bruff_private.memberships where workspace_id=w and user_id=auth.uid() and role='owner' and status='active') into owner_access;
 return jsonb_build_object('id',r.id,'draftId',r.draft_id,'draftVersion',r.draft_version,'revision',r.revision,'state',r.state,'count',jsonb_array_length(r.recipients),'kind','native','plan',jsonb_build_object('cycles',1),'canActivate',owner_access and r.state='prepared' and r.prepared_at>now()-interval '30 minutes','ownerAccess',owner_access,'queueId',r.queue_id,'messageId',r.message_id);
end;$$;
revoke all on function public.bruff_native_status(uuid,uuid,uuid) from public,anon;
grant execute on function public.bruff_native_status(uuid,uuid,uuid) to authenticated;
commit;
