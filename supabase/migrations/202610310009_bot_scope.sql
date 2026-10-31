-- Stores routing preferences only. No engine, job or real send is enabled.
create function public.bruff_bot_scope(w uuid,c uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not bruff_private.can_access(w,c,'read') or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) then raise exception 'Acceso denegado';end if;
 select jsonb_build_object('mode',s.mode,'version',s.version) into result from bruff_private.bruff_settings s where s.workspace_id=w and s.creator_id=c;
 return coalesce(result,jsonb_build_object('mode','off','version',0)) || jsonb_build_object('engine_ready',false,'editable',bruff_private.can_access(w,c,'settings'),'overrides',coalesce((select jsonb_object_agg(o.fan_id,o.mode) from bruff_private.bruff_chat_overrides o where o.workspace_id=w and o.creator_id=c),'{}'::jsonb));
end $$;
create function public.bruff_bot_update(w uuid,c uuid,expected bigint,new_mode text default null,fan text default null,override_mode text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare current_version bigint;
begin
 perform bruff_private.require_team_manager(w);
 if not bruff_private.can_access(w,c,'settings') then raise exception 'Acceso denegado';end if;
 select version into current_version from bruff_private.bruff_settings where workspace_id=w and creator_id=c for update;
 if coalesce(current_version,0)<>expected then raise exception 'La configuración ha cambiado. Actualiza antes de guardar.';end if;
 if fan is null then
  if new_mode is null or new_mode not in ('off','selected','all') or override_mode is not null then raise exception 'Modo inválido';end if;
 else
  if fan !~ '^[0-9]{1,24}$' or new_mode is not null or override_mode is null or override_mode not in ('inherit','manual','enabled') then raise exception 'Excepción inválida';end if;
 end if;
 insert into bruff_private.bruff_settings(workspace_id,creator_id,mode) values(w,c,coalesce(new_mode,'off')) on conflict(workspace_id,creator_id) do update set mode=coalesce(new_mode,bruff_private.bruff_settings.mode),version=bruff_private.bruff_settings.version+1;
 if fan is not null then
  if override_mode='inherit' then delete from bruff_private.bruff_chat_overrides where workspace_id=w and creator_id=c and fan_id=fan;
  else
   insert into bruff_private.fans(workspace_id,creator_id,id,display_name) values(w,c,fan,'Fan '||fan) on conflict do nothing;
   insert into bruff_private.bruff_chat_overrides(workspace_id,creator_id,fan_id,mode) values(w,c,fan,override_mode) on conflict(workspace_id,creator_id,fan_id) do update set mode=excluded.mode;
  end if;
 end if;
 insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'bot_scope_updated',auth.uid());
 return public.bruff_bot_scope(w,c);
end $$;
revoke all on function public.bruff_bot_scope(uuid,uuid),public.bruff_bot_update(uuid,uuid,bigint,text,text,text) from public,anon;
grant execute on function public.bruff_bot_scope(uuid,uuid),public.bruff_bot_update(uuid,uuid,bigint,text,text,text) to authenticated;
insert into bruff_private.schema_versions(version) values('202610310009_bot_scope');
