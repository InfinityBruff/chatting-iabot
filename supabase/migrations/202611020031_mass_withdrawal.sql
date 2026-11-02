begin;
create table bruff_private.advanced_withdrawals(
 id uuid primary key default gen_random_uuid(),delivery_id uuid not null unique references bruff_private.advanced_deliveries(id),run_id uuid not null references bruff_private.advanced_runs(id),fan_id text not null,message_id text not null,binding text not null,mode text not null check(mode in ('all','unread')),due_at timestamptz not null,
 state text not null default 'pending' check(state in ('pending','claimed','deleting','removed','skipped','blocked','uncertain')),lease uuid,lease_until timestamptz,updated_at timestamptz not null default now()
);
alter table bruff_private.advanced_withdrawals enable row level security;
revoke all on bruff_private.advanced_withdrawals from public,anon,authenticated,service_role;
create function bruff_private.enqueue_withdrawal() returns trigger language plpgsql security definer set search_path='' as $$
declare r bruff_private.advanced_runs;cfg jsonb;
begin
 if new.state='sent' and old.state is distinct from 'sent' then
  select * into r from bruff_private.advanced_runs where id=new.run_id;
  select config into cfg from bruff_private.auto_message_drafts where id=r.draft_id and version=r.draft_version;
  if cfg->'unsend'->>'enabled'='true' and cfg->>'trigger'='mass' then
   insert into bruff_private.advanced_withdrawals(delivery_id,run_id,fan_id,message_id,binding,mode,due_at)
   values(new.id,r.id,new.fan_id,new.provider_id,r.binding,cfg->'unsend'->>'mode',now()+make_interval(hours=>(cfg->'unsend'->>'hours')::int)) on conflict(delivery_id) do nothing;
  end if;
 end if;
 return new;
end;$$;
revoke all on function bruff_private.enqueue_withdrawal() from public,anon,authenticated,service_role;
create trigger advanced_enqueue_withdrawal after update of state on bruff_private.advanced_deliveries for each row execute function bruff_private.enqueue_withdrawal();
create function bruff_private.withdrawal_allowed(j bruff_private.advanced_withdrawals) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from bruff_private.advanced_runs r join bruff_private.memberships m on m.workspace_id=r.workspace_id and m.user_id=r.activated_by join auth.users u on u.id=m.user_id join bruff_private.creator_accounts c on c.workspace_id=r.workspace_id and c.id=r.creator_id
 where r.id=j.run_id and r.state in ('active','completed') and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null and (m.role='owner' or not exists(select 1 from bruff_private.chat_safety_blocks b where b.workspace_id=m.workspace_id and b.user_id=m.user_id)) and c.provider='ofmapi' and c.connection_status='connected' and c.external_id=j.binding and r.binding=j.binding)
 and exists(select 1 from bruff_private.advanced_runtime where approved and worker_ready and last_tick>now()-interval '3 minutes');
$$;
revoke all on function bruff_private.withdrawal_allowed(bruff_private.advanced_withdrawals) from public,anon,authenticated,service_role;
create function public.bruff_advanced_withdrawal(op text,token text default null,job_id uuid default null,lease_id uuid default null,result text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare j bruff_private.advanced_withdrawals;r bruff_private.advanced_runs;items jsonb;
begin
 if op='poll' then
  if token is null or length(token)<40 or not exists(select 1 from bruff_private.advanced_runtime where approved and worker_ready and secret_hash=md5(token)) then raise exception 'No autorizado';end if;
  update bruff_private.advanced_withdrawals set state='uncertain',updated_at=now() where state='deleting' and lease_until<=now();
  with selected as (select id from bruff_private.advanced_withdrawals x where (state='pending' or state='claimed' and lease_until<=now()) and due_at<=now() and bruff_private.withdrawal_allowed(x) order by due_at,id for update skip locked limit 2), claimed as (
   update bruff_private.advanced_withdrawals set state='claimed',lease=gen_random_uuid(),lease_until=now()+interval '90 seconds',updated_at=now() where id in(select id from selected) returning *
  ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'lease',lease,'binding',binding,'fan',fan_id,'messageId',message_id,'mode',mode)),'[]'::jsonb) into items from claimed;
  return items;
 end if;
 select x.* into r from bruff_private.advanced_runs x join bruff_private.advanced_withdrawals y on y.run_id=x.id where y.id=job_id;
 if r.id is null then return 'false'::jsonb;end if;
 perform 1 from bruff_private.workspaces where id=r.workspace_id for update;
 select * into r from bruff_private.advanced_runs where id=r.id for update;
 select * into j from bruff_private.advanced_withdrawals where id=job_id for update;
 if j.lease is distinct from lease_id then return 'false'::jsonb;end if;
 if op='finish' then
  if result is null or result not in ('removed','skipped','blocked','uncertain') or j.state not in ('claimed','deleting') or (result='removed' and j.state<>'deleting') then raise exception 'Resultado inválido';end if;
  update bruff_private.advanced_withdrawals set state=result,updated_at=now() where id=j.id;return 'true'::jsonb;
 end if;
 if j.state<>'claimed' or j.lease_until<=now() or not bruff_private.withdrawal_allowed(j) then return 'false'::jsonb;end if;
 if op='authorize' then return 'true'::jsonb;
 elsif op='begin' then update bruff_private.advanced_withdrawals set state='deleting',updated_at=now() where id=j.id;return 'true'::jsonb;
 else raise exception 'Operación no disponible';end if;
end;$$;
revoke all on function public.bruff_advanced_withdrawal(text,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.bruff_advanced_withdrawal(text,text,uuid,uuid,text) to service_role;
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
 if (cfg->'resend'->>'enabled')::boolean or (cfg->>'startAiOnReply')::boolean or exists(select 1 from jsonb_each(cfg->'audience') x where x.key not in ('excludeLists','modelSpend','buyingPower') and x.value->>'enabled'='true') then raise exception 'La campaña contiene opciones todavía no conectadas al ejecutor';end if;
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
 return jsonb_build_object('ready',true,'cleanupReady',true,'deliveries',result);
end;$$;
create function public.bruff_withdrawal_counts(w uuid,c uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 if not bruff_private.can_access(w,c,'send') or not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null) then raise exception 'Acceso no permitido';end if;
 select coalesce(jsonb_agg(x),'[]'::jsonb) into result from (
 select r.id,count(*) filter(where j.state in ('pending','claimed')) as pending,count(*) filter(where j.state='deleting') as removing,count(*) filter(where j.state='removed') as removed,count(*) filter(where j.state='skipped') as skipped,count(*) filter(where j.state in ('blocked','uncertain')) as review
 from bruff_private.advanced_runs r join bruff_private.advanced_withdrawals j on j.run_id=r.id where r.workspace_id=w and r.creator_id=c group by r.id)x;
 return result;
end;$$;
revoke all on function public.bruff_withdrawal_counts(uuid,uuid) from public,anon;
grant execute on function public.bruff_withdrawal_counts(uuid,uuid) to authenticated;
commit;
