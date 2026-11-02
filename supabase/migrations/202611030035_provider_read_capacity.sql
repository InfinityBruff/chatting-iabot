begin;
-- Bounded concurrency, spaced starts. No provider keys, URLs or fan data.
create table bruff_private.provider_read_leases(
 lease uuid primary key,lease_until timestamptz not null,
 priority text not null check(priority in ('foreground','background'))
);
alter table bruff_private.provider_read_leases enable row level security;
revoke all on bruff_private.provider_read_leases from public,anon,authenticated,service_role;
create or replace function public.bruff_provider_read_slot(op text,lease_id uuid default null,priority text default 'background') returns jsonb
language plpgsql security definer set search_path='' as $$
declare row_state bruff_private.provider_read_slots%rowtype;instant timestamptz;token uuid;active_count integer;active_background integer;affected integer;legacy boolean;
begin
 if op is null or op not in ('acquire','release') or priority is null or priority not in ('foreground','background') then raise exception 'Operación de lectura inválida';end if;
 select * into row_state from bruff_private.provider_read_slots where id=true for update;
 if not found then raise exception 'Coordinación de lecturas no disponible';end if;
 instant=clock_timestamp();
 delete from bruff_private.provider_read_leases where lease_until<=instant;
 legacy=row_state.lease is not null and row_state.lease_until>instant;
 if op='release' then
  if lease_id is null then return jsonb_build_object('released',false);end if;
  if row_state.lease=lease_id then
   update bruff_private.provider_read_slots set lease=null,lease_until=null where id=true;
   affected=1;
  else
   delete from bruff_private.provider_read_leases where lease=lease_id;
   get diagnostics affected=row_count;
  end if;
  if affected>0 then update bruff_private.provider_read_slots set next_at=greatest(next_at,instant+interval '250 milliseconds') where id=true;end if;
  return jsonb_build_object('released',affected>0);
 end if;
 select count(*),count(*) filter(where l.priority='background') into active_count,active_background from bruff_private.provider_read_leases l;
 if legacy then active_count=active_count+1;active_background=active_background+1;end if;
 -- One background read maximum leaves capacity for opening a fan/model.
 if active_count>=2 or row_state.next_at>instant or (priority='background' and (active_background>=1 or row_state.foreground_until>instant)) then
  if priority='foreground' then update bruff_private.provider_read_slots set foreground_until=instant+interval '1500 milliseconds' where id=true;end if;
  return jsonb_build_object('allowed',false,'retryAfterMs',250);
 end if;
 token=pg_catalog.gen_random_uuid();
 insert into bruff_private.provider_read_leases values(token,instant+interval '30 seconds',priority);
 update bruff_private.provider_read_slots set next_at=instant+interval '1100 milliseconds',foreground_until=case when priority='foreground' then '-infinity'::timestamptz else foreground_until end where id=true;
 return jsonb_build_object('allowed',true,'lease',token);
end;$$;
revoke all on function public.bruff_provider_read_slot(text,uuid,text) from public,anon,authenticated;
grant execute on function public.bruff_provider_read_slot(text,uuid,text) to service_role;
commit;
