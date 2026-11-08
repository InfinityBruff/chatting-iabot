import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {FAN_MEMORY_EXTRACTOR_VERSION,emptyFanContext,validateFanContext,fanMemoryScanPlan,syncFanContext,editFanContext,createFanContext} from '../supabase/functions/bruff-memory/fan-context.js';
import {createFanMemoryStore} from '../supabase/functions/bruff-memory/fan-memory-store.js';
import {createMemoryHandler} from '../supabase/functions/bruff-memory/handler.js';
const owner='11111111-1111-4111-8111-111111111111',w='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444';
const scope={ownerId:owner,actorId:owner,workspaceId:w,creatorId:c,binding:'acct_fictional',fanId:'55'},at='2026-11-08T09:00:00.000Z',now=Date.parse('2026-11-08T10:00:00.000Z');
const message=(id,text,extra={})=>({id:String(id),text,isFromMe:false,createdAt:at,...extra}),page=(messages,hasMore=false,cursor=null)=>({messages,hasMore,cursor});
async function legacy(){const state=await syncFanContext(scope,emptyFanContext(scope),page([message('1','Call me Alex.'),message('2','I like music.')]),{now:now-60000});delete state.scan.extractorVersion;delete state.scan.contextBoundary;state.scan.seenCursors=['a'.repeat(64)];return state;}

test('legacy validation and reads do not silently rewrite stored scan JSON or expose private version fields',async()=>{
 const state=await legacy(),before=JSON.stringify(state),validated=validateFanContext(scope,state);assert.equal(JSON.stringify(validated),before);assert.equal(JSON.stringify(state),before);assert.equal(Object.hasOwn(validated.scan,'extractorVersion'),false);
 const dto=await createFanContext(scope,state);assert.deepEqual(Object.keys(dto.coverage).sort(),['historyComplete','cursor','pages','recentCheckedAt','historyCheckedAt','messagesObserved','contextLimited'].sort());assert.equal(JSON.stringify(dto).includes('extractorVersion'),false);assert.equal(dto.coverage.historyComplete,false);assert.equal(dto.coverage.pages,0);assert.equal(dto.coverage.messagesObserved,0);assert.equal(state.scan.historyComplete,true);assert.equal(JSON.stringify(state),before);
 const empty=emptyFanContext(scope);assert.equal(empty.scan.extractorVersion,FAN_MEMORY_EXTRACTOR_VERSION);assert.equal(empty.memory.version,0);assert.equal(FAN_MEMORY_EXTRACTOR_VERSION,3);
});

test('the shared request plan reopens legacy EOF, partial and limited passes from the real head exactly once',async()=>{
 for(const version of [undefined,1,2])for(const kind of ['complete','partial','limited']){
  const state=await legacy();if(version!==undefined)state.scan.extractorVersion=version;if(kind!=='complete'){state.scan.historyComplete=false;state.scan.cursor='obsolete-cursor';}if(kind==='limited'){state.scan.contextLimited=true;state.scan.pages=1000;}
  for(const request of ['recent','older'])assert.deepEqual(fanMemoryScanPlan(state,request),{scan:'recent',cursor:null,skip:false,restarting:true});
 }
 const current=await syncFanContext(scope,emptyFanContext(scope),page([message('3','I work as a carpenter.')],true,'current-cursor'),{now});assert.deepEqual(fanMemoryScanPlan(current,'older'),{scan:'older',cursor:'current-cursor',skip:false,restarting:false});
 current.scan.contextLimited=true;assert.equal(fanMemoryScanPlan(current,'older').skip,true);current.scan.contextLimited=false;current.scan.historyComplete=true;current.scan.cursor=null;assert.equal(fanMemoryScanPlan(current,'older').skip,true);
 assert.deepEqual(fanMemoryScanPlan(emptyFanContext(scope),'older'),{scan:'recent',cursor:null,skip:false,restarting:false});
});

