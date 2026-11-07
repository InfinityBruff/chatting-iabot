import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createTursoMemoryStore} from '../supabase/functions/bruff-memory/turso-store.js';

const owner='10000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000002',workspace='20000000-0000-4000-8000-000000000001',creator='30000000-0000-4000-8000-000000000001';
const batch='a'.repeat(64),date='2026-11-07T10:00:00.000Z';
const scope={ownerId:owner,workspaceId:workspace,creatorId:creator,binding:'acct_fixture',fanId:'77',batchHash:batch,actorId:actor};
const catalogScope={workspaceId:workspace,creatorId:creator,batchHash:batch};
const observation=(patch={})=>({folderId:'folder_a',mediaId:'501',messageId:'901',createdAt:date,kind:'offered',priceCents:1200,openedReported:false,paidConfirmed:false,...patch});
const next=(patch={})=>({cursor:'opaque-page',historyComplete:false,recentCheckedAt:date,historyCheckedAt:null,pages:1,...patch});
const code=expected=>error=>error.code===expected&&!error.message.includes('private');
const progressSql=await readFile(new URL('../supabase/migrations/turso/202611070001_fan_script_progress.sql',import.meta.url),'utf8');

// Shape matches the previously imported immutable catalogue; all values here
// are fictional. Actual SQL runs in memory behind the documented HTTP envelope.
const catalogueSql=`PRAGMA foreign_keys=ON;
CREATE TABLE bruff_catalog_batches(owner_id TEXT,workspace_id TEXT,batch_hash TEXT,status TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(owner_id,workspace_id,batch_hash)) STRICT;
CREATE TABLE bruff_catalog_models(owner_id TEXT,workspace_id TEXT,batch_hash TEXT,creator_id TEXT,source_username TEXT,status TEXT NOT NULL,enabled INTEGER NOT NULL,PRIMARY KEY(owner_id,workspace_id,batch_hash,creator_id),FOREIGN KEY(owner_id,workspace_id,batch_hash) REFERENCES bruff_catalog_batches(owner_id,workspace_id,batch_hash)) STRICT;
CREATE TABLE bruff_catalog_folders(owner_id TEXT,workspace_id TEXT,batch_hash TEXT,creator_id TEXT,folder_key TEXT,source_name TEXT NOT NULL,complete INTEGER NOT NULL,status TEXT NOT NULL,enabled INTEGER NOT NULL,step_order_confirmed INTEGER NOT NULL,position_confirmed INTEGER,PRIMARY KEY(owner_id,workspace_id,batch_hash,creator_id,folder_key),FOREIGN KEY(owner_id,workspace_id,batch_hash,creator_id) REFERENCES bruff_catalog_models(owner_id,workspace_id,batch_hash,creator_id)) STRICT;
CREATE TABLE bruff_catalog_media(owner_id TEXT,workspace_id TEXT,batch_hash TEXT,creator_id TEXT,folder_key TEXT,media_id TEXT,media_type TEXT,observed_label TEXT,observed_index INTEGER,reference_example_price_cents INTEGER,configured_price_cents INTEGER,status TEXT,enabled INTEGER,step_order_confirmed INTEGER,position_confirmed INTEGER,final_price_confirmed INTEGER,source_metadata_json TEXT,PRIMARY KEY(owner_id,workspace_id,batch_hash,creator_id,folder_key,media_id),FOREIGN KEY(owner_id,workspace_id,batch_hash,creator_id,folder_key) REFERENCES bruff_catalog_folders(owner_id,workspace_id,batch_hash,creator_id,folder_key)) STRICT;`;
const typed=value=>value===null?{type:'null'}:typeof value==='number'||typeof value==='bigint'?{type:'integer',value:String(value)}:{type:'text',value};
function fixture(options={}){
 const db=new DatabaseSync(':memory:'),calls=[];db.exec(catalogueSql);db.exec(progressSql);
 const seed=({ownerId=owner,workspaceId=workspace,creatorId=creator,batchHash=batch,folderId='folder_a',ids=['501','502']}={})=>{
  db.prepare("INSERT OR IGNORE INTO bruff_catalog_batches VALUES(?,?,?,'draft',0)").run(ownerId,workspaceId,batchHash);
  db.prepare("INSERT OR IGNORE INTO bruff_catalog_models VALUES(?,?,?,?,'fixture_model','draft',0)").run(ownerId,workspaceId,batchHash,creatorId);
  db.prepare("INSERT OR IGNORE INTO bruff_catalog_folders VALUES(?,?,?,?,?,'Documented folder',1,'draft',0,0,NULL)").run(ownerId,workspaceId,batchHash,creatorId,folderId);
  ids.forEach((id,i)=>db.prepare("INSERT INTO bruff_catalog_media VALUES(?,?,?,?,?,?,?, ?,?,1200,NULL,'draft',0,0,NULL,0,?)").run(ownerId,workspaceId,batchHash,creatorId,folderId,id,i===0?'video':'photo','Observed '+(i+1),i,JSON.stringify({observed:{durationLabel:i===0?'01:32':null},unselectedField:'not returned'})));
 };
 seed();
 const fetcher=async(url,input)=>{
  const body=JSON.parse(input.body);calls.push({url,input,body});
  if(options.fetcher)return options.fetcher(url,input,body);
  assert.equal(url,'https://fixture-account.turso.io/v2/pipeline');assert.equal(input.redirect,'error');assert.equal(input.method,'POST');assert.deepEqual(body.requests.map(r=>r.type),['execute','execute','close']);
  assert.equal(body.requests[0].stmt.sql,'PRAGMA foreign_keys=ON');db.exec(body.requests[0].stmt.sql);
  const stmt=body.requests[1].stmt,args=stmt.args.map(v=>v.type==='null'?null:v.type==='integer'?Number(v.value):v.value);
  let data;
  try{
   const prepared=db.prepare(stmt.sql),names=prepared.columns().map(c=>c.name),rows=prepared.all(...args),affected=db.prepare('SELECT changes() AS n').get().n;
   const result={cols:names.map(name=>({name,decltype:null})),rows:rows.map(row=>names.map(name=>typed(row[name]))),affected_row_count:affected,last_insert_rowid:null};
   data={results:[{type:'ok',response:{type:'execute',result:{cols:[],rows:[],affected_row_count:0}}},{type:'ok',response:{type:'execute',result}},{type:'ok',response:{type:'close'}}]};
  }catch(error){data={results:[{type:'ok',response:{type:'execute',result:{cols:[],rows:[],affected_row_count:0}}},{type:'error',error:{code:'SQLITE_ERROR',message:'private database detail '+error.message}},{type:'ok',response:{type:'close'}}]}}
  return Response.json(options.transform?options.transform(data):data);
 };
 const store=createTursoMemoryStore({url:'libsql://fixture-account.turso.io',token:'private-test-token',fetcher});
 return {db,calls,store,seed,count:()=>db.prepare('SELECT count(*) AS n FROM bruff_fan_script_observations').get().n,close:()=>db.close()};
}

