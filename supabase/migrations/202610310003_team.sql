-- Owner-only team management. Role IDs remain compatible with existing policies.
begin;
alter table bruff_private.memberships add column version bigint not null default 1;
create table bruff_private.team_invites (
 id uuid primary key default gen_random_uuid(), workspace_id uuid not null references bruff_private.workspaces(id),
 email text not null, role text not null check(role in ('admin','operator','viewer')),
 grants jsonb not null, actor_id uuid not null references auth.users(id),
 status text not null default 'prepared' check(status in ('prepared','sent','failed','existing','cancelled')),
 user_id uuid references auth.users(id), created_at timestamptz not null default now()
);
create unique index one_pending_team_invite on bruff_private.team_invites(workspace_id,email) where status='prepared';
create table bruff_private.team_audit (
 id bigint generated always as identity primary key, workspace_id uuid not null references bruff_private.workspaces(id),
 actor_id uuid not null references auth.users(id), action text not null, target_id uuid,
 created_at timestamptz not null default now()
);
alter table bruff_private.team_invites enable row level security;
alter table bruff_private.team_audit enable row level security;
revoke all on bruff_private.team_invites,bruff_private.team_audit from public,anon,authenticated;
create function bruff_private.require_owner(w uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Serializes owner mutations and protects against revocation races.
 perform 1 from bruff_private.workspaces where id=w for update;
 if not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id
 where m.workspace_id=w and m.user_id=auth.uid() and m.role='owner' and m.status='active' and u.email_confirmed_at is not null)
 then raise exception 'Solo el propietario puede gestionar el equipo' using errcode='42501'; end if;
end $$;
create function bruff_private.validate_team_grants(w uuid,r text,g jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if r is null or r not in ('admin','operator','viewer') or g is null or jsonb_typeof(g)<>'array' or jsonb_array_length(g)>500 then raise exception 'Rol o permisos no válidos'; end if;
 if r='admin' and jsonb_array_length(g)<>0 then raise exception 'Manager tiene acceso a todas las modelos'; end if;
 if exists(select 1 from jsonb_array_elements(g) x where jsonb_typeof(x)<>'object'
 or not (x ? 'creator_id' and x ? 'permission') or (x-'creator_id'-'permission')<>'{}'::jsonb
 or coalesce(x->>'permission','') not in ('read','notes','drafts','send','settings')
 or (r='viewer' and x->>'permission'<>'read')
 or not exists(select 1 from bruff_private.creator_accounts a where a.workspace_id=w and a.id::text=x->>'creator_id'))
 then raise exception 'Permisos o modelos no válidos para esta agencia'; end if;
 if exists(select 1 from jsonb_array_elements(g) x where x->>'permission'<>'read' and not exists(
 select 1 from jsonb_array_elements(g) y where y->>'creator_id'=x->>'creator_id' and y->>'permission'='read'))
 then raise exception 'Cada acción requiere permiso de consulta'; end if;
end $$;
create function public.bruff_team_snapshot(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform bruff_private.require_owner(w);
 return jsonb_build_object(
 'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'status',m.status,'version',m.version,'confirmed',u.email_confirmed_at is not null) order by m.created_at) from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w),'[]'::jsonb),
 'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'status',a.connection_status) order by a.display_name) from bruff_private.creator_accounts a where a.workspace_id=w),'[]'::jsonb),
 'grants',coalesce((select jsonb_agg(jsonb_build_object('user_id',g.user_id,'creator_id',g.creator_id,'permission',g.permission)) from bruff_private.account_grants g where g.workspace_id=w),'[]'::jsonb),
 'invites',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from (select id,email,role,status,created_at from bruff_private.team_invites where workspace_id=w order by created_at desc limit 50) i),'[]'::jsonb));
end $$;
create function public.bruff_team_update(w uuid,target uuid,r text,s text,g jsonb,expected_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare current_member bruff_private.memberships;
begin
 perform bruff_private.require_owner(w);
 select * into current_member from bruff_private.memberships where workspace_id=w and user_id=target for update;
 if not found or current_member.role='owner' or target=auth.uid() then raise exception 'No puedes modificar al propietario ni a un miembro ajeno'; end if;
 if expected_version is null or current_member.version<>expected_version then raise exception 'La ficha ha cambiado. Recarga antes de guardar' using errcode='40001'; end if;
 if s is null or s not in ('active','disabled') then raise exception 'Estado no válido'; end if;
 perform bruff_private.validate_team_grants(w,r,g);
 update bruff_private.memberships set role=r,status=s,version=version+1 where workspace_id=w and user_id=target;
 delete from bruff_private.account_grants where workspace_id=w and user_id=target;
 insert into bruff_private.account_grants select distinct w,target,(x->>'creator_id')::uuid,x->>'permission' from jsonb_array_elements(g) x;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'member_updated',target);
