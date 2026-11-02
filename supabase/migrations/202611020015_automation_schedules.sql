begin;
alter table bruff_private.automations add column ends_at timestamptz, add column remaining_seconds integer, add column cycle integer not null default 0, add column cycle_started timestamptz;
create or replace function public.bruff_automations(w uuid,c uuid,op text default 'list',rule_id uuid default null,expected_version bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a bruff_private.automations; result jsonb; typ text; actor_role text; timing jsonb; start_time timestamptz;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 perform bruff_private.automation_access(w,c);
 if op not in ('list','save','archive','restore','activate','pause','stop') then raise exception 'Operación no válida';end if;
 if op<>'list' then
  if rule_id is not null then
   select * into a from bruff_private.automations where id=rule_id and workspace_id=w and creator_id=c for update;
   if not found then raise exception 'Automatización ajena' using errcode='42501';end if;
   if expected_version is distinct from a.version then raise exception 'Ha cambiado en otro dispositivo. Recarga antes de continuar.' using errcode='40001';end if;
  elsif op<>'save' then raise exception 'Falta automatización';end if;
  if op='save' then
   if a.status in ('active','completed') then raise exception 'Pausa la regla antes de editar; una campaña completada no se reenvía.';end if;
   typ=value->>'type';
   if value is null or jsonb_typeof(value)<>'object' or octet_length(value::text)>150000 or coalesce(typ,'') not in ('mass','welcome','online')
    or coalesce(length(btrim(value->>'name')),0) not between 1 and 80 or coalesce(length(btrim(value->>'text')),0) not between 1 and 3000
    or coalesce(value->>'audience','') not in ('all','selected','collections') or jsonb_typeof(value->'recipients') is distinct from 'array'
    or jsonb_array_length(value->'recipients')>5000 or exists(select 1 from jsonb_array_elements(value->'recipients') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[0-9]{1,24}$')
    or (typ='mass' and value->>'audience'='selected' and jsonb_array_length(value->'recipients')=0)
    or coalesce(value->>'schedule','') not in ('manual','scheduled')
    or coalesce(value->>'cooldown','') not in ('24','48','72','168') or coalesce(value->>'limit','') not in ('1','2','3')
    or jsonb_typeof(value->'skipRecent') is distinct from 'boolean'
   then raise exception 'Configuración no válida';end if;
   if a.id is not null and typ='mass' and exists(select 1 from bruff_private.automation_deliveries where automation_id=a.id) then raise exception 'La campaña ya ha empezado: conserva su texto o crea un borrador nuevo';end if;
   if a.id is not null and a.config->>'type'<>typ then raise exception 'Crea otra regla para cambiar el tipo';end if;
   if typ='mass' and value->>'schedule'='scheduled' and ((value->>'at')::timestamptz is null or (value->>'at')::timestamptz<=now()) then raise exception 'Selecciona una fecha futura';end if;
   timing=jsonb_build_object('repeat',coalesce((value->>'repeat')::boolean,false),'intervalMinutes',coalesce((value->>'intervalMinutes')::int,120),'endMode',coalesce(value->>'endMode','duration'),'durationMinutes',coalesce((value->>'durationMinutes')::int,120),'maxRuns',coalesce((value->>'maxRuns')::int,4),'endAt',coalesce(value->>'endAt',''),'listIds',coalesce(value->'listIds','[]'::jsonb));
   if (timing->>'intervalMinutes')::int not between 60 and 43200 or (timing->>'durationMinutes')::int not between 1 and 525600 or (timing->>'maxRuns')::int not between 1 and 1000 or timing->>'endMode' not in ('duration','date','runs') or (typ='online' and timing->>'endMode'='runs') then raise exception 'Horario no válido';end if;
   if jsonb_typeof(timing->'listIds') is distinct from 'array' or jsonb_array_length(timing->'listIds')>100 or exists(select 1 from jsonb_array_elements(timing->'listIds') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[A-Za-z0-9_-]{1,100}$') then raise exception 'Colecciones no válidas';end if;
   if value->>'audience'='collections' and jsonb_array_length(timing->'listIds')=0 then raise exception 'Selecciona una colección';end if;
   if typ<>'welcome' and value->>'schedule'='scheduled' and ((value->>'at')::timestamptz is null or (value->>'at')::timestamptz<=now()) then raise exception 'Inicio no válido';end if;
   if typ<>'welcome' and timing->>'endMode'='date' and (typ='online' or (timing->>'repeat')::boolean) and (nullif(timing->>'endAt','')::timestamptz is null or (timing->>'endAt')::timestamptz<=greatest(now(),nullif(value->>'at','')::timestamptz)) then raise exception 'Fin no válido';end if;
   value=timing||jsonb_build_object('type',typ,'name',btrim(value->>'name'),'text',value->>'text','audience',value->>'audience','recipients',value->'recipients','schedule',value->>'schedule','at',value->>'at','cooldown',(value->>'cooldown')::int,'limit',(value->>'limit')::int,'skipRecent',(value->>'skipRecent')::boolean);
   if a.id is null then insert into bruff_private.automations(workspace_id,creator_id,config) values(w,c,value) returning * into a;
   else update bruff_private.automations set config=value,status='draft',ends_at=null,remaining_seconds=null,cycle=0,cycle_started=null,next_check=now(),version=version+1,updated_at=now(),last_error=null where id=a.id returning * into a;end if;
  elsif op='activate' then
   select role into actor_role from bruff_private.memberships where workspace_id=w and user_id=auth.uid();
   if actor_role<>'owner' then raise exception 'Solo el propietario puede activar envíos' using errcode='42501';end if;
   if a.status not in ('draft','paused') or a.archived then raise exception 'Esta regla no puede activarse';end if;
   if not exists(select 1 from bruff_private.automation_runtime where last_tick>now()-interval '3 minutes') then raise exception 'Ejecutor sin conexión reciente. No se activará ningún envío.';end if;
   if exists(select 1 from bruff_private.automation_deliveries where automation_id=a.id and state in ('sending','uncertain')) then raise exception 'Hay envíos sin confirmar. Revisa el historial antes de continuar.';end if;
   if exists(select 1 from bruff_private.chat_safety_terms where position(bruff_private.chat_normalize(term) in bruff_private.chat_normalize(a.config->>'text'))>0) then raise exception 'El texto contiene términos bloqueados por la política de BRUFF';end if;
   if a.config->>'type'='welcome' and coalesce(value->>'welcomeReviewed','false')<>'true' then raise exception 'Revisa la bienvenida externa para evitar duplicados';end if;
   if a.status<>'paused' and a.config->>'type'<>'welcome' and a.config->>'schedule'='scheduled' and (a.config->>'at')::timestamptz<=now() then raise exception 'Actualiza la fecha antes de activar';end if;
   start_time=case when a.status='paused' then greatest(now(),a.next_check) when a.config->>'type'<>'welcome' and a.config->>'schedule'='scheduled' then (a.config->>'at')::timestamptz else now() end;
   if a.config->>'endMode'='date' and (a.config->>'type'='online' or coalesce((a.config->>'repeat')::boolean,false)) and (a.config->>'endAt')::timestamptz<=start_time then raise exception 'La fecha límite ya ha pasado';end if;
   update bruff_private.automations set ends_at=case when config->>'type'='online' or coalesce((config->>'repeat')::boolean,false) then case when config->>'endMode'='date' then (config->>'endAt')::timestamptz when config->>'endMode'='duration' then start_time+make_interval(secs=>case when a.status='paused' and a.remaining_seconds is not null then a.remaining_seconds else (config->>'durationMinutes')::int*60 end) else null end else null end,remaining_seconds=null,cycle_started=coalesce(cycle_started,start_time),status='active',activated_by=auth.uid(),activated_at=coalesce(activated_at,now()),binding=public.bruff_live_authorize(w,c,'send'),cursor=case when a.status='paused' and config->>'type'='mass' then cursor else null end,scan_done=case when a.status='paused' and config->>'type'='mass' then scan_done else false end,lease=null,lease_until=null,next_check=start_time,version=version+1,updated_at=now(),last_error=null where id=a.id returning * into a;
  else
   if op='stop' and a.status not in ('active','paused') then raise exception 'Solo puedes finalizar una regla activa o pausada';end if;
   if op='pause' and a.status<>'active' then raise exception 'Solo se puede pausar una automatización activa';end if;
   if op in ('archive','restore') and a.status='active' then raise exception 'Pausa antes de archivar';end if;
   update bruff_private.automations set remaining_seconds=case when op='pause' and config->>'endMode'='duration' and ends_at is not null then greatest(0,extract(epoch from ends_at-greatest(now(),cycle_started))::int) else remaining_seconds end,status=case when op='pause' then 'paused' when op='stop' then 'completed' else status end,archived=case when op='archive' then true when op='restore' then false else archived end,lease=null,lease_until=null,version=version+1,updated_at=now() where id=a.id;
   if op='stop' and a.status not in ('active','paused') then raise exception 'Solo puedes finalizar una regla activa o pausada';end if;
   if op='stop' or (op='pause' and a.config->>'type'<>'mass') then update bruff_private.automation_deliveries set state='skipped',detail='Pausada antes del envío' where automation_id=a.id and state='pending';end if;
  end if;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'automation_'||op,auth.uid());
 end if;
 select coalesce(jsonb_agg(config||jsonb_build_object('id',id,'version',version,'status',status,'archived',archived,'createdAt',created_at,'updatedAt',updated_at,'lastError',last_error,'scanDone',scan_done,'endsAt',ends_at,'remainingSeconds',remaining_seconds,'cycle',cycle,'nextRun',next_check,
 'counts',(select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from (select state,count(*) n from bruff_private.automation_deliveries where automation_id=row_rule.id group by state) q),
 'history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from (select fan_id,state,created_at,attempted_at,message_id,detail from bruff_private.automation_deliveries where automation_id=row_rule.id order by created_at desc limit 20) h)) order by created_at desc),'[]'::jsonb) into result from bruff_private.automations row_rule where workspace_id=w and creator_id=c;
 return jsonb_build_object('schedulerVersion',2,'rows',result,'lastTick',(select last_tick from bruff_private.automation_runtime),'savedId',a.id);
end $$;

-- All worker operations are service-only; each delivery revalidates the activating owner.
create or replace function public.bruff_automation_worker(op text,token text default null,rule_id uuid default null,lease_id uuid default null,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a bruff_private.automations; d bruff_private.automation_deliveries; x jsonb; outrows jsonb='[]'; actor_name text; allowed jsonb; request uuid;
begin
 if op='claim' then
  if token is null or not exists(select 1 from bruff_private.automation_runtime where secret_hash=md5(token)) then raise exception 'No autorizado' using errcode='42501';end if;
  update bruff_private.automation_runtime set last_tick=now();
  update bruff_private.automation_deliveries set state='uncertain',detail='Confirmación interrumpida; no se reintenta automáticamente' where state='sending' and attempted_at<now()-interval '5 minutes';
  update bruff_private.automations rule_row set status='error',last_error='Hay envíos sin confirmar. Revisa el historial.',lease=null,lease_until=null,version=version+1 where status='active' and exists(select 1 from bruff_private.automation_deliveries receipt_row where receipt_row.automation_id=rule_row.id and receipt_row.state='uncertain');
  update bruff_private.automation_deliveries set state='skipped',detail='Duración finalizada' where state='pending' and automation_id in(select id from bruff_private.automations where status='active' and ends_at<=now());
  update bruff_private.automations set status='completed',lease=null,lease_until=null,version=version+1 where status='active' and ends_at<=now();
  for a in select * from bruff_private.automations where status='active' and next_check<=now() and (lease_until is null or lease_until<now()) order by next_check,id limit 3 for update skip locked loop
   update bruff_private.automations set lease=gen_random_uuid(),lease_until=now()+interval '90 seconds',next_check=now()+interval '1 minute' where id=a.id returning * into a;
   outrows=outrows||jsonb_build_array(to_jsonb(a));
  end loop;return outrows;
 end if;
 select * into a from bruff_private.automations where id=rule_id for update;
 if not found then raise exception 'Regla no encontrada';end if;
 if op='finish' then
  update bruff_private.automation_deliveries set state=case when payload->>'messageId' ~ '^[0-9]{1,24}$' then 'sent' else 'uncertain' end,message_id=case when payload->>'messageId' ~ '^[0-9]{1,24}$' then payload->>'messageId' else null end,detail=left(payload->>'detail',200)
  where id=(payload->>'id')::uuid and automation_id=a.id and state='sending' returning * into d;
  if d.state='uncertain' then update bruff_private.automations set status=case when status='active' then 'error' else status end,last_error='Envío sin confirmar. Revisa el historial antes de continuar.',lease=null,lease_until=null,version=version+1 where id=a.id;end if;
  if d.message_id is not null then perform public.bruff_message_finish(a.workspace_id,a.creator_id,d.fan_id,d.id,a.activated_by,d.message_id);end if;
  return '{}'::jsonb;
 end if;
 if a.status<>'active' or a.lease is distinct from lease_id or a.lease_until<now() then return null;end if;
 if a.ends_at<=now() then
  update bruff_private.automations set status='completed',lease=null,lease_until=null,version=version+1 where id=a.id;
  update bruff_private.automation_deliveries set state='skipped',detail='Duración finalizada' where automation_id=a.id and state='pending';return null;
 end if;
 perform set_config('request.jwt.claim.sub',a.activated_by::text,true);
 if not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=a.workspace_id and m.user_id=a.activated_by and m.status='active' and m.role='owner' and u.email_confirmed_at is not null)
 or not bruff_private.can_access(a.workspace_id,a.creator_id,'send') or not exists(select 1 from bruff_private.creator_accounts where workspace_id=a.workspace_id and id=a.creator_id and external_id=a.binding and provider='ofmapi' and connection_status='connected') then
  update bruff_private.automations set status='paused',last_error='Acceso o conexión revocados',version=version+1 where id=a.id;return null;
 end if;
 if op='page' then
  if jsonb_typeof(payload->'fans') is distinct from 'array' or jsonb_array_length(payload->'fans')>1000 then raise exception 'Página inválida';end if;
  for x in select * from jsonb_array_elements(payload->'fans') loop
   if x->>'id' ~ '^[0-9]{1,24}$' then
    if a.config->>'type'='online' and exists(select 1 from bruff_private.automation_deliveries z join bruff_private.automations r on r.id=z.automation_id where r.workspace_id=a.workspace_id and r.creator_id=a.creator_id and r.config->>'type'='online' and z.fan_id=x->>'id' and z.state in ('pending','sending','sent','uncertain') and z.created_at>now()-make_interval(hours=>(a.config->>'cooldown')::int)) then continue;end if;
    insert into bruff_private.automation_deliveries(automation_id,fan_id,dedupe) values(a.id,x->>'id',case when a.config->>'type'='online' then (x->>'id')||':'||clock_timestamp()::text when a.config->>'type'='mass' then (x->>'id')||':'||a.cycle::text else x->>'id' end) on conflict do nothing;
   end if;
  end loop;
  update bruff_private.automations set cursor=payload->>'cursor',scan_done=coalesce((payload->>'done')::boolean,false) where id=a.id;
 elsif op='next' then
  for d in select * from bruff_private.automation_deliveries where automation_id=a.id and state='pending' order by created_at,id for update skip locked loop
   if a.config->>'type'='online' and d.created_at<now()-interval '45 seconds' then update bruff_private.automation_deliveries set state='skipped',detail='Presencia caducada' where id=d.id;continue;end if;
   allowed=public.bruff_chat_screen(a.workspace_id,a.creator_id,d.fan_id,a.config->>'text');
   if allowed->>'allowed'<>'true' then update bruff_private.automations set status='paused',last_error='Mensaje bloqueado por la política de BRUFF',version=version+1 where id=a.id;return null;end if;
   perform public.bruff_message_begin(a.workspace_id,a.creator_id,d.fan_id,d.id);
   update bruff_private.automation_deliveries set state='sending',attempted_at=now() where id=d.id;
   return to_jsonb(d)||jsonb_build_object('text',a.config->>'text','binding',a.binding);
  end loop;return null;
 elsif op='skip' then
  update bruff_private.automation_deliveries set state='skipped',detail=left(payload->>'detail',200) where automation_id=a.id and id=(payload->>'id')::uuid and state='sending';
 elsif op='release' then
  if payload->>'error' is not null then
   update bruff_private.automations set status='error',last_error=left(payload->>'error',200),lease=null,lease_until=null,version=version+1 where id=a.id;
  elsif a.config->>'type'='mass' and a.scan_done and not exists(select 1 from bruff_private.automation_deliveries where automation_id=a.id and state in ('pending','sending')) then
   if coalesce((a.config->>'repeat')::boolean,false) and not exists(select 1 from bruff_private.automation_deliveries where automation_id=a.id and state='uncertain') and (a.config->>'endMode'<>'runs' or a.cycle+1<(a.config->>'maxRuns')::int) then
    update bruff_private.automations set cycle=cycle+1,cursor=null,scan_done=false,lease=null,lease_until=null,cycle_started=greatest(now(),cycle_started+make_interval(mins=>(config->>'intervalMinutes')::int)),next_check=greatest(now(),cycle_started+make_interval(mins=>(config->>'intervalMinutes')::int)),version=version+1 where id=a.id;
   else update bruff_private.automations set status=case when exists(select 1 from bruff_private.automation_deliveries where automation_id=a.id and state='uncertain') then 'error' else 'completed' end,lease=null,lease_until=null,version=version+1 where id=a.id;end if;
  else
   update bruff_private.automations set lease=null,lease_until=null,last_error=null,cursor=case when scan_done and config->>'type'<>'mass' then null else cursor end,scan_done=case when config->>'type'<>'mass' then false else scan_done end where id=a.id;
  end if;
 elsif op<>'check' then raise exception 'Operación no válida';end if;
 return jsonb_build_object('ok',true);
end $$;

insert into bruff_private.schema_versions(version) values('202611020015_automation_schedules');
commit;
