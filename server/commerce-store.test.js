import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createCommerceStore} from '../supabase/functions/bruff-memory/commerce-store.js';
import {createTursoMemoryStore} from '../supabase/functions/bruff-memory/turso-store.js';
import {commerceEvidenceId,reconcilePurchaseEvents,assessScriptPlan} from '../supabase/functions/bruff-memory/commerce.js';

const owner='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000002',workspace='20000000-0000-4000-8000-000000000001',creator='30000000-0000-4000-8000-000000000001';
const date='2026-11-07T10:00:00.000Z',batch='a'.repeat(64),eventId='40000000-0000-4000-8000-000000000001';
const scope={ownerId:owner,workspaceId:workspace,creatorId:creator,binding:'acct_fixture',fanId:'77',batchHash:batch,actorId:actor};
const opened='ofmapi-openapi-20261107-ppv-opened',purchased='ofmapi-webhooks-20261107-ppv-purchased';
const inputPlan=(patch={})=>({folderId:'folder_a',steps:[{mediaId:'502',priceCents:0},{mediaId:'501',priceCents:600},{mediaId:'503',priceCents:null}],...patch});
const inputEvidence=(patch={})=>({kind:'paid_unlock_reported',messageId:'901',mediaIds:['501','503'],offerPriceCents:600,paidAmountCents:null,paidAt:null,eventId:null,contract:opened,...patch});
const inputEvent=(patch={})=>({eventId,fanId:'77',messageId:'901',amountCents:600,occurredAt:date,ingestedAt:date,contract:purchased,...patch});
const paidEvidence=(patch={})=>inputEvidence({kind:'ppv_purchase_event',paidAmountCents:600,paidAt:date,eventId,contract:purchased,...patch});
const code=expected=>error=>error.code===expected&&!/private|token|SQLITE/u.test(error.message);
const sql=await readFile(new URL('../supabase/migrations/turso/202611070002_script_commerce.sql',import.meta.url),'utf8');
const oldSql=await readFile(new URL('../supabase/migrations/turso/202611070001_fan_script_progress.sql',import.meta.url),'utf8');
const catalogue=`PRAGMA foreign_keys=ON;
 CREATE TABLE bruff_catalog_batches(owner_id TEXT,workspace_id TEXT,batch_hash TEXT,PRIMARY KEY(owner_id,workspace_id,batch_hash)) STRICT;
 CREATE TABLE bruff_catalog_models(owner_id TEXT,workspace_id TEXT,batch_hash TEXT,creator_id TEXT,PRIMARY KEY(owner_id,workspace_id,batch_hash,creator_id),FOREIGN KEY(owner_id,workspace_id,batch_hash) REFERENCES bruff_catalog_batches(owner_id,workspace_id,batch_hash)) STRICT;
 CREATE TABLE bruff_catalog_folders(owner_id TEXT,workspace_id TEXT,batch_hash TEXT,creator_id TEXT,folder_key TEXT,PRIMARY KEY(owner_id,workspace_id,batch_hash,creator_id,folder_key),FOREIGN KEY(owner_id,workspace_id,batch_hash,creator_id) REFERENCES bruff_catalog_models(owner_id,workspace_id,batch_hash,creator_id)) STRICT;
 CREATE TABLE bruff_catalog_media(owner_id TEXT,workspace_id TEXT,batch_hash TEXT,creator_id TEXT,folder_key TEXT,media_id TEXT,media_type TEXT,PRIMARY KEY(owner_id,workspace_id,batch_hash,creator_id,folder_key,media_id),FOREIGN KEY(owner_id,workspace_id,batch_hash,creator_id,folder_key) REFERENCES bruff_catalog_folders(owner_id,workspace_id,batch_hash,creator_id,folder_key)) STRICT;`;
