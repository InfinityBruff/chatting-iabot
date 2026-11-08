import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {isNeutralMemoryQuote,validateCitedCandidates,prepareCitedCandidates,citedCandidateKey} from '../supabase/functions/bruff-memory/cited-candidates.js';
import {emptyFanContext,importCitedFanCandidates,editFanContext,createFanContext,syncFanContext} from '../supabase/functions/bruff-memory/fan-context.js';
import {createFanMemoryStore} from '../supabase/functions/bruff-memory/fan-memory-store.js';
import {createMemoryHandler} from '../supabase/functions/bruff-memory/handler.js';
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',w='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444';
const scope={ownerId:owner,actorId:owner,workspaceId:w,creatorId:c,binding:'acct_fictional',fanId:'55'},at='2026-11-08T09:00:00.000Z';
const candidate=(quote='I work as a carpenter.',category='personal_context',message_id='7')=>({category,message_id,quote});
const message=(text='I work as a carpenter.',extra={})=>({id:'7',text,isFromMe:false,createdAt:at,...extra});
const page=(messages=[message()])=>({messages,hasMore:true,cursor:'older-page'});
const json=(data,status=200,headers={})=>Response.json(data,{status,headers});

test('positive category policies accept ordinary literal declarations and neutral questions without inferring fields',()=>{
 const positives=[['personal_context','I work as a carpenter.'],['personal_context','Trabajo como electricista.'],['personal_context','I live in Madrid.'],['personal_context','Trabajo en marketing.'],['language','I prefer Spanish.'],['interests','I enjoy hiking.'],['preferred_name','You can call me Alex.'],['availability','I am usually free on weekends.'],['commitment',"I'll message you tomorrow."],['pending_question','How was your day?'],['pending_question','¿Cómo fue tu día?'],['commitment','I’ll message you tomorrow.']];
 for(const[category,quote]of positives){const value=candidate(quote,category);assert.equal(isNeutralMemoryQuote(quote,category),true,quote);assert.deepEqual(validateCitedCandidates([value]),[value]);}
 assert.equal(isNeutralMemoryQuote('I live in Madrid.','language'),false);assert.equal(isNeutralMemoryQuote('I prefer Spanish.','personal_context'),false);
});

test('generic personal claims, sensitive facts, credentials and misleading coarse locations are rejected by positive policy',()=>{
 for(const quote of ['Tengo asma','Soy budista','Tengo diecisiete años','Mi clave es abcdefghij','I live in poverty','Vivo en un refugio','I work as an escort','I am a medical patient','My religion is Buddhism','I have seventeen years','I am lonely and wealthy','I bought a video','I like secret fetish content','I love music and politics','I work in money laundering']){
  assert.equal(isNeutralMemoryQuote(quote),false,quote);assert.throws(()=>validateCitedCandidates([candidate(quote)]),error=>error.status===400,quote);
 }
 for(const category of ['preferred_name','language','interests','availability','pending_question','commitment','personal_context'])assert.throws(()=>validateCitedCandidates([candidate('Tengo asma',category)]));
 for(const quote of ['My name is Ana and I have lupus','My name is Ana and I am twelve','My name is Ana and my PIN is abcdef','My name is Ana has lupus','My name is Ana y tengo doce','My name is Ana-and-I-have-lupus'])assert.throws(()=>validateCitedCandidates([candidate(quote,'preferred_name')]),quote);
 for(const quote of ['My name is John Smith.','You can call me Anne-Marie.','Me llamo María José.'])assert.equal(validateCitedCandidates([candidate(quote,'preferred_name')])[0].quote,quote);
});