test('Turso endpoint is fixed server configuration, rejects unsafe URLs/tokens and never falls back',()=>{
 for(const config of [{},{url:'http://fixture.turso.io',token:'x'},{url:'https://evil.test',token:'x'},{url:'https://user:pass@fixture.turso.io',token:'x'},{url:'https://fixture.turso.io/path',token:'x'},{url:'https://fixture.turso.io?url=elsewhere',token:'x'},{url:'https://fixture.turso.io:9443',token:'x'},{url:'https://fixture.turso.io',token:'x\nsecret'}])assert.throws(()=>createTursoMemoryStore(config),code('MEMORY_CONFIG'));
});

test('catalog reads exact persisted model/batch, projects metadata only and leaves four catalog tables untouched',async t=>{
 const f=fixture();t.after(f.close);const before=f.db.prepare('SELECT * FROM bruff_catalog_media').all();
 const result=await f.store.readCatalog(catalogScope);
 assert.deepEqual(result,{ownerId:owner,...catalogScope,sourceUsername:'fixture_model',folders:[{id:'folder_a',name:'Documented folder',orderConfirmed:false,items:[{id:'501',type:'video',label:'Observed 1',durationLabel:'01:32',referencePriceCents:1200,configuredPriceCents:null},{id:'502',type:'photo',label:'Observed 2',durationLabel:null,referencePriceCents:1200,configuredPriceCents:null}]}]});
 assert.deepEqual(f.db.prepare('SELECT * FROM bruff_catalog_media').all(),before);assert.equal(f.calls.length,1);
 assert.equal(JSON.stringify(result).includes('unselectedField'),false);assert.equal(JSON.stringify(result).includes('private-test-token'),false);assert.match(f.calls[0].body.requests[1].stmt.sql,/WHERE model\.workspace_id=\? AND model\.creator_id=\? AND model\.batch_hash=\?/u);
 await assert.rejects(()=>f.store.readCatalog({...catalogScope,batchHash:'b'.repeat(64)}),code('MEMORY_STORE'));
});

