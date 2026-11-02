-- Lifecycle controls for existing advanced runs. No activation, enqueue or scheduler.
begin;
create function public.bruff_advanced_runs(w uuid,c uuid,op text default 'list',run_id uuid default null,expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r bruff_private.advanced_runs;result jsonb;
begin
 perform 1 from bruff_private.workspaces where id=w for update;
 if not bruff_private.can_access(w,c,'send') or not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=auth.uid() and m.status='active' and m.role in ('owner','admin') and u.email_confirmed_at is not null)
 then raise exception 'Acceso no permitido' using errcode='42501';end if;
 if op='list' then
  select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'draftId',x.draft_id,'draftVersion',x.draft_version,'state',x.state,'revision',x.revision,'startsAt',x.activated_at,'endsAt',x.ends_at,'counts',(select jsonb_build_object('pending',count(*) filter(where d.state in ('pending','claimed')),'sending',count(*) filter(where d.state='sending'),'sent',count(*) filter(where d.state='sent'),'uncertain',count(*) filter(where d.state='uncertain'),'blocked',count(*) filter(where d.state='blocked')) from bruff_private.advanced_deliveries d where d.run_id=x.id)) order by x.activated_at desc nulls last),'[]'::jsonb) into result from bruff_private.advanced_runs x where x.workspace_id=w and x.creator_id=c;
  return jsonb_build_object('runs',result,'capabilities',jsonb_build_array('pause','resume','stop'),'activationReady',false);
 end if;
 if op is null or op not in ('pause','resume','stop') then raise exception 'Operación no disponible';end if;
 select * into r from bruff_private.advanced_runs where id=run_id and workspace_id=w and creator_id=c for update;
 if r.id is null then raise exception 'Ejecución no encontrada' using errcode='42501';end if;
 if expected_revision is distinct from r.revision then raise exception 'La ejecución ha cambiado. Actualiza antes de continuar' using errcode='40001';end if;
 if r.state in ('stopped','completed') then raise exception 'Esta ejecución ya ha terminado';end if;
 if op='resume' then
  if r.state<>'paused' or r.activated_at is null or r.ends_at<=now() then raise exception 'Esta ejecución no se puede continuar';end if;
  -- Keep the original schedule and require the original activation authority to remain valid.
  if not exists(select 1 from bruff_private.auto_message_drafts d where d.id=r.draft_id and d.workspace_id=w and d.creator_id=c and d.version=r.draft_version and not d.archived)
   or not exists(select 1 from bruff_private.creator_accounts a where a.workspace_id=w and a.id=c and a.connection_status='connected')
   or not exists(select 1 from bruff_private.memberships m join auth.users u on u.id=m.user_id where m.workspace_id=w and m.user_id=r.activated_by and m.role in ('owner','admin') and m.status='active' and u.email_confirmed_at is not null)
  then raise exception 'Revisa el borrador, la conexión y los permisos antes de continuar';end if;
 elsif op='pause' and r.state<>'active' then raise exception 'La ejecución no está activa';end if;
 update bruff_private.advanced_runs set state=case op when 'resume' then 'active' when 'pause' then 'paused' else 'stopped' end,revision=revision+1 where id=r.id returning * into r;
 -- Invalidate only reservations that have not crossed the provider-write boundary.
 -- A request already marked sending is never reset, retried or described as recalled.
 update bruff_private.advanced_deliveries set state=case when op='stop' then 'blocked' else 'pending' end,lease=null,lease_until=null,run_revision=null,detail=case when op='stop' then 'Ejecución detenida por el equipo' else detail end,updated_at=now()
 where bruff_private.advanced_deliveries.run_id=r.id and (state='claimed' or op='stop' and state='pending');
 return jsonb_build_object('id',r.id,'state',r.state,'revision',r.revision,'inFlight',(select count(*) from bruff_private.advanced_deliveries d where d.run_id=r.id and d.state='sending'));
end;$$;
revoke all on function public.bruff_advanced_runs(uuid,uuid,text,uuid,bigint) from public,anon;
grant execute on function public.bruff_advanced_runs(uuid,uuid,text,uuid,bigint) to authenticated;
commit;
