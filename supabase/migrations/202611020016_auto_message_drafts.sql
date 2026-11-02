-- Draft storage only. Intentionally independent of automations 014/015 and their worker.
-- Nothing in this migration schedules, activates, sends or withdraws a message.
begin;
create table bruff_private.auto_message_drafts(
 id uuid primary key default gen_random_uuid(),workspace_id uuid not null,creator_id uuid not null,
 config jsonb not null check(jsonb_typeof(config)='object'),
 version bigint not null default 1 check(version>0),archived boolean not null default false,
 created_by uuid not null,updated_by uuid not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 foreign key(workspace_id,created_by) references bruff_private.memberships(workspace_id,user_id),
 foreign key(workspace_id,updated_by) references bruff_private.memberships(workspace_id,user_id)
);
alter table bruff_private.auto_message_drafts enable row level security;
revoke all on bruff_private.auto_message_drafts from public,anon,authenticated;
create index auto_message_draft_scope on bruff_private.auto_message_drafts(workspace_id,creator_id,updated_at desc);

create function public.bruff_auto_message_drafts(w uuid,c uuid,op text default 'list',draft_id uuid default null,expected_version bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a bruff_private.auto_message_drafts; result jsonb; msg jsonb; asset jsonb; clean_messages jsonb='[]'; clean_media jsonb; key text; opt jsonb;
begin
 -- Share the workspace lock with role/grant changes: every operation checks current access.
 perform 1 from bruff_private.workspaces where id=w for update;
 if not bruff_private.can_access(w,c,'send') or not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op not in ('list','save','archive','restore') or op is null then raise exception 'Operación no disponible: solo borradores';end if;
 if op<>'list' then
  if draft_id is not null then
   select * into a from bruff_private.auto_message_drafts where id=draft_id and workspace_id=w and creator_id=c for update;
   if not found then raise exception 'Borrador ajeno' using errcode='42501';end if;
   if expected_version is distinct from a.version then raise exception 'Ha cambiado en otro dispositivo. Abre de nuevo el borrador.' using errcode='40001';end if;
  elsif op<>'save' then raise exception 'Falta el borrador';end if;
  if op='save' then
   if value is null or jsonb_typeof(value)<>'object' or octet_length(value::text)>100000 or value->>'schemaVersion' is distinct from '1'
    or coalesce(value->>'trigger','') not in ('welcome','online','expired','expiring') or coalesce(value->>'action','') not in ('message','assistant')
    or coalesce(length(btrim(value->>'name')),0) not between 1 and 80
    or jsonb_typeof(value->'messages') is distinct from 'array' then raise exception 'Configuración de borrador no válida';end if;
   if jsonb_array_length(value->'messages') not between 1 and 5 then raise exception 'Prepara entre 1 y 5 mensajes';end if;
   foreach key in array array['timeWindow','ending','unsend','resend','audience'] loop
    if jsonb_typeof(value->key) is distinct from 'object' then raise exception 'Faltan reglas de la campaña';end if;
   end loop;
   if coalesce(value->>'delay','') not in ('1-3','3-5','5-15','15-30','30-60') or coalesce(value->>'expiryDays','') not in ('1','2','5','7','10','14') or jsonb_typeof(value->'startAiOnReply') is distinct from 'boolean' then raise exception 'Reglas no válidas';end if;
   foreach key in array array['timeWindow','ending','unsend','resend'] loop
    if jsonb_typeof(value->key->'enabled') is distinct from 'boolean' then raise exception 'Estado de regla no válido';end if;
   end loop;
   opt=value->'timeWindow';
   if coalesce(opt->>'start','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or coalesce(opt->>'end','')!~'^([01][0-9]|2[0-3]):[0-5][0-9]$' or not exists(select 1 from pg_timezone_names where name=opt->>'zone') then raise exception 'Franja no válida';end if;
   value=jsonb_set(value,'{timeWindow}',jsonb_build_object('enabled',opt->'enabled','start',opt->>'start','end',opt->>'end','zone',opt->>'zone'));
   opt=value->'ending';
   if coalesce(opt->>'mode','') not in ('date','duration') or coalesce(opt->>'durationMinutes','')!~'^[0-9]{1,6}$' or (opt->>'durationMinutes')::int not between 1 and 525600 or jsonb_typeof(opt->'at') is distinct from 'string' then raise exception 'Finalización no válida';end if;
   if (opt->>'enabled')::boolean and opt->>'mode'='date' then perform (opt->>'at')::timestamp;end if;
   value=jsonb_set(value,'{ending}',jsonb_build_object('enabled',opt->'enabled','mode',opt->>'mode','at',opt->>'at','durationMinutes',opt->'durationMinutes'));
   opt=value->'unsend';if coalesce(opt->>'mode','') not in ('all','unread') or coalesce(opt->>'hours','') not in ('1','2','5','8','15','20') then raise exception 'Retirada no válida';end if;
   value=jsonb_set(value,'{unsend}',jsonb_build_object('enabled',opt->'enabled','mode',opt->>'mode','hours',opt->'hours'));
   opt=value->'resend';if coalesce(opt->>'days','') not in ('1','2','3','5','7','14','30') or (opt->>'enabled')::boolean and (value->>'trigger'<>'online' or not (value->'unsend'->>'enabled')::boolean) then raise exception 'Reenvío no válido';end if;
   value=jsonb_set(value,'{resend}',jsonb_build_object('enabled',opt->'enabled','days',opt->'days'));
   foreach key in array array['modelSpend','agencySpend','modelPurchase','agencyPurchase','buyingPower'] loop
    opt=value->'audience'->key;
    if jsonb_typeof(opt) is distinct from 'object' or jsonb_typeof(opt->'enabled') is distinct from 'boolean' then raise exception 'Filtro no válido';end if;
    if (opt->>'enabled')::boolean and ((opt->>'min') is null or (opt->>'max') is null or coalesce(opt->>'min','')!~'^[0-9]+([.][0-9]+)?$' or coalesce(opt->>'max','')!~'^[0-9]+([.][0-9]+)?$' or (opt->>'min')::numeric>(opt->>'max')::numeric or key='buyingPower' and (opt->>'max')::numeric>5) then raise exception 'Rango no válido';end if;
    value=jsonb_set(value,array['audience',key],jsonb_build_object('enabled',opt->'enabled','min',opt->'min','max',opt->'max'));
   end loop;
   opt=value->'audience'->'activeChats';
   if jsonb_typeof(opt->'enabled') is distinct from 'boolean' or coalesce(opt->>'mode','') not in ('all','team') or coalesce(opt->>'minutes','')!~'^[0-9]{1,8}$' or (opt->>'minutes')::int<1 then raise exception 'Exclusión no válida';end if;
   value=jsonb_set(value,'{audience,activeChats}',jsonb_build_object('enabled',opt->'enabled','mode',opt->>'mode','minutes',opt->'minutes'));
   opt=value->'audience'->'excludeLists';if jsonb_typeof(opt) is distinct from 'array' then raise exception 'Listas no válidas';end if;
   if jsonb_array_length(opt)>100 or exists(select 1 from jsonb_array_elements(opt) x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^[a-zA-Z0-9_-]{1,100}$') then raise exception 'Listas no válidas';end if;
   select jsonb_object_agg(k,v) into opt from jsonb_each(value->'audience') e(k,v) where k in ('modelSpend','agencySpend','modelPurchase','agencyPurchase','buyingPower','activeChats','excludeLists');value=jsonb_set(value,'{audience}',opt);
   for msg in select * from jsonb_array_elements(value->'messages') loop
    if jsonb_typeof(msg)<>'object' or coalesce(length(msg->>'id'),0) not between 1 and 80 or jsonb_typeof(msg->'text') is distinct from 'string' or length(msg->>'text')>3000
     or jsonb_typeof(msg->'media') is distinct from 'array' or jsonb_typeof(msg->'tags') is distinct from 'array'
     or coalesce(msg->>'nameMode','') not in ('none','custom','fan','fan_custom','custom_fan')
     or coalesce(msg->>'delay','') not in ('0-1','1-2','2-5','5-10','30-45','45-60') then raise exception 'Mensaje no válido';end if;
    if jsonb_array_length(msg->'media')>10 or jsonb_array_length(msg->'tags')>10 or (value->>'action'='message' and length(btrim(msg->>'text'))=0 and jsonb_array_length(msg->'media')=0) then raise exception 'Revisa texto y adjuntos';end if;
    if jsonb_typeof(msg->'fallback') is distinct from 'string' or length(msg->>'fallback')>80 or (msg->>'nameMode'<>'none' and length(btrim(msg->>'fallback'))=0) or exists(select 1 from jsonb_array_elements(msg->'tags') x where jsonb_typeof(x)<>'string' or x#>>'{}'!~'^@?[a-zA-Z0-9_.]{1,64}$') then raise exception 'Personalización no válida';end if;
    foreach key in array array['paidMedia','paidText','firstName'] loop
     if jsonb_typeof(msg->key) is distinct from 'boolean' then raise exception 'Opciones de mensaje inválidas';end if;
    end loop;
    if (msg->>'paidMedia')::boolean or (msg->>'paidText')::boolean then
     if jsonb_typeof(msg->'price') is distinct from 'number' or (msg->>'price')::numeric not between 3 and 200 or round((msg->>'price')::numeric,2)<>(msg->>'price')::numeric then raise exception 'Precio no válido';end if;
    end if;
    clean_media='[]';
    for asset in select * from jsonb_array_elements(msg->'media') loop
     if coalesce(asset->>'id','')!~'^[0-9]{1,24}$' or coalesce(asset->>'type','') not in ('photo','video','audio','gif') or coalesce(asset->>'slot','') not in ('free','paid') then raise exception 'Adjunto no válido';end if;
     clean_media=clean_media||jsonb_build_array(jsonb_build_object('id',asset->>'id','type',asset->>'type','slot',asset->>'slot'));
    end loop;
    if jsonb_array_length(clean_media)<>(select count(distinct x->>'id') from jsonb_array_elements(clean_media) x) then raise exception 'Adjuntos duplicados';end if;
    clean_messages=clean_messages||jsonb_build_array(jsonb_build_object('id',msg->>'id','text',msg->>'text','delay',msg->>'delay','nameMode',msg->>'nameMode','fallback',left(msg->>'fallback',80),'firstName',msg->'firstName','paidMedia',msg->'paidMedia','paidText',msg->'paidText','price',msg->'price','media',clean_media,'tags',msg->'tags'));
   end loop;
   if jsonb_array_length(clean_messages)<>(select count(distinct x->>'id') from jsonb_array_elements(clean_messages) x) then raise exception 'Mensajes duplicados';end if;
   -- Only whitelisted top-level configuration reaches storage. No execution state is accepted.
   value=jsonb_build_object('schemaVersion',1,'name',btrim(value->>'name'),'trigger',value->>'trigger','action',value->>'action','delay',value->>'delay','expiryDays',value->'expiryDays',
    'timeWindow',value->'timeWindow','ending',value->'ending','unsend',value->'unsend','resend',value->'resend','startAiOnReply',value->'startAiOnReply','audience',value->'audience','messages',clean_messages);
   if a.id is null then insert into bruff_private.auto_message_drafts(workspace_id,creator_id,config,created_by,updated_by) values(w,c,value,auth.uid(),auth.uid()) returning * into a;
   else update bruff_private.auto_message_drafts set config=value,version=version+1,updated_at=now(),updated_by=auth.uid() where id=a.id returning * into a;end if;
  else update bruff_private.auto_message_drafts set archived=op='archive',version=version+1,updated_at=now(),updated_by=auth.uid() where id=a.id returning * into a;end if;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'auto_message_draft_'||op,auth.uid());
 end if;
 select coalesce(jsonb_agg(config||jsonb_build_object('id',id,'version',version,'status','draft','archived',archived,'createdAt',created_at,'updatedAt',updated_at,'createdBy',created_by,'updatedBy',updated_by) order by updated_at desc),'[]') into result from bruff_private.auto_message_drafts where workspace_id=w and creator_id=c;
 return jsonb_build_object('schemaVersion',1,'rows',result,'savedId',a.id);
end $$;
revoke all on function public.bruff_auto_message_drafts(uuid,uuid,text,uuid,bigint,jsonb) from public,anon;
grant execute on function public.bruff_auto_message_drafts(uuid,uuid,text,uuid,bigint,jsonb) to authenticated;
insert into bruff_private.schema_versions(version) values('202611020016_auto_message_drafts');
notify pgrst,'reload schema';
commit;