test('first valid upgrade resets only pass counters and coverage while retaining reviewed, manual, pinned and suppressed memory',async()=>{
 let state=await legacy();state=editFanContext(scope,state,{key:'preferred_name',action:'correct',expected_version:1,value:'Owner reviewed name'});state=editFanContext(scope,state,{key:'preferred_name',action:'pin',expected_version:2});state=editFanContext(scope,state,{key:'interest_music',action:'delete',expected_version:3});const before=JSON.stringify(state),oldName=structuredClone(state.memory.items[0]),tombstones=[...state.memory.suppressedKeys];
 const upgraded=await syncFanContext(scope,state,page([message('3','I work as a carpenter.')],true,'fresh-head'),{scan:'older',now});
 assert.equal(JSON.stringify(state),before);assert.equal(upgraded.memory.version,5);assert.deepEqual(upgraded.memory.items.find(item=>item.key==='preferred_name'),oldName);assert.deepEqual(upgraded.memory.suppressedKeys,tombstones);assert.equal(upgraded.memory.items.find(item=>item.category==='personal_context').status,'pending');
 assert.equal(upgraded.scan.extractorVersion,FAN_MEMORY_EXTRACTOR_VERSION);assert.equal(upgraded.scan.pages,1);assert.equal(upgraded.scan.cursor,'fresh-head');assert.equal(upgraded.scan.historyComplete,false);assert.equal(upgraded.scan.contextLimited,false);assert.deepEqual(upgraded.scan.seenMessages,['3']);assert.equal(upgraded.scan.seenCursors.length,1);assert.ok(!upgraded.scan.seenCursors.includes('a'.repeat(64)));assert.equal(upgraded.scan.recentCheckedAt,new Date(now).toISOString());assert.equal(upgraded.scan.historyCheckedAt,new Date(now).toISOString());
});

test('current-version recent checks preserve the reopened cursor and older pages finish the new pass without resetting it again',async()=>{
 const state=await legacy(),first=await syncFanContext(scope,state,page([message('3','I work as a carpenter.')],true,'fresh-head'),{scan:'older',now}),recent=await syncFanContext(scope,first,page([message('4','Hello.')],true,'newer-head'),{now:now+1000});
 assert.equal(recent.memory.version,3);assert.equal(recent.scan.extractorVersion,FAN_MEMORY_EXTRACTOR_VERSION);assert.equal(recent.scan.pages,1);assert.equal(recent.scan.cursor,'fresh-head');assert.equal(recent.scan.seenCursors.length,1);assert.deepEqual(recent.scan.seenMessages,['3','4']);
 const final=await syncFanContext(scope,recent,page([message('5','I live in Madrid.')]),{scan:'older',now:now+2000});assert.equal(final.memory.version,4);assert.equal(final.scan.pages,2);assert.equal(final.scan.historyComplete,true);assert.equal(final.scan.cursor,null);assert.deepEqual(final.scan.seenMessages,['3','4','5']);assert.equal(final.scan.extractorVersion,FAN_MEMORY_EXTRACTOR_VERSION);
 assert.deepEqual(fanMemoryScanPlan(final,'older'),{scan:'older',cursor:null,skip:true,restarting:false});const skipped=await syncFanContext(scope,final,page([]),{scan:'older',now:now+3000});assert.deepEqual(skipped,final);
});

test('malformed pages, wrong scopes, future versions and capacity errors cannot mutate or stamp legacy state as upgraded',async()=>{
 const state=await legacy(),before=JSON.stringify(state);
 for(const data of [{messages:[],hasMore:true,cursor:null},page([message('3','I work as a carpenter.',{isFromMe:null})]),page([message('3','I work as a carpenter.',{fanId:'56'})])]){await assert.rejects(syncFanContext(scope,state,data,{scan:'older',now}));assert.equal(JSON.stringify(state),before);}
 for(const version of [null,'2',0,FAN_MEMORY_EXTRACTOR_VERSION+1,-1,1.5]){const invalid=structuredClone(state);invalid.scan.extractorVersion=version;assert.throws(()=>validateFanContext(scope,invalid));assert.throws(()=>fanMemoryScanPlan(invalid,'older'));}
 const full=structuredClone(state),item=full.memory.items[0];full.memory.items=Array.from({length:100},(_,index)=>({...structuredClone(item),key:'stored_'+index,source:{...item.source,messageId:String(index+100)}}));const fullBefore=JSON.stringify(full);await assert.rejects(syncFanContext(scope,full,page([message('3','I work as a carpenter.')],true,'fresh-head'),{scan:'older',now}),e=>e.status===409);assert.equal(JSON.stringify(full),fullBefore);assert.equal(Object.hasOwn(full.scan,'extractorVersion'),false);
});

