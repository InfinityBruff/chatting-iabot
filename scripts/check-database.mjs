// Isolated PostgreSQL/WASM validation. Never connects to a remote database.
// Pass the installed @electric-sql/pglite entry point as argv[2].
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
try {
await db.exec(`create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as
$$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;
`);
await db.exec(await readFile(new URL('../supabase/migrations/202610300001_private_foundation.sql', import.meta.url),'utf8'));
let checks=0;
const check=(value,expected)=>{assert.deepEqual(value,expected);checks++};
const scalar=async sql=>(await db.query(sql)).rows[0].value;
check(await scalar(`select count(*)::int as value from pg_tables where schemaname='bruff_private' and rowsecurity`),10);
for(const role of ['anon','authenticated']) {
 check(await scalar(`select has_schema_privilege('${role}','bruff_private','usage') as value`),false);
 check(await scalar(`select bool_or(has_table_privilege('${role}',schemaname||'.'||tablename,'select,insert,update,delete')) as value from pg_tables where schemaname='bruff_private'`),false);
}
// All fixtures and temporary test privileges exist only in this in-memory instance.
const w1='00000000-0000-0000-0000-000000000001',w2='00000000-0000-0000-0000-000000000002';
const u1='10000000-0000-0000-0000-000000000001',u2='10000000-0000-0000-0000-000000000002';
const c1='20000000-0000-0000-0000-000000000001',c2='20000000-0000-0000-0000-000000000002';
await db.exec(`insert into auth.users values ('${u1}'),('${u2}');
insert into bruff_private.workspaces(id,name) values ('${w1}','Test A'),('${w2}','Test B');
insert into bruff_private.memberships(workspace_id,user_id,role,status) values ('${w1}','${u1}','operator','active'),('${w2}','${u2}','owner','active');
insert into bruff_private.creator_accounts(workspace_id,id,display_name) values ('${w1}','${c1}','A'),('${w1}','${c2}','B'),('${w2}','${c1}','C');
insert into bruff_private.account_grants values ('${w1}','${u1}','${c1}','read'),('${w1}','${u1}','${c1}','notes');
insert into bruff_private.fans values ('${w1}','${c1}','same-fan','A'),('${w1}','${c2}','same-fan','B'),('${w2}','${c1}','same-fan','C');
select set_config('request.jwt.claim.sub','${u1}',false);
`);
check(await scalar(`select bruff_private.can_access('${w1}','${c1}','notes') as value`),true);
check(await scalar(`select bruff_private.can_access('${w1}','${c2}','notes') as value`),false);
check(await scalar(`select bruff_private.can_access('${w2}','${c1}','read') as value`),false);
check(await scalar(`select bruff_private.can_access('${w1}','${c1}','unknown') as value`),false);
await db.exec(`grant usage on schema bruff_private to authenticated;
grant select on all tables in schema bruff_private to authenticated;
grant execute on all functions in schema bruff_private to authenticated;
set role authenticated;`);
check((await db.query(`select display_name from bruff_private.fans`)).rows,[{display_name:'A'}]);
await assert.rejects(db.exec(`update bruff_private.memberships set role='owner'`),/permission denied/);checks++;
await db.exec(`reset role; update bruff_private.memberships set status='disabled' where user_id='${u1}'; set role authenticated;`);
check((await db.query(`select * from bruff_private.fans`)).rows,[]);
await db.exec(`reset role; update bruff_private.memberships set status='active',role='viewer' where user_id='${u1}';`);
check(await scalar(`select bruff_private.can_access('${w1}','${c1}','notes') as value`),false);
await db.exec(`select set_config('request.jwt.claim.sub','${u2}',false); set role authenticated;`);
check((await db.query(`select display_name from bruff_private.fans`)).rows,[{display_name:'C'}]);
await db.exec(`reset role`);
await assert.rejects(db.exec(`insert into bruff_private.fan_notes(workspace_id,creator_id,fan_id,body,updated_by) values ('${w2}','${c1}','same-fan','Cross-agency author','${u1}')`),/foreign key/);checks++;
await assert.rejects(db.exec(`insert into bruff_private.fan_notes(workspace_id,creator_id,fan_id,body,updated_by) values ('${w1}','${c1}','missing','No fan','${u1}')`),/foreign key/);checks++;
check(await scalar(`select bool_and(globally_paused) as value from bruff_private.workspaces`),true);
// Exercise the public RPC without granting direct private-table access.
await db.exec(`revoke all on schema bruff_private from authenticated;
revoke all on all tables in schema bruff_private from authenticated;`);
await db.exec(await readFile(new URL('../supabase/migrations/202610310002_membership_rpc.sql', import.meta.url),'utf8'));
check(await scalar(`select has_function_privilege('anon','public.bruff_my_workspaces()','execute') as value`),false);
await db.exec(`set role authenticated;`);
check((await db.query(`select name,role from public.bruff_my_workspaces()`)).rows,[{name:'Test B',role:'owner'}]);
await db.exec(`reset role; select set_config('request.jwt.claim.sub','${u1}',false); set role authenticated;`);
check((await db.query(`select name,role from public.bruff_my_workspaces()`)).rows,[{name:'Test A',role:'viewer'}]);
await assert.rejects(db.exec(`select * from bruff_private.memberships`),/permission denied/);checks++;
await db.exec(`reset role; update bruff_private.memberships set status='disabled' where user_id='${u1}'; set role authenticated;`);
check((await db.query(`select * from public.bruff_my_workspaces()`)).rows,[]);
await db.exec(`reset role; select set_config('request.jwt.claim.sub','',false); set role authenticated;`);
check((await db.query(`select * from public.bruff_my_workspaces()`)).rows,[]);
console.log(`${checks} PostgreSQL checks passed: RLS, grants, identity, cross-agency/account/fan isolation, disabled membership and protected roles.`);
} finally { await db.close(); }