test('catalog refuses ambiguous owner or a media ID repeated in different folders',async t=>{
 for(const mode of ['owner','media']){const f=fixture();t.after(f.close);f.seed(mode==='owner'?{ownerId:actor,ids:['601']}:{folderId:'folder_b',ids:['501']});await assert.rejects(()=>f.store.readCatalog(catalogScope),code('MEMORY_STORE'))}
});

test('catalog does not promote configured prices, sequence, incomplete or unsafe metadata',async t=>{
 for(const mutation of ["UPDATE bruff_catalog_media SET configured_price_cents=500","UPDATE bruff_catalog_media SET final_price_confirmed=1","UPDATE bruff_catalog_folders SET step_order_confirmed=1","UPDATE bruff_catalog_folders SET complete=0","UPDATE bruff_catalog_media SET observed_label='https://private.example/media'","UPDATE bruff_catalog_media SET source_metadata_json='{\"observed\":{\"durationLabel\":12}}'","UPDATE bruff_catalog_media SET source_metadata_json='invalid'"]){const f=fixture();t.after(f.close);f.db.exec(mutation);await assert.rejects(()=>f.store.readCatalog(catalogScope),code('MEMORY_STORE'))}
});

test('catalog fails its cap rather than calling a truncated inventory complete',async t=>{
 const f=fixture();t.after(f.close);f.seed({folderId:'large',ids:Array.from({length:1001},(_,i)=>String(i+10000))});await assert.rejects(()=>f.store.readCatalog(catalogScope),code('MEMORY_STORE'));
});

test('append is a single atomic parameterized mutation and replays across actors do not duplicate',async t=>{
 const f=fixture();t.after(f.close);
 assert.deepEqual(await f.store.writeObservations(scope,[observation(),observation({mediaId:'502',kind:'free_sent',priceCents:0})]),{written:2});
 assert.equal(f.calls.length,1);assert.equal(f.count(),2);assert.match(f.calls[0].body.requests[1].stmt.sql,/INSERT INTO bruff_fan_script_observations/u);assert.equal(f.calls[0].body.requests[1].stmt.sql.includes('901'),false);
 assert.deepEqual(await f.store.writeObservations({...scope,actorId:owner},[observation()]),{written:0});assert.equal(f.count(),2);
 const row=f.db.prepare('SELECT actor_id,observed_at,paid_confirmed FROM bruff_fan_script_observations LIMIT 1').get();assert.equal(row.actor_id,actor);assert.match(row.observed_at,/Z$/u);assert.equal(row.paid_confirmed,0);
});

test('opened and evidence-date corrections append variants but progress presents the latest message/media state once',async t=>{
 const f=fixture();t.after(f.close);await f.store.writeObservations(scope,[observation()]);await f.store.writeObservations(scope,[observation({openedReported:true})]);await f.store.writeObservations(scope,[observation({openedReported:true,createdAt:'2026-11-07T10:00:01.000Z'})]);
 assert.equal(f.count(),3);const progress=await f.store.readProgress(scope);assert.equal(progress.observations.length,1);assert.equal(progress.observations[0].openedReported,true);assert.equal(progress.observations[0].createdAt,'2026-11-07T10:00:01.000Z');assert.equal(progress.observations[0].paidConfirmed,false);assert.equal(progress.scan.historyComplete,false);
 const replay=await f.store.readProgress({...scope,actorId:owner});assert.deepEqual(replay,progress);assert.equal(f.calls.at(-1).body.requests[1].stmt.sql.includes('UNION ALL SELECT'),true);
});

