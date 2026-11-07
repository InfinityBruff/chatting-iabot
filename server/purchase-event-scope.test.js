import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {createPurchaseRecorder} from '../supabase/functions/bruff-ai-events/payment-ingest.js';
const owner='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',creator='33333333-3333-4333-8333-333333333333';
const scope={ownerId:owner,workspaceId:workspace,creatorId:creator,binding:'acct_qa'};
const event={kind:'ppv_purchase',account_id:'acct_qa',event_id:'44444444-4444-4444-8444-444444444444',fan_id:'99',message_id:'100',amount_cents:600,occurred_at:'2026-11-07T10:00:00.000Z',ingested_at:'2026-11-07T10:00:01.000Z',contract:'ofmapi-webhooks-20261107-ppv-purchased'};
test('purchase recorder derives exact server scope twice and records only normalized financial metadata',async()=>{
 const calls=[],writes=[];const recorder=createPurchaseRecorder({url:'https://db.example',serviceKey:'fictitious',enabled:true,store:{writeEvent:async(...args)=>writes.push(args)},fetcher:async(url,options)=>{calls.push([url,JSON.parse(options.body)]);assert.equal(options.headers.Authorization,'Bearer fictitious');assert.equal(options.redirect,'error');return new Response(JSON.stringify(scope))}});
 assert.deepEqual(await recorder(event),{accepted:true,queued:false});assert.deepEqual(calls,Array(2).fill(['https://db.example/rest/v1/rpc/bruff_memory_event_scope',{account_binding:'acct_qa'}]));assert.equal(writes.length,1);assert.deepEqual(writes[0][0],{...scope,actorId:owner});assert.deepEqual(writes[0][1],{eventId:event.event_id,fanId:'99',messageId:'100',amountCents:600,occurredAt:event.occurred_at,ingestedAt:event.ingested_at,contract:event.contract});
});
test('missing or changed mapping and failed storage never queue or record into an unverified account',async()=>{
 for(const mapping of [null,{...scope,binding:'acct_other'},{...scope,ownerId:'untrusted'}]){let writes=0;const recorder=createPurchaseRecorder({url:'https://db.example',serviceKey:'fictitious',enabled:true,store:{writeEvent:async()=>writes++},fetcher:async()=>new Response(JSON.stringify(mapping))});if(mapping===null)assert.deepEqual(await recorder(event),{accepted:false,queued:false});else await assert.rejects(recorder(event));assert.equal(writes,0)}
 let calls=0,writes=0;const recorder=createPurchaseRecorder({url:'https://db.example',serviceKey:'fictitious',enabled:true,store:{writeEvent:async()=>writes++},fetcher:async()=>new Response(JSON.stringify(++calls===1?scope:{...scope,creatorId:owner}))});await assert.rejects(recorder(event));assert.equal(writes,0);
});
test('payment scope RPC is executable only by service role and rejects ambiguous agency/model/owner bindings', {skip:!process.env.BRUFF_PGLITE_MODULE},async()=>{
 const {PGlite}=await import(pathToFileURL(process.env.BRUFF_PGLITE_MODULE).href),db=new PGlite();
 try{
  await db.exec("create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key,email_confirmed_at timestamptz);create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;create schema bruff_private;create table bruff_private.schema_versions(version text primary key);create table bruff_private.creator_accounts(workspace_id uuid,id uuid,provider text,connection_status text,external_id text);create table bruff_private.memberships(workspace_id uuid,user_id uuid,role text,status text);grant usage on schema auth to service_role;");
  await db.exec(await readFile(new URL('../supabase/migrations/202611070045_memory_purchase_scope.sql',import.meta.url),'utf8'));
  await db.query('insert into auth.users values($1,now())',[owner]);await db.query("insert into bruff_private.memberships values($1,$2,'owner','active')",[workspace,owner]);await db.query("insert into bruff_private.creator_accounts values($1,$2,'ofmapi','connected','acct_qa')",[workspace,creator]);
  for(const role of ['anon','authenticated']){await db.exec('set role '+role);await assert.rejects(db.query("select public.bruff_memory_event_scope('acct_qa')"));await db.exec('reset role')}
  await db.exec("select set_config('request.jwt.claim.role','service_role',false);set role service_role");assert.deepEqual((await db.query("select public.bruff_memory_event_scope('acct_qa') as scope")).rows[0].scope,scope);assert.equal((await db.query("select public.bruff_memory_event_scope('acct_missing') as scope")).rows[0].scope,null);await db.exec('reset role');
  await db.query("insert into bruff_private.creator_accounts values($1,$2,'ofmapi','connected','acct_qa')",[owner,workspace]);await db.exec('set role service_role');assert.equal((await db.query("select public.bruff_memory_event_scope('acct_qa') as scope")).rows[0].scope,null);
 }finally{await db.close()}
});
