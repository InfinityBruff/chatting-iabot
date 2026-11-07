import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const sql=readFileSync(new URL('../supabase/migrations/202611060044_ai_autopilot.sql',import.meta.url),'utf8');
const body=name=>{const start=sql.indexOf('function '+name+'(');assert.ok(start>=0,name);const open=sql.indexOf('$$',start);return sql.slice(open+2,sql.indexOf('$$;',open+2))};

test('autopilot migration is dormant and has no provider calls, scheduling, stored user token or JWT impersonation',()=>{
 assert.doesNotMatch(sql,/\b(?:set_config|request\.jwt|http_post|http_get|cron\.schedule|dblink|net\.)\b/iu);
 assert.match(body('bruff_private.ai_autopilot_defaults'),/"enabled":false/);
 assert.match(sql,/revoke all on bruff_private\.ai_autopilot_configs,bruff_private\.ai_autopilot_events,bruff_private\.ai_autopilot_jobs from public,anon,authenticated,service_role/);
 for(const table of ['ai_autopilot_configs','ai_autopilot_events','ai_autopilot_jobs'])assert.match(sql,new RegExp('alter table bruff_private\\.'+table+' enable row level security'));
});

test('owner controls and manual selection use real owner authentication and preserve current CRM stop controls',()=>{
 for(const name of ['public.bruff_autopilot_control','public.bruff_queue_selected_reply'])assert.match(body(name),/perform bruff_private\.require_owner\(w\)/);
 const control=body('public.bruff_autopilot_control');assert.match(control,/expected is distinct from coalesce\(cfg\.version,0\)/);assert.match(control,/review_required=excluded\.review_required/);assert.doesNotMatch(control,/config=excluded\.config/);
 const allowed=body('bruff_private.ai_autopilot_allowed');assert.match(allowed,/m\.user_id=cfg\.owner_id and m\.role='owner' and m\.status='active'/);assert.match(allowed,/s\.mode<>'off'/);assert.match(body('bruff_private.ai_autopilot_fan_allowed'),/o\.mode='manual'/);
 const manual=body('public.bruff_queue_selected_reply');assert.match(manual,/r\.engine_version<>'bruff-drafts-v2'/);assert.match(manual,/selected->>'english' is distinct from expected_english/);assert.match(manual,/confirmed is distinct from true/);assert.match(manual,/'newlyQueued',created/);
});

test('service work derives scope and owner from stored jobs, shares budgets and separates automatic engine policy',()=>{
 assert.match(sql,/grant execute on function public\.bruff_ai_event_ingest\(jsonb\),public\.bruff_autopilot_worker\(text,uuid,uuid,jsonb\) to service_role/);
 const worker=body('public.bruff_autopilot_worker');assert.match(worker,/where id=job_id/);assert.match(worker,/j\.owner_id/);assert.match(worker,/'bruff-autopilot-v1'/);assert.match(worker,/used\+600>7500/);assert.match(worker,/used>=2/);
 assert.ok(worker.indexOf('bruff.generation.actor:')<worker.indexOf('bruff.generation.global.daily'));
 assert.match(worker,/public\.bruff_generation_usage\(j\.workspace_id,j\.creator_id,j\.generation_id,j\.owner_id/);
 assert.match(worker,/public\.bruff_generation_commit\(j\.workspace_id,j\.creator_id,j\.generation_id,j\.owner_id/);
});

test('events contain only metadata and cannot broadcast a binding or replay a fan message into another job',()=>{
 const ingest=body('public.bruff_ai_event_ingest');assert.match(ingest,/if n<>1 then/);assert.match(ingest,/'binding_unavailable'/);assert.match(ingest,/'jobId',new_job/);assert.match(ingest,/'source' not in \('ws','reconcile'\)/);
 assert.match(sql,/unique\(binding,event_id\)/);assert.match(sql,/unique\(workspace_id,creator_id,fan_id,message_id,direction\)/);
 assert.doesNotMatch(sql,/create table[^;]*\b(?:message_text|raw_body|provider_token)\b/isu);
});

test('send begin is single-use and bound to canonical content, fresh context, moderation and explicit AI attribution',()=>{
 const worker=body('public.bruff_autopilot_worker');assert.match(worker,/v->>'context_hash' is distinct from j\.context_hash/);assert.match(worker,/j\.kind='manual' or e\.message_id is distinct from j\.anchor_message_id/);
 assert.match(worker,/chat_safety_terms/);assert.match(worker,/chat_normalize\(text_body\)/);assert.match(worker,/BRUFF IA/);assert.match(worker,/state='sending',draft_id=v->>'draftId',payload=result,payload_hash=md5\(result::text\)/);assert.match(worker,/'bruff-ai-auto-'\|\|j\.id::text/);
 assert.match(worker,/state='uncertain'.*no se reintenta/isu);assert.match(worker,/when v->>'reason'='send_disabled'.*then 'draft_ready'/s);
 const manual=body('public.bruff_message_begin');assert.match(manual,/bruff\.ai\.fan:/);assert.match(manual,/state in \('queued','claimed','generating','ready'\)/);assert.doesNotMatch(manual,/state in \([^)]*'sending'/);
});

test('uncertainty review is owner-scoped, job-versioned and preserves the terminal receipt before a fresh activation',()=>{
 const control=body('public.bruff_autopilot_control');
 assert.match(control,/op='review_uncertain'/);assert.match(control,/expected is distinct from review_job\.version/);assert.match(control,/review_job\.state<>'uncertain'/);assert.match(control,/uncertain_reviewed_by=auth\.uid\(\)/);
 assert.match(control,/jsonb_set\(bruff_private\.ai_autopilot_configs\.settings,'\{enabled\}','false'::jsonb\)/);assert.match(control,/when op='review_uncertain' and x->>'id'=v->>'jobId' then 0/);
 assert.doesNotMatch(control,/set state='sent'|set state='queued'/);assert.match(body('bruff_private.ai_autopilot_allowed'),/j\.state='uncertain' and j\.uncertain_reviewed_at is null/);assert.match(body('bruff_private.ai_manual_job_allowed'),/other\.state='uncertain' and other\.uncertain_reviewed_at is null/);
 assert.match(control,/'selectedDraftId',j\.draft_id/);assert.match(control,/'uncertainReviewNote',j\.uncertain_review_note/);
});
