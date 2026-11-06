import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../supabase/migrations/202611060040_chat_direct_knowledge.sql',import.meta.url),'utf8');
const body=name=>sql.split('create function public.'+name+'(')[1]?.split('end $$;')[0];

test('knowledge migration has private scoped storage with no direct table or anonymous function access',()=>{
 assert.match(sql,/primary key\(workspace_id,creator_id,id\)/);
 assert.match(sql,/foreign key\(workspace_id,creator_id\) references bruff_private\.creator_accounts\(workspace_id,id\)/);
 assert.match(sql,/alter table bruff_private\.chat_direct_examples enable row level security/);
 assert.match(sql,/revoke all on bruff_private\.chat_direct_examples from public,anon,authenticated/);
 assert.doesNotMatch(sql,/grant\s+(?:all|select|insert|update|delete).*chat_direct_examples/i);
 assert.match(sql,/bruff_chat_direct_reference\(uuid,uuid,uuid,text\) from public,anon/);
 assert.equal((sql.match(/security definer set search_path=''/g)||[]).length,3);
});

test('owner curation and retrieval have distinct gates and bounded indexed scopes',()=>{
 assert.match(body('bruff_chat_direct_knowledge'),/perform bruff_private\.require_owner\(w\)/);
 for(const name of ['bruff_chat_direct_suggestions','bruff_chat_direct_reference']){
  const fn=body(name);assert.match(fn,/can_access\(w,c,'read'\)/);assert.match(fn,/can_access\(w,c,'send'\)/);assert.match(fn,/email_confirmed_at is not null/);assert.match(fn,/workspace_id=w and creator_id=c/);assert.match(fn,/state='verified'/);
 }
 assert.match(sql,/using gin\(search_terms\) where state='verified'/);
 assert.match(sql,/to_tsvector\('pg_catalog.english',trigger\)/);
 assert.match(body('bruff_chat_direct_knowledge'),/total_count>=200/);
 assert.match(body('bruff_chat_direct_suggestions'),/order by relevance desc,id limit 3/);
 assert.match(body('bruff_chat_direct_suggestions'),/search_terms @@ terms/);
});

test('document-only examples cannot install transport, ingest, AI calls or unreviewed variable/content payloads',()=>{
 assert.match(sql,/source_kind='document'/);assert.match(sql,/content_kind='non_explicit'/);
 assert.match(sql,/value->'reviewed' is distinct from 'true'::jsonb/);
 assert.match(sql,/position\('\{\{' in value->>'english'\)>0/);
 assert.match(sql,/value-'trigger'-'english'-'spanish'-'state'-'referenceId'-'label'-'sourceVersion'-'reviewed'/);
 assert.doesNotMatch(sql,/\b(?:http_post|http_get|cron\.schedule|net\.|dblink|prepare_send|send_message|conversationId|messageId|service_role)\b/i);
 for(const name of ['bruff_chat_direct_suggestions','bruff_chat_direct_reference'])assert.doesNotMatch(body(name),/\b(?:insert into|update bruff_private|delete from)\b/i);
});

test('all suggestion and reference replies bind database identity without trusting a browser actor parameter',()=>{
 for(const name of ['bruff_chat_direct_suggestions','bruff_chat_direct_reference']){
  const fn=body(name),replies=fn.split('return jsonb_build_object(').slice(1);
  assert.ok(replies.length>0);
  for(const reply of replies)assert.match(reply,/^'actorId',auth\.uid\(\),'workspaceId',w,'creatorId',c,/);
  assert.doesNotMatch(fn,/\bactor_id\s+(?:uuid|text)\b/);
 }
});
