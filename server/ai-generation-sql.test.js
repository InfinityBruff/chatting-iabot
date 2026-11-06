import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../supabase/migrations/202611060042_ai_generation_knowledge.sql',import.meta.url),'utf8');
const body=(schema,name)=>sql.split('create function '+schema+'.'+name+'(')[1]?.split('end $$;')[0];

test('generation storage stays private, scoped and separate from existing bank/semantic and fan transports',()=>{
 for(const table of ['model_knowledge','generation_settings','generation_reservations'])assert.match(sql,new RegExp('alter table bruff_private\\.'+table+' enable row level security'));
 assert.match(sql,/revoke all on bruff_private\.model_knowledge,bruff_private\.generation_settings,bruff_private\.generation_reservations from public,anon,authenticated,service_role/);
 assert.equal((sql.match(/foreign key\(workspace_id,creator_id\) references bruff_private.creator_accounts\(workspace_id,id\)/g)||[]).length,3);
 assert.doesNotMatch(sql,/(?:insert into|update|delete from|alter table)\s+bruff_private\.(?:fans|fan_notes|bruff_settings|bruff_chat_overrides|ai_manual_settings|ai_manual_usage)\b/i);
 assert.doesNotMatch(sql,/\b(?:http_post|http_get|cron\.schedule|net\.|dblink|prepare_send|send_message|set_config|request\.jwt)\b/i);
});

test('canonical payload commit is service-only and revalidates an explicit fixed actor without JWT impersonation',()=>{
 assert.match(sql,/revoke all on function public\.bruff_generation_commit\(uuid,uuid,uuid,uuid,jsonb\) from public,anon,authenticated/);
 assert.match(sql,/grant execute on function public\.bruff_generation_commit\(uuid,uuid,uuid,uuid,jsonb\) to service_role/);
 const commit=body('public','bruff_generation_commit');
 assert.match(commit,/generation_actor_allowed\(w,c,a\)/);assert.match(commit,/r\.actor_id is distinct from a/);assert.match(commit,/bruff_private\.workspaces where id=w for update/);
 assert.match(commit,/generation_snapshot\(w,c\)/);assert.match(commit,/r\.payload is not null/);assert.match(commit,/r\.expires_at<=clock_timestamp\(\)/);
 assert.match(sql,/'aiGenerated',true,'aiVerified',false/);
 assert.match(body('bruff_private','generation_actor_allowed'),/m\.user_id=a.*m\.status='active'/s);
 assert.match(body('bruff_private','generation_actor_allowed'),/g\.permission='read'/);assert.match(body('bruff_private','generation_actor_allowed'),/g\.permission='send'/);
});

test('generation-only estimated reservations and owner-reviewed facts have bounded concurrency and freshness',()=>{
 const claim=body('public','bruff_generation_claim');
 assert.ok(claim.indexOf('bruff.generation.actor:')<claim.indexOf('bruff.generation.global.daily'));
 assert.ok(claim.indexOf('bruff.generation.global.daily')<claim.indexOf('bruff_private.workspaces where id=w for update'));
 assert.match(claim,/used\+600>7500/);assert.match(claim,/used>=2/);assert.match(claim,/interval '10 minutes'/);
 assert.match(sql,/estimated_neurons integer not null default 600 check\(estimated_neurons=600\)/);
 assert.match(body('bruff_private','generation_snapshot'),/md5\(snapshot::text\)/);
 assert.match(sql,/create unique index model_knowledge_verified_fact.*where kind='model_fact' and state='verified'/);
 assert.match(body('public','bruff_model_knowledge'),/require_owner\(w\)/);
 assert.match(body('public','bruff_model_knowledge'),/target_state=coalesce\(value->>'state','draft'\)/);
 assert.match(body('public','bruff_model_knowledge'),/total_count>=200/);assert.match(body('public','bruff_model_knowledge'),/active_count>=100/);
});

test('expiry cleanup removes payloads without refunding current-day generation reservations',()=>{
 const prune=body('bruff_private','generation_prune');
 assert.match(prune,/set payload=null,committed_at=null where expires_at<=moment/);
 assert.match(prune,/delete from bruff_private\.generation_reservations where usage_day<\(moment at time zone 'UTC'\)::date-30 and expires_at<=moment/);
 assert.doesNotMatch(prune,/estimated_neurons\s*=|usage_day\s*=|created_at\s*=/);
 assert.match(body('public','bruff_generation_claim'),/perform bruff_private\.generation_prune\(\)/);
});
