begin;
create function public.bruff_fan_note(w uuid,c uuid,fan text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare n bruff_private.fan_notes;
begin
 if fan is null or fan !~ '^[0-9]{1,24}$' or not bruff_private.can_access(w,c,'read')
 or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501'; end if;
 if not bruff_private.can_access(w,c,'notes') then return jsonb_build_object('allowed',false); end if;
 select * into n from bruff_private.fan_notes where workspace_id=w and creator_id=c and fan_id=fan;
 return jsonb_build_object('allowed',true,'body',coalesce(n.body,''),'version',coalesce(n.version,0),'updatedAt',n.updated_at);
end $$;
create function public.bruff_fan_note_save(w uuid,c uuid,fan text,body text,expected bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare n bruff_private.fan_notes;
begin
 -- Team changes use the same workspace lock: permissions are checked after it.
 perform 1 from bruff_private.workspaces where id=w for update;
 if fan is null or fan !~ '^[0-9]{1,24}$' or not bruff_private.can_access(w,c,'read') or not bruff_private.can_access(w,c,'notes')
 or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501'; end if;
 if body is null or length(body)>5000 or expected is null or expected<0 then raise exception 'Nota inválida'; end if;
 select * into n from bruff_private.fan_notes where workspace_id=w and creator_id=c and fan_id=fan for update;
 if coalesce(n.version,0)<>expected then raise exception 'Otra persona actualizó la nota. Recárgala antes de guardar.' using errcode='40001'; end if;
 insert into bruff_private.fans(workspace_id,creator_id,id,display_name) values(w,c,fan,fan) on conflict do nothing;
 insert into bruff_private.fan_notes(workspace_id,creator_id,fan_id,body,updated_by)
 values(w,c,fan,body,auth.uid()) on conflict(workspace_id,creator_id,fan_id) do update
 set body=excluded.body,updated_by=auth.uid(),updated_at=now(),version=bruff_private.fan_notes.version+1;
 return public.bruff_fan_note(w,c,fan);
end $$;
revoke all on function public.bruff_fan_note(uuid,uuid,text),public.bruff_fan_note_save(uuid,uuid,text,text,bigint) from public,anon;
grant execute on function public.bruff_fan_note(uuid,uuid,text),public.bruff_fan_note_save(uuid,uuid,text,text,bigint) to authenticated;
commit;