end $$;
create function public.bruff_team_add_account(w uuid,display_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform bruff_private.require_owner(w);
 if display_name is null or length(trim(display_name)) not between 1 and 120 then raise exception 'Nombre no válido'; end if;
 insert into bruff_private.creator_accounts(workspace_id,display_name) values(w,trim(display_name)) returning id into result;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'account_registered_disconnected',result);
 return result;
end $$;
create function public.bruff_team_prepare_invite(w uuid,email_address text,r text,g jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(trim(email_address)); result uuid; existing_user uuid;
begin
 perform bruff_private.require_owner(w);
 perform bruff_private.validate_team_grants(w,r,g);
 if normalized is null or length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Correo no válido'; end if;
 if exists(select 1 from bruff_private.team_invites where workspace_id=w and created_at>now()-interval '1 minute') then raise exception 'Espera un minuto antes de otra invitación'; end if;
 select id into existing_user from auth.users where lower(email)=normalized limit 1;
 if exists(select 1 from bruff_private.memberships where workspace_id=w and user_id=existing_user) then raise exception 'Esta persona ya pertenece al equipo'; end if;
 insert into bruff_private.team_invites(workspace_id,email,role,grants,actor_id) values(w,normalized,r,g,auth.uid()) returning id into result;
 return jsonb_build_object('id',result,'email',normalized,'existing_user',existing_user);
end $$;
-- Only the Edge Function's service role can finalize an Auth invitation.
create function public.bruff_team_finish_invite(ticket uuid,target uuid,result_status text) returns void
language plpgsql security definer set search_path='' as $$
declare i bruff_private.team_invites;
begin
 select * into i from bruff_private.team_invites where id=ticket;
 if not found then raise exception 'Invitación no encontrada'; end if;
 perform 1 from bruff_private.workspaces where id=i.workspace_id for update;
 select * into i from bruff_private.team_invites where id=ticket for update;
 if i.status<>'prepared' then raise exception 'Invitación ya procesada'; end if;
 if result_status is null or result_status not in ('sent','failed','existing') then raise exception 'Resultado no válido'; end if;
 if result_status='failed' then update bruff_private.team_invites set status='failed' where id=ticket; return; end if;
 if not exists(select 1 from bruff_private.memberships where workspace_id=i.workspace_id and user_id=i.actor_id and role='owner' and status='active') then raise exception 'Propietario sin acceso'; end if;
 if not exists(select 1 from auth.users where id=target and lower(email)=i.email) then raise exception 'La identidad no coincide con la invitación'; end if;
 perform bruff_private.validate_team_grants(i.workspace_id,i.role,i.grants);
 insert into bruff_private.memberships(workspace_id,user_id,role,status) values(i.workspace_id,target,i.role,'active');
 insert into bruff_private.account_grants select distinct i.workspace_id,target,(x->>'creator_id')::uuid,x->>'permission' from jsonb_array_elements(i.grants) x;
 update bruff_private.team_invites set status=result_status,user_id=target where id=ticket;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(i.workspace_id,i.actor_id,'member_invited',target);
end $$;
create function public.bruff_team_cancel_invite(w uuid,ticket uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform bruff_private.require_owner(w);
 update bruff_private.team_invites set status='cancelled' where id=ticket and workspace_id=w and status='prepared';
 if not found then raise exception 'No hay una invitación pendiente para cancelar'; end if;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'invite_cancelled',ticket);
end $$;
revoke all on function bruff_private.require_owner(uuid),bruff_private.validate_team_grants(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.bruff_team_snapshot(uuid),public.bruff_team_update(uuid,uuid,text,text,jsonb,bigint),public.bruff_team_add_account(uuid,text),public.bruff_team_prepare_invite(uuid,text,text,jsonb),public.bruff_team_cancel_invite(uuid,uuid) from public,anon;
grant execute on function public.bruff_team_snapshot(uuid),public.bruff_team_update(uuid,uuid,text,text,jsonb,bigint),public.bruff_team_add_account(uuid,text),public.bruff_team_prepare_invite(uuid,text,text,jsonb),public.bruff_team_cancel_invite(uuid,uuid) to authenticated;
revoke all on function public.bruff_team_finish_invite(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bruff_team_finish_invite(uuid,uuid,text) to service_role;
insert into bruff_private.schema_versions(version) values('202610310003_team');
commit;
