begin;
create table bruff_private.automations(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,creator_id uuid not null,
 config jsonb not null,version bigint not null default 1,status text not null default 'draft' check(status in ('draft','active','paused','completed','error')),
 archived boolean not null default false,updated_at timestamptz not null default now(),created_at timestamptz not null default now(),
 activated_by uuid,activated_at timestamptz,binding text,cursor text,scan_done boolean not null default false,
 lease uuid,lease_until timestamptz,next_check timestamptz not null default now(),last_error text,
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 foreign key(workspace_id,activated_by) references bruff_private.memberships(workspace_id,user_id)
);
create unique index automation_one_recurring on bruff_private.automations(workspace_id,creator_id,(config->>'type')) where status='active' and config->>'type' in ('welcome','online');
create table bruff_private.automation_deliveries(
 id uuid primary key default gen_random_uuid(),automation_id uuid not null references bruff_private.automations(id),
 fan_id text not null check(fan_id ~ '^[0-9]{1,24}$'),dedupe text not null,
 state text not null default 'pending' check(state in ('pending','sending','sent','skipped','uncertain','failed')),
 created_at timestamptz not null default now(),attempted_at timestamptz,message_id text,detail text,
 unique(automation_id,dedupe)
);
create index automation_pending on bruff_private.automation_deliveries(automation_id,state,created_at);
create table bruff_private.automation_runtime(singleton boolean primary key default true check(singleton),secret_hash text,last_tick timestamptz);
insert into bruff_private.automation_runtime(singleton) values(true);
alter table bruff_private.automations enable row level security;
alter table bruff_private.automation_deliveries enable row level security;
alter table bruff_private.automation_runtime enable row level security;
revoke all on bruff_private.automations,bruff_private.automation_deliveries,bruff_private.automation_runtime from public,anon,authenticated;

