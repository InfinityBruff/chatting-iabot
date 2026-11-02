-- Read-only discovery checkpoint. Does not activate campaigns or enqueue deliveries.
begin;
create table bruff_private.audience_checkpoints (
 workspace_id uuid not null, creator_id uuid not null, draft_id uuid primary key references bruff_private.auto_message_drafts(id) on delete cascade,
 draft_version bigint not null, binding text not null, checkpoint jsonb,
 lease uuid, lease_until timestamptz, retry_at timestamptz,
 expires_at timestamptz not null default now()+interval '30 minutes',
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id)
);
alter table bruff_private.audience_checkpoints enable row level security;
revoke all on bruff_private.audience_checkpoints from public,anon,authenticated,service_role;
create function public.bruff_audience_checkpoint(w uuid,c uuid,d uuid,v bigint,actor uuid,binding_id text,op text,lease_id uuid default null,value jsonb default null,wait_seconds integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a bruff_private.audience_checkpoints; connection text;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=actor and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 -- The authenticated Edge route checks per-model send access before every operation;
 -- this service-only RPC also verifies the current owner/admin and exact persisted scope.
 select external_id into connection from bruff_private.creator_accounts where workspace_id=w and id=c and connection_status='connected' and provider='ofmapi';
 if connection is distinct from binding_id or connection is null then raise exception 'Conexión modificada';end if;
 if not exists(select 1 from bruff_private.auto_message_drafts where workspace_id=w and creator_id=c and id=d and version=v and not archived) then raise exception 'Borrador modificado';end if;
 if op='acquire' then
  insert into bruff_private.audience_checkpoints(workspace_id,creator_id,draft_id,draft_version,binding) values(w,c,d,v,binding_id) on conflict(draft_id) do nothing;
  select * into a from bruff_private.audience_checkpoints where draft_id=d for update;
  if a.workspace_id<>w or a.creator_id<>c then raise exception 'Ámbito inválido';end if;
  if a.draft_version<>v or a.binding<>binding_id or a.expires_at<=now() then
   update bruff_private.audience_checkpoints set draft_version=v,binding=binding_id,checkpoint=null,lease=null,lease_until=null,retry_at=null,expires_at=now()+interval '30 minutes' where draft_id=d;
   select * into a from bruff_private.audience_checkpoints where draft_id=d;
  end if;
  if a.retry_at>now() or a.lease_until>now() then return jsonb_build_object('busy',true,'retryAfter',greatest(1,ceil(extract(epoch from greatest(a.retry_at,a.lease_until)-now()))::int));end if;
  update bruff_private.audience_checkpoints set lease=gen_random_uuid(),lease_until=now()+interval '90 seconds' where draft_id=d returning * into a;
  return jsonb_build_object('lease',a.lease,'checkpoint',a.checkpoint);
 end if;
 select * into a from bruff_private.audience_checkpoints where draft_id=d for update;
 if a.draft_id is null or a.workspace_id<>w or a.creator_id<>c or a.draft_version<>v or a.binding<>binding_id or a.lease is distinct from lease_id or a.lease_until<=now() or a.expires_at<=now() then return 'false'::jsonb;end if;
 if op='save' then
  if jsonb_typeof(value)<>'object' or jsonb_typeof(value->'ids')<>'array' or jsonb_array_length(value->'ids')>100000 or octet_length(value::text)>5000000 then raise exception 'Avance inválido';end if;
  update bruff_private.audience_checkpoints set checkpoint=value where draft_id=d;
 elsif op='release' then
  if wait_seconds is null or wait_seconds<0 or wait_seconds>86400 then raise exception 'Espera inválida';end if;
  update bruff_private.audience_checkpoints set lease=null,lease_until=null,retry_at=now()+make_interval(secs=>wait_seconds) where draft_id=d;
 elsif op='invalidate' then
  update bruff_private.audience_checkpoints set checkpoint=null,lease=null,lease_until=null,retry_at=null where draft_id=d;
 else raise exception 'Operación inválida';end if;
 return 'true'::jsonb;
end;$$;
revoke all on function public.bruff_audience_checkpoint(uuid,uuid,uuid,bigint,uuid,text,text,uuid,jsonb,integer) from public,anon,authenticated;
grant execute on function public.bruff_audience_checkpoint(uuid,uuid,uuid,bigint,uuid,text,text,uuid,jsonb,integer) to service_role;
commit;
