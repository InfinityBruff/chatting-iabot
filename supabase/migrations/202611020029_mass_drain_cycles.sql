begin;
create or replace function bruff_private.advanced_allowed(r bruff_private.advanced_runs) returns boolean
language sql stable security definer set search_path='' as $$
 select r.state='active' and r.activated_at is not null and r.activated_at<=now() and (r.ends_at>now() or r.execution_plan->>'missedPolicy'='drain')
 and exists(select 1 from bruff_private.advanced_runtime where approved and worker_ready and last_tick>now()-interval '3 minutes')
 and exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=r.workspace_id and m.user_id=r.activated_by and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null and (m.role='owner' or not exists(select 1 from bruff_private.chat_safety_blocks b where b.workspace_id=m.workspace_id and b.user_id=m.user_id)))
 and exists(select 1 from bruff_private.auto_message_drafts d where d.id=r.draft_id and d.workspace_id=r.workspace_id and d.creator_id=r.creator_id and d.version=r.draft_version and not d.archived)
 and exists(select 1 from bruff_private.creator_accounts c where c.workspace_id=r.workspace_id and c.id=r.creator_id and c.provider='ofmapi' and c.connection_status='connected' and c.external_id=r.binding);
$$;

create or replace function public.bruff_activate_mass(w uuid,c uuid,run_id uuid,expected_revision bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bruff_private.advanced_runs;cfg jsonb;b jsonb;start_time timestamptz;end_time timestamptz;cycles int;minutes int;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.role='owner' and m.status='active' and u.email_confirmed_at is not null) then raise exception 'Solo el propietario puede activar envíos' using errcode='42501';end if;
 if not exists(select 1 from bruff_private.advanced_runtime where approved and worker_ready and last_tick>now()-interval '3 minutes') then raise exception 'Ejecutor sin conexión reciente. No se activarán envíos';end if;
 select * into r from bruff_private.advanced_runs where id=run_id and workspace_id=w and creator_id=c for update;
 if r.id is null or r.revision is distinct from expected_revision then raise exception 'La ejecución ha cambiado' using errcode='40001';end if;
 if r.prepared_at is null or r.prepared_at<now()-interval '30 minutes' then raise exception 'Comprueba de nuevo los destinatarios antes de activar';end if;
 if r.state<>'paused' or r.activated_at is not null or r.execution_plan is null or r.audience_ids is null then raise exception 'Esta ejecución no se puede activar';end if;
 select config into cfg from bruff_private.auto_message_drafts where id=r.draft_id and version=r.draft_version and workspace_id=w and creator_id=c and not archived;
 if cfg is null or cfg->>'trigger'<>'mass' then raise exception 'Revisa el borrador antes de activar';end if;
 if not exists(select 1 from bruff_private.creator_accounts where workspace_id=w and id=c and external_id=r.binding and provider='ofmapi' and connection_status='connected') then raise exception 'La conexión de la modelo ha cambiado';end if;
 b=cfg->'bulk';start_time=case when b->>'schedule'='scheduled' then (b->>'at')::timestamptz else now() end;
 if start_time<now() then raise exception 'Actualiza la fecha de inicio';end if;
 minutes=(b->>'intervalMinutes')::int;
 if not (b->>'repeat')::boolean then cycles=1;end_time=start_time+interval '24 hours';
 elsif b->>'endMode'='runs' then cycles=(b->>'maxRuns')::int;end_time=start_time+make_interval(mins=>minutes*cycles);
 else end_time=case when b->>'endMode'='date' then (b->>'endAt')::timestamptz else start_time+make_interval(mins=>(b->>'durationMinutes')::int) end;cycles=ceil(extract(epoch from end_time-start_time)/(minutes*60))::int;end if;
 if cycles not between 1 and 8760 or end_time<=start_time then raise exception 'Finalización inválida';end if;
 update bruff_private.advanced_runs set state='active',activated_by=auth.uid(),activated_at=start_time,ends_at=end_time,revision=revision+1,execution_plan=jsonb_build_object('startAt',start_time,'endsAt',end_time,'cycles',cycles,'intervalMs',case when (b->>'repeat')::boolean then minutes*60000 else null end,'missedPolicy','drain','singleDeliveryWindowHours',case when (b->>'repeat')::boolean then null else 24 end) where id=r.id returning * into r;
 return jsonb_build_object('id',r.id,'state',r.state,'revision',r.revision,'startsAt',r.activated_at,'endsAt',r.ends_at);
