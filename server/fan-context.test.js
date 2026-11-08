import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {emptyFanContext,extractNeutralFanCandidates,syncFanContext,editFanContext,createFanContext,fanMemoryContext} from '../supabase/functions/bruff-memory/fan-context.js';
import {createFanMemoryStore} from '../supabase/functions/bruff-memory/fan-memory-store.js';
import {createMemoryHandler} from '../supabase/functions/bruff-memory/handler.js';
const owner='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',w='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444',at=Date.parse('2026-11-08T10:00:00.000Z');
const scope={ownerId:owner,actorId:actor,workspaceId:w,creatorId:c,binding:'acct_fictional',fanId:'55'};
const message=(id,text,extra={})=>({id:String(id),isFromMe:false,createdAt:'2026-11-08T09:00:00.000Z',text,...extra});
const page=(messages,hasMore=false,cursor=null)=>({messages,hasMore,cursor});
const seeded=()=>syncFanContext(scope,emptyFanContext(scope),page([message('1','Call me Alex.'),message('2','I prefer English.')]),{now:at});
const sql=await readFile(new URL('../supabase/migrations/turso/202611080003_fan_context.sql',import.meta.url),'utf8');
const typed=x=>typeof x==='number'||typeof x==='bigint'?{type:'integer',value:String(x)}:{type:'text',value:x};
function database(){
 const db=new DatabaseSync(':memory:');db.exec(sql);const calls=[];
 const fetcher=async(url,options)=>{
  assert.equal(url,'https://fixture.turso.io/v2/pipeline');assert.equal(options.redirect,'error');assert.equal(options.headers.Authorization,'Bearer fictional-token');const body=JSON.parse(options.body);calls.push(body);
  try{const {sql,args}=body.requests[0].stmt,stmt=db.prepare(sql),values=args.map(x=>x.type==='integer'?Number(x.value):x.value),rows=stmt.all(...values),changes=db.prepare('SELECT changes() AS n').get().n,cols=stmt.columns().map(x=>({name:x.name}));return new Response(JSON.stringify({results:[{type:'ok',response:{type:'execute',result:{cols,rows:rows.map(row=>cols.map(col=>typed(row[col.name]))),affected_row_count:changes}}},{type:'ok',response:{type:'close'}}]}))}catch{return new Response(JSON.stringify({results:[{type:'error',error:{message:'private SQL'}}]}))}
 };
 return{db,calls,store:createFanMemoryStore({url:'libsql://fixture.turso.io',token:'fictional-token',fetcher})};
}
test('only explicit neutral fan declarations become pending cited candidates, never payment/personality inference',()=>{
 const rows=[message('1','Call me Alex.'),message('2','I prefer English.'),message('3','I like reading.'),message('4','Call me Someone.',{isFromMe:true}),message('5','I bought it for $50.'),message('6','I am lonely and wealthy.'),message('7','Explicit sexting request'),message('8','I live in Madrid.')],items=extractNeutralFanCandidates(scope,rows);
 assert.deepEqual(items.map(x=>x.category),['preferred_name','language','interests']);for(const item of items){assert.equal(item.status,'pending');assert.equal(item.origin,'analysis');assert.equal(item.source.author,'fan');assert.ok(rows.find(row=>row.id===item.source.messageId).text.includes(item.source.quote))}
 assert.throws(()=>extractNeutralFanCandidates(scope,[message('1','Call me A.'),message('1','Call me B.')]));
});
test('one-page traversal stores actual IDs and explicit coverage while old pages cannot overwrite newer pending statements',async()=>{
 let state=await syncFanContext(scope,emptyFanContext(scope),page([message('2','Call me Alex.')],true,'older'),{now:at});assert.equal(state.scan.historyComplete,false);assert.equal(state.scan.cursor,'older');
 state=await syncFanContext(scope,state,page([message('1','Call me Old.',{createdAt:'2026-11-07T09:00:00.000Z'})]),{scan:'older',now:at+1000});assert.equal(state.scan.historyComplete,true);assert.equal(state.scan.pages,2);assert.equal(state.memory.items[0].value,'Alex');assert.equal(state.scan.seenMessages.length,2);
});
test('repeat cursor fails before mutation and recent checks preserve unfinished older traversal',async()=>{
 const state=await syncFanContext(scope,emptyFanContext(scope),page([message('1','Hello.')],true,'older'),{now:at}),before=JSON.stringify(state);
 await assert.rejects(syncFanContext(scope,state,page([message('2','Hi.')],true,'older'),{scan:'older',now:at}));assert.equal(JSON.stringify(state),before);
 const recent=await syncFanContext(scope,state,page([message('3','Hi.')],true,'other-head'),{now:at+1000});assert.equal(recent.scan.cursor,'older');assert.equal(recent.scan.pages,1);assert.equal(recent.scan.seenMessages.length,2);
});
test('owner confirmation, correction, pinning and suppression survive future extraction with global CAS',async()=>{
 const initial=await seeded();for(const action of ['confirm','correct','pin']){const edited=editFanContext(scope,initial,{key:'preferred_name',action,expected_version:1,...(action==='correct'?{value:'Al'}:{})}),next=await syncFanContext(scope,edited,page([message('3','Call me Other.',{createdAt:'2026-11-08T10:00:00.000Z'})]),{now:at});assert.deepEqual(next.memory.items.find(x=>x.key==='preferred_name'),edited.memory.items.find(x=>x.key==='preferred_name'))}
 const removed=editFanContext(scope,initial,{key:'preferred_name',action:'delete',expected_version:1}),next=await syncFanContext(scope,removed,page([message('3','Call me Other.')]),{now:at});assert.ok(!next.memory.items.some(x=>x.key==='preferred_name'));
 assert.throws(()=>editFanContext(scope,initial,{key:'preferred_name',action:'confirm',expected_version:0}),error=>error.status===409);assert.throws(()=>editFanContext(scope,initial,{key:'preferred_name',action:'correct',value:'https://secret.test',expected_version:1}));
});
test('context revision binds binding/scope and confirmed facts, not polls, cursors or unreviewed statements',async()=>{
 const state=await seeded(),a=await createFanContext(scope,state,{actorId:actor}),poll=await syncFanContext(scope,state,page([message('1','Call me Alex.'),message('2','I prefer English.')]),{now:at+5000}),b=await createFanContext(scope,poll,{actorId:actor});assert.equal(a.contextRevision,b.contextRevision);assert.notEqual(a.version,b.version);
 const confirmed=editFanContext(scope,state,{key:'preferred_name',action:'confirm',expected_version:1}),d=await createFanContext(scope,confirmed,{actorId:actor});assert.notEqual(d.contextRevision,a.contextRevision);assert.equal(d.items[0].source.author,'fan');assert.equal(d.coverage.messagesObserved,2);assert.equal(d.binding,scope.binding);
 assert.notEqual((await createFanContext({...scope,binding:'acct_other'},state,{actorId:actor})).contextRevision,a.contextRevision);
});
test('a later contradictory declaration creates a pending conflict and invalidates context without replacing reviewed data',async()=>{
 const state=await seeded(),confirmed=editFanContext(scope,state,{key:'preferred_name',action:'confirm',expected_version:1}),before=await createFanContext(scope,confirmed,{actorId:actor});
 const changed=await syncFanContext(scope,confirmed,page([message('3','Call me Other.',{createdAt:'2026-11-08T10:00:00.000Z'})]),{now:at+1000}),after=await createFanContext(scope,changed,{actorId:actor});
 assert.deepEqual(changed.memory.items.find(item=>item.key==='preferred_name'),confirmed.memory.items.find(item=>item.key==='preferred_name'));
 const conflict=changed.memory.items.find(item=>item.key==='preferred_name_conflict_3');assert.equal(conflict.status,'pending');assert.equal(conflict.value,'Other');assert.equal(conflict.source.messageId,'3');assert.equal(conflict.source.quote,'Call me Other.');assert.notEqual(before.contextRevision,after.contextRevision);
 const older=await syncFanContext(scope,confirmed,page([message('4','Call me Old.',{createdAt:'2026-11-07T09:00:00.000Z'})]),{now:at});assert.ok(!older.memory.items.some(item=>item.key.includes('_conflict_')));
});
test('manual or pinned memory stays intact and deleted conflict keys do not revive on repeat extraction',async()=>{
 for(const action of ['correct','pin']){
  const state=await seeded(),edited=editFanContext(scope,state,{key:'preferred_name',action,expected_version:1,...(action==='correct'?{value:'Owner name'}:{})}),input=page([message('3','Call me New.',{createdAt:'2026-11-08T10:00:00.000Z'})]),changed=await syncFanContext(scope,edited,input,{now:at});
  assert.deepEqual(changed.memory.items.find(item=>item.key==='preferred_name'),edited.memory.items.find(item=>item.key==='preferred_name'));assert.ok(changed.memory.items.some(item=>item.key==='preferred_name_conflict_3'));
  const removed=editFanContext(scope,changed,{key:'preferred_name_conflict_3',action:'delete',expected_version:3}),repeated=await syncFanContext(scope,removed,input,{now:at+1000});assert.ok(!repeated.memory.items.some(item=>item.key==='preferred_name_conflict_3'));assert.ok(repeated.memory.suppressedKeys.includes('preferred_name_conflict_3'));
 }
});
test('actual SQLite current-row CAS and HTTP adapter isolate owner, agency, model, binding and fan',async()=>{
 const f=database();try{assert.equal((await f.store.read(scope)).memory.version,0);const state=await seeded();await f.store.write(scope,0,state);assert.equal((await fanMemoryContext(f.store,scope,{actorId:actor})).items.length,2);await assert.rejects(f.store.write(scope,0,state),error=>error.code==='MEMORY_CONFLICT');
 for(const [key,value]of[['ownerId',actor],['workspaceId',actor],['creatorId',actor],['binding','acct_other'],['fanId','56']])assert.equal((await f.store.read({...scope,[key]:value})).memory.version,0,key);
 const removed=editFanContext(scope,state,{key:'preferred_name',action:'delete',expected_version:1});await f.store.write(scope,1,removed);const refreshed=await syncFanContext(scope,await f.store.read(scope),page([message('9','Call me Return.')]),{now:at});await f.store.write(scope,2,refreshed);assert.equal(f.db.prepare('SELECT count(*) AS n FROM bruff_fan_context_current').get().n,1);assert.ok(!(await f.store.read(scope)).memory.items.some(x=>x.key==='preferred_name'));
 }finally{f.db.close()}
});
test('corrupt stored checksum and cross-model serialized state are rejected',async()=>{
 const f=database();try{const state=await seeded();await assert.rejects(f.store.write({...scope,creatorId:owner},0,state));await f.store.write(scope,0,state);f.db.exec("UPDATE bruff_fan_context_current SET content_hash='"+'0'.repeat(64)+"'");await assert.rejects(f.store.read(scope));}finally{f.db.close()}
});
function handlerFixture(options={}){
 let state=emptyFanContext(scope),checks=0;const calls=[],writes=[];
 const handler=createMemoryHandler({url:'https://auth.test',anonKey:'public',enabled:true,catalogBatch:undefined,fanMemoryStore:{read:async()=>structuredClone(state),write:async(s,expected,next)=>{if(options.conflict)throw Object.assign(Error('CAS'),{code:'MEMORY_CONFLICT',status:409});assert.equal(state.memory.version,expected);state=structuredClone(next);writes.push(s);return state}},fetcher:async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});assert.equal(init.headers.Authorization,'Bearer user-session');
  if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify({id:options.owner?owner:actor,email_confirmed_at:'2026-11-08T00:00:00Z'}));
  if(url.endsWith('/bruff_live_authorize'))return new Response(JSON.stringify(++checks>=2&&options.revoke?'acct_other':scope.binding));
  if(url.endsWith('/bruff_fan_memory_scope'))return new Response(JSON.stringify({actorId:options.owner?owner:actor,ownerId:owner,workspaceId:w,creatorId:c,binding:scope.binding}));
  if(url.endsWith('/bruff_ai_models'))return new Response(JSON.stringify({actorId:owner,workspaces:[{id:w,models:[{id:c}]}]}));
  if(url.endsWith('/bruff-live'))return new Response(JSON.stringify({data:page([message('1','Call me Alex.')],true,'older-page')}));throw Error('Unexpected route');
 }});
 const run=(patch={})=>handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer user-session','Content-Type':'application/json'},body:JSON.stringify({operation:'fan_memory_read',workspace_id:w,creator_id:c,conversation_id:'55',...patch})}));return{run,calls,writes};
}
test('fan memory works without catalog batch, uses real scope RPC and never calls catalog/providers directly',async()=>{
 const f=handlerFixture(),r=await f.run(),d=await r.json();assert.equal(r.status,200);assert.equal(d.version,0);assert.deepEqual(d.items,[]);assert.equal(d.binding,scope.binding);assert.equal(d.coverage.historyComplete,false);assert.match(d.contextRevision,/^[a-f0-9]{64}$/);assert.ok(f.calls.some(x=>x.url.endsWith('bruff_fan_memory_scope')));assert.ok(!f.calls.some(x=>/ofmapi|cloudflare|send|prepare|profile/iu.test(x.url)));assert.equal(f.writes.length,0);
});
test('fan sync reads only one authorized page and owner-only edits preserve cited provenance',async()=>{
 const reader=handlerFixture(),r=await reader.run({operation:'fan_memory_sync',scan:'recent'}),d=await r.json();assert.equal(r.status,200);assert.equal(d.items[0].status,'pending');assert.equal(d.coverage.cursor,'older-page');assert.equal(reader.calls.filter(x=>x.url.endsWith('/bruff-live')).length,1);assert.equal(reader.writes.length,1);
 const denied=await reader.run({operation:'fan_memory_edit',edit:{key:'preferred_name',action:'confirm',expected_version:1}});assert.equal(denied.status,403);assert.equal(reader.writes.length,1);
 const owned=handlerFixture({owner:true});await owned.run({operation:'fan_memory_sync'});const saved=await owned.run({operation:'fan_memory_edit',edit:{key:'preferred_name',action:'correct',value:'Al',expected_version:1}}),value=await saved.json();assert.equal(saved.status,200);assert.equal(value.items[0].value,'Al');assert.equal(value.items[0].origin,'manual');assert.equal(value.items[0].source.quote,'Call me Alex.');
});
test('revocation and concurrent sync fail closed without returning private state',async()=>{
 const f=handlerFixture({revoke:true}),r=await f.run({operation:'fan_memory_sync'});assert.equal(r.status,403);assert.equal(f.writes.length,0);assert.equal((await r.json()).items,undefined);
 const race=handlerFixture({conflict:true});assert.equal((await race.run({operation:'fan_memory_sync'})).status,409);
 const invalid=handlerFixture();assert.equal((await invalid.run({operation:'fan_memory_read',messages:[message('1','Forged')]})).status,400);assert.equal(invalid.calls.length,0);
});