test('invalid observation or one foreign media rolls back the entire batch, never upgrades payment',async t=>{
 const f=fixture();t.after(f.close);
 for(const patch of [{paidConfirmed:true},{kind:'purchased'},{kind:'free_sent',priceCents:null},{kind:'offered',priceCents:0},{kind:'sent_price_unknown',priceCents:10},{openedReported:1},{mediaId:'01'},{messageId:'3 OR 1=1'},{createdAt:'2026-02-30T10:00:00Z'},{url:'https://elsewhere.test'}])await assert.rejects(()=>f.store.writeObservations(scope,[observation(patch)]),code('MEMORY_STORE'));
 assert.equal(f.calls.length,0);f.db.exec('PRAGMA foreign_keys=OFF');await assert.rejects(()=>f.store.writeObservations(scope,[observation(),observation({mediaId:'999'})]),code('MEMORY_STORE'));assert.equal(f.count(),0);assert.equal(f.db.prepare('PRAGMA foreign_keys').get().foreign_keys,1);
 await f.store.writeObservations(scope,[observation({kind:'sent_price_unknown',priceCents:null,openedReported:null})]);assert.equal((await f.store.readProgress(scope)).observations[0].priceCents,null);
});

test('every durable fan scope dimension is isolated while worker actor is audit only',async t=>{
 const f=fixture();t.after(f.close);await f.store.writeObservations(scope,[observation()]);
 for(const patch of [{ownerId:actor},{workspaceId:creator},{creatorId:workspace},{binding:'acct_other'},{fanId:'78'},{batchHash:'b'.repeat(64)}])assert.deepEqual((await f.store.readProgress({...scope,...patch})).observations,[]);
 assert.equal((await f.store.readProgress({...scope,actorId:owner})).observations.length,1);
 await assert.rejects(()=>f.store.writeObservations({...scope,creatorId:workspace},[observation()]),code('MEMORY_STORE'));assert.equal(f.count(),1);
});

test('scan CAS is independent of observations, shared between workers and cannot report incomplete history as EOF',async t=>{
 const f=fixture();t.after(f.close);assert.deepEqual((await f.store.readProgress(scope)).scan,{version:0,cursor:null,historyComplete:false,recentCheckedAt:null,historyCheckedAt:null,pages:0});
 const first=await f.store.saveScan(scope,0,next());assert.deepEqual(first,{version:1,...next()});
 await assert.rejects(()=>f.store.saveScan(scope,0,next()),code('MEMORY_CONFLICT'));
 await f.store.writeObservations(scope,[observation()]);await assert.rejects(()=>f.store.saveScan(scope,0,next({cursor:'old'})),code('MEMORY_CONFLICT'));assert.equal(f.count(),1);assert.equal((await f.store.readProgress(scope)).scan.cursor,'opaque-page');
 const finished=await f.store.saveScan({...scope,actorId:owner},1,next({cursor:null,historyComplete:true,historyCheckedAt:date,pages:3}));assert.equal(finished.version,2);assert.equal(finished.historyComplete,true);assert.equal((await f.store.readProgress(scope)).scan.version,2);
 await assert.rejects(()=>f.store.saveScan(scope,1,next()),code('MEMORY_CONFLICT'));
 for(const invalid of [next({historyComplete:true}),next({cursor:null,historyComplete:true}),next({pages:-1}),{...next(),version:2}])await assert.rejects(()=>f.store.saveScan(scope,2,invalid),code('MEMORY_STORE'));
 assert.equal((await f.store.readProgress(scope)).scan.version,2);
});

