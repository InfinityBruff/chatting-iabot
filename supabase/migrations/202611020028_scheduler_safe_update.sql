begin;
create or replace function public.bruff_advanced_poll(token text,can_send boolean default false) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bruff_private.advanced_runs;target_cycle int;interval_ms bigint;result jsonb;allowed boolean;
begin
 if token is null or length(token)<40 or not exists(select 1 from bruff_private.advanced_runtime where secret_hash=md5(token)) then raise exception 'No autorizado' using errcode='42501';end if;
 update bruff_private.advanced_runtime set last_tick=now(),worker_ready=coalesce(can_send,false) where id=true returning approved and worker_ready into allowed;
 if not allowed then return jsonb_build_object('ready',false,'deliveries','[]'::jsonb);end if;
 -- Lock workspaces before runs, matching activation, team changes and delivery claims.
 for r in select * from bruff_private.advanced_runs where state='active' and execution_plan is not null order by activated_at,id limit 20 loop
  perform 1 from bruff_private.workspaces where id=r.workspace_id for update;
  select * into r from bruff_private.advanced_runs where id=r.id for update;
  if r.state<>'active' then continue;end if;
  update bruff_private.advanced_deliveries set state='uncertain',detail='Proceso interrumpido tras iniciar envío',updated_at=now() where run_id=r.id and state='sending' and lease_until<=now();
  if exists(select 1 from bruff_private.advanced_deliveries where run_id=r.id and state='uncertain') then update bruff_private.advanced_runs set state='paused',revision=revision+1 where id=r.id;continue;end if;
  if r.ends_at<=now() then
   update bruff_private.advanced_deliveries set state='blocked',detail='Ventana de ejecución finalizada',updated_at=now() where run_id=r.id and state in ('pending','claimed');
   update bruff_private.advanced_runs set state='completed',revision=revision+1 where id=r.id;continue;
  end if;
  if not bruff_private.advanced_allowed(r) then continue;end if;
  interval_ms=(r.execution_plan->>'intervalMs')::bigint;
  target_cycle=case when interval_ms is null then 0 else floor(extract(epoch from now()-r.activated_at)*1000/interval_ms)::int end;
  if target_cycle>= (r.execution_plan->>'cycles')::int then continue;end if;
  if target_cycle>r.last_cycle then
   -- No catch-up burst: pending deliveries from a missed cycle expire explicitly.
   update bruff_private.advanced_deliveries set state='blocked',detail='Intervalo anterior finalizado',updated_at=now() where run_id=r.id and cycle<target_cycle and state in ('pending','claimed');
   insert into bruff_private.advanced_deliveries(run_id,fan_id,cycle,step_index,due_at)
   select r.id,x,target_cycle,0,r.activated_at+make_interval(secs=>coalesce(interval_ms,0)*target_cycle/1000.0) from jsonb_array_elements_text(r.audience_ids)x on conflict(run_id,cycle,fan_id,step_index) do nothing;
   update bruff_private.advanced_runs set last_cycle=target_cycle where id=r.id;
  end if;
  if r.last_cycle>=(r.execution_plan->>'cycles')::int-1 and not exists(select 1 from bruff_private.advanced_deliveries where run_id=r.id and state in ('pending','claimed','sending','uncertain')) then update bruff_private.advanced_runs set state='completed',revision=revision+1 where id=r.id;end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'activationId',q.run_id,'binding',q.binding,'scope',jsonb_build_object('workspace',q.workspace_id,'creator',q.creator_id,'fan',q.fan_id))),'[]'::jsonb) into result from (
 select d.id,d.run_id,d.fan_id,ar.workspace_id,ar.creator_id,ar.binding from bruff_private.advanced_deliveries d join bruff_private.advanced_runs ar on ar.id=d.run_id where bruff_private.advanced_allowed(ar) and d.due_at<=now() and (d.state='pending' or d.state='claimed' and d.lease_until<=now()) order by d.due_at,d.id limit 4)q;
 return jsonb_build_object('ready',true,'deliveries',result);
end;$$;
commit;