const typed=value=>value===null?{type:'null'}:typeof value==='number'||typeof value==='bigint'?{type:'integer',value:String(value)}:{type:'text',value};
function fixture(options={}){
 const db=new DatabaseSync(':memory:'),calls=[];db.exec(catalogue);db.exec(oldSql);db.exec(sql);
 const seed=(patch={})=>{const s={...scope,...patch};db.prepare('INSERT OR IGNORE INTO bruff_catalog_batches VALUES(?,?,?)').run(s.ownerId,s.workspaceId,s.batchHash);db.prepare('INSERT OR IGNORE INTO bruff_catalog_models VALUES(?,?,?,?)').run(s.ownerId,s.workspaceId,s.batchHash,s.creatorId);db.prepare('INSERT OR IGNORE INTO bruff_catalog_folders VALUES(?,?,?,?,?)').run(s.ownerId,s.workspaceId,s.batchHash,s.creatorId,patch.folderId||'folder_a');for(const [id,type]of patch.items||[['501','video'],['502','photo'],['503','video']])db.prepare('INSERT OR IGNORE INTO bruff_catalog_media VALUES(?,?,?,?,?,?,?)').run(s.ownerId,s.workspaceId,s.batchHash,s.creatorId,patch.folderId||'folder_a',id,type)};
 seed();
 const fetcher=async(url,input)=>{
  const body=JSON.parse(input.body);calls.push({url,input,body});if(options.fetcher)return options.fetcher(url,input,body);
  assert.equal(url,'https://fixture-account.turso.io/v2/pipeline');assert.equal(input.method,'POST');assert.equal(input.redirect,'error');assert.deepEqual(body.requests.map(r=>r.type),['execute','execute','close']);assert.equal(body.requests[0].stmt.sql,'PRAGMA foreign_keys=ON');db.exec(body.requests[0].stmt.sql);
  const stmt=body.requests[1].stmt,args=stmt.args.map(v=>v.type==='null'?null:v.type==='integer'?Number(v.value):v.value);let data;
  try{const prepared=db.prepare(stmt.sql),names=prepared.columns().map(c=>c.name),rows=prepared.all(...args),affected=db.prepare('SELECT changes() AS n').get().n;data={results:[{type:'ok',response:{type:'execute',result:{cols:[],rows:[],affected_row_count:0}}},{type:'ok',response:{type:'execute',result:{cols:names.map(name=>({name})),rows:rows.map(row=>names.map(name=>typed(row[name]))),affected_row_count:affected}}},{type:'ok',response:{type:'close'}}]}}
  catch(error){data={results:[{type:'ok',response:{type:'execute',result:{cols:[],rows:[],affected_row_count:0}}},{type:'error',error:{message:'private SQLITE '+error.message}},{type:'ok',response:{type:'close'}}]}}
  return Response.json(options.transform?options.transform(data):data);
 };
 const config={url:'libsql://fixture-account.turso.io',token:'private-test-token',fetcher};return {db,calls,seed,store:createCommerceStore(config),old:createTursoMemoryStore(config),count:table=>db.prepare('SELECT count(*) AS n FROM '+table).get().n,close:()=>db.close()};
}

test('commerce uses fixed server-only Turso endpoint and rejects unsafe connection configuration',()=>{
 for(const config of [{},{url:'http://a.turso.io',token:'x'},{url:'https://evil.test',token:'x'},{url:'https://user:pass@a.turso.io',token:'x'},{url:'https://a.turso.io:9000',token:'x'},{url:'https://a.turso.io/path',token:'x'},{url:'https://a.turso.io?query=x',token:'x'},{url:'https://a.turso.io',token:'x\nprivate'}])assert.throws(()=>createCommerceStore(config),code('MEMORY_CONFIG'));
});

test('approved complete folder order is append-only, preserves unknown prices and returns only the latest scoped version',async t=>{
 const f=fixture();t.after(f.close);const first=await f.store.savePlan(scope,0,inputPlan());assert.equal(first.version,1);assert.equal(first.approvedBy,actor);assert.match(first.approvedAt,/Z$/u);assert.match(first.planHash,/^[a-f0-9]{64}$/u);assert.deepEqual(first.steps,inputPlan().steps);assert.equal(f.calls.length,1);
 const second=await f.store.savePlan({...scope,actorId:owner},1,inputPlan({steps:[{mediaId:'501',priceCents:1000},{mediaId:'502',priceCents:0},{mediaId:'503',priceCents:null}]}));assert.equal(second.version,2);assert.equal(second.approvedBy,owner);assert.notEqual(second.planHash,first.planHash);assert.deepEqual(await f.store.readPlans(scope),[second]);assert.equal(f.count('bruff_script_plans'),2);
 assert.equal(f.calls[0].body.requests[1].stmt.sql.includes('acct_fixture'),false);assert.equal(JSON.stringify(second).includes('private-test-token'),false);
});