test('URLs, contacts, addresses, numbers, unsupported categories and extra fields never become candidates',()=>{
 for(const quote of ['I live in Madrid https://example.test','I live in user@example.test','I live in @myhandle','I work as a designer +1 (555) 123-4567','I live in Calle Mayor 12','I am 17 years old','I live in Madrid\n',' I live in Madrid.','I live in Madrid.\u0000','I live in Madrid. '.repeat(20)])assert.equal(isNeutralMemoryQuote(quote),false,quote);
 const good=candidate();for(const value of [{...good,value:'invented'},{...good,status:'confirmed'},{...good,source:{messageId:'7'}},{...good,actor:owner},{...good,category:'spending'},{...good,message_id:7},{...good,message_id:'07'},{...good,message_id:'0'},{...good,message_id:'1'.repeat(25)}])assert.throws(()=>validateCitedCandidates([value]));
 assert.throws(()=>validateCitedCandidates(Array(21).fill(good)));assert.deepEqual(validateCitedCandidates([]),[]);
});

test('server evidence requires an exact quote, actual fan authorship and a valid UTC timestamp',async()=>{
 const good=candidate(),rows=[message('Hello! I work as a carpenter. How are you?')],items=await prepareCitedCandidates(scope,[good],rows);
 assert.equal(items[0].value,good.quote);assert.equal(items[0].source.quote,good.quote);assert.equal(items[0].source.author,'fan');assert.equal(items[0].source.at,at);assert.equal(items[0].status,'pending');assert.equal(items[0].origin,'analysis');assert.equal(items[0].pinned,false);
 for(const row of [message('I work as a designer.'),message(undefined,{isFromMe:true}),message(undefined,{isFromMe:null}),message(undefined,{pending:true}),message(undefined,{delivery:'pending'}),message(undefined,{createdAt:'not-a-date'}),message(undefined,{createdAt:'2026-02-31T09:00:00.000Z'})])await assert.rejects(prepareCitedCandidates(scope,[good],[row]));
 await assert.rejects(prepareCitedCandidates(scope,[good],[]));await assert.rejects(prepareCitedCandidates(scope,[good],[message(),message()]));
});

test('proof cannot cross agency, model, fan or binding and input cannot choose the stored scope',async()=>{
 for(const[key,value]of[['workspaceId',other],['creatorId',other],['modelId',other],['fanId','56'],['binding','acct_other']])await assert.rejects(prepareCitedCandidates(scope,[candidate()],[message(undefined,{[key]:value})]));
 await assert.rejects(prepareCitedCandidates({...scope,ownerId:'invalid'},[],[]));
 const item=(await prepareCitedCandidates(scope,[candidate()],[message()]))[0];assert.equal(item.workspaceId,w);assert.equal(item.creatorId,c);assert.equal(item.fanId,'55');
});

test('stable source keys include the server scope and exact semantics but not the auditing actor',async()=>{
 const first=await citedCandidateKey(scope,candidate());assert.match(first,/^cited_[a-f0-9]{64}$/u);assert.ok(first.length<=80);
 assert.equal(await citedCandidateKey({...scope,actorId:other},candidate()),first);
 for(const[key,value]of[['ownerId',other],['workspaceId',other],['creatorId',other],['fanId','56'],['binding','acct_other']])assert.notEqual(await citedCandidateKey({...scope,[key]:value},candidate()),first);
 assert.notEqual(await citedCandidateKey(scope,candidate('I work as a carpenter')),first);
});

test('one atomic import preserves literal text and scan coverage, with exact duplicate and noop accounting',async()=>{
 const original=emptyFanContext(scope),before=JSON.stringify(original),result=await importCitedFanCandidates(scope,original,[candidate(),candidate()],[message()],0);
 assert.deepEqual(result.importResult,{added:1,reused:1});assert.equal(result.record.memory.version,1);assert.equal(JSON.stringify(original),before);assert.deepEqual(result.record.scan,original.scan);assert.equal(result.record.memory.coverage,original.memory.coverage);
 assert.equal((await createFanContext(scope,result.record)).contextRevision,(await createFanContext(scope,original)).contextRevision);
 const repeat=await importCitedFanCandidates(scope,result.record,[candidate()],[message()],1);assert.deepEqual(repeat.importResult,{added:0,reused:1});assert.deepEqual(repeat.record,result.record);
 const empty=await importCitedFanCandidates(scope,result.record,[],[message()],1);assert.deepEqual(empty.importResult,{added:0,reused:0});assert.deepEqual(empty.record,result.record);
});

