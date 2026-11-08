-- Explicit owner teaching only. No conversation import, inference or fan send.
begin;
create table bruff_private.chat_teaching_permissions(
 workspace_id uuid not null,creator_id uuid not null,actor_id uuid not null references auth.users(id),
 enabled boolean not null default false,allowed_kinds text[] not null default '{}',version bigint not null check(version>0),
 granted_at timestamptz,revoked_at timestamptz,updated_at timestamptz not null default now(),
 primary key(workspace_id,creator_id,actor_id),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 check(cardinality(allowed_kinds)<=4 and allowed_kinds<@array['example','style_rule','model_fact','boundary']::text[]),
 check(not enabled or cardinality(allowed_kinds)>0)
);
create table bruff_private.chat_teaching_receipts(
 request_id uuid primary key,workspace_id uuid not null,creator_id uuid not null,actor_id uuid not null references auth.users(id),
 request_hash text not null check(request_hash~'^[0-9a-f]{64}$'),kind text not null check(kind in('example','style_rule','model_fact','boundary')),
 source_id uuid not null,source_version bigint not null check(source_version>0),permission_version bigint not null check(permission_version>0),created_at timestamptz not null default now(),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id)
);
alter table bruff_private.chat_teaching_permissions enable row level security;
alter table bruff_private.chat_teaching_receipts enable row level security;
revoke all on bruff_private.chat_teaching_permissions,bruff_private.chat_teaching_receipts from public,anon,authenticated,service_role;

create function public.bruff_teaching_permission(w uuid,c uuid,op text default 'read',expected bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p bruff_private.chat_teaching_permissions;kinds text[];
begin
 perform bruff_private.require_owner(w);
 if not bruff_private.can_access(w,c,'settings') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op is null or op not in('read','save') then raise exception 'Operación no válida' using errcode='22023';end if;
 select * into p from bruff_private.chat_teaching_permissions where workspace_id=w and creator_id=c and actor_id=auth.uid() for update;
 if op='read' then
  if expected is not null or value is not null then raise exception 'Consulta no válida' using errcode='22023';end if;
 else
  if expected is null or expected<0 or expected>=9007199254740991 or expected<>coalesce(p.version,0) then raise exception 'El permiso cambió' using errcode='40001';end if;
  if value is null or jsonb_typeof(value)<>'object' or (value-'enabled'-'allowedKinds')<>'{}'::jsonb or not(value ?& array['enabled','allowedKinds']) or jsonb_typeof(value->'enabled') is distinct from 'boolean' or jsonb_typeof(value->'allowedKinds') is distinct from 'array' then raise exception 'Permiso no válido' using errcode='22023';end if;
  if jsonb_array_length(value->'allowedKinds')>4 or exists(select 1 from jsonb_array_elements(value->'allowedKinds') k where jsonb_typeof(k)<>'string' or k#>>'{}' not in('example','style_rule','model_fact','boundary')) or (select count(distinct k) from jsonb_array_elements(value->'allowedKinds') k)<>jsonb_array_length(value->'allowedKinds') then raise exception 'Ámbito no válido' using errcode='22023';end if;
  select coalesce(array_agg(k order by k),'{}'::text[]) into kinds from jsonb_array_elements_text(value->'allowedKinds') k;
  if (value->>'enabled')::boolean and cardinality(kinds)=0 then raise exception 'Selecciona el ámbito' using errcode='22023';end if;
  insert into bruff_private.chat_teaching_permissions(workspace_id,creator_id,actor_id,enabled,allowed_kinds,version,granted_at,revoked_at)
  values(w,c,auth.uid(),(value->>'enabled')::boolean,kinds,1,case when (value->>'enabled')::boolean then now() end,case when not (value->>'enabled')::boolean then now() end)
  on conflict(workspace_id,creator_id,actor_id) do update set enabled=excluded.enabled,allowed_kinds=excluded.allowed_kinds,version=chat_teaching_permissions.version+1,granted_at=case when excluded.enabled then now() else chat_teaching_permissions.granted_at end,revoked_at=case when not excluded.enabled then now() else null end,updated_at=now() returning * into p;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),case when p.enabled then 'chat_teaching_permission_save' else 'chat_teaching_permission_revoke' end,c);
 end if;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'permission',jsonb_build_object('enabled',coalesce(p.enabled,false),'allowedKinds',to_jsonb(coalesce(p.allowed_kinds,'{}'::text[]))),'version',coalesce(p.version,0));
