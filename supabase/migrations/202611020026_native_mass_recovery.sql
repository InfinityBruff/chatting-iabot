begin;
create function public.bruff_native_for_draft(w uuid,c uuid,d uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare run_id uuid;
begin
 if not bruff_private.can_access(w,c,'send') or not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null) then raise exception 'Acceso no permitido';end if;
 select id into run_id from bruff_private.native_mass_runs where workspace_id=w and creator_id=c and draft_id=d order by draft_version desc limit 1;
 if run_id is null then return 'null'::jsonb;end if;
 return public.bruff_native_status(w,c,run_id);
end;$$;
revoke all on function public.bruff_native_for_draft(uuid,uuid,uuid) from public,anon;
grant execute on function public.bruff_native_for_draft(uuid,uuid,uuid) to authenticated;
commit;