test('reviewed, manual and pinned entries are preserved and recognized semantically across legacy keys',async()=>{
 const seed=await syncFanContext(scope,emptyFanContext(scope),{messages:[message('Call me Alex.')],hasMore:false,cursor:null});
 for(const action of ['confirm','correct','pin']){
  const edited=editFanContext(scope,seed,{key:'preferred_name',action,expected_version:1,...(action==='correct'?{value:'Owner name'}:{})}),result=await importCitedFanCandidates(scope,edited,[candidate('Call me Alex.','preferred_name')],[message('Call me Alex.')],2);
  assert.deepEqual(result.record,edited);assert.deepEqual(result.importResult,{added:0,reused:1});
 }
});

test('stable category and message tombstones prevent resurrecting a removed quote through another subquote',async()=>{
 const quote='I speak Spanish.',input=candidate(quote,'language'),first=await importCitedFanCandidates(scope,emptyFanContext(scope),[input],[message(quote)],0),removed=editFanContext(scope,first.record,{key:first.record.memory.items[0].key,action:'delete',expected_version:1});
 assert.ok(removed.memory.suppressedKeys.includes('cited_source_language_7'));
 const variant=candidate('I speak Spanish','language');assert.notEqual(await citedCandidateKey(scope,input),await citedCandidateKey(scope,variant));
 const repeated=await importCitedFanCandidates(scope,removed,[variant],[message(quote)],2);assert.deepEqual(repeated.importResult,{added:0,reused:1});assert.deepEqual(repeated.record,removed);
 const legacy=await syncFanContext(scope,emptyFanContext(scope),{messages:[message('Call me Alex.')],hasMore:false,cursor:null}),deleted=editFanContext(scope,legacy,{key:'preferred_name',action:'delete',expected_version:1}),resurrect=await importCitedFanCandidates(scope,deleted,[candidate('Call me New.','preferred_name','8')],[message('Call me New.',{id:'8'})],2);assert.equal(resurrect.record.memory.items.length,0);assert.equal(resurrect.importResult.reused,1);
});

test('stale versions, mixed bad evidence and storage caps fail without modifying any memory or scan',async()=>{
 const initial=emptyFanContext(scope),before=JSON.stringify(initial);await assert.rejects(importCitedFanCandidates(scope,initial,[candidate()],[message()],1),e=>e.status===409);assert.equal(JSON.stringify(initial),before);
 await assert.rejects(importCitedFanCandidates(scope,initial,[candidate(),candidate('I live in Madrid.','personal_context','8')],[message(),message('I live in Paris.',{id:'8'})],0));assert.equal(JSON.stringify(initial),before);
 const first=await importCitedFanCandidates(scope,initial,[candidate()],[message()],0),full=structuredClone(first.record),item=full.memory.items[0];full.memory.items=Array.from({length:100},(_,index)=>({...structuredClone(item),key:'entry_'+index,source:{...item.source,messageId:String(index+100)}}));
 await assert.rejects(importCitedFanCandidates(scope,full,[candidate()],[message()],1),e=>e.status===409&&e.code==='MEMORY_CONTEXT_LIMIT');assert.equal(full.memory.items.length,100);
});

