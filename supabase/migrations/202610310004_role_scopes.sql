-- Requested roles: Manager operates team; Chatter chats only; Analyst analytics only.
begin;
alter table bruff_private.account_grants drop constraint account_grants_permission_check;
alter table bruff_private.account_grants add constraint account_grants_permission_check check(permission in ('read','notes','drafts','send','settings','analytics','vault'));
-- Preserve assigned models for analysts, while removing access to conversations.
insert into bruff_private.account_grants(workspace_id,user_id,creator_id,permission)
select g.workspace_id,g.user_id,g.creator_id,'analytics' from bruff_private.account_grants g
join bruff_private.memberships m using(workspace_id,user_id) where m.role='viewer' and g.permission='read'
on conflict do nothing;
delete from bruff_private.account_grants g using bruff_private.memberships m
where g.workspace_id=m.workspace_id and g.user_id=m.user_id and
((m.role='viewer' and g.permission<>'analytics') or (m.role='operator' and g.permission not in ('read','drafts','send')));
create or replace function bruff_private.can_access(w uuid,c uuid,p text) returns boolean
language sql stable security definer set search_path='' as $$
select p in ('read','notes','drafts','send','settings','analytics','vault') and exists(
 select 1 from bruff_private.memberships m join bruff_private.creator_accounts a on a.workspace_id=m.workspace_id and a.id=c
 where m.workspace_id=w and m.user_id=auth.uid() and m.status='active'
 and (m.role in ('owner','admin') or (
 ((m.role='operator' and p in ('read','drafts','send')) or (m.role='viewer' and p='analytics'))
 and exists(select 1 from bruff_private.account_grants g where g.workspace_id=w and g.creator_id=c and g.user_id=m.user_id and g.permission=p))))
$$;
create or replace function bruff_private.require_team_manager(w uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 -- Serializes owner mutations and protects against revocation races.
 perform 1 from bruff_private.workspaces where id=w for update;
 if not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id
 where m.workspace_id=w and m.user_id=auth.uid() and m.role in ('owner','admin') and m.status='active' and u.email_confirmed_at is not null)
 then raise exception 'Solo Propietario o Manager pueden gestionar el equipo' using errcode='42501'; end if;
end $$;
create or replace function bruff_private.validate_team_grants(w uuid,r text,g jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if r is null or r not in ('admin','operator','viewer') or g is null or jsonb_typeof(g)<>'array' or jsonb_array_length(g)>500 then raise exception 'Rol o permisos no válidos'; end if;
 if r='admin' and jsonb_array_length(g)<>0 then raise exception 'Manager tiene acceso a todas las modelos'; end if;
 if exists(select 1 from jsonb_array_elements(g) x where jsonb_typeof(x)<>'object'
 or not (x ? 'creator_id' and x ? 'permission') or (x-'creator_id'-'permission')<>'{}'::jsonb
 or coalesce(x->>'permission','') not in ('read','notes','drafts','send','settings','analytics','vault')
 or (r='viewer' and x->>'permission'<>'analytics')
 or (r='operator' and x->>'permission' not in ('read','drafts','send'))
 or not exists(select 1 from bruff_private.creator_accounts a where a.workspace_id=w and a.id::text=x->>'creator_id'))
 then raise exception 'Permisos o modelos no válidos para esta agencia'; end if;
 if exists(select 1 from jsonb_array_elements(g) x where x->>'permission' in ('notes','drafts','send') and not exists(
 select 1 from jsonb_array_elements(g) y where y->>'creator_id'=x->>'creator_id' and y->>'permission'='read'))
 then raise exception 'Cada acción requiere permiso de consulta'; end if;
end $$;
create or replace function public.bruff_team_snapshot(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform bruff_private.require_team_manager(w);
 return jsonb_build_object(
 'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'role',m.role,'status',m.status,'version',m.version,'confirmed',u.email_confirmed_at is not null) order by m.created_at) from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w),'[]'::jsonb),
 'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'status',a.connection_status) order by a.display_name) from bruff_private.creator_accounts a where a.workspace_id=w),'[]'::jsonb),
 'grants',coalesce((select jsonb_agg(jsonb_build_object('user_id',g.user_id,'creator_id',g.creator_id,'permission',g.permission)) from bruff_private.account_grants g where g.workspace_id=w),'[]'::jsonb),
 'invites',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from (select id,email,role,status,created_at from bruff_private.team_invites where workspace_id=w order by created_at desc limit 50) i),'[]'::jsonb));
