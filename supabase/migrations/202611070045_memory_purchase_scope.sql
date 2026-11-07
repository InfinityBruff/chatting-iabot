-- Resolves trusted signed purchase events; does not grant access to workers,
-- expose private tables, configure a webhook, run inference or send messages.
begin;
create function public.bruff_memory_event_scope(account_binding text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a bruff_private.creator_accounts; owner_id uuid; n integer;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Solo servidor' using errcode='42501';end if;
 if account_binding is null or length(account_binding)>128 or account_binding!~'^acct_[A-Za-z0-9_-]+$' then raise exception 'Cuenta no válida' using errcode='22023';end if;
 select count(*) into n from bruff_private.creator_accounts where provider='ofmapi' and connection_status='connected' and external_id=account_binding;
 if n<>1 then return null;end if;
 select * into a from bruff_private.creator_accounts where provider='ofmapi' and connection_status='connected' and external_id=account_binding;
 select count(*) into n from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=a.workspace_id and m.role='owner' and m.status='active' and u.email_confirmed_at is not null;
 if n<>1 then return null;end if;
 select m.user_id into owner_id from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=a.workspace_id and m.role='owner' and m.status='active' and u.email_confirmed_at is not null;
 return jsonb_build_object('ownerId',owner_id,'workspaceId',a.workspace_id,'creatorId',a.id,'binding',a.external_id);
end $$;
revoke all on function public.bruff_memory_event_scope(text) from public,anon,authenticated;
grant execute on function public.bruff_memory_event_scope(text) to service_role;
insert into bruff_private.schema_versions(version) values('202611070045_memory_purchase_scope');
commit;