function handlerFixture(state,options={}){
 let stored=structuredClone(state);const calls=[],writes=[];
 const handler=createMemoryHandler({url:'https://auth.test',anonKey:'public',enabled:true,fanMemoryStore:{read:async()=>structuredClone(stored),write:async(s,expected,next)=>{if(options.conflict)throw Object.assign(Error('CAS'),{code:'MEMORY_CONFLICT',status:409});assert.equal(expected,stored.memory.version);assert.equal(next.memory.version,expected+1);stored=structuredClone(next);writes.push(next);return structuredClone(stored);}},fetcher:async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});if(url.endsWith('/auth/v1/user'))return Response.json({id:owner,email_confirmed_at:at});if(url.endsWith('/bruff_live_authorize'))return Response.json(scope.binding);if(url.endsWith('/bruff_fan_memory_scope'))return Response.json({actorId:owner,ownerId:owner,workspaceId:w,creatorId:c,binding:scope.binding});if(url.endsWith('/bruff-live')){if(options.fail)return Response.json({error:'unavailable'},{status:503});return Response.json({data:options.data||page([message('3','I work as a carpenter.')],true,'new-head')});}throw Error('Unexpected route');
 }});
 const run=()=>handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer owner-session','Content-Type':'application/json'},body:JSON.stringify({operation:'fan_memory_sync',workspace_id:w,creator_id:c,conversation_id:'55',scan:'older'})}));return{run,calls,writes,get stored(){return stored;}};
}

test('actual handler requests the head for legacy EOF even when asked older, then stores exactly one upgraded pass',async()=>{
 const state=await legacy(),f=handlerFixture(state),response=await f.run(),dto=await response.json();assert.equal(response.status,200);assert.equal(f.calls.filter(call=>call.url.endsWith('/bruff-live')).length,1);assert.equal(f.writes.length,1);const body=f.calls.find(call=>call.url.endsWith('/bruff-live')).body;assert.equal(Object.hasOwn(body,'cursor'),false);assert.equal(body.background,true);assert.equal(dto.version,state.memory.version+1);assert.equal(dto.coverage.pages,1);assert.equal(dto.coverage.historyComplete,false);assert.equal(dto.coverage.cursor,'new-head');assert.equal(f.stored.scan.extractorVersion,FAN_MEMORY_EXTRACTOR_VERSION);assert.equal(dto.items.some(item=>item.category==='personal_context'),true);
});

test('actual handler source failure and concurrent CAS preserve old coverage and do not persist a reset',async()=>{
 for(const options of [{fail:true},{conflict:true},{data:{messages:[],hasMore:true,cursor:null}}]){const state=await legacy(),f=handlerFixture(state,options),response=await f.run();assert.ok([409,503].includes(response.status));assert.equal(f.writes.length,0);assert.deepEqual(f.stored,state);}
 const state=await syncFanContext(scope,emptyFanContext(scope),page([message('3','I work as a carpenter.')])),current=handlerFixture(state),response=await current.run();assert.equal(response.status,200);assert.equal(current.calls.some(call=>call.url.endsWith('/bruff-live')),false);assert.equal(current.writes.length,0);assert.deepEqual(current.stored,state);
});

test('real SQLite accepts checksum-exact legacy JSON and persists the new marker only with successful versioned CAS',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('../supabase/migrations/turso/202611080003_fan_context.sql',import.meta.url),'utf8'));const typed=value=>typeof value==='number'?{type:'integer',value:String(value)}:{type:'text',value};
 const fetcher=async(url,init)=>{assert.equal(url,'https://fixture.turso.io/v2/pipeline');const body=JSON.parse(init.body),{sql,args}=body.requests[0].stmt,stmt=db.prepare(sql),rows=stmt.all(...args.map(x=>x.type==='integer'?Number(x.value):x.value)),cols=stmt.columns().map(col=>({name:col.name}));return Response.json({results:[{type:'ok',response:{type:'execute',result:{cols,rows:rows.map(row=>cols.map(col=>typed(row[col.name]))),affected_row_count:db.prepare('SELECT changes() AS n').get().n}}},{type:'ok',response:{type:'close'}}]});};
 const store=createFanMemoryStore({url:'libsql://fixture.turso.io',token:'fictional-token',fetcher});try{await store.read(scope);assert.equal(db.prepare('SELECT count(*) AS n FROM bruff_fan_context_current').get().n,0);const old=await legacy();await store.write(scope,0,old);const read=await store.read(scope);assert.deepEqual(read,old);assert.equal(Object.hasOwn(read.scan,'extractorVersion'),false);const first=await syncFanContext(scope,read,page([message('3','I work as a carpenter.')],true,'fresh-head'),{scan:'older',now});await store.write(scope,1,first);await assert.rejects(store.write(scope,1,first),e=>e.code==='MEMORY_CONFLICT');const saved=await store.read(scope);assert.equal(saved.scan.extractorVersion,FAN_MEMORY_EXTRACTOR_VERSION);assert.equal(saved.memory.version,2);assert.equal(saved.scan.cursor,'fresh-head');assert.deepEqual(saved.scan.seenMessages,['3']);}finally{db.close();}
});
