import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../supabase/migrations/202611060041_ai_control.sql',import.meta.url),'utf8');
const fn=name=>sql.split('create function public.'+name+'(')[1]?.split('end $$;')[0];

test('manual AI controls have private scoped tables and authenticated RPCs only',()=>{
 for(const name of ['ai_manual_settings','ai_manual_usage']){
  assert.match(sql,new RegExp('alter table bruff_private\\.'+name+' enable row level security'));
  assert.match(sql,/revoke all on bruff_private\.ai_manual_settings,bruff_private\.ai_manual_usage from public,anon,authenticated/);
 }
 assert.equal((sql.match(/foreign key\(workspace_id,creator_id\) references bruff_private.creator_accounts\(workspace_id,id\)/g)||[]).length,2);
 assert.equal((sql.match(/security definer set search_path=''/g)||[]).length,4);
 assert.match(sql,/bruff_ai_claim\(uuid,uuid,uuid\) from public,anon/);
 assert.doesNotMatch(sql,/grant\s+(?:all|select|insert|update|delete).*ai_manual_/i);
});

test('owner model/config control is separate from read-send retrieval and claims',()=>{
 assert.match(fn('bruff_ai_models'),/m\.role='owner' and m\.status='active'/);
 assert.match(fn('bruff_ai_control'),/require_owner\(w\)/);
 assert.match(fn('bruff_ai_control'),/expected is distinct from config_version/);
 for(const name of ['bruff_ai_pool','bruff_ai_claim']){
  assert.match(fn(name),/can_access\(w,c,'read'\)/);assert.match(fn(name),/can_access\(w,c,'send'\)/);assert.match(fn(name),/email_confirmed_at is not null/);
 }
 assert.match(fn('bruff_ai_pool'),/state='verified' order by e\.id limit 200/);
 assert.match(fn('bruff_ai_pool'),/if config->>'mode'='bank' then return .*'approvedCount',approved_count,'rows','\[\]'::jsonb/);
 assert.doesNotMatch(fn('bruff_ai_pool'),/@@|plainto_tsquery/);
});

test('claim gates are atomic across models/agencies, duplicate-safe and metadata-only',()=>{
 const claim=fn('bruff_ai_claim');
 assert.match(claim,/pg_advisory_xact_lock\(hashtextextended\('bruff\.ai\.actor:'\|\|actor::text,0\)\)/);
 assert.match(claim,/bruff_private\.workspaces where id=w for update/);
 assert.match(claim,/ai_manual_settings.*for update/);
 assert.match(claim,/u\.request_id=req.*'reason','duplicate'/);
 assert.match(claim,/used>=200/);assert.match(claim,/used>=10/);assert.match(claim,/interval '1 minute'/);
 const usage=sql.split('create table bruff_private.ai_manual_usage (')[1].split(');')[0];
 assert.doesNotMatch(usage,/\b(?:query|text|transcript|message|english|spanish|prompt|response)\b/i);
 assert.doesNotMatch(sql,/\b(?:http_post|http_get|cron\.schedule|net\.|dblink|prepare_send|send_message|bruff_bot_update|service_role)\b/i);
 assert.doesNotMatch(sql,/(?:insert into|update|delete from)\s+bruff_private\.(?:fans|bruff_settings|bruff_chat_overrides|fan_notes)\b/i);
});
