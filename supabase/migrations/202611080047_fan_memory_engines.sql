-- Bump the complete prompt/context contract without changing budgets or enabling
-- any model, automation, credential, audience or delivery. Existing reservations
-- remain readable for accounting; older engines cannot begin a new delivery.
begin;
alter table bruff_private.generation_reservations drop constraint generation_reservations_engine_version_check;
alter table bruff_private.generation_reservations add constraint generation_reservations_engine_version_check
 check(engine_version in ('legacy-v1','bruff-drafts-v2','bruff-drafts-v3','bruff-autopilot-v1','bruff-autopilot-v2'));

-- Patch only fixed version literals in the existing reviewed functions. Their
-- authorization, lock order, idempotency, leases and quota arithmetic stay intact.
-- Guards abort the transaction if the expected baseline no longer matches.
do $migration$
declare body text;
begin
 body=pg_get_functiondef('public.bruff_generation_claim_v2(uuid,uuid,uuid,text,text,text,text,boolean)'::regprocedure);
 if position('engine not in (''legacy-v1'',''bruff-drafts-v2'')' in body)=0
  or position('engine=''bruff-drafts-v2'' and r.actor_id=a' in body)=0 then
  raise exception 'Generation claim baseline changed' using errcode='40001';
 end if;
 body=replace(body,'engine not in (''legacy-v1'',''bruff-drafts-v2'')','engine not in (''legacy-v1'',''bruff-drafts-v2'',''bruff-drafts-v3'')');
 body=replace(body,'engine=''bruff-drafts-v2'' and r.actor_id=a','engine in (''bruff-drafts-v2'',''bruff-drafts-v3'') and r.actor_id=a');
 execute body;

 body=pg_get_functiondef('public.bruff_queue_selected_reply(uuid,uuid,text,uuid,uuid,text,text,boolean)'::regprocedure);
 if position('r.engine_version<>''bruff-drafts-v2''' in body)=0 then
  raise exception 'Selected reply baseline changed' using errcode='40001';
 end if;
 execute replace(body,'r.engine_version<>''bruff-drafts-v2''','r.engine_version<>''bruff-drafts-v3''');

 body=pg_get_functiondef('public.bruff_autopilot_worker(text,uuid,uuid,jsonb)'::regprocedure);
 if position('r.engine_version=''bruff-autopilot-v1''' in body)=0
  or position('''bruff-autopilot-v1'',moment' in body)=0
  or position('then ''bruff-drafts-v2'' else ''bruff-autopilot-v1''' in body)=0 then
  raise exception 'Autopilot worker baseline changed' using errcode='40001';
 end if;
 body=replace(body,'''bruff-autopilot-v1''','''bruff-autopilot-v2''');
 body=replace(body,'''bruff-drafts-v2''','''bruff-drafts-v3''');
 execute body;
end
$migration$;
insert into bruff_private.schema_versions(version) values('202611080047_fan_memory_engines');
commit;