end $$;

create function bruff_private.chat_teaching_source(w uuid,c uuid,k text,sid uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select case when k='example' then
  (select jsonb_build_object('id',id,'version',version,'state',state,'trigger',trigger,'english',english,'spanish',spanish,'referenceId',reference_id,'label',label,'sourceVersion',source_version) from bruff_private.chat_direct_examples where workspace_id=w and creator_id=c and id=sid)
 else
  (select jsonb_build_object('id',id,'version',version,'state',state,'text',body,'referenceId',reference_id,'label',label,'sourceVersion',source_version)||case when kind='model_fact' then jsonb_build_object('key',fact_key) else '{}'::jsonb end from bruff_private.model_knowledge where workspace_id=w and creator_id=c and id=sid and kind=k)
 end
$$;

create function public.bruff_save_reviewed_teaching(w uuid,c uuid,kind text,source_id uuid,expected bigint,permission_version bigint,request_id uuid,reviewed boolean,value jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p bruff_private.chat_teaching_permissions;r bruff_private.chat_teaching_receipts;fingerprint text;result jsonb;source jsonb;sid uuid;did_reuse boolean:=false;legacy_value jsonb;
begin
 perform bruff_private.require_owner(w);
 if not bruff_private.can_access(w,c,'settings') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if reviewed is distinct from true or kind is null or kind not in('example','style_rule','model_fact','boundary') or request_id is null or expected is null or expected<0 or expected>=9007199254740991 or (source_id is null and expected<>0) or (source_id is not null and expected<1) or value is null or jsonb_typeof(value)<>'object' or octet_length(value::text)>120000 then raise exception 'Enseñanza no válida' using errcode='22023';end if;
 select * into p from bruff_private.chat_teaching_permissions where workspace_id=w and creator_id=c and actor_id=auth.uid() for update;
 if not found or not p.enabled or not(kind=any(p.allowed_kinds)) then raise exception 'Permiso de enseñanza no vigente' using errcode='42501';end if;
 if permission_version is distinct from p.version then raise exception 'El permiso cambió' using errcode='40001';end if;
 if kind='example' then
  if (value-'trigger'-'english'-'spanish'-'referenceId'-'label'-'sourceVersion')<>'{}'::jsonb or not(value ?& array['trigger','english','spanish','referenceId','label','sourceVersion']) or value->>'trigger' is distinct from btrim(value->>'trigger') or value->>'label' is distinct from btrim(value->>'label') then raise exception 'Ejemplo no válido' using errcode='22023';end if;
  legacy_value=value||jsonb_build_object('state','verified','reviewed',true);
 else
  if (value-'text'-'key'-'referenceId'-'label'-'sourceVersion')<>'{}'::jsonb or not(value ?& array['text','referenceId','label','sourceVersion']) or value->>'label' is distinct from btrim(value->>'label') or (kind='model_fact' and (not(value ? 'key') or jsonb_typeof(value->'key') is distinct from 'string')) or (kind<>'model_fact' and value ? 'key') then raise exception 'Conocimiento no válido' using errcode='22023';end if;
  legacy_value=value||jsonb_build_object('kind',kind,'state','verified');
 end if;
 fingerprint=encode(sha256(convert_to(jsonb_build_object('actor',auth.uid(),'workspace',w,'creator',c,'kind',kind,'source',source_id,'expected',expected,'permission',permission_version,'value',value)::text,'UTF8')),'hex');
 -- Owner/workspace mutation lock above makes permission revocation, CAS and
 -- receipt creation one transaction. No JWT substitution or service role.
 select * into r from bruff_private.chat_teaching_receipts t where t.request_id=bruff_save_reviewed_teaching.request_id;
 if found then
  if r.actor_id<>auth.uid() or r.workspace_id<>w or r.creator_id<>c then raise exception 'Solicitud no disponible' using errcode='42501';end if;
  if r.request_hash<>fingerprint then raise exception 'Solicitud reutilizada con otros datos' using errcode='40001';end if;
  sid=r.source_id;source=bruff_private.chat_teaching_source(w,c,kind,sid);
  if source is null or (source->>'version')::bigint<>r.source_version or source->>'state'<>'verified' or (source-'id'-'version'-'state')<>value then raise exception 'La enseñanza cambió' using errcode='40001';end if;
  did_reuse=true;
 else
  if source_id is not null then
   source=bruff_private.chat_teaching_source(w,c,kind,source_id);
   if source is null then raise exception 'Fuente no disponible' using errcode='42501';end if;
   if kind='model_fact' and source->>'key' is distinct from value->>'key' then raise exception 'No se sustituye otra clave de hecho' using errcode='22023';end if;
  end if;
  if kind='example' then result=public.bruff_chat_direct_knowledge(w,c,'save',source_id,expected,legacy_value);
  else result=public.bruff_model_knowledge(w,c,'save',source_id,expected,legacy_value);end if;
  sid=(result->>'savedId')::uuid;source=bruff_private.chat_teaching_source(w,c,kind,sid);
  if sid is null or source is null or (source->>'version')::bigint<>expected+1 or source->>'state'<>'verified' or (source-'id'-'version'-'state')<>value then raise exception 'Resultado no confirmado' using errcode='40001';end if;
  insert into bruff_private.chat_teaching_receipts(request_id,workspace_id,creator_id,actor_id,request_hash,kind,source_id,source_version,permission_version) values(request_id,w,c,auth.uid(),fingerprint,kind,sid,expected+1,permission_version);
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'chat_teaching_reviewed_save',sid);
 end if;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'requestId',request_id,'reused',did_reuse,'permissionVersion',p.version,'kind',kind,'source',source);
