-- Pending remote approval/application. Narrow, read-only identity endpoint.
begin;
create function public.bruff_my_workspaces()
returns table(id uuid, name text, role text, globally_paused boolean)
language sql stable security definer set search_path = '' as $$
  select w.id,w.name,m.role,w.globally_paused
  from bruff_private.memberships m
  join bruff_private.workspaces w on w.id=m.workspace_id
  where m.user_id=auth.uid() and m.status='active'
  order by w.name,w.id;
$$;
revoke all on function public.bruff_my_workspaces() from public, anon;
grant execute on function public.bruff_my_workspaces() to authenticated;
insert into bruff_private.schema_versions(version) values ('202610310002_membership_rpc');
commit;