end;$$;
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
  if r.ends_at<=now() and r.execution_plan->>'missedPolicy' is distinct from 'drain' then
   update bruff_private.advanced_deliveries set state='blocked',detail='Ventana de ejecución finalizada',updated_at=now() where run_id=r.id and state in ('pending','claimed');
   update bruff_private.advanced_runs set state='completed',revision=revision+1 where id=r.id;continue;
  end if;
  if not bruff_private.advanced_allowed(r) then continue;end if;
  interval_ms=(r.execution_plan->>'intervalMs')::bigint;
  if r.execution_plan->>'missedPolicy'='drain' then
   -- Never retire a pending recipient to make room for the next repetition.
   if exists(select 1 from bruff_private.advanced_deliveries where run_id=r.id and state in ('blocked','uncertain')) then
    update bruff_private.advanced_runs set state='paused',revision=revision+1 where id=r.id;continue;
   end if;
   if exists(select 1 from bruff_private.advanced_deliveries where run_id=r.id and state in ('pending','claimed','sending')) then continue;end if;
   target_cycle=r.last_cycle+1;
   if target_cycle >= (r.execution_plan->>'cycles')::int or (r.ends_at<=now() and (select config->'bulk'->>'endMode' from bruff_private.auto_message_drafts where id=r.draft_id) in ('date','duration')) then
    update bruff_private.advanced_runs set state='completed',revision=revision+1 where id=r.id;continue;
   end if;
   if r.activated_at+make_interval(secs=>coalesce(interval_ms,0)*target_cycle/1000.0)>now() then continue;end if;
   insert into bruff_private.advanced_deliveries(run_id,fan_id,cycle,step_index,due_at)
   select r.id,x,target_cycle,0,now() from jsonb_array_elements_text(r.audience_ids)x on conflict(run_id,cycle,fan_id,step_index) do nothing;
   update bruff_private.advanced_runs set last_cycle=target_cycle where id=r.id;
  else
   -- Legacy active campaigns retain their old policy; no silent conversion.
  target_cycle=case when interval_ms is null then 0 else floor(extract(epoch from now()-r.activated_at)*1000/interval_ms)::int end;
  if target_cycle>= (r.execution_plan->>'cycles')::int then continue;end if;
  if target_cycle>r.last_cycle then
   -- No catch-up burst: pending deliveries from a missed cycle expire explicitly.
   update bruff_private.advanced_deliveries set state='blocked',detail='Intervalo anterior finalizado',updated_at=now() where run_id=r.id and cycle<target_cycle and state in ('pending','claimed');
   insert into bruff_private.advanced_deliveries(run_id,fan_id,cycle,step_index,due_at)
   select r.id,x,target_cycle,0,r.activated_at+make_interval(secs=>coalesce(interval_ms,0)*target_cycle/1000.0) from jsonb_array_elements_text(r.audience_ids)x on conflict(run_id,cycle,fan_id,step_index) do nothing;
   update bruff_private.advanced_runs set last_cycle=target_cycle where id=r.id;
  end if;
  end if;
  if r.last_cycle>=(r.execution_plan->>'cycles')::int-1 and not exists(select 1 from bruff_private.advanced_deliveries where run_id=r.id and state in ('pending','claimed','sending','uncertain')) then update bruff_private.advanced_runs set state='completed',revision=revision+1 where id=r.id;end if;
 end loop;
 select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'activationId',q.run_id,'binding',q.binding,'scope',jsonb_build_object('workspace',q.workspace_id,'creator',q.creator_id,'fan',q.fan_id))),'[]'::jsonb) into result from (
 select d.id,d.run_id,d.fan_id,ar.workspace_id,ar.creator_id,ar.binding from bruff_private.advanced_deliveries d join bruff_private.advanced_runs ar on ar.id=d.run_id where bruff_private.advanced_allowed(ar) and d.due_at<=now() and (d.state='pending' or d.state='claimed' and d.lease_until<=now()) order by d.due_at,d.id limit 4)q;
 return jsonb_build_object('ready',true,'deliveries',result);
end;$$;
commit;
