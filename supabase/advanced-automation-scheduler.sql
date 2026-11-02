-- Apply only after deployment of the advanced worker and explicit scheduler approval.
-- Does not activate campaigns. Fails rather than start with any existing active run.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$
declare secret_value text;
begin
 if exists(select 1 from bruff_private.advanced_runs where state='active') then raise exception 'Pause active campaigns before enabling this scheduler';end if;
 if exists(select 1 from vault.secrets where name='bruff_advanced_tick') then
  select decrypted_secret into strict secret_value from vault.decrypted_secrets where name='bruff_advanced_tick';
 else
  secret_value=gen_random_uuid()::text||gen_random_uuid()::text;
  perform vault.create_secret(secret_value,'bruff_advanced_tick','BRUFF advanced scheduler only');
 end if;
 update bruff_private.advanced_runtime set secret_hash=md5(secret_value),approved=true,worker_ready=false,last_tick=null where id=true;
end $$;
create or replace function bruff_private.invoke_advanced_tick() returns bigint
language plpgsql security definer set search_path='' as $$
declare request_id bigint;
begin
 select net.http_post(
  url:='https://lejxenmswcaddrnspxuf.supabase.co/functions/v1/bruff-live',
  headers:=jsonb_build_object('Content-Type','application/json','x-bruff-advanced-secret',(select decrypted_secret from vault.decrypted_secrets where name='bruff_advanced_tick')),
  body:='{}'::jsonb,timeout_milliseconds:=80000
 ) into request_id;
 return request_id;
end;$$;
revoke all on function bruff_private.invoke_advanced_tick() from public,anon,authenticated,service_role;
select cron.schedule('bruff-advanced-minute','* * * * *','select bruff_private.invoke_advanced_tick()');
commit;
-- Emergency stop: update bruff_private.advanced_runtime set approved=false where id=true;
-- Inspect health without revealing the credential:
select approved,worker_ready,last_tick from bruff_private.advanced_runtime;
