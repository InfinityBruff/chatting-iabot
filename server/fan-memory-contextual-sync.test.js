import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFile} from 'node:fs/promises';
import {emptyFanContext,syncFanContext,createFanContext,editFanContext,validateFanContext,FAN_MEMORY_EXTRACTOR_VERSION} from '../supabase/functions/bruff-memory/fan-context.js';
import {createFanMemoryStore} from '../supabase/functions/bruff-memory/fan-memory-store.js';

const owner='11111111-1111-4111-8111-111111111111',w='22222222-2222-4222-8222-222222222222',c='33333333-3333-4333-8333-333333333333';
const scope={ownerId:owner,actorId:owner,workspaceId:w,creatorId:c,binding:'acct_context_fixture',fanId:'55'};
const row=(id,text,isFromMe,second)=>({id,text,isFromMe,createdAt:`2026-11-08T09:00:${String(second).padStart(2,'0')}.000Z`});
const answer=row('22','I am 42, in mountains of Colorado.',false,20),question=row('11','Where are you from?',true,10);
const page=(messages,hasMore=false,cursor=null)=>({messages,hasMore,cursor});

test('contextual sync keeps real question and neutral answer with one version and honest coverage',async()=>{
 const original=emptyFanContext(scope),snapshot=JSON.stringify(original),next=await syncFanContext(scope,original,page([answer,question]));
 assert.equal(JSON.stringify(original),snapshot);assert.equal(next.memory.version,1);assert.equal(next.scan.pages,1);assert.equal(next.scan.historyComplete,true);assert.equal(next.scan.extractorVersion,FAN_MEMORY_EXTRACTOR_VERSION);
 const item=next.memory.items.find(i=>i.category==='personal_context');assert.ok(item);assert.equal(item.status,'pending');assert.equal(item.value,item.source.quote);assert.ok(answer.text.includes(item.value));assert.ok(item.value.includes('Colorado'));assert.ok(!item.value.includes('42'));assert.equal(item.source.messageId,'22');assert.deepEqual(item.source.question,{messageId:'11',quote:question.text,at:question.createdAt,author:'model',kind:'where_from'});
 const dto=await createFanContext(scope,next);assert.deepEqual(dto.items.find(i=>i.key===item.key).source.question,item.source.question);assert.equal(JSON.stringify(dto).includes('contextBoundary'),false);
});

test('a real page boundary persists only neutral evidence and links to the next older question',async()=>{
 const head=await syncFanContext(scope,emptyFanContext(scope),page([answer],true,'old-head'));
 assert.equal(head.memory.items.length,0);assert.ok(head.scan.contextBoundary);assert.ok(head.scan.contextBoundary.candidates.every(item=>!item.quote.includes('42')));assert.equal(head.scan.pages,1);
 const stored=JSON.parse(JSON.stringify(head)),done=await syncFanContext(scope,stored,page([question]),{scan:'older'});
 assert.equal(done.memory.version,2);assert.equal(done.scan.pages,2);assert.equal(done.scan.historyComplete,true);assert.equal(done.scan.contextBoundary,null);assert.equal(done.memory.items.length,1);assert.equal(done.memory.items[0].source.messageId,'22');assert.equal(done.memory.items[0].source.question.messageId,'11');assert.equal(done.memory.items[0].status,'pending');
});

test('recent polling cannot replace the older-walk boundary or pair the wrong fan answer',async()=>{
 const head=await syncFanContext(scope,emptyFanContext(scope),page([answer],true,'old-head')),boundary=structuredClone(head.scan.contextBoundary);
 const poll=await syncFanContext(scope,head,page([row('44','Spain',false,40),row('33','Where are you from?',true,30)],true,'recent-tail'),{scan:'recent'});
 assert.deepEqual(poll.scan.contextBoundary,boundary);assert.equal(poll.scan.cursor,'old-head');assert.equal(poll.scan.pages,1);
 const done=await syncFanContext(scope,poll,page([question]),{scan:'older'}),old=done.memory.items.find(i=>i.source.messageId==='22');
 assert.ok(old);assert.ok(old.value.includes('Colorado'));assert.equal(old.source.question.messageId,'11');assert.equal(done.memory.items.find(i=>i.source.messageId==='44').source.question.messageId,'33');
});