create function bruff_private.automation_access(w uuid,c uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 if not bruff_private.can_access(w,c,'send') or not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
end $$;
create function public.bruff_automations(w uuid,c uuid,op text default 'list',rule_id uuid default null,expected_version bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a bruff_private.automations; result jsonb; typ text; actor_role text;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 perform bruff_private.automation_access(w,c);
 if op not in ('list','save','archive','restore','activate','pause') then raise exception 'Operación no válida';end if;
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
    or coalesce(value->>'audience','') not in ('all','selected') or jsonb_typeof(value->'recipients') is distinct from 'array'
    or jsonb_array_length(value->'recipients')>5000 or exists(select 1 from jsonb_array_elements(value->'recipients') x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^[0-9]{1,24}$')
    or (typ='mass' and value->>'audience'='selected' and jsonb_array_length(value->'recipients')=0)
    or coalesce(value->>'schedule','') not in ('manual','scheduled')
    or coalesce(value->>'cooldown','') not in ('24','48','72','168') or coalesce(value->>'limit','') not in ('1','2','3')
    or jsonb_typeof(value->'skipRecent') is distinct from 'boolean'
   then raise exception 'Configuración no válida';end if;
   if a.id is not null and typ='mass' and exists(select 1 from bruff_private.automation_deliveries where automation_id=a.id) then raise exception 'La campaña ya ha empezado: conserva su texto o crea un borrador nuevo';end if;
   if a.id is not null and a.config->>'type'<>typ then raise exception 'Crea otra regla para cambiar el tipo';end if;
   if typ='mass' and value->>'schedule'='scheduled' and ((value->>'at')::timestamptz is null or (value->>'at')::timestamptz<=now()) then raise exception 'Selecciona una fecha futura';end if;
   value=jsonb_build_object('type',typ,'name',btrim(value->>'name'),'text',value->>'text','audience',value->>'audience','recipients',value->'recipients','schedule',value->>'schedule','at',value->>'at','cooldown',(value->>'cooldown')::int,'limit',(value->>'limit')::int,'skipRecent',(value->>'skipRecent')::boolean);
   if a.id is null then insert into bruff_private.automations(workspace_id,creator_id,config) values(w,c,value) returning * into a;
   else update bruff_private.automations set config=value,status='draft',version=version+1,updated_at=now(),last_error=null where id=a.id returning * into a;end if;
  elsif op='activate' then
   select role into actor_role from bruff_private.memberships where workspace_id=w and user_id=auth.uid();
   if actor_role<>'owner' then raise exception 'Solo el propietario puede activar envíos' using errcode='42501';end if;
   if a.status not in ('draft','paused') or a.archived then raise exception 'Esta regla no puede activarse';end if;
   if not exists(select 1 from bruff_private.automation_runtime where last_tick>now()-interval '3 minutes') then raise exception 'Ejecutor sin conexión reciente. No se activará ningún envío.';end if;
   if exists(select 1 from bruff_private.automation_deliveries where automation_id=a.id and state in ('sending','uncertain')) then raise exception 'Hay envíos sin confirmar. Revisa el historial antes de continuar.';end if;
   if exists(select 1 from bruff_private.chat_safety_terms where position(bruff_private.chat_normalize(term) in bruff_private.chat_normalize(a.config->>'text'))>0) then raise exception 'El texto contiene términos bloqueados por la política de BRUFF';end if;
   if a.config->>'type'='welcome' and coalesce(value->>'welcomeReviewed','false')<>'true' then raise exception 'Revisa la bienvenida externa para evitar duplicados';end if;
   if a.config->>'type'='mass' and a.config->>'schedule'='scheduled' and (a.config->>'at')::timestamptz<=now() then raise exception 'Actualiza la fecha antes de activar';end if;
   update bruff_private.automations set status='active',activated_by=auth.uid(),activated_at=now(),binding=public.bruff_live_authorize(w,c,'send'),cursor=null,scan_done=false,lease=null,lease_until=null,next_check=case when config->>'type'='mass' and config->>'schedule'='scheduled' then (config->>'at')::timestamptz else now() end,version=version+1,updated_at=now(),last_error=null where id=a.id returning * into a;
  else
   if op='pause' and a.status<>'active' then raise exception 'Solo se puede pausar una automatización activa';end if;
   if op in ('archive','restore') and a.status='active' then raise exception 'Pausa antes de archivar';end if;
   update bruff_private.automations set status=case when op='pause' then 'paused' else status end,archived=case when op='archive' then true when op='restore' then false else archived end,lease=null,lease_until=null,version=version+1,updated_at=now() where id=a.id;
   if op='pause' and a.config->>'type'<>'mass' then update bruff_private.automation_deliveries set state='skipped',detail='Pausada antes del envío' where automation_id=a.id and state='pending';end if;
  end if;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'automation_'||op,auth.uid());
 end if;
 select coalesce(jsonb_agg(config||jsonb_build_object('id',id,'version',version,'status',status,'archived',archived,'createdAt',created_at,'updatedAt',updated_at,'lastError',last_error,'scanDone',scan_done,
 'counts',(select coalesce(jsonb_object_agg(state,n),'{}'::jsonb) from (select state,count(*) n from bruff_private.automation_deliveries where automation_id=row_rule.id group by state) q),
 'history',(select coalesce(jsonb_agg(to_jsonb(h)),'[]'::jsonb) from (select fan_id,state,created_at,attempted_at,message_id,detail from bruff_private.automation_deliveries where automation_id=row_rule.id order by created_at desc limit 20) h)) order by created_at desc),'[]'::jsonb) into result from bruff_private.automations row_rule where workspace_id=w and creator_id=c;
 return jsonb_build_object('rows',result,'lastTick',(select last_tick from bruff_private.automation_runtime),'savedId',a.id);
end $$;

-- All worker operations are service-only; each delivery revalidates the activating owner.
create function public.bruff_automation_worker(op text,token text default null,rule_id uuid default null,lease_id uuid default null,payload jsonb default '{}') returns jsonb
language plpgsql security definer set search_path='' as $$
declare a bruff_private.automations; d bruff_private.automation_deliveries; x jsonb; outrows jsonb='[]'; actor_name text; allowed jsonb; request uuid;
begin
 if op='claim' then
  if token is null or not exists(select 1 from bruff_private.automation_runtime where secret_hash=md5(token)) then raise exception 'No autorizado' using errcode='42501';end if;
  update bruff_private.automation_runtime set last_tick=now();
  update bruff_private.automation_deliveries set state='uncertain',detail='Confirmación interrumpida; no se reintenta automáticamente' where state='sending' and attempted_at<now()-interval '5 minutes';
  update bruff_private.automations rule_row set status='error',last_error='Hay envíos sin confirmar. Revisa el historial.',lease=null,lease_until=null,version=version+1 where status='active' and exists(select 1 from bruff_private.automation_deliveries receipt_row where receipt_row.automation_id=rule_row.id and receipt_row.state='uncertain');
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
    insert into bruff_private.automation_deliveries(automation_id,fan_id,dedupe) values(a.id,x->>'id',case when a.config->>'type'='online' then (x->>'id')||':'||clock_timestamp()::text else x->>'id' end) on conflict do nothing;
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
  update bruff_private.automations set lease=null,lease_until=null,last_error=left(payload->>'error',200),status=case when config->>'type'='mass' and scan_done and not exists(select 1 from bruff_private.automation_deliveries where automation_id=a.id and state in ('pending','sending')) then case when exists(select 1 from bruff_private.automation_deliveries where automation_id=a.id and state='uncertain') then 'error' else 'completed' end else status end,
  cursor=case when scan_done and config->>'type'<>'mass' then null else cursor end,scan_done=case when config->>'type'<>'mass' then false else scan_done end where id=a.id;
 elsif op<>'check' then raise exception 'Operación no válida';end if;
 return jsonb_build_object('ok',true);
end $$;
revoke all on function bruff_private.automation_access(uuid,uuid) from public,anon,authenticated;
revoke all on function public.bruff_automations(uuid,uuid,text,uuid,bigint,jsonb) from public,anon;
grant execute on function public.bruff_automations(uuid,uuid,text,uuid,bigint,jsonb) to authenticated;
revoke all on function public.bruff_automation_worker(text,text,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.bruff_automation_worker(text,text,uuid,uuid,jsonb) to service_role;
insert into bruff_private.schema_versions(version) values('202611010014_automations');
commit;