end $$;

-- Authenticated read context; no catalogue dependency and no client owner ID.
create function public.bruff_fan_memory_scope(w uuid,c uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare a bruff_private.creator_accounts;owner_id uuid;n integer;
begin
 if not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null) or not bruff_private.can_access(w,c,'read') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 select * into a from bruff_private.creator_accounts where workspace_id=w and id=c and provider='ofmapi' and connection_status='connected';
 if not found or a.external_id is null or length(a.external_id)>128 or a.external_id!~'^acct_[A-Za-z0-9_-]+$' then raise exception 'Cuenta no disponible' using errcode='42501';end if;
 select count(*) into n from bruff_private.creator_accounts where provider='ofmapi' and connection_status='connected' and external_id=a.external_id;
 if n<>1 then raise exception 'Cuenta ambigua' using errcode='42501';end if;
 select count(*),min(m.user_id::text)::uuid into n,owner_id from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.role='owner' and m.status='active' and u.email_confirmed_at is not null;
 if n<>1 then raise exception 'Propietario no disponible' using errcode='42501';end if;
 return jsonb_build_object('actorId',auth.uid(),'ownerId',owner_id,'workspaceId',w,'creatorId',c,'binding',a.external_id);
end $$;
revoke all on function bruff_private.chat_teaching_source(uuid,uuid,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.bruff_teaching_permission(uuid,uuid,text,bigint,jsonb),public.bruff_save_reviewed_teaching(uuid,uuid,text,uuid,bigint,bigint,uuid,boolean,jsonb),public.bruff_fan_memory_scope(uuid,uuid) from public,anon,service_role;
grant execute on function public.bruff_teaching_permission(uuid,uuid,text,bigint,jsonb),public.bruff_save_reviewed_teaching(uuid,uuid,text,uuid,bigint,bigint,uuid,boolean,jsonb),public.bruff_fan_memory_scope(uuid,uuid) to authenticated;
insert into bruff_private.schema_versions(version) values('202611080046_chat_teaching');
notify pgrst,'reload schema';
commit;
