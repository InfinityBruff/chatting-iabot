import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const sql=await readFile(new URL('../supabase/migrations/202611080046_chat_teaching.sql',import.meta.url),'utf8');
test('teaching migration keeps durable permission and receipts private and independent of fan writes',()=>{
 for(const table of ['chat_teaching_permissions','chat_teaching_receipts'])assert.ok(sql.includes('alter table bruff_private.'+table+' enable row level security'));
 assert.match(sql,/revoke all on bruff_private\.chat_teaching_permissions,bruff_private\.chat_teaching_receipts from public,anon,authenticated,service_role/u);assert.doesNotMatch(sql,/(?:set_config|request\.jwt|bruff_message_begin|bruff_queue_selected_reply|bruff_autopilot_control)/u);assert.ok(sql.includes("coalesce(p.enabled,false)"));
});
test('teaching source commit is a single permission-locked transaction with version and idempotence guards',()=>{
 assert.ok(sql.indexOf('begin;')<sql.indexOf('create table'));assert.match(sql,/perform bruff_private\.require_owner\(w\)/u);assert.match(sql,/permission_version is distinct from p\.version/u);assert.match(sql,/where workspace_id=w and creator_id=c and actor_id=auth\.uid\(\) for update/u);assert.match(sql,/r\.request_hash<>fingerprint/u);assert.match(sql,/source->>'state'<>'verified'/u);assert.match(sql,/public\.bruff_chat_direct_knowledge\(w,c,'save'/u);assert.match(sql,/public\.bruff_model_knowledge\(w,c,'save'/u);
});
test('fan memory scope derives a unique current connected binding and owner without trusting caller claims',()=>{
 assert.match(sql,/public\.bruff_fan_memory_scope\(w uuid,c uuid\)/u);assert.match(sql,/bruff_private\.can_access\(w,c,'read'\)/u);assert.match(sql,/provider='ofmapi' and connection_status='connected'/u);assert.match(sql,/n<>1 then raise exception 'Cuenta ambigua'/u);assert.match(sql,/n<>1 then raise exception 'Propietario no disponible'/u);assert.match(sql,/'ownerId',owner_id/u);
});