function fixture(options={}){
 let state=options.state?structuredClone(options.state):emptyFanContext(scope),binding=scope.binding,ownerChecks=0;const calls=[],writes=[];
 const handler=createMemoryHandler({url:'https://auth.test',anonKey:'public',enabled:true,fanMemoryStore:{read:async()=>structuredClone(state),write:async(s,expected,next)=>{if(options.conflict||state.memory.version!==expected)throw Object.assign(Error('CAS'),{code:'MEMORY_CONFLICT',status:409});state=structuredClone(next);writes.push({scope:s,expected,next});return structuredClone(state);}},fetcher:async(url,init)=>{
  const body=init.body?JSON.parse(init.body):null;calls.push({url,body});assert.equal(init.headers.Authorization,'Bearer owner-session');
  if(url.endsWith('/auth/v1/user'))return json({id:options.reader?other:owner,email_confirmed_at:at});
  if(url.endsWith('/bruff_live_authorize'))return json(binding);
  if(url.endsWith('/bruff_fan_memory_scope'))return json({actorId:options.reader?other:owner,ownerId:owner,workspaceId:w,creatorId:c,binding:scope.binding});
  if(url.endsWith('/bruff_ai_models')){ownerChecks++;if(ownerChecks===options.revokeOwnerAt)return json({code:'42501'},403);return json({actorId:owner,workspaces:[{id:w,models:[{id:c}]}]});}
  if(url.endsWith('/bruff-live')){assert.equal(body.operation,'messages');assert.equal(body.background,true);assert.equal(body.conversation_id,'55');if(options.onPage)state=options.onPage(state);if(options.revokeBinding)binding='acct_other';if(options.providerStatus)return json({error:'private provider detail'},options.providerStatus,{'Retry-After':'17'});return json(options.envelope||{data:page(options.messages||[message()])});}
  throw Error('Unexpected route');
 }});
 const run=(extra={})=>handler(new Request('https://edge.test',{method:'POST',headers:{Authorization:'Bearer owner-session','Content-Type':'application/json'},body:JSON.stringify({operation:'fan_memory_import_candidates',workspace_id:w,creator_id:c,conversation_id:'55',expected_version:state.memory.version,candidates:[candidate()],...extra})}));
 return{run,calls,writes,get state(){return state;}};
}

test('handler re-reads exactly the selected page and returns pending memory plus a truthful import receipt',async()=>{
 const f=fixture(),response=await f.run({cursor:'opaque&older'}),data=await response.json();assert.equal(response.status,200);assert.deepEqual(data.importResult,{added:1,reused:0});assert.equal(data.version,1);assert.equal(data.items[0].value,candidate().quote);assert.equal(data.items[0].status,'pending');assert.equal(data.coverage.pages,0);assert.equal(data.coverage.historyComplete,false);assert.equal(f.writes.length,1);
 assert.deepEqual(f.calls.find(x=>x.url.endsWith('/bruff-live')).body,{workspace_id:w,creator_id:c,operation:'messages',conversation_id:'55',background:true,cursor:'opaque&older'});assert.equal(f.calls.filter(x=>x.url.endsWith('/bruff_ai_models')).length,3);
 assert.ok(f.calls.every(x=>!/(?:cloudflare|bruff-drafts|generation_|send|prepare|autopilot)/u.test(x.url)));assert.equal(response.headers.get('Cache-Control'),'no-store');
 const noop=await f.run({cursor:null});assert.equal(noop.status,200);const repeated=await noop.json();assert.deepEqual(repeated.importResult,{added:0,reused:1});assert.equal(repeated.version,1);assert.equal(f.writes.length,1);
});

test('import rejects readers and injected or malformed arguments before source reads or writes',async()=>{
 const reader=fixture({reader:true});assert.equal((await reader.run()).status,403);assert.equal(reader.writes.length,0);assert.ok(!reader.calls.some(x=>x.url.endsWith('/bruff-live')));
 for(const patch of [{expected_version:'0'},{expected_version:-1},{expected_version:Number.MAX_SAFE_INTEGER},{cursor:'https://foreign.test'},{cursor:''},{candidates:[{...candidate(),value:'invented'}]},{candidates:[candidate('Tengo asma')]},{scan:'recent'},{actorId:owner},{candidates:Array(21).fill(candidate())}]){const f=fixture();assert.equal((await f.run(patch)).status,400);assert.equal(f.calls.length,0);assert.equal(f.writes.length,0);}
 const wrongOperation=fixture();assert.equal((await wrongOperation.run({operation:'fan_memory_read',candidates:[]})).status,400);assert.equal(wrongOperation.calls.length,0);
});

