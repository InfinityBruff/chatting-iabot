import test from 'node:test';
import assert from 'node:assert/strict';
import {memoryQuestionKind,validateMemoryQuestion,emptyFanMemory,reviewMemoryCandidates,mergeMemoryCandidates,editMemoryItem} from './fan-memory.js';
import {fanMemorySnapshot} from '../supabase/functions/bruff-control/admin-teaching.js';
import {validatedFanMemory} from '../supabase/functions/bruff-drafts/generation.js';
import {validateFanMemory} from '../src/fan-memory-source.js';
const actor='10000000-0000-4000-8000-000000000001',w='20000000-0000-4000-8000-000000000001',c='30000000-0000-4000-8000-000000000001';
const scope={workspaceId:w,creatorId:c,fanId:'77'},qAt='2026-11-08T00:00:00.000Z',at='2026-11-08T00:01:00.000Z';
const question=()=>({messageId:'100',quote:'Where are you from?',at:qAt,author:'model',kind:'where_from'});
const candidate=()=>({key:'contextual_fixture',category:'personal_context',value:'Canada',messageId:'101',quote:'Canada',question:question()});
const transcript=()=>[{...scope,id:'100',author:'model',text:question().quote,at:qAt},{...scope,id:'101',author:'fan',text:'Canada',at}];
const item=()=>({...scope,key:'contextual_fixture',category:'personal_context',value:'Canada',status:'pending',origin:'analysis',pinned:false,source:{messageId:'101',quote:'Canada',at,author:'fan',question:question()}});
const snapshot=()=>({actorId:actor,workspaceId:w,creatorId:c,fanId:'77',binding:'acct_fixture',version:1,contextRevision:'a'.repeat(64),items:[(({workspaceId,creatorId,fanId,...value})=>value)(item())],coverage:{historyComplete:false,cursor:null,pages:1,recentCheckedAt:at,historyCheckedAt:at,messagesObserved:2,contextLimited:false}});
const readers=[value=>fanMemorySnapshot(value,actor,w,c,'77'),value=>validatedFanMemory(value,{actor,w,c,fan:'77'}),value=>validateFanMemory(value,{actor,workspace:w,account:c,fanId:'77'})];

test('one closed question grammar recognizes targeted neutral EN/ES questions and never third-person, mixed or invented contexts',()=>{
 for(const[quote,kind]of [['where are u from??','where_from'],['¿De dónde eres?','where_from'],['Where do you live?','where_based'],['En qué ciudad vives?','where_based'],["What’s your name?",'preferred_name'],['Cómo te puedo llamar?','preferred_name'],['Which language do you prefer?','language'],['Qué idioma hablas?','language'],['What do you enjoy doing?','interests']])assert.equal(memoryQuestionKind(quote),kind,quote);
 for(const quote of ['Where is she from?','I live in Canada.','Where are you from? What is your name?', 'Where are you from????','"Where are you from?"','Where are you from? https://private.test','What is your medical diagnosis?','Where are you from? '.repeat(8),'Where are you\nfrom?'])assert.equal(memoryQuestionKind(quote),null,quote);
});

test('context evidence is preserved through pending merge, confirmation, manual correction and deletion suppression without invented declarations',()=>{
 const selected=reviewMemoryCandidates(scope,[candidate()],transcript());assert.equal(selected[0].status,'pending');assert.equal(selected[0].value,'Canada');assert.deepEqual(selected[0].source.question,question());
 const initial=mergeMemoryCandidates(scope,emptyFanMemory(scope),selected,0);
 for(const action of ['confirm','pin','correct']){const edited=editMemoryItem(scope,initial,candidate().key,action,1,...(action==='correct'?['A reviewed broad location']:[]));assert.deepEqual(edited.items[0].source.question,question());assert.equal(initial.items[0].status,'pending')}
 const deleted=editMemoryItem(scope,initial,candidate().key,'delete',1),again=mergeMemoryCandidates(scope,deleted,selected,2);assert.equal(again.items.length,0);assert.ok(again.suppressedKeys.includes(candidate().key));
});

test('context evidence accepts literal two-letter responses only with a verified targeted question, keeping legacy three-character rules',()=>{
 for(const [quote,q,category]of [['UK',question(),'personal_context'],['Li',{...question(),quote:'What is your name?',kind:'preferred_name'},'preferred_name']]){
  const next={...candidate(),quote,value:quote,category,question:q},messages=[{...transcript()[0],text:q.quote},{...transcript()[1],text:quote}];assert.equal(reviewMemoryCandidates(scope,[next],messages)[0].value,quote);
  assert.throws(()=>reviewMemoryCandidates(scope,[{...next,quote:'A',value:'A'}],[messages[0],{...messages[1],text:'A'}]));
  const {question:removed,...legacy}=next;assert.throws(()=>reviewMemoryCandidates(scope,[legacy],messages));
 }
});

test('a source question must match actual same-scope model evidence before the fan response, never caller-selected narrative or another fan',()=>{
 for(const change of [rows=>rows.filter(row=>row.id!=='100'),rows=>rows.map(row=>row.id==='100'?{...row,author:'fan'}:row),rows=>rows.map(row=>row.id==='100'?{...row,text:'Where do you live?'}:row),rows=>rows.map(row=>row.id==='100'?{...row,fanId:'78'}:row),rows=>rows.map(row=>row.id==='100'?{...row,creatorId:actor}:row),rows=>rows.map(row=>row.id==='100'?{...row,at}:row)])assert.throws(()=>reviewMemoryCandidates(scope,[candidate()],change(transcript())));
 assert.throws(()=>reviewMemoryCandidates(scope,[{...candidate(),value:'I live permanently in Canada.'}],transcript()));
});

test('MCP, generation and client projections retain exact contextual evidence and still accept old records without question',()=>{
 for(const read of readers){const raw=snapshot(),next=read(raw);assert.deepEqual(next.items[0].source.question,question());next.items[0].source.question.quote='Changed local copy';assert.equal(raw.items[0].source.question.quote,question().quote);
  const legacy=snapshot();delete legacy.items[0].source.question;assert.equal(Object.hasOwn(read(legacy).items[0].source,'question'),false);
  raw.items[0].source.quote='UK';raw.items[0].value='UK';assert.equal(read(raw).items[0].value,'UK');
 }
});

test('all projections reject false kind/category, wrong authors, future/equal or invalid dates, unsafe quotes, bad IDs and injected question metadata',()=>{
 const mutate=[s=>s.items[0].source.question.kind='where_based',s=>s.items[0].category='language',s=>s.items[0].source.author='model',s=>s.items[0].source.question.author='fan',s=>s.items[0].source.question.messageId='0100',s=>s.items[0].source.question.messageId='101',s=>s.items[0].source.question.at=at,s=>s.items[0].source.question.at='2026-11-09T00:00:00Z',s=>s.items[0].source.question.at='2026-02-31T00:00:00Z',s=>s.items[0].source.question.quote='I am from Canada.',s=>s.items[0].source.question.quote='Where are you from? https://private.test',s=>s.items[0].source.question.workspaceId=actor,s=>s.items[0].source.question=null,s=>s.items[0].value='A different inferred answer',s=>s.items[0].source.quote='My password is private',s=>s.items[0].source.quote='A'];
 for(const change of mutate)for(const read of readers){const raw=snapshot();change(raw);assert.throws(()=>read(raw))}
 assert.equal(validateMemoryQuestion({messageId:'legacy',quote:'Neutral legacy text',author:'model',at},'interests'),null);
});
