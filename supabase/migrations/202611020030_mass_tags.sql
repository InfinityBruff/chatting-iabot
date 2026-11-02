begin;
create or replace function public.bruff_prepare_mass(w uuid,c uuid,d uuid,v bigint,actor uuid,binding_id text,recipients jsonb,plan jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare cfg jsonb;r bruff_private.advanced_runs;msg jsonb;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=actor and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if not exists(select 1 from bruff_private.creator_accounts where workspace_id=w and id=c and provider='ofmapi' and external_id=binding_id and connection_status='connected') then raise exception 'Conexión modificada';end if;
 select config into cfg from bruff_private.auto_message_drafts where id=d and workspace_id=w and creator_id=c and version=v and not archived for update;
 if cfg is null then raise exception 'Borrador modificado';end if;
 if cfg->>'trigger'<>'mass' or cfg->>'action'<>'message' or jsonb_array_length(cfg->'messages')<>1 then raise exception 'Esta preparación corresponde a un masivo de un mensaje';end if;
 if (cfg->'unsend'->>'enabled')::boolean or (cfg->'resend'->>'enabled')::boolean or (cfg->>'startAiOnReply')::boolean or exists(select 1 from jsonb_each(cfg->'audience') x where x.key<>'excludeLists' and x.value->>'enabled'='true') then raise exception 'La campaña contiene opciones todavía no conectadas al ejecutor';end if;
 msg=cfg->'messages'->0;
 if (select count(distinct x->>'slot') from jsonb_array_elements(msg->'media')x)>1 or ((msg->>'paidText')::boolean and exists(select 1 from jsonb_array_elements(msg->'media')x where x->>'slot'='free')) then raise exception 'La combinación de contenido gratuito y bloqueado no está confirmada por el proveedor';end if;
 if recipients is null or jsonb_typeof(recipients)<>'array' or jsonb_array_length(recipients) not between 1 and 100000 or exists(select 1 from jsonb_array_elements(recipients)x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[1-9][0-9]{0,23}$') or (select count(distinct x) from jsonb_array_elements_text(recipients)x)<>jsonb_array_length(recipients) then raise exception 'Destinatarios no verificables';end if;
 if plan is null or jsonb_typeof(plan)<>'object' or not (plan ?& array['cycles','startAt','endsAt','intervalMs','missedPolicy']) or jsonb_typeof(plan->'cycles') is distinct from 'number' or jsonb_typeof(plan->'startAt') is distinct from 'string' or jsonb_typeof(plan->'endsAt') is distinct from 'string' or (plan->>'cycles')::int not between 1 and 8760 or (plan->>'endsAt')::timestamptz<=(plan->>'startAt')::timestamptz or (plan->>'endsAt')::timestamptz<=now() or (plan->>'missedPolicy') is distinct from 'skip' then raise exception 'Programación inválida';end if;
 select * into r from bruff_private.advanced_runs where draft_id=d and draft_version=v and execution_plan is not null;
 if r.id is not null then
  if r.state='paused' and r.activated_at is null then
   update bruff_private.advanced_runs set audience_ids=recipients,binding=binding_id,execution_plan=plan,prepared_at=now(),ends_at=(plan->>'endsAt')::timestamptz,revision=revision+1 where id=r.id returning * into r;
  end if;
  return jsonb_build_object('id',r.id,'state',r.state,'prepared',r.activated_at is null,'alreadyExists',true,'revision',r.revision,'count',jsonb_array_length(r.audience_ids));
 end if;
 insert into bruff_private.advanced_runs(workspace_id,creator_id,draft_id,draft_version,activated_by,state,ends_at,binding,audience_ids,execution_plan,prepared_at)
 values(w,c,d,v,actor,'paused',(plan->>'endsAt')::timestamptz,binding_id,recipients,plan,now()) returning * into r;
 return jsonb_build_object('id',r.id,'state','paused','prepared',true,'count',jsonb_array_length(recipients));
end;$$;
create function bruff_private.mass_window_open(cfg jsonb,instant timestamptz default now()) returns boolean
language plpgsql stable set search_path='' as $$
declare local_time time;start_time time;end_time time;
begin
 if coalesce((cfg->'timeWindow'->>'enabled')::boolean,false)=false then return true;end if;
 local_time=(instant at time zone (cfg->'timeWindow'->>'zone'))::time;
 start_time=(cfg->'timeWindow'->>'start')::time;end_time=(cfg->'timeWindow'->>'end')::time;
 if start_time=end_time then return false;end if;
 return case when start_time<end_time then local_time>=start_time and local_time<end_time else local_time>=start_time or local_time<end_time end;
 exception when others then return false;
end;$$;
revoke all on function bruff_private.mass_window_open(jsonb,timestamptz) from public,anon,authenticated,service_role;
create function bruff_private.mass_end_reached(cfg jsonb,started timestamptz,instant timestamptz default now()) returns boolean
language plpgsql stable set search_path='' as $$
begin
 if coalesce((cfg->'ending'->>'enabled')::boolean,false)=false then return false;end if;
 if cfg->'ending'->>'mode'='date' then return instant>=(cfg->'ending'->>'at')::timestamptz;end if;
 if cfg->'ending'->>'mode'='duration' then return instant>=started+make_interval(mins=>(cfg->'ending'->>'durationMinutes')::int);end if;
 return true;
 exception when others then return true;
end;$$;
revoke all on function bruff_private.mass_end_reached(jsonb,timestamptz,timestamptz) from public,anon,authenticated,service_role;
create or replace function bruff_private.advanced_allowed(r bruff_private.advanced_runs) returns boolean
language sql stable security definer set search_path='' as $$
 select r.state='active' and r.activated_at is not null and r.activated_at<=now() and (r.ends_at>now() or r.execution_plan->>'missedPolicy'='drain')
 and exists(select 1 from bruff_private.advanced_runtime where approved and worker_ready and last_tick>now()-interval '3 minutes')
 and exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=r.workspace_id and m.user_id=r.activated_by and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null and (m.role='owner' or not exists(select 1 from bruff_private.chat_safety_blocks b where b.workspace_id=m.workspace_id and b.user_id=m.user_id)))
 and exists(select 1 from bruff_private.auto_message_drafts d where d.id=r.draft_id and d.workspace_id=r.workspace_id and d.creator_id=r.creator_id and d.version=r.draft_version and not d.archived and bruff_private.mass_window_open(d.config) and not bruff_private.mass_end_reached(d.config,r.activated_at))
 and exists(select 1 from bruff_private.creator_accounts c where c.workspace_id=r.workspace_id and c.id=r.creator_id and c.provider='ofmapi' and c.connection_status='connected' and c.external_id=r.binding);
$$;

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
  if bruff_private.mass_end_reached((select config from bruff_private.auto_message_drafts where id=r.draft_id),r.activated_at) then
   update bruff_private.advanced_deliveries set state='blocked',detail='Finalización explícita de campaña',updated_at=now() where run_id=r.id and state in ('pending','claimed');
   update bruff_private.advanced_runs set state='completed',revision=revision+1 where id=r.id;continue;
  end if;
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
create or replace function public.bruff_advanced_delivery(op text,delivery_id uuid,lease_id uuid default null,expected_revision bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare d bruff_private.advanced_deliveries;r bruff_private.advanced_runs;config jsonb;w uuid;rid uuid;
begin
 if op is null or op not in ('claim','authorize','begin','finish','release') then raise exception 'Operación inválida';end if;
 select x.workspace_id,x.id into w,rid from bruff_private.advanced_runs x join bruff_private.advanced_deliveries y on y.run_id=x.id where y.id=delivery_id;
 if w is null then return null;end if;
 -- Same lock order as permissions and pause: workspace, run, delivery.
 perform 1 from bruff_private.workspaces where id=w for update;
 select * into r from bruff_private.advanced_runs where id=rid for update;
 select * into d from bruff_private.advanced_deliveries where id=delivery_id for update;
 if op='claim' then
  if d.state='sending' and d.lease_until<=now() then update bruff_private.advanced_deliveries set state='uncertain',detail='Proceso interrumpido después de iniciar el envío',updated_at=now() where id=d.id;return null;end if;
  if not bruff_private.advanced_allowed(r) or d.due_at>now() or d.state not in ('pending','claimed') or d.state='claimed' and d.lease_until>now() then return null;end if;
  if d.step_index>0 and not exists(select 1 from bruff_private.advanced_deliveries p where p.run_id=d.run_id and p.cycle=d.cycle and p.fan_id=d.fan_id and p.step_index=d.step_index-1 and p.state='sent') then return null;end if;
  select a.config into config from bruff_private.auto_message_drafts a where a.id=r.draft_id;
  if config->'messages'->d.step_index is null then raise exception 'Mensaje ausente';end if;
  update bruff_private.advanced_deliveries set state='claimed',lease=gen_random_uuid(),lease_until=now()+interval '60 seconds',run_revision=r.revision,updated_at=now() where id=d.id returning * into d;
  return jsonb_build_object('id',d.id,'activationId',r.id,'status','claimed','lease',d.lease,'revision',r.revision,'scope',jsonb_build_object('workspace',r.workspace_id,'creator',r.creator_id,'fan',d.fan_id),'dueAt',d.due_at,'expiresAt',d.lease_until,'stepIndex',d.step_index,'trigger',config->>'trigger','message',config->'messages'->d.step_index);
 end if;
 if lease_id is distinct from d.lease or expected_revision is distinct from d.run_revision then return 'false'::jsonb;end if;
 if op='finish' then
  if d.state<>'sending' then return 'false'::jsonb;end if;
  if value->>'status'='sent' and coalesce(value->>'providerId','')~'^[0-9]{1,24}$' then
   update bruff_private.advanced_deliveries set state='sent',provider_id=value->>'providerId',updated_at=now() where id=d.id;
  elsif value->>'status'='uncertain' then update bruff_private.advanced_deliveries set state='uncertain',detail='Resultado pendiente de revisión',updated_at=now() where id=d.id;
  else raise exception 'Resultado inválido';end if;return 'true'::jsonb;
 end if;
 if op='release' then
  if d.state<>'claimed' then return 'false'::jsonb;end if;
  if r.state='active' and value->>'reason' in ('Sin permiso o campaña detenida','Campaña pausada, modificada o acceso retirado') and not bruff_private.mass_window_open((select a.config from bruff_private.auto_message_drafts a where a.id=r.draft_id)) then
   update bruff_private.advanced_deliveries set state='pending',lease=null,lease_until=null,run_revision=null,detail='Espera de franja horaria',updated_at=now() where id=d.id;return 'true'::jsonb;
  end if;
  update bruff_private.advanced_deliveries set state='blocked',detail=left(coalesce(value->>'reason','Preparación interrumpida'),200),updated_at=now() where id=d.id;return 'true'::jsonb;
 end if;
 if d.state<>'claimed' or d.lease_until<=now() or r.revision<>expected_revision or not bruff_private.advanced_allowed(r) then return 'false'::jsonb;end if;
 if op='authorize' then return 'true'::jsonb;end if;
 if value is null or jsonb_typeof(value)<>'object' or jsonb_typeof(value->'text') is distinct from 'string' or length(value->>'text')>3000 or jsonb_typeof(value->'media') is distinct from 'array' or jsonb_typeof(value->'price') is distinct from 'number' or (value->>'price')::numeric<0 then raise exception 'Payload inválido';end if;
 update bruff_private.advanced_deliveries set state='sending',payload=value,updated_at=now() where id=d.id;return 'true'::jsonb;
end $$;
commit;
