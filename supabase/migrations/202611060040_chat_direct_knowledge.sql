-- Owner-reviewed, non-explicit documentary examples only. No model, provider
-- requests, fan messages, ingestion job, send transport or schedule is installed.
begin;

create table bruff_private.chat_direct_examples (
 workspace_id uuid not null,
 creator_id uuid not null,
 id uuid not null default gen_random_uuid(),
 version bigint not null default 1 check(version>0),
 state text not null default 'draft' check(state in ('draft','verified','archived')),
 trigger text not null check(length(btrim(trigger)) between 1 and 2000 and trigger !~ '[[:cntrl:]]'),
 english text not null check(length(btrim(english)) between 1 and 10000 and translate(english,E'\t\n\r','') !~ '[[:cntrl:]]'),
 spanish text not null check(length(btrim(spanish)) between 1 and 10000 and translate(spanish,E'\t\n\r','') !~ '[[:cntrl:]]'),
 source_kind text not null default 'document' check(source_kind='document'),
 content_kind text not null default 'non_explicit' check(content_kind='non_explicit'),
 reference_id text not null check(reference_id ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'),
 label text not null check(length(btrim(label)) between 1 and 200 and label !~ '[[:cntrl:]]'),
 source_version text not null check(source_version ~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$' and source_version<>'0'),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 created_by uuid not null references auth.users(id),
 updated_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 search_terms tsvector generated always as (to_tsvector('pg_catalog.english',trigger)) stored,
 trigger_key text generated always as (lower(regexp_replace(btrim(trigger),'[[:space:]]+',' ','g'))) stored,
 primary key(workspace_id,creator_id,id),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 check(state<>'verified' or (reviewed_by is not null and reviewed_at is not null)),
 check(position('{{' in trigger)=0 and position('}}' in trigger)=0 and position('{{' in english)=0 and position('}}' in english)=0 and position('{{' in spanish)=0 and position('}}' in spanish)=0)
);
alter table bruff_private.chat_direct_examples enable row level security;
revoke all on bruff_private.chat_direct_examples from public,anon,authenticated;
create index chat_direct_examples_scope_state on bruff_private.chat_direct_examples(workspace_id,creator_id,state);
create index chat_direct_examples_search on bruff_private.chat_direct_examples using gin(search_terms) where state='verified';
create index chat_direct_examples_exact on bruff_private.chat_direct_examples(workspace_id,creator_id,trigger_key) where state='verified';
create unique index chat_direct_examples_verified_origin on bruff_private.chat_direct_examples(workspace_id,creator_id,reference_id,trigger_key) where state='verified';

-- All mutation/list operations are owner-only. The shared workspace lock also
-- serializes role changes, capacity checks and optimistic updates.
create function public.bruff_chat_direct_knowledge(w uuid,c uuid,op text default 'list',example_id uuid default null,expected bigint default null,value jsonb default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a bruff_private.chat_direct_examples; result jsonb; total_count integer; saved_id uuid;
begin
 perform bruff_private.require_owner(w);
 if not bruff_private.can_access(w,c,'settings') then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op is null or op not in ('list','save','archive') then raise exception 'Operación no válida' using errcode='22023';end if;
 if op='list' then
  if example_id is not null or expected is not null or value is not null then raise exception 'Consulta no válida' using errcode='22023';end if;
 else
  if example_id is not null then
   select * into a from bruff_private.chat_direct_examples where workspace_id=w and creator_id=c and id=example_id for update;
   if not found then raise exception 'Ejemplo no disponible en esta modelo' using errcode='42501';end if;
   if expected is distinct from a.version then raise exception 'El ejemplo cambió. Recarga antes de guardar.' using errcode='40001';end if;
  elsif op<>'save' or expected is distinct from 0::bigint then
   raise exception 'Versión o ejemplo no válido' using errcode='22023';
  end if;
  if op='save' then
   if value is null or jsonb_typeof(value)<>'object' or (value-'trigger'-'english'-'spanish'-'state'-'referenceId'-'label'-'sourceVersion'-'reviewed')<>'{}'::jsonb
    or not (value ?& array['trigger','english','spanish','state','referenceId','label','sourceVersion'])
    or jsonb_typeof(value->'trigger') is distinct from 'string' or length(btrim(value->>'trigger')) not between 1 and 2000 or value->>'trigger' ~ '[[:cntrl:]]'
    or jsonb_typeof(value->'english') is distinct from 'string' or length(btrim(value->>'english')) not between 1 and 10000
    or translate(value->>'english',E'\t\n\r','') ~ '[[:cntrl:]]'
    or jsonb_typeof(value->'spanish') is distinct from 'string' or length(btrim(value->>'spanish')) not between 1 and 10000
    or translate(value->>'spanish',E'\t\n\r','') ~ '[[:cntrl:]]'
    or jsonb_typeof(value->'state') is distinct from 'string' or value->>'state' not in ('draft','verified','archived')
    or jsonb_typeof(value->'referenceId') is distinct from 'string' or value->>'referenceId' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$'
    or jsonb_typeof(value->'label') is distinct from 'string' or length(btrim(value->>'label')) not between 1 and 200 or value->>'label' ~ '[[:cntrl:]]'
    or jsonb_typeof(value->'sourceVersion') is distinct from 'string' or value->>'sourceVersion' !~ '^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$' or value->>'sourceVersion'='0'
    or value ? 'reviewed' and jsonb_typeof(value->'reviewed') is distinct from 'boolean'
    or value->>'state'='verified' and value->'reviewed' is distinct from 'true'::jsonb
    or position('{{' in value->>'trigger')>0 or position('}}' in value->>'trigger')>0
    or position('{{' in value->>'english')>0 or position('}}' in value->>'english')>0
    or position('{{' in value->>'spanish')>0 or position('}}' in value->>'spanish')>0
   then raise exception 'Revisa los textos, la referencia documental y la revisión no explícita. No se admiten variables ni contenido adjunto.' using errcode='22023';end if;
   if a.id is null then
    select count(*) into total_count from bruff_private.chat_direct_examples where workspace_id=w and creator_id=c;
    if total_count>=200 then raise exception 'Límite de 200 ejemplos por modelo. Edita uno existente.' using errcode='23514';end if;
    insert into bruff_private.chat_direct_examples(workspace_id,creator_id,trigger,english,spanish,state,reference_id,label,source_version,reviewed_by,reviewed_at,created_by,updated_by)
    values(w,c,btrim(value->>'trigger'),value->>'english',value->>'spanish',value->>'state',value->>'referenceId',btrim(value->>'label'),value->>'sourceVersion',case when value->>'state'='verified' then auth.uid() end,case when value->>'state'='verified' then now() end,auth.uid(),auth.uid()) returning * into a;
   else
    update bruff_private.chat_direct_examples set trigger=btrim(value->>'trigger'),english=value->>'english',spanish=value->>'spanish',state=value->>'state',reference_id=value->>'referenceId',label=btrim(value->>'label'),source_version=value->>'sourceVersion',reviewed_by=case when value->>'state'='verified' then auth.uid() end,reviewed_at=case when value->>'state'='verified' then now() end,version=version+1,updated_by=auth.uid(),updated_at=now() where workspace_id=w and creator_id=c and id=a.id returning * into a;
   end if;
  else
   if value is not null then raise exception 'Operación no válida' using errcode='22023';end if;
   update bruff_private.chat_direct_examples set state='archived',version=version+1,updated_by=auth.uid(),updated_at=now() where workspace_id=w and creator_id=c and id=a.id returning * into a;
  end if;
  saved_id=a.id;
  insert into bruff_private.team_audit(workspace_id,actor_id,action,target_id) values(w,auth.uid(),'chat_direct_example_'||op,a.id);
 end if;
 select count(*) into total_count from bruff_private.chat_direct_examples where workspace_id=w and creator_id=c;
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'trigger',trigger,'english',english,'spanish',spanish,'state',state,'referenceId',reference_id,'label',label,'sourceVersion',source_version,'reviewedBy',reviewed_by,'reviewedAt',reviewed_at,'createdAt',created_at,'updatedAt',updated_at) order by updated_at desc,id),'[]'::jsonb) into result
 from (select * from bruff_private.chat_direct_examples where workspace_id=w and creator_id=c order by updated_at desc,id limit 200) e;
 return jsonb_build_object('schemaVersion',1,'status','connected','canEdit',true,'items',result,'total',total_count,'limit',200,'complete',total_count<=200,'savedId',saved_id);