end $$;
create or replace function public.bruff_team_update(w uuid,target uuid,r text,s text,g jsonb,expected_version bigint) returns void
language plpgsql security definer set search_path='' as $$
declare current_member bruff_private.memberships;
begin
 perform bruff_private.require_team_manager(w);
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
create or replace function public.bruff_team_add_account(w uuid,display_name text) returns uuid
language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 perform bruff_private.require_team_manager(w);
 if display_name is null or length(trim(display_name)) not between 1 and 120 then raise exception 'Nombre no válido'; end if;
 insert into bruff_private.creator_accounts(workspace_id,display_name) values(w,trim(display_name)) returning id into result;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'account_registered_disconnected',result);
 return result;
end $$;
create or replace function public.bruff_team_prepare_invite(w uuid,email_address text,r text,g jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(trim(email_address)); result uuid; existing_user uuid;
begin
 perform bruff_private.require_team_manager(w);
 perform bruff_private.validate_team_grants(w,r,g);
 if normalized is null or length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Correo no válido'; end if;
 if exists(select 1 from bruff_private.team_invites where workspace_id=w and created_at>now()-interval '1 minute') then raise exception 'Espera un minuto antes de otra invitación'; end if;
 select id into existing_user from auth.users where lower(email)=normalized limit 1;
 if exists(select 1 from bruff_private.memberships where workspace_id=w and user_id=existing_user) then raise exception 'Esta persona ya pertenece al equipo'; end if;
 insert into bruff_private.team_invites(workspace_id,email,role,grants,actor_id) values(w,normalized,r,g,auth.uid()) returning id into result;
 return jsonb_build_object('id',result,'email',normalized,'existing_user',existing_user);
end $$;
-- Only the Edge Function's service role can finalize an Auth invitation.
create or replace function public.bruff_team_finish_invite(ticket uuid,target uuid,result_status text) returns void
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
 if not exists(select 1 from bruff_private.memberships where workspace_id=i.workspace_id and user_id=i.actor_id and role in ('owner','admin') and status='active') then raise exception 'Propietario sin acceso'; end if;
 if not exists(select 1 from auth.users where id=target and lower(email)=i.email) then raise exception 'La identidad no coincide con la invitación'; end if;
 perform bruff_private.validate_team_grants(i.workspace_id,i.role,i.grants);
 insert into bruff_private.memberships(workspace_id,user_id,role,status) values(i.workspace_id,target,i.role,'active');
 insert into bruff_private.account_grants select distinct i.workspace_id,target,(x->>'creator_id')::uuid,x->>'permission' from jsonb_array_elements(i.grants) x;
 update bruff_private.team_invites set status=result_status,user_id=target where id=ticket;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(i.workspace_id,i.actor_id,'member_invited',target);
end $$;
create or replace function public.bruff_team_cancel_invite(w uuid,ticket uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 perform bruff_private.require_team_manager(w);
 update bruff_private.team_invites set status='cancelled' where id=ticket and workspace_id=w and status='prepared';
 if not found then raise exception 'No hay una invitación pendiente para cancelar'; end if;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'invite_cancelled',ticket);
end $$;

revoke all on function bruff_private.require_team_manager(uuid) from public,anon,authenticated;
drop policy note_read on bruff_private.fan_notes;
create policy note_read on bruff_private.fan_notes for select to authenticated using(bruff_private.can_access(workspace_id,creator_id,'notes'));
insert into bruff_private.schema_versions(version) values('202610310004_role_scopes');
commit;
