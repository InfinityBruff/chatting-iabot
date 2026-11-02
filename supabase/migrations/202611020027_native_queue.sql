begin;
create table bruff_private.native_queue_events(
 id uuid primary key default gen_random_uuid(),run_id uuid not null references bruff_private.native_mass_runs(id),actor uuid not null references auth.users(id),result text not null check(result in ('cancelled','not_cancelled','uncertain')),created_at timestamptz not null default now()
);
alter table bruff_private.native_queue_events enable row level security;
revoke all on bruff_private.native_queue_events from public,anon,authenticated,service_role;
create function public.bruff_native_queue(w uuid,c uuid,actor uuid,run_id uuid,op text,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bruff_private.native_mass_runs;role_name text;
begin
 select m.role into role_name from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=actor and m.status='active' and u.email_confirmed_at is not null;
 if role_name is null or role_name not in ('owner','admin') then raise exception 'Acceso no permitido';end if;
 -- Service caller must bind actor to the validated session; never trust a browser actor.
 select * into r from bruff_private.native_mass_runs where id=run_id and workspace_id=w and creator_id=c;
 if r.id is null or r.queue_id is null or r.state<>'accepted' then raise exception 'Cola no disponible';end if;
 if not exists(select 1 from bruff_private.creator_accounts where workspace_id=w and id=c and external_id=r.binding and provider='ofmapi' and connection_status='connected') then raise exception 'Conexión modificada';end if;
 if op in ('cancel_context','cancel_authorize','record') and role_name<>'owner' then raise exception 'Solo el propietario puede cancelar';end if;
 if op='record' then
  if value->>'state' is null or value->>'state' not in ('cancelled','not_cancelled','uncertain') or value->>'queueId' is distinct from r.queue_id then raise exception 'Resultado inválido';end if;
  insert into bruff_private.native_queue_events(run_id,actor,result) values(r.id,bruff_native_queue.actor,value->>'state');
  return 'true'::jsonb;
 elsif op in ('authorize','cancel_authorize') then return to_jsonb(r.binding);
 elsif op not in ('context','cancel_context') then raise exception 'Operación inválida';end if;
 return jsonb_build_object('id',r.id,'binding',r.binding,'queueId',r.queue_id);
end;$$;
revoke all on function public.bruff_native_queue(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.bruff_native_queue(uuid,uuid,uuid,uuid,text,jsonb) to service_role;
commit;
