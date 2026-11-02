-- Revalidate the same lease after durable begin, without claiming or restarting it.
begin;
create function public.bruff_advanced_transport_authorize(delivery_id uuid,lease_id uuid,expected_revision bigint) returns boolean
language plpgsql security definer set search_path='' as $$
declare r bruff_private.advanced_runs;d bruff_private.advanced_deliveries;
begin
 select * into d from bruff_private.advanced_deliveries where id=delivery_id;
 select * into r from bruff_private.advanced_runs where id=d.run_id;
 perform 1 from bruff_private.workspaces where id=r.workspace_id for update;
 select * into r from bruff_private.advanced_runs where id=d.run_id for update;
 select * into d from bruff_private.advanced_deliveries where id=delivery_id for update;
 return coalesce(d.state in ('claimed','sending') and d.lease=lease_id and d.run_revision=expected_revision and r.revision=expected_revision and d.lease_until>now() and bruff_private.advanced_allowed(r),false);
end;$$;
revoke all on function public.bruff_advanced_transport_authorize(uuid,uuid,bigint) from public,anon,authenticated;
grant execute on function public.bruff_advanced_transport_authorize(uuid,uuid,bigint) to service_role;
commit;
