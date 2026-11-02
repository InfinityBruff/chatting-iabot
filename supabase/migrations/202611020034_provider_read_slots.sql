begin;
-- Coordinates GETs across browsers and Edge instances. Stores no keys, URLs or fan data.
create table bruff_private.provider_read_slots(
 id boolean primary key default true check(id),lease uuid,lease_until timestamptz,
 next_at timestamptz not null default '-infinity',foreground_until timestamptz not null default '-infinity'
);
insert into bruff_private.provider_read_slots(id) values(true);
alter table bruff_private.provider_read_slots enable row level security;
revoke all on bruff_private.provider_read_slots from public,anon,authenticated,service_role;
create function public.bruff_provider_read_slot(op text,lease_id uuid default null,priority text default 'background') returns jsonb
language plpgsql security definer set search_path='' as $$
declare row_state bruff_private.provider_read_slots%rowtype;instant timestamptz;token uuid;
begin
 if op is null or op not in ('acquire','release') or priority is null or priority not in ('foreground','background') then raise exception 'Operación de lectura inválida';end if;
 select * into row_state from bruff_private.provider_read_slots where id=true for update;
 if not found then raise exception 'Coordinación de lecturas no disponible';end if;
 instant=clock_timestamp();
 if op='release' then
  if lease_id is null or row_state.lease is distinct from lease_id then return jsonb_build_object('released',false);end if;
  update bruff_private.provider_read_slots set lease=null,lease_until=null,next_at=greatest(next_at,instant+interval '250 milliseconds') where id=true;
  return jsonb_build_object('released',true);
 end if;
 if (row_state.lease is not null and row_state.lease_until>instant) or row_state.next_at>instant or (priority='background' and row_state.foreground_until>instant) then
  if priority='foreground' then update bruff_private.provider_read_slots set foreground_until=instant+interval '1500 milliseconds' where id=true;end if;
  return jsonb_build_object('allowed',false,'retryAfterMs',250);
 end if;
 token=pg_catalog.gen_random_uuid();
 update bruff_private.provider_read_slots set lease=token,lease_until=instant+interval '30 seconds',next_at=instant+interval '1100 milliseconds',foreground_until=case when priority='foreground' then '-infinity'::timestamptz else foreground_until end where id=true;
 return jsonb_build_object('allowed',true,'lease',token);
end;$$;
revoke all on function public.bruff_provider_read_slot(text,uuid,text) from public,anon,authenticated;
grant execute on function public.bruff_provider_read_slot(text,uuid,text) to service_role;
commit;
