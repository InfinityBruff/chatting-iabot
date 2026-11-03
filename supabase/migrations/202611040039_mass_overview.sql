-- Read-only list projection. Does not activate, enqueue, cancel or send.
begin;
create index native_queue_events_run_latest on bruff_private.native_queue_events(run_id,created_at desc,id desc);
create index advanced_withdrawals_run_state on bruff_private.advanced_withdrawals(run_id,state);
create function public.bruff_mass_overview(w uuid,c uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not bruff_private.can_access(w,c,'send') or not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null) then raise exception 'Acceso no permitido' using errcode='42501';end if;
 with candidates as (
  select r.id,r.draft_id,r.draft_version,'advanced'::text as kind,
   case when r.activated_at is null then 'prepared' else r.state end as state,
   r.activated_at is not null as started,
   coalesce(r.prepared_at,r.activated_at) as prepared_at,
   jsonb_build_object('targets',jsonb_array_length(r.audience_ids),'sent',(select count(*) from bruff_private.advanced_deliveries x where x.run_id=r.id and x.state='sent'),'removed',(select count(*) from bruff_private.advanced_withdrawals x where x.run_id=r.id and x.state='removed'),'review',(select count(*) from bruff_private.advanced_deliveries x where x.run_id=r.id and x.state in ('uncertain','blocked'))+(select count(*) from bruff_private.advanced_withdrawals x where x.run_id=r.id and x.state in ('uncertain','blocked'))) as counts
  from bruff_private.advanced_runs r join bruff_private.auto_message_drafts d on d.id=r.draft_id and d.version=r.draft_version and d.workspace_id=r.workspace_id and d.creator_id=r.creator_id
  where r.workspace_id=w and r.creator_id=c and d.config->>'trigger'='mass' and r.execution_plan is not null
  union all
  select r.id,r.draft_id,r.draft_version,'native'::text,
   case when r.state='accepted' and (select x.result from bruff_private.native_queue_events x where x.run_id=r.id order by x.created_at desc,x.id desc limit 1)='cancelled' then 'cancelled' else r.state end,
   r.state<>'prepared',
   r.prepared_at,
   jsonb_build_object('targets',jsonb_array_length(r.recipients),'sent',null,'removed',null,'review',case when r.state='uncertain' or (select x.result from bruff_private.native_queue_events x where x.run_id=r.id order by x.created_at desc,x.id desc limit 1)='uncertain' then 1 else 0 end)
  from bruff_private.native_mass_runs r join bruff_private.auto_message_drafts d on d.id=r.draft_id and d.version=r.draft_version and d.workspace_id=r.workspace_id and d.creator_id=r.creator_id
  where r.workspace_id=w and r.creator_id=c and d.config->>'trigger'='mass'
 ), latest as (
  -- Each kind is unique per draft version. Prefer an actual start over a dormant
  -- cross-kind preparation; resolve defensive cross-kind ties by time, not UUID.
  select distinct on(draft_id,draft_version) * from candidates order by draft_id,draft_version,started desc,prepared_at desc nulls last,id desc
 ) select coalesce(jsonb_agg(jsonb_build_object('id',id,'draftId',draft_id,'draftVersion',draft_version,'kind',kind,'state',state,'started',started,'counts',counts) order by draft_id),'[]'::jsonb) into result from latest;
 return jsonb_build_object('workspaceId',w,'creatorId',c,'runs',result);
end;$$;
revoke all on function public.bruff_mass_overview(uuid,uuid) from public,anon;
grant execute on function public.bruff_mass_overview(uuid,uuid) to authenticated;
commit;
