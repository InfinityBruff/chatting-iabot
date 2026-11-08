-- Compact per-worker review synchronization. No provider read, fan write,
-- polling-frequency change or cached authorization is introduced here.
begin;
alter table bruff_private.notification_reviews add column version bigint not null default 1 check(version>0);

create function bruff_private.notification_sections_canonical(v jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,ids order by key),'{}'::jsonb)
 from (select e.key,(select jsonb_agg(distinct item order by item) from jsonb_array_elements(e.value) items(item)) ids
       from jsonb_each(v) e where jsonb_array_length(e.value)>0) normalized
$$;
revoke all on function bruff_private.notification_sections_canonical(jsonb) from public,anon,authenticated;

-- Older published clients still use the original RPC. Its genuine changes must
-- bump the same version, while unchanged legacy UPDATEs produce no row write.
create function bruff_private.notification_review_version() returns trigger
language plpgsql set search_path='' as $$
begin
 new.sections=bruff_private.notification_sections_canonical(new.sections);
 if new.baseline is not distinct from old.baseline
  and new.sections=bruff_private.notification_sections_canonical(old.sections) then return null;end if;
 new.version=old.version+1;new.updated_at=clock_timestamp();return new;
end $$;
revoke all on function bruff_private.notification_review_version() from public,anon,authenticated;
create trigger notification_review_version before update on bruff_private.notification_reviews
 for each row execute function bruff_private.notification_review_version();

create function public.bruff_notification_sync_batch(w uuid,entries jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();item jsonb;model uuid;seen uuid[]:=array[]::uuid[];baseline bigint;known bigint;
 delta jsonb;merged jsonb;k text;ids jsonb;existing bruff_private.notification_reviews;models jsonb:='[]'::jsonb;
begin
 -- Membership writers take this workspace lock too. Recheck on every RPC;
 -- no caller-supplied user, owner, session version or authorization is trusted.
 perform 1 from bruff_private.workspaces where id=w for update;
 if not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id
  where m.workspace_id=w and m.user_id=actor and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if entries is null or jsonb_typeof(entries)<>'array' or jsonb_array_length(entries)>50 or octet_length(entries::text)>2000000
 then raise exception 'Estado no válido' using errcode='22023';end if;
 for item in select value from jsonb_array_elements(entries) loop
  if jsonb_typeof(item)<>'object' or not(item ?& array['creatorId','initialBaseline','knownVersion','delta'])
   or (item-'creatorId'-'initialBaseline'-'knownVersion'-'delta')<>'{}'::jsonb
   or jsonb_typeof(item->'creatorId') is distinct from 'string' or item->>'creatorId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   or jsonb_typeof(item->'initialBaseline') is distinct from 'number'
   or (item->>'initialBaseline')::numeric<>trunc((item->>'initialBaseline')::numeric)
   or (item->>'initialBaseline')::numeric not between 0 and floor(extract(epoch from clock_timestamp())*1000)+60000
   or jsonb_typeof(item->'knownVersion') not in ('number','null')
   or jsonb_typeof(item->'knownVersion')='number' and ((item->>'knownVersion')::numeric<>trunc((item->>'knownVersion')::numeric) or (item->>'knownVersion')::numeric not between 1 and 9007199254740991)
   or jsonb_typeof(item->'delta') is distinct from 'object'
  then raise exception 'Estado no válido' using errcode='22023';end if;
  model=(item->>'creatorId')::uuid;if model=any(seen) then raise exception 'Modelo repetida' using errcode='22023';end if;seen=array_append(seen,model);
  baseline=(item->>'initialBaseline')::bigint;known=(item->>'knownVersion')::bigint;delta=item->'delta';
  for k,ids in select * from jsonb_each(delta) loop
   if k not in ('sidebar','all','subscribed','purchases','tip','commented','mentioned','favorited','message','deactivated_media') or jsonb_typeof(ids)<>'array'
    or exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 100)
   then raise exception 'Apartado no válido' using errcode='22023';end if;
  end loop;
  if bruff_private.can_access(w,model,'read') is distinct from true then
   models=models||jsonb_build_array(jsonb_build_object('creatorId',model,'denied',true));continue;
  end if;
  delta=bruff_private.notification_sections_canonical(delta);
  select * into existing from bruff_private.notification_reviews where workspace_id=w and creator_id=model and user_id=actor for update;
  if not found then
   insert into bruff_private.notification_reviews(workspace_id,creator_id,user_id,baseline,sections)
    values(w,model,actor,baseline,delta) on conflict do nothing;
   select * into existing from bruff_private.notification_reviews where workspace_id=w and creator_id=model and user_id=actor for update;
  end if;
  merged=bruff_private.notification_sections_canonical(existing.sections);
  for k,ids in select * from jsonb_each(delta) loop
   merged=jsonb_set(merged,array[k],(select coalesce(jsonb_agg(distinct x order by x),'[]'::jsonb) from jsonb_array_elements(coalesce(merged->k,'[]'::jsonb)||ids) x));
  end loop;
  if octet_length(merged::text)>2000000 then raise exception 'Estado demasiado grande' using errcode='22023';end if;
  if merged is distinct from bruff_private.notification_sections_canonical(existing.sections) then
   update bruff_private.notification_reviews set sections=merged where workspace_id=w and creator_id=model and user_id=actor returning * into existing;
  end if;
  if known is not null and known=existing.version then
   models=models||jsonb_build_array(jsonb_build_object('creatorId',model,'baseline',existing.baseline,'version',existing.version,'unchanged',true));
  else
   models=models||jsonb_build_array(jsonb_build_object('creatorId',model,'baseline',existing.baseline,'version',existing.version,'unchanged',false,'sections',bruff_private.notification_sections_canonical(existing.sections)));
  end if;
 end loop;
 return jsonb_build_object('actorId',actor,'workspaceId',w,'models',models);
end $$;
revoke all on function public.bruff_notification_sync_batch(uuid,jsonb) from public,anon;
grant execute on function public.bruff_notification_sync_batch(uuid,jsonb) to authenticated;
insert into bruff_private.schema_versions(version) values('202611080048_notification_review_batch');
commit;