test('plan compare-and-swap is atomic across workers and a stale version never changes an approved plan',async t=>{
 const f=fixture();t.after(f.close);const results=await Promise.allSettled([f.store.savePlan(scope,0,inputPlan()),f.store.savePlan({...scope,actorId:owner},0,inputPlan())]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.ok(code('MEMORY_CONFLICT')(results.find(r=>r.status==='rejected').reason));assert.equal(f.count('bruff_script_plans'),1);
 await assert.rejects(()=>f.store.savePlan(scope,0,inputPlan()),code('MEMORY_CONFLICT'));await assert.rejects(()=>f.store.savePlan(scope,2,inputPlan()),code('MEMORY_CONFLICT'));assert.equal((await f.store.readPlans(scope))[0].version,1);
});

test('plan approval cannot omit, repeat, import foreign media or charge a photo',async t=>{
 const f=fixture();t.after(f.close);f.seed({folderId:'other',items:[['601','video']]});
 for(const steps of [[],inputPlan().steps.slice(0,2),[...inputPlan().steps,{mediaId:'601',priceCents:1000}],[{mediaId:'501',priceCents:1},{mediaId:'501',priceCents:1},{mediaId:'503',priceCents:null}],inputPlan().steps.map(s=>s.mediaId==='502'?{...s,priceCents:null}:s),inputPlan().steps.map(s=>s.mediaId==='502'?{...s,priceCents:500}:s),inputPlan().steps.map(s=>s.mediaId==='501'?{...s,priceCents:1.5}:s),inputPlan().steps.map(s=>s.mediaId==='501'?{...s,priceCents:-1}:s)])await assert.rejects(()=>f.store.savePlan(scope,0,inputPlan({steps})),code('MEMORY_STORE'));
 await assert.rejects(()=>f.store.savePlan(scope,0,{...inputPlan(),confirmed:true}),code('MEMORY_STORE'));assert.equal(f.count('bruff_script_plans'),0);
});

test('plans isolate owner, agency, model, binding and batch; fan and audit actor do not fragment the model plan',async t=>{
 const f=fixture();t.after(f.close);await f.store.savePlan(scope,0,inputPlan());
 for(const patch of [{ownerId:actor},{workspaceId:creator},{creatorId:workspace},{binding:'acct_other'},{batchHash:'b'.repeat(64)}])assert.deepEqual(await f.store.readPlans({...scope,...patch}),[]);
 assert.equal((await f.store.readPlans({...scope,fanId:'78',actorId:owner}))[0].version,1);await assert.rejects(()=>f.store.savePlan({...scope,creatorId:workspace},0,inputPlan()),code('MEMORY_STORE'));
});

test('opened evidence remains a reported unlock, carries no payment and is idempotent across worker actor and media order',async t=>{
 const f=fixture();t.after(f.close);assert.deepEqual(await f.store.writeEvidence(scope,[inputEvidence()]),{written:1});const first=(await f.store.readEvidence(scope))[0];assert.equal(first.kind,'paid_unlock_reported');assert.equal(first.paidAmountCents,null);assert.equal(first.paidAt,null);assert.equal(first.eventId,null);assert.match(first.id,/^[a-f0-9]{64}$/u);assert.match(first.observedAt,/Z$/u);
 assert.deepEqual(await f.store.writeEvidence({...scope,actorId:owner},[inputEvidence({mediaIds:['503','501']})]),{written:0});assert.equal(f.count('bruff_purchase_evidence'),1);assert.equal((await f.store.readEvidence(scope))[0].id,first.id);assert.equal(f.db.prepare('SELECT actor_id FROM bruff_purchase_evidence').get().actor_id,actor);
 const expected=[owner,workspace,creator,scope.binding,scope.fanId,batch,'paid_unlock_reported','901',['501','503'],600,null,null,null,opened];const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(expected)))).toString('hex');assert.equal(first.id,hash);
});

test('evidence rejects fabricated payment flags, loose IDs, timestamps, purchase types and unknown fields before HTTP',async t=>{
 const f=fixture();t.after(f.close);
 for(const patch of [{paidConfirmed:true},{paidAmountCents:600},{paidAt:date},{eventId},{contract:'guessed'},{kind:'seen'},{offerPriceCents:0},{offerPriceCents:null},{messageId:901},{mediaIds:[501]},{mediaIds:['01']},{mediaIds:['501','501']},{text:'not stored'},{url:'https://private.example'}])await assert.rejects(()=>f.store.writeEvidence(scope,[inputEvidence(patch)]),code('MEMORY_STORE'));
 for(const patch of [{fanId:77},{fanId:'077'},{binding:'acct_bad/path'},{actorId:'not-a-uuid'},{batchHash:'bad'}])await assert.rejects(()=>f.store.readEvidence({...scope,...patch}),code('MEMORY_STORE'));assert.equal(f.calls.length,0);
});

