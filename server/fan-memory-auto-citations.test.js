import test from 'node:test';
import assert from 'node:assert/strict';
import {extractCitedCandidateInputs,isNeutralMemoryQuote} from '../supabase/functions/bruff-memory/cited-candidates.js';
import {emptyFanContext,syncFanContext,importCitedFanCandidates,editFanContext,createFanContext} from '../supabase/functions/bruff-memory/fan-context.js';
import {createMemoryHandler} from '../supabase/functions/bruff-memory/handler.js';
const owner='11111111-1111-4111-8111-111111111111',w='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444',at='2026-11-08T09:00:00.000Z';
const scope={ownerId:owner,actorId:owner,workspaceId:w,creatorId:c,binding:'acct_fictional',fanId:'55'};
const message=(text,extra={})=>({id:'7',text,isFromMe:false,createdAt:at,...extra}),page=(messages,hasMore=false,cursor=null)=>({messages,hasMore,cursor});

test('same page yields only contiguous neutral fan declarations, one sentence per message/category',()=>{
 const text='Hello! I work as a carpenter. I live in Madrid. I enjoy hiking. I prefer Spanish. I am usually free on weekends. How was your day? I will message you tomorrow.';
 const rows=[message(text),message('I work as a carpenter.',{id:'8',isFromMe:true}),message('I live in Madrid.',{id:'9',pending:true})],items=extractCitedCandidateInputs(rows);
 assert.deepEqual(items.map(item=>item.category),['personal_context','interests','language','availability']);assert.equal(items[0].quote,'I work as a carpenter.');assert.equal(new Set(items.map(item=>item.message_id+':'+item.category)).size,items.length);
 for(const item of items){assert.ok(text.includes(item.quote));assert.equal(isNeutralMemoryQuote(item.quote,item.category),true);}
});

test('historical questions, promises, temporary availability, model text and unsupported claims never auto-fill memory',()=>{
 for(const text of ['How are you?',"I'll message you tomorrow.",'I am free tomorrow.','I am usually free tomorrow.','I live in Madrid?','Tengo asma.','Soy budista.','Tengo diecisiete años.','Mi clave es abcdefghij.','My name is Ana and I have lupus.','My name is Ana and I am twelve.','My name is Ana and my PIN is abcdef.'])assert.deepEqual(extractCitedCandidateInputs([message(text)]),[],text);
 for(const extra of [{isFromMe:true},{delivery:'queued'},{createdAt:'not-a-date'}])assert.deepEqual(extractCitedCandidateInputs([message('I work as a carpenter.',extra)]),[]);
});

test('sync keeps legacy keys and literal extracted values while adding new cited neutral declarations once',async()=>{
 const rows=[message('Call me Alex. I work as a carpenter. I prefer Spanish. I enjoy hiking. I am usually free on weekends.')],state=await syncFanContext(scope,emptyFanContext(scope),page(rows,true,'older'));
 assert.equal(state.memory.version,1);assert.equal(state.scan.pages,1);assert.equal(state.scan.cursor,'older');assert.equal(state.scan.historyComplete,false);
 assert.equal(state.memory.items.length,5);assert.equal(new Set(state.memory.items.map(item=>item.category+':'+item.source.messageId)).size,5);
 for(const item of state.memory.items){assert.equal(item.status,'pending');assert.equal(item.origin,'analysis');assert.equal(item.pinned,false);assert.equal(item.source.author,'fan');assert.ok(rows[0].text.includes(item.source.quote));assert.equal(item.value,item.source.quote);}
 const repeated=await syncFanContext(scope,state,page(rows,true,'new-head'));assert.equal(repeated.memory.version,2);assert.equal(repeated.memory.items.length,5);assert.equal(repeated.scan.pages,1);assert.equal(repeated.scan.cursor,'older');assert.equal(repeated.scan.seenMessages.length,1);
 const legacy=await syncFanContext(scope,emptyFanContext(scope),page([message('Call me Alex.')],true,'legacy'));assert.equal(legacy.memory.items[0].key,'preferred_name');assert.equal(legacy.memory.items[0].value,'Alex');assert.equal(legacy.memory.items[0].source.quote,'Call me Alex.');
});

test('a legacy candidate cannot bypass the positive policy, and previously stored entries are retained',async()=>{
 const source='Call me Ana and I have lupus.',blank=await syncFanContext(scope,emptyFanContext(scope),page([message(source)]));assert.deepEqual(blank.memory.items,[]);
 const historical=emptyFanContext(scope);historical.memory.version=1;historical.memory.items=[{workspaceId:w,creatorId:c,fanId:'55',key:'preferred_name',category:'preferred_name',value:'Ana and I have lupus',status:'pending',origin:'analysis',pinned:false,source:{messageId:'6',quote:source,at,author:'fan'}}];
 const preserved=await syncFanContext(scope,historical,page([message(source)]));assert.deepEqual(preserved.memory.items,historical.memory.items);assert.equal(preserved.memory.version,2);
});

test('sync does not duplicate explicit imports by message/category or overwrite reviewed, manual and pinned data',async()=>{
 const quote='I speak Spanish.',input=[{category:'language',message_id:'7',quote}],imported=(await importCitedFanCandidates(scope,emptyFanContext(scope),input,[message(quote)],0)).record;
 const repeated=await syncFanContext(scope,imported,page([message(quote)]));assert.equal(repeated.memory.items.length,1);assert.equal(repeated.memory.items[0].key,imported.memory.items[0].key);
 const work='I work as a carpenter.',first=await syncFanContext(scope,emptyFanContext(scope),page([message(work)]));
 for(const action of ['confirm','correct','pin']){const old=editFanContext(scope,first,{key:first.memory.items[0].key,action,expected_version:1,...(action==='correct'?{value:'Reviewed work context'}:{})}),next=await syncFanContext(scope,old,page([message(work)]));assert.deepEqual(next.memory.items,old.memory.items);}
});

