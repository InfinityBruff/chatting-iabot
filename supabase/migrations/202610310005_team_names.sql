-- Display names are labels; immutable user IDs still determine identity and access.
begin;
alter table bruff_private.memberships add column display_name text check(display_name is null or length(btrim(display_name)) between 1 and 80);
alter table bruff_private.team_invites add column display_name text check(display_name is null or length(btrim(display_name)) between 1 and 80);
alter table bruff_private.team_audit add column actor_name text;
alter table bruff_private.team_audit add column target_name text;
create function bruff_private.validate_display_name(n text) returns void language plpgsql set search_path='' as $$
begin if n is null or length(btrim(n)) not between 1 and 80 or n ~ '[[:cntrl:]]' then raise exception 'Indica un nombre de 1 a 80 caracteres, sin saltos de línea'; end if; end $$;
create function bruff_private.team_audit_names() returns trigger language plpgsql security definer set search_path='' as $$
begin
 select display_name into new.actor_name from bruff_private.memberships where workspace_id=new.workspace_id and user_id=new.actor_id;
 select display_name into new.target_name from bruff_private.memberships where workspace_id=new.workspace_id and user_id=new.target_id;
 return new;
end $$;
create trigger team_audit_names before insert on bruff_private.team_audit for each row execute function bruff_private.team_audit_names();
create or replace function public.bruff_team_snapshot(w uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 perform bruff_private.require_team_manager(w);
 return jsonb_build_object(
 'audit',coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at desc) from (select id,action,actor_name,target_name,created_at from bruff_private.team_audit where workspace_id=w order by created_at desc,id desc limit 50) a),'[]'::jsonb),
 'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'email',u.email,'display_name',m.display_name,'role',m.role,'status',m.status,'version',m.version,'confirmed',u.email_confirmed_at is not null) order by m.created_at) from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w),'[]'::jsonb),
 'accounts',coalesce((select jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'status',a.connection_status) order by a.display_name) from bruff_private.creator_accounts a where a.workspace_id=w),'[]'::jsonb),
 'grants',coalesce((select jsonb_agg(jsonb_build_object('user_id',g.user_id,'creator_id',g.creator_id,'permission',g.permission)) from bruff_private.account_grants g where g.workspace_id=w),'[]'::jsonb),
 'invites',coalesce((select jsonb_agg(to_jsonb(i) order by i.created_at desc) from (select id,email,display_name,role,status,created_at from bruff_private.team_invites where workspace_id=w order by created_at desc limit 50) i),'[]'::jsonb));
end $$;
create or replace function public.bruff_team_update(w uuid,target uuid,r text,s text,g jsonb,expected_version bigint,display_name text) returns void
language plpgsql security definer set search_path='' as $$
declare current_member bruff_private.memberships;
begin
 perform bruff_private.require_team_manager(w);
 select * into current_member from bruff_private.memberships where workspace_id=w and user_id=target for update;
 if not found or current_member.role='owner' or target=auth.uid() then raise exception 'No puedes modificar al propietario ni a un miembro ajeno'; end if;
 if expected_version is null or current_member.version<>expected_version then raise exception 'La ficha ha cambiado. Recarga antes de guardar' using errcode='40001'; end if;
 if s is null or s not in ('active','disabled') then raise exception 'Estado no válido'; end if;
 perform bruff_private.validate_team_grants(w,r,g);
 perform bruff_private.validate_display_name(display_name);
 update bruff_private.memberships set role=r,status=s,version=version+1,display_name=btrim(bruff_team_update.display_name) where workspace_id=w and user_id=target;
 delete from bruff_private.account_grants where workspace_id=w and user_id=target;
 insert into bruff_private.account_grants select distinct w,target,(x->>'creator_id')::uuid,x->>'permission' from jsonb_array_elements(g) x;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'member_updated',target);
end $$;
create or replace function public.bruff_team_prepare_invite(w uuid,email_address text,r text,g jsonb,display_name text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare normalized text:=lower(trim(email_address)); result uuid; existing_user uuid;
begin
 perform bruff_private.require_team_manager(w);
 perform bruff_private.validate_team_grants(w,r,g);
 perform bruff_private.validate_display_name(display_name);
 if normalized is null or length(normalized)>254 or normalized !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Correo no válido'; end if;
 if exists(select 1 from bruff_private.team_invites where workspace_id=w and created_at>now()-interval '1 minute') then raise exception 'Espera un minuto antes de otra invitación'; end if;
 select id into existing_user from auth.users where lower(email)=normalized limit 1;
 if exists(select 1 from bruff_private.memberships where workspace_id=w and user_id=existing_user) then raise exception 'Esta persona ya pertenece al equipo'; end if;
 insert into bruff_private.team_invites(workspace_id,email,role,grants,actor_id,display_name) values(w,normalized,r,g,auth.uid(),btrim(display_name)) returning id into result;
 return jsonb_build_object('id',result,'email',normalized,'existing_user',existing_user,'display_name',btrim(display_name));
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
 perform bruff_private.validate_display_name(i.display_name);
 insert into bruff_private.memberships(workspace_id,user_id,role,status,display_name) values(i.workspace_id,target,i.role,'active',i.display_name);
 insert into bruff_private.account_grants select distinct i.workspace_id,target,(x->>'creator_id')::uuid,x->>'permission' from jsonb_array_elements(i.grants) x;
 update bruff_private.team_invites set status=result_status,user_id=target where id=ticket;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(i.workspace_id,i.actor_id,'member_invited',target);
end $$;

create function public.bruff_my_display_name(w uuid) returns text language sql stable security definer set search_path='' as $$
 select m.display_name from bruff_private.memberships m join auth.users u on u.id=m.user_id
 where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and u.email_confirmed_at is not null;
$$;
create function public.bruff_set_my_display_name(w uuid,display_name text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform bruff_private.validate_display_name(display_name);
 update bruff_private.memberships m set display_name=btrim(bruff_set_my_display_name.display_name),version=version+1
 where m.workspace_id=w and m.user_id=auth.uid() and m.status='active'
 and exists(select 1 from auth.users u where u.id=auth.uid() and u.email_confirmed_at is not null);
 if not found then raise exception 'No tienes acceso activo a esta agencia' using errcode='42501'; end if;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'display_name_updated',auth.uid());
end $$;
revoke all on function bruff_private.validate_display_name(text),bruff_private.team_audit_names() from public,anon,authenticated;
revoke execute on function public.bruff_team_update(uuid,uuid,text,text,jsonb,bigint),public.bruff_team_prepare_invite(uuid,text,text,jsonb) from authenticated;
revoke all on function public.bruff_team_update(uuid,uuid,text,text,jsonb,bigint,text),public.bruff_team_prepare_invite(uuid,text,text,jsonb,text),public.bruff_my_display_name(uuid),public.bruff_set_my_display_name(uuid,text) from public,anon;
grant execute on function public.bruff_team_update(uuid,uuid,text,text,jsonb,bigint,text),public.bruff_team_prepare_invite(uuid,text,text,jsonb,text),public.bruff_my_display_name(uuid),public.bruff_set_my_display_name(uuid,text) to authenticated;
insert into bruff_private.schema_versions(version) values('202610310005_team_names');
commit;