test('foreign media invalidates the whole atomic evidence insert and every fan scope dimension is isolated',async t=>{
 const f=fixture();t.after(f.close);f.db.exec('PRAGMA foreign_keys=OFF');await assert.rejects(()=>f.store.writeEvidence(scope,[inputEvidence(),inputEvidence({messageId:'902',mediaIds:['999']})]),code('MEMORY_STORE'));assert.equal(f.count('bruff_purchase_evidence'),0);assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 await f.store.writeEvidence(scope,[inputEvidence()]);for(const patch of [{ownerId:actor},{workspaceId:creator},{creatorId:workspace},{binding:'acct_other'},{fanId:'78'},{batchHash:'b'.repeat(64)}])assert.deepEqual(await f.store.readEvidence({...scope,...patch}),[]);assert.equal((await f.store.readEvidence({...scope,actorId:owner})).length,1);
});

test('a signed event receipt can precede catalogue import, stays batch independent and accepts identical retries only once',async t=>{
 const f=fixture();t.after(f.close);const eventScope={...scope,ownerId:actor,batchHash:undefined};assert.deepEqual(await f.store.writeEvent(eventScope,inputEvent()),{written:1});assert.deepEqual(await f.store.writeEvent({...eventScope,actorId:owner},inputEvent()),{written:0});assert.equal(f.calls.length,2);assert.deepEqual(await f.store.readEvents({...eventScope,batchHash:'b'.repeat(64)}),[inputEvent()]);
 for(const patch of [{ownerId:owner},{workspaceId:creator},{creatorId:workspace},{binding:'acct_other'},{fanId:'78'}])assert.deepEqual(await f.store.readEvents({...eventScope,...patch}),[]);assert.equal(f.count('bruff_ppv_events'),1);
});

test('an event ID cannot be replayed with a contradictory fan, message, amount, time or contract',async t=>{
 const f=fixture();t.after(f.close);await f.store.writeEvent(scope,inputEvent());
 for(const patch of [{fanId:'78'},{messageId:'902'},{amountCents:1000},{occurredAt:'2026-11-07T10:00:01.000Z'},{ingestedAt:'2026-11-07T10:00:01.000Z'},{contract:'unknown'}])await assert.rejects(()=>f.store.writeEvent({...scope,fanId:undefined},inputEvent(patch)),code('MEMORY_STORE'));
 for(const patch of [{amountCents:0},{amountCents:'600'},{fanId:77},{messageId:'0901'},{occurredAt:'2026-02-30T10:00:00Z'},{eventId:'4000000A-0000-4000-8000-000000000001'},{text:'not retained'}])await assert.rejects(()=>f.store.writeEvent(scope,inputEvent(patch)),code('MEMORY_STORE'));assert.equal(f.count('bruff_ppv_events'),1);assert.deepEqual(await f.store.readEvents(scope),[inputEvent()]);
});

test('purchase evidence must match an existing exact scoped event and bundle amount is recorded once for all media',async t=>{
 const f=fixture();t.after(f.close);await assert.rejects(()=>f.store.writeEvidence(scope,[paidEvidence()]),code('MEMORY_STORE'));await f.store.writeEvent(scope,inputEvent());
 for(const [patch,scopePatch]of [[{messageId:'902'},{}],[{paidAmountCents:1000},{}],[{paidAt:'2026-11-07T10:00:01.000Z'},{}],[{}, {fanId:'78'}],[{}, {binding:'acct_other'}]])await assert.rejects(()=>f.store.writeEvidence({...scope,...scopePatch},[paidEvidence(patch)]),code('MEMORY_STORE'));
 await f.store.writeEvidence(scope,[paidEvidence({offerPriceCents:null})]);const result=await f.store.readEvidence(scope);assert.equal(result.length,1);assert.deepEqual(result[0].mediaIds,['501','503']);assert.equal(result[0].paidAmountCents,600);assert.equal(result[0].offerPriceCents,null);assert.equal(f.count('bruff_purchase_evidence'),1);
});

test('real commerce reconciliation and storage agree on evidence identity and bundle accounting',async t=>{
 const f=fixture();t.after(f.close);const approved=await f.store.savePlan(scope,0,inputPlan()),observations=['501','503'].map(mediaId=>({folderId:'folder_a',mediaId,messageId:'901',createdAt:date,kind:'offered',priceCents:600,openedReported:false,paidConfirmed:false}));
 await f.store.writeEvent(scope,inputEvent());const records=reconcilePurchaseEvents({observations,events:await f.store.readEvents(scope),fanId:scope.fanId});assert.equal(records.length,1);await f.store.writeEvidence(scope,records);const evidence=await f.store.readEvidence(scope);assert.equal(evidence[0].id,await commerceEvidenceId(scope,records[0]));
 const assessed=assessScriptPlan(approved,observations,evidence);assert.equal(assessed.steps.find(step=>step.mediaId==='501').state,'purchased');assert.equal(assessed.steps.find(step=>step.mediaId==='503').state,'purchased');assert.equal(assessed.payments.length,1);assert.equal(assessed.payments[0].paidAmountCents,600);assert.equal(assessed.refundStatus,'unknown');
});

