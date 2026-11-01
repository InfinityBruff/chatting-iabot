-- Apply after migration 014 and deployment of bruff-live/automation-worker.js.
-- No automation is activated by this setup. The tick only processes owner-activated rows.
begin;
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
do $$
declare secret_value text;
begin
 if exists(select 1 from vault.secrets where name='bruff_automation_tick') then
  select decrypted_secret into secret_value from vault.decrypted_secrets where name='bruff_automation_tick';
 else
  secret_value=gen_random_uuid()::text||gen_random_uuid()::text;
  perform vault.create_secret(secret_value,'bruff_automation_tick','BRUFF internal scheduler only');
 end if;
 update bruff_private.automation_runtime set secret_hash=md5(secret_value);
end $$;
select cron.schedule('bruff-automation-minute','* * * * *',$job$
 select net.http_post(
  url:='https://lejxenmswcaddrnspxuf.supabase.co/functions/v1/bruff-live',
  headers:=jsonb_build_object('Content-Type','application/json','x-bruff-automation-secret',(select decrypted_secret from vault.decrypted_secrets where name='bruff_automation_tick')),
  body:='{}'::jsonb,timeout_milliseconds:=80000
 );
$job$);
commit;