test('missing, wrong-author or cross-scope source pages cannot write candidates',async()=>{
 for(const options of [{messages:[message('Other text.')]},{messages:[message(undefined,{isFromMe:true})]},{envelope:{actorId:other,data:page()}},{envelope:{data:{...page(),actorId:other}}},{envelope:{data:{...page(),fanId:'56'}}},{envelope:{data:{...page(),hasMore:true,cursor:null}}}]){const f=fixture(options);assert.ok([400,403,503].includes((await f.run()).status));assert.equal(f.writes.length,0);}
});

test('CAS conflicts, concurrent noop edits and owner/binding revocation never return successful stale imports',async()=>{
 const stale=fixture();assert.equal((await stale.run({expected_version:1})).status,409);assert.ok(!stale.calls.some(x=>x.url.endsWith('/bruff-live')));
 const conflict=fixture({conflict:true});assert.equal((await conflict.run()).status,409);assert.equal(conflict.writes.length,0);
 const initial=(await importCitedFanCandidates(scope,emptyFanContext(scope),[candidate()],[message()],0)).record,noop=fixture({state:initial,onPage:state=>({...state,memory:{...state.memory,version:state.memory.version+1}})});assert.equal((await noop.run()).status,409);assert.equal(noop.writes.length,0);
 for(const options of [{revokeOwnerAt:2},{revokeBinding:true}]){const f=fixture(options),response=await f.run();assert.equal(response.status,403);assert.equal(f.writes.length,0);assert.equal((await response.json()).items,undefined);}
 const after=fixture({revokeOwnerAt:3}),response=await after.run();assert.equal(response.status,403);assert.equal(after.writes.length,1);assert.equal((await response.json()).items,undefined);
});

test('rate limits and unavailable sources preserve state and never retry the provider read or write',async()=>{
 for(const status of [429,503]){const f=fixture({providerStatus:status}),response=await f.run();assert.equal(response.status,status);assert.equal(f.writes.length,0);assert.equal(f.calls.filter(x=>x.url.endsWith('/bruff-live')).length,1);const data=await response.json();assert.ok(!JSON.stringify(data).includes('private provider detail'));if(status===429)assert.equal(response.headers.get('Retry-After'),'17');}
});

test('real SQLite current-row adapter persists cited state, preserves coverage and rejects stale cross-scope CAS',async()=>{
 const db=new DatabaseSync(':memory:');db.exec(await readFile(new URL('../supabase/migrations/turso/202611080003_fan_context.sql',import.meta.url),'utf8'));
 const typed=value=>typeof value==='number'?{type:'integer',value:String(value)}:{type:'text',value};
 const fetcher=async(url,init)=>{assert.equal(url,'https://fixture.turso.io/v2/pipeline');const body=JSON.parse(init.body),{sql,args}=body.requests[0].stmt,statement=db.prepare(sql),rows=statement.all(...args.map(x=>x.type==='integer'?Number(x.value):x.value)),cols=statement.columns().map(x=>({name:x.name}));return json({results:[{type:'ok',response:{type:'execute',result:{cols,rows:rows.map(row=>cols.map(col=>typed(row[col.name]))),affected_row_count:db.prepare('SELECT changes() AS n').get().n}}},{type:'ok',response:{type:'close'}}]});};
 const store=createFanMemoryStore({url:'libsql://fixture.turso.io',token:'fictional-token',fetcher});
 try{const original=await store.read(scope),imported=await importCitedFanCandidates(scope,original,[candidate()],[message()],0);await store.write(scope,0,imported.record);const saved=await store.read(scope);assert.equal(saved.memory.items[0].value,candidate().quote);assert.equal(saved.memory.version,1);assert.deepEqual(saved.scan,original.scan);await assert.rejects(store.write(scope,0,imported.record),e=>e.code==='MEMORY_CONFLICT');for(const[key,value]of[['ownerId',other],['workspaceId',other],['creatorId',other],['binding','acct_other'],['fanId','56']])assert.equal((await store.read({...scope,[key]:value})).memory.version,0,key);}finally{db.close();}
});