end $$;

-- Query text is transient. Matching requires all non-stopword query lexemes;
-- there is no popular-example fallback, generation or fabricated third option.
create function public.bruff_chat_direct_suggestions(w uuid,c uuid,query text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare terms tsquery; normalized_query text; approved_count integer; result jsonb;
begin
 if not bruff_private.can_access(w,c,'read') or not bruff_private.can_access(w,c,'send')
  or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if query is null or length(query)>2000 then raise exception 'Consulta de hasta 2000 caracteres' using errcode='22023';end if;
 select count(*) into approved_count from bruff_private.chat_direct_examples where workspace_id=w and creator_id=c and state='verified';
 terms=plainto_tsquery('pg_catalog.english',query);
 normalized_query=lower(regexp_replace(btrim(query),'[[:space:]]+',' ','g'));
 with matched as materialized (
  select id,version,english,spanish,reference_id,label,source_version,search_terms,trigger_key
  from bruff_private.chat_direct_examples
  where workspace_id=w and creator_id=c and state='verified' and (trigger_key=normalized_query or numnode(terms)>0 and search_terms @@ terms)
  order by id limit 200
 ), ranked as (
  select *,ts_rank_cd(search_terms,terms)+case when trigger_key=normalized_query then 1 else 0 end as relevance from matched order by relevance desc,id limit 3
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'english',english,'spanish',spanish,'variables','[]'::jsonb,'source',jsonb_build_object('kind','document','modelId',c,'referenceId',reference_id,'label',label,'version',source_version||'.r'||version::text,'verified',true)) order by relevance desc,id),'[]'::jsonb) into result from ranked;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'status',case when approved_count=0 then 'empty' else 'connected' end,'approvedCount',approved_count,'rows',result);
end $$;