test('schema is repeatable, append-only and cannot rewrite the original unpaid observations or imported catalogue',async t=>{
 const f=fixture();t.after(f.close);const catalogueBefore=f.db.prepare('SELECT * FROM bruff_catalog_media').all();await f.old.writeObservations(scope,[{folderId:'folder_a',mediaId:'501',messageId:'901',createdAt:date,kind:'offered',priceCents:600,openedReported:true,paidConfirmed:false}]);await f.store.savePlan(scope,0,inputPlan());await f.store.writeEvent(scope,inputEvent());await f.store.writeEvidence(scope,[paidEvidence()]);
 for(const table of ['bruff_script_plans','bruff_ppv_events','bruff_purchase_evidence']){assert.throws(()=>f.db.exec('UPDATE '+table+' SET binding=\'acct_other\''),/append-only/u);assert.throws(()=>f.db.exec('DELETE FROM '+table),/append-only/u)}
 f.db.exec(sql);assert.equal(f.count('bruff_purchase_evidence'),1);assert.equal(f.db.prepare('SELECT paid_confirmed FROM bruff_fan_script_observations').get().paid_confirmed,0);assert.deepEqual(f.db.prepare('SELECT * FROM bruff_catalog_media').all(),catalogueBefore);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);assert.equal((sql.match(/CREATE TABLE/gu)||[]).length,3);assert.ok(f.db.prepare("SELECT strict FROM pragma_table_list WHERE name IN('bruff_script_plans','bruff_ppv_events','bruff_purchase_evidence')").all().every(row=>row.strict===1));
});

test('SQL trigger rejects contradictions even if a malformed caller reuses the original event hash',async t=>{
 const f=fixture();t.after(f.close);await f.store.writeEvent(scope,inputEvent());const stmt=f.calls.at(-1).body.requests[1].stmt,args=stmt.args.map(v=>v.type==='integer'?Number(v.value):v.value);args[7]=700;assert.throws(()=>f.db.prepare(stmt.sql).all(...args),/Contradictory/u);assert.equal(f.count('bruff_ppv_events'),1);
});

test('ambiguous media catalogue associations cannot produce purchase evidence',async t=>{
 const f=fixture();t.after(f.close);f.seed({folderId:'other',items:[['501','video']]});await assert.rejects(()=>f.store.writeEvidence(scope,[inputEvidence()]),code('MEMORY_STORE'));assert.equal(f.count('bruff_purchase_evidence'),0);
});

test('storage failures, malformed HTTP envelopes and unbounded bodies reveal only fixed errors',async t=>{
 for(const options of [{fetcher:()=>new Response('private-token',{status:403})},{transform:()=>({results:[{type:'error',error:{message:'private SQL'}}]})},{transform:data=>{data.results[0].response.result.cols=[{name:'wrong'}];return data}},{transform:data=>{data.results[1].response.result.cols=[{name:'unsafe name'}];return data}},{fetcher:()=>new Response('x'.repeat(8*1024*1024+1))}]){const f=fixture(options);t.after(f.close);await assert.rejects(()=>f.store.readPlans(scope),code('MEMORY_STORE'))}
});

test('caller cancellation aborts a stalled body and pre-aborted operations never reach HTTP',async t=>{
 let cancelled=false;const f=fixture({fetcher:()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"results":'));},cancel(){cancelled=true}}))});t.after(f.close);const controller=new AbortController(),pending=f.store.readPlans(scope,controller.signal);setTimeout(()=>controller.abort(),5);await assert.rejects(()=>pending,error=>error.name==='AbortError');assert.equal(cancelled,true);const before=f.calls.length;await assert.rejects(()=>f.store.writeEvent(scope,inputEvent(),controller.signal),error=>error.name==='AbortError');assert.equal(f.calls.length,before);
});

test('capped evidence and event reads fail rather than presenting a false complete purchase history',async t=>{
 for(const method of ['readEvidence','readEvents']){const f=fixture({transform:data=>{const result=data.results[1].response.result;result.rows=Array.from({length:5001},()=>result.cols.map(()=>({type:'null'})));return data}});t.after(f.close);await assert.rejects(()=>f.store[method](scope),code('MEMORY_STORE'))}
});