test('new observation tables enforce append-only evidence, false payment and catalog foreign keys in SQLite',async t=>{
 const f=fixture();t.after(f.close);await f.store.writeObservations(scope,[observation()]);
 assert.throws(()=>f.db.exec('UPDATE bruff_fan_script_observations SET paid_confirmed=1'),/append-only/u);assert.throws(()=>f.db.exec('DELETE FROM bruff_fan_script_observations'),/append-only/u);
 const query=f.calls.find(call=>call.body.requests[1].stmt.sql.startsWith('INSERT INTO bruff_fan_script_observations')).body.requests[1].stmt;
 const values=query.args.map(v=>v.type==='null'?null:v.type==='integer'?Number(v.value):v.value);
 for(const patch of [{12:2},{13:1},{11:null},{6:'foreign-folder'}]){const args=values.slice();for(const [index,value]of Object.entries(patch))args[Number(index)]=value;args[15]='b'.repeat(64);assert.throws(()=>f.db.prepare(query.sql).run(...args));}
 assert.equal(f.count(),1);assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});

test('schema is repeatable, changes only two new STRICT tables and preserves evidence and catalog snapshots',async t=>{
 const f=fixture();t.after(f.close);await f.store.writeObservations(scope,[observation()]);await f.store.saveScan(scope,0,next());
 const catalogue=f.db.prepare('SELECT * FROM bruff_catalog_media').all();f.db.exec(progressSql);
 assert.equal(f.count(),1);assert.equal((await f.store.readProgress(scope)).scan.version,1);assert.deepEqual(f.db.prepare('SELECT * FROM bruff_catalog_media').all(),catalogue);
 const tables=f.db.prepare("SELECT name,strict FROM pragma_table_list WHERE name IN('bruff_fan_script_observations','bruff_fan_script_scans') ORDER BY name").all();assert.equal(tables.length,2);assert.ok(tables.every(table=>table.strict===1));assert.equal((progressSql.match(/CREATE TABLE/gu)||[]).length,2);assert.doesNotMatch(progressSql,/(?:INSERT INTO|UPDATE|DELETE FROM) bruff_catalog_/u);
});

test('protocol, private SQL errors and unauthorized HTTP responses surface only a fixed safe error',async t=>{
 for(const options of [{fetcher:()=>new Response('private remote token', {status:403})},{transform:()=>({results:[{type:'error',error:{message:'private'}}]})},{transform:data=>{data.results[1].response.result.cols=[{name:'invalid name'}];return data}},{transform:data=>{data.results[1].response.result.rows[0][0]={type:'integer',value:'9999999999999999999999'};return data}},{fetcher:()=>new Response('x'.repeat(8*1024*1024+1),{status:200})}]){const f=fixture(options);t.after(f.close);await assert.rejects(()=>f.store.readCatalog(catalogScope),code('MEMORY_STORE'))}
});

test('abort cancels a stalled response body and a pre-aborted request never reaches HTTP',async t=>{
 let cancelled=false;const f=fixture({fetcher:()=>new Response(new ReadableStream({start(controller){controller.enqueue(new TextEncoder().encode('{"results":'));},cancel(){cancelled=true}}))});t.after(f.close);
 const controller=new AbortController(),pending=f.store.readCatalog(catalogScope,controller.signal);setTimeout(()=>controller.abort(),5);await assert.rejects(()=>pending,error=>error.name==='AbortError');assert.equal(cancelled,true);
 const before=f.calls.length;await assert.rejects(()=>f.store.readProgress(scope,controller.signal),error=>error.name==='AbortError');assert.equal(f.calls.length,before);
});

test('progress rejects a capped result rather than displaying a false total or complete state',async t=>{
 const f=fixture();t.after(f.close);const items=Array.from({length:1000},(_,i)=>observation({messageId:String(10000+i)}));
 for(let page=0;page<5;page++)await f.store.writeObservations(scope,items.map(item=>({...item,messageId:String(Number(item.messageId)+page*1000)})));
 await f.store.writeObservations(scope,[observation({messageId:'99999'})]);assert.equal(f.count(),5001);await assert.rejects(()=>f.store.readProgress(scope),code('MEMORY_STORE'));
});