test('cross-fan and malformed boundaries fail before exposing memory or modifying the original',async()=>{
 const other={...scope,fanId:'56'},foreign=await syncFanContext(other,emptyFanContext(other),page([answer],true,'foreign-cursor')),head=await syncFanContext(scope,emptyFanContext(scope),page([answer],true,'old-head'));
 const crossed=structuredClone(head);crossed.scan.contextBoundary=foreign.scan.contextBoundary;const before=JSON.stringify(crossed);
 await assert.rejects(createFanContext(scope,crossed));await assert.rejects(syncFanContext(scope,crossed,page([question]),{scan:'older'}));assert.equal(JSON.stringify(crossed),before);
 const injected=structuredClone(head);injected.scan.contextBoundary.rawText='private fixture data';assert.throws(()=>validateFanContext(scope,injected));
});

test('review, correction and deletion preserve paired provenance and stable exclusions',async()=>{
 const first=await syncFanContext(scope,emptyFanContext(scope),page([answer,question])),item=first.memory.items[0];
 const confirmed=editFanContext(scope,first,{key:item.key,action:'confirm',expected_version:1}),repeated=await syncFanContext(scope,confirmed,page([answer,question]));
 assert.equal(repeated.memory.items.length,1);assert.equal(repeated.memory.items[0].status,'confirmed');assert.deepEqual(repeated.memory.items[0].source.question,item.source.question);
 const corrected=editFanContext(scope,confirmed,{key:item.key,action:'correct',value:'Owner-reviewed ordinary note',expected_version:2});assert.deepEqual(corrected.memory.items[0].source.question,item.source.question);
 const deleted=editFanContext(scope,confirmed,{key:item.key,action:'delete',expected_version:2}),again=await syncFanContext(scope,deleted,page([answer,question]));assert.equal(again.memory.items.length,0);assert.ok(again.memory.suppressedKeys.includes('cited_source_personal_context_22'));
});

test('version-two scans reopen once without losing a reviewed paired item',async()=>{
 const initial=await syncFanContext(scope,emptyFanContext(scope),page([answer,question])),first=editFanContext(scope,initial,{key:initial.memory.items[0].key,action:'confirm',expected_version:1});first.scan.extractorVersion=2;delete first.scan.contextBoundary;
 const before=structuredClone(first.memory.items),head=await syncFanContext(scope,first,page([row('88','I enjoy hiking.',false,50)],true,'fresh-head'),{scan:'older'});
 assert.equal(head.scan.extractorVersion,FAN_MEMORY_EXTRACTOR_VERSION);assert.equal(head.scan.pages,1);assert.equal(head.scan.cursor,'fresh-head');assert.equal(head.memory.version,3);assert.deepEqual(head.memory.items.filter(i=>i.key===before[0].key),before);
 const next=await syncFanContext(scope,head,page([row('77','I speak English.',false,45)]),{scan:'older'});assert.equal(next.scan.pages,2);assert.equal(next.scan.historyComplete,true);
});

test('SQLite round trip retains a neutral boundary, paired provenance and CAS across two real store writes',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('../supabase/migrations/turso/202611080003_fan_context.sql',import.meta.url),'utf8'));
 const typed=value=>typeof value==='number'?{type:'integer',value:String(value)}:{type:'text',value};
 const fetcher=async(url,init)=>{assert.equal(url,'https://fixture.turso.io/v2/pipeline');const body=JSON.parse(init.body),{sql,args}=body.requests[0].stmt,statement=db.prepare(sql),rows=statement.all(...args.map(x=>x.type==='integer'?Number(x.value):x.value)),cols=statement.columns().map(x=>({name:x.name}));return Response.json({results:[{type:'ok',response:{type:'execute',result:{cols,rows:rows.map(row=>cols.map(col=>typed(row[col.name]))),affected_row_count:db.prepare('SELECT changes() AS n').get().n}}},{type:'ok',response:{type:'close'}}]});};
 const store=createFanMemoryStore({url:'libsql://fixture.turso.io',token:'fictional-token',fetcher});
 try{
  const empty=await store.read(scope),head=await syncFanContext(scope,empty,page([answer],true,'old-head'));await store.write(scope,0,head);const read=await store.read(scope);assert.deepEqual(read.scan.contextBoundary,head.scan.contextBoundary);assert.ok(read.scan.contextBoundary.candidates.every(item=>!item.quote.includes('42')));
  const older=await syncFanContext(scope,read,page([question]),{scan:'older'});await store.write(scope,1,older);const final=await store.read(scope);assert.equal(final.memory.version,2);assert.equal(final.scan.pages,2);assert.equal(final.scan.contextBoundary,null);assert.equal(final.memory.items[0].source.question.messageId,'11');assert.equal(final.memory.items[0].status,'pending');await assert.rejects(store.write(scope,1,older),error=>error.code==='MEMORY_CONFLICT');assert.equal((await store.read({...scope,fanId:'56'})).memory.items.length,0);
 }finally{db.close();}
});