test('stable source exclusions and legacy exclusions prevent automatic replay of another subquote',async()=>{
 const quote='I live in Madrid.',first=await syncFanContext(scope,emptyFanContext(scope),page([message(quote)])),removed=editFanContext(scope,first,{key:first.memory.items[0].key,action:'delete',expected_version:1}),variant=await syncFanContext(scope,removed,page([message('I live in Madrid')]));assert.equal(variant.memory.items.length,0);assert.ok(variant.memory.suppressedKeys.includes('cited_source_personal_context_7'));
 const language=await syncFanContext(scope,emptyFanContext(scope),page([message('I speak Spanish.')])),deleted=editFanContext(scope,language,{key:'language',action:'delete',expected_version:1}),repeated=await syncFanContext(scope,deleted,page([message('I prefer Spanish.')]));assert.equal(repeated.memory.items.length,0);
});

test('new cited declarations preserve actual one-page coverage, cursor failure and explicit capacity limits',async()=>{
 const original=await syncFanContext(scope,emptyFanContext(scope),page([message('I work as a carpenter.')],true,'older')),before=JSON.stringify(original);
 await assert.rejects(syncFanContext(scope,original,page([message('I live in Madrid.',{id:'8'})],true,'older'),{scan:'older'}),error=>error.status===409);assert.equal(JSON.stringify(original),before);
 const final=await syncFanContext(scope,original,page([message('I live in Madrid.',{id:'8'})]),{scan:'older'});assert.equal(final.memory.version,2);assert.equal(final.scan.pages,2);assert.equal(final.scan.historyComplete,true);assert.equal(final.scan.cursor,null);assert.equal(final.scan.seenMessages.length,2);
 const full=structuredClone(original),seed=full.memory.items[0];full.memory.items=Array.from({length:100},(_,index)=>({...structuredClone(seed),key:'existing_'+index,source:{...seed.source,messageId:String(index+100)}}));const fullBefore=JSON.stringify(full);await assert.rejects(syncFanContext(scope,full,page([message('I live in Madrid.',{id:'8'})])),error=>error.status===409);assert.equal(JSON.stringify(full),fullBefore);
});

test('optional provider scope echoes are checked before transcript reconstruction and cannot be overwritten with the requested fan',async()=>{
 const state=emptyFanContext(scope),before=JSON.stringify(state);
 for(const[field,value]of[['workspaceId',owner],['creatorId',owner],['modelId',owner],['fanId','56'],['binding','acct_other']]){
  await assert.rejects(syncFanContext(scope,state,page([message('I work as a carpenter.',{[field]:value})])));
  await assert.rejects(syncFanContext(scope,state,{...page([message('I work as a carpenter.')]),[field]:value}));
  assert.equal(JSON.stringify(state),before);
 }
 const matching=await syncFanContext(scope,state,page([message('I work as a carpenter.',{workspaceId:w,creatorId:c,modelId:c,fanId:'55',binding:scope.binding})]));assert.equal(matching.memory.items.length,1);
});

test('existing sync handler performs one real-page read, one CAS write and one version increment without import/AI/send',async()=>{
 let state=emptyFanContext(scope);const calls=[],writes=[];
 const handler=createMemoryHandler({url:'https://auth.test',anonKey:'public',enabled:true,fanMemoryStore:{read:async()=>structuredClone(state),write:async(s,expected,next)=>{assert.equal(expected,state.memory.version);assert.equal(next.memory.version,expected+1);state=structuredClone(next);writes.push({s,expected});return state;}},fetcher:async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});assert.equal(init.headers.Authorization,'Bearer owner-session');
  if(url.endsWith('/auth/v1/user'))return Response.json({id:owner,email_confirmed_at:at});
  if(url.endsWith('/bruff_live_authorize'))return Response.json(scope.binding);
  if(url.endsWith('/bruff_fan_memory_scope'))return Response.json({actorId:owner,ownerId:owner,workspaceId:w,creatorId:c,binding:scope.binding});
  if(url.endsWith('/bruff-live'))return Response.json({data:page([message('Hi! I work as a carpenter. I enjoy hiking.')],true,'older')});throw Error('Unexpected route');
 }});
 const response=await handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer owner-session','Content-Type':'application/json'},body:JSON.stringify({operation:'fan_memory_sync',workspace_id:w,creator_id:c,conversation_id:'55',scan:'recent'})})),data=await response.json();
 assert.equal(response.status,200);assert.equal(data.version,1);assert.equal(data.items.length,2);assert.equal(data.coverage.pages,1);assert.equal(data.coverage.cursor,'older');assert.equal(data.coverage.historyComplete,false);assert.equal(data.coverage.messagesObserved,1);assert.equal(writes.length,1);assert.equal(calls.filter(x=>x.url.endsWith('/bruff-live')).length,1);
 assert.ok(calls.every(x=>!/(?:cloudflare|bruff-drafts|generation|send|prepare|import_candidates)/u.test(x.url)));assert.equal(data.importResult,undefined);for(const item of data.items)assert.equal(item.value,item.source.quote);
 const dto=await createFanContext(scope,state);assert.equal(dto.items.length,2);
});