-- Revalidate only identity/state/version before manual draft insertion. No body
-- is returned; archival or an edit in another session invalidates old results.
create function public.bruff_chat_direct_reference(w uuid,c uuid,example_id uuid,expected text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not bruff_private.can_access(w,c,'read') or not bruff_private.can_access(w,c,'send')
  or not exists(select 1 from auth.users where id=auth.uid() and email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if example_id is null or expected is null or length(expected)>128 then return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'valid',false);end if;
 return jsonb_build_object('actorId',auth.uid(),'workspaceId',w,'creatorId',c,'valid',exists(select 1 from bruff_private.chat_direct_examples where workspace_id=w and creator_id=c and id=example_id and state='verified' and source_version||'.r'||version::text=expected));
end $$;

revoke all on function public.bruff_chat_direct_knowledge(uuid,uuid,text,uuid,bigint,jsonb),public.bruff_chat_direct_suggestions(uuid,uuid,text),public.bruff_chat_direct_reference(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.bruff_chat_direct_knowledge(uuid,uuid,text,uuid,bigint,jsonb),public.bruff_chat_direct_suggestions(uuid,uuid,text),public.bruff_chat_direct_reference(uuid,uuid,uuid,text) to authenticated;
insert into bruff_private.schema_versions(version) values('202611060040_chat_direct_knowledge');
notify pgrst,'reload schema';
commit;
