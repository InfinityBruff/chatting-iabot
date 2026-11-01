begin;
create table bruff_private.notification_reviews (
 workspace_id uuid not null, creator_id uuid not null, user_id uuid not null,
 baseline bigint not null, sections jsonb not null default '{}', updated_at timestamptz not null default now(),
 primary key(workspace_id,creator_id,user_id),
 foreign key(workspace_id,creator_id) references bruff_private.creator_accounts(workspace_id,id),
 foreign key(workspace_id,user_id) references bruff_private.memberships(workspace_id,user_id)
);
alter table bruff_private.notification_reviews enable row level security;
revoke all on bruff_private.notification_reviews from public,anon,authenticated;
create function public.bruff_notification_sync(w uuid,c uuid,initial_baseline bigint,review_sections jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare existing bruff_private.notification_reviews; merged jsonb; k text; ids jsonb;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if not bruff_private.can_access(w,c,'read') or not exists(
  select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id
  where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if initial_baseline is null or initial_baseline<0 or initial_baseline>extract(epoch from clock_timestamp())*1000+60000
 or review_sections is null or jsonb_typeof(review_sections)<>'object' or octet_length(review_sections::text)>2000000 then raise exception 'Estado no válido';end if;
 for k,ids in select * from jsonb_each(review_sections) loop
  if k not in ('sidebar','all','subscribed','purchases','tip','commented','mentioned','favorited','message','deactivated_media') or jsonb_typeof(ids)<>'array' then raise exception 'Apartado no válido';end if;
  if exists(select 1 from jsonb_array_elements(ids) x where jsonb_typeof(x)<>'string' or length(x#>>'{}') not between 1 and 100) then raise exception 'Identificador no válido';end if;
 end loop;
 insert into bruff_private.notification_reviews(workspace_id,creator_id,user_id,baseline) values(w,c,auth.uid(),initial_baseline) on conflict do nothing;
 select * into existing from bruff_private.notification_reviews where workspace_id=w and creator_id=c and user_id=auth.uid() for update;
 merged=existing.sections;
 for k,ids in select * from jsonb_each(review_sections) loop
  merged=jsonb_set(merged,array[k],(select coalesce(jsonb_agg(distinct x),'[]'::jsonb) from jsonb_array_elements(coalesce(merged->k,'[]'::jsonb)||ids) x));
 end loop;
 update bruff_private.notification_reviews set sections=merged,updated_at=now() where workspace_id=w and creator_id=c and user_id=auth.uid();
 return jsonb_build_object('baseline',existing.baseline,'reviewed','[]'::jsonb,'sections',merged);
end $$;
revoke all on function public.bruff_notification_sync(uuid,uuid,bigint,jsonb) from public,anon;
grant execute on function public.bruff_notification_sync(uuid,uuid,bigint,jsonb) to authenticated;
commit;
