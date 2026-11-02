begin;
-- One OFMAPI key is shared by this Edge deployment. No key or provider payload is stored.
create table bruff_private.provider_read_cooldown (
 id boolean primary key default true check(id),blocked_until timestamptz not null default '-infinity'
);
insert into bruff_private.provider_read_cooldown(id) values(true);
alter table bruff_private.provider_read_cooldown enable row level security;
revoke all on bruff_private.provider_read_cooldown from public,anon,authenticated,service_role;
create function public.bruff_provider_read_gate(op text,wait_seconds integer default 0) returns jsonb
language plpgsql security definer set search_path='' as $$
declare until_at timestamptz;instant timestamptz;
begin
 if op is null or op not in ('check','block') or wait_seconds is null or wait_seconds<0 or op='block' and wait_seconds<1 then raise exception 'Operación de lectura inválida';end if;
 select blocked_until into until_at from bruff_private.provider_read_cooldown where id=true for update;
 if until_at is null then raise exception 'Coordinación de lecturas no disponible';end if;
 if op='block' then
  update bruff_private.provider_read_cooldown set blocked_until=greatest(blocked_until,clock_timestamp()+make_interval(secs=>wait_seconds)) where id=true returning blocked_until into until_at;
 end if;
 instant=clock_timestamp();
 return jsonb_build_object('allowed',until_at<=instant,'retryAfter',case when until_at<=instant then 0 else greatest(1,ceil(extract(epoch from until_at-instant))::int) end);
end;$$;
revoke all on function public.bruff_provider_read_gate(text,integer) from public,anon,authenticated;
grant execute on function public.bruff_provider_read_gate(text,integer) to service_role;
commit;
