import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../supabase/migrations/202611060043_ai_generation_budget.sql',import.meta.url),'utf8');
const body=name=>sql.split(new RegExp('create(?: or replace)? function '+name.replaceAll('.','\\.')+'\\('))[1]?.split('$$;')[0];

test('budget migration preserves existing settings and estimates without fan writes or network execution',()=>{
 assert.match(sql,/engine_version text not null default 'legacy-v1'/);assert.match(sql,/add column actual_neurons bigint/);
 assert.doesNotMatch(sql,/(?:update|delete from)\s+bruff_private\.(?:generation_settings|fans|fan_notes|bruff_settings|ai_manual_usage|ai_manual_settings)\b/iu);
 assert.doesNotMatch(sql,/set\s+(?:estimated_neurons|created_at|usage_day)\s*=/iu);
 assert.doesNotMatch(sql,/\b(?:http_post|http_get|cron\.schedule|dblink|send_message|set_config|request\.jwt)\b/iu);
 assert.match(body('public.bruff_generation_control'),/between 1 and 1000/);assert.match(body('public.bruff_generation_control'),/"enabled":false,"dailyLimit":100/);
 assert.match(body('public.bruff_generation_control'),/expected is distinct from config_version/);
});

test('settlement is service-only, fixed to an existing actor-owned reservation and immutable after its first result',()=>{
 assert.match(sql,/revoke all on function public\.bruff_generation_usage\(uuid,uuid,uuid,uuid,bigint,bigint\) from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public\.bruff_generation_usage\(uuid,uuid,uuid,uuid,bigint,bigint\) to service_role/);
 const settle=body('public.bruff_generation_usage');assert.match(settle,/r\.actor_id is distinct from a/);assert.match(settle,/workspace_id=w and creator_id=c/);assert.match(settle,/request_id=req for update/);assert.match(settle,/if r\.finished_at is null then/);
 assert.doesNotMatch(settle,/generation_actor_allowed|generation_record_json|r\.payload|auth\.uid\(\)/);
 for(const name of ['public.bruff_generation_claim_v2','public.bruff_generation_usage']){const value=body(name);assert.ok(value.indexOf('bruff.generation.actor:')<value.indexOf('bruff.generation.global.daily'));assert.ok(value.indexOf('bruff.generation.global.daily')<value.indexOf('bruff_private.workspaces where id=w for update'))}
});

test('observed cost rounds up from bounded token counts without clamping to the estimate',()=>{
 const settle=body('public.bruff_generation_usage');assert.match(settle,/input_tokens not between 1 and 1000000/);assert.match(settle,/output_tokens not between 0 and 1000000/);
 assert.match(settle,/greatest\(1,ceil\(\(input_tokens::numeric\*31876\+output_tokens::numeric\*50488\)\/1000000\)\)::bigint/);
 assert.doesNotMatch(settle,/least\(/);assert.match(body('public.bruff_generation_claim_v2'),/sum\(coalesce\(actual_neurons,estimated_neurons\)\)/);
 assert.match(body('public.bruff_generation_claim_v2'),/used\+600>7500/);assert.match(body('bruff_private.generation_usage_json'),/coalesce\(r\.actual_neurons,r\.estimated_neurons\)/);
});

test('reuse stays scoped and pending protection spans settlement through canonical commit',()=>{
 const claim=body('public.bruff_generation_claim_v2');assert.match(claim,/actor_id=a and workspace_id=w and creator_id=c and fan_id=target_fan/);
 for(const key of ['revision=expected_revision','context_hash=fingerprint','engine_version=engine','expires_at>moment'])assert.ok(claim.includes(key));
 assert.ok(claim.indexOf("'reason','cached'")<claim.indexOf("'reason','model_daily_limit'"));assert.match(claim,/if not forced then/);assert.match(claim,/payload is null and created_at>moment-interval '45 seconds'/);assert.doesNotMatch(claim,/finished_at is null/);
 assert.match(claim,/moment\+interval '10 minutes'/);assert.doesNotMatch(claim,/set expires_at/);
 assert.match(body('public.bruff_generation_claim'),/bruff_generation_claim_v2\(w,c,request_id,fan,revision,context_hash,'legacy-v1',true\)/);
});

test('quota is metadata-only and outside the source freshness hash',()=>{
 const quota=body('public.bruff_generation_quota');assert.match(quota,/generation_actor_allowed\(w,c,auth.uid\(\)\)/);assert.match(quota,/generation_quota_snapshot\(w,c\)/);
 const snapshot=body('bruff_private.generation_snapshot');assert.match(snapshot,/md5\(snapshot::text\)/);assert.doesNotMatch(snapshot,/generation_reservations|quota|actual_neurons|usageDay/);
 const usage=body('bruff_private.generation_quota_snapshot');for(const key of ['usageDay','resetsAt','modelQueries','modelDailyLimit','sharedBudgetNeurons','calculatedNeurons','reservedNeurons','chargedNeurons','remainingNeurons','observedRequests','reservedRequests'])assert.ok(usage.includes("'"+key+"'"));
 assert.doesNotMatch(usage,/jsonb_build_object\([^;]*(?:fan_id|actor_id|drafts|context_hash)/s);
});
