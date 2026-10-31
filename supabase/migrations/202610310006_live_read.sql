begin;
-- Bindings are managed in the database, never accepted from a browser request.
create function public.bruff_live_accounts(w uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.display_name,'status',a.connection_status,
 'chat',bruff_private.can_access(w,a.id,'read'),'analytics',bruff_private.can_access(w,a.id,'analytics')) order by a.display_name),'[]'::jsonb)
 from bruff_private.creator_accounts a where a.workspace_id=w and a.provider='ofmapi'
 and (bruff_private.can_access(w,a.id,'read') or bruff_private.can_access(w,a.id,'analytics'))
 and exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
$$;
create function public.bruff_live_authorize(w uuid,c uuid,p text) returns text
language plpgsql stable security definer set search_path='' as $$
declare binding text;
begin
 if p not in ('read','analytics') or not bruff_private.can_access(w,c,p)
 or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501'; end if;
 select external_id into binding from bruff_private.creator_accounts
 where workspace_id=w and id=c and provider='ofmapi' and connection_status='connected';
 if binding is null then raise exception 'Modelo no conectada' using errcode='42501'; end if;
 return binding;
end $$;
revoke all on function public.bruff_live_accounts(uuid),public.bruff_live_authorize(uuid,uuid,text) from public,anon;
grant execute on function public.bruff_live_accounts(uuid),public.bruff_live_authorize(uuid,uuid,text) to authenticated;
commit;
