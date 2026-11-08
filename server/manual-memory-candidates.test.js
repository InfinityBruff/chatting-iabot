import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareManualCitedCandidates} from '../supabase/functions/bruff-memory/manual-candidates.js';
import {normalizeFanMemoryTimestamp,validateCitedCandidates,prepareCitedCandidates} from '../supabase/functions/bruff-memory/cited-candidates.js';
import {extractContextualFanCandidates} from '../supabase/functions/bruff-memory/contextual-candidates.js';
import {validateMemoryQuestion} from './fan-memory.js';
const owner='11111111-1111-4111-8111-111111111111',w='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444',other='22222222-2222-4222-8222-222222222222';
const scope={ownerId:owner,actorId:owner,workspaceId:w,creatorId:c,binding:'acct_fictional',fanId:'55'},time=seconds=>new Date(Date.UTC(2026,0,1,10,0,seconds)).toISOString();
const message=(id,text,isFromMe,seconds,extra={})=>({id:String(id),text,isFromMe,createdAt:time(seconds),...extra});
const candidate=(quote='in mountains of Colorado',category='personal_context',extra={})=>({category,message_id:'2',quote,question_message_id:'1',...extra});
const page=(answer='A few ordinary details; in mountains of Colorado.',question='where are u from??')=>[message('2',answer,false,20,{createdAt:'2026-01-01T10:00:20+00:00'}),message('1',question,true,10,{createdAt:'2026-01-01T10:00:10+00:00'})];

test('source UTC Z and zero-offset timestamps normalize without accepting impossible calendars or other offsets',()=>{
 for(const[value,expected]of [['2026-01-01T10:00:00Z','2026-01-01T10:00:00.000Z'],['2026-01-01T10:00:00+00:00','2026-01-01T10:00:00.000Z'],['2024-02-29T10:00:00.12+00:00','2024-02-29T10:00:00.120Z'],['2026-01-01T10:00:00.123456Z','2026-01-01T10:00:00.123Z']])assert.equal(normalizeFanMemoryTimestamp(value),expected);
 for(const value of ['2026-02-31T10:00:00Z','2025-02-29T10:00:00+00:00','2026-01-01T24:00:00Z','2026-01-01T10:00:60Z','2026-13-01T10:00:00Z','2026-01-01T10:00:00+01:00','2026-01-01T10:00:00-00:00','2026-01-01',' 2026-01-01T10:00:00Z',null])assert.equal(normalizeFanMemoryTimestamp(value),null,value);
});

test('optional question IDs preserve the old positive policy and permit only coherent closed contextual fragments',()=>{
 const paired=candidate('UK');assert.deepEqual(validateCitedCandidates([paired]),[paired]);
 const plain={category:'personal_context',message_id:'2',quote:'I live in Colorado.'};assert.deepEqual(validateCitedCandidates([plain]),[plain]);assert.throws(()=>validateCitedCandidates([{...plain,quote:'Colorado'}]));
 for(const patch of [{question_message_id:'02'},{question_message_id:'2'},{question_message_id:null},{question_message_id:1},{question_message_id:'1',category:'availability',quote:'I am free tomorrow.'},{question_message_id:'1',quote:'private password abcdef'},{question_message_id:'1',source:{author:'fan'}}])assert.throws(()=>validateCitedCandidates([{...candidate(),...patch}]));
});

test('the old preparer normalizes zero-offset dates and never silently ignores new question metadata',async()=>{
 const plain={category:'personal_context',message_id:'2',quote:'I live in Colorado.'},rows=page('I live in Colorado.');const result=await prepareCitedCandidates(scope,[plain],rows);assert.equal(result[0].source.at,'2026-01-01T10:00:20.000Z');assert.equal(result[0].value,plain.quote);await assert.rejects(prepareCitedCandidates(scope,[candidate()],rows));
 await assert.rejects(prepareCitedCandidates(scope,[plain],[{...rows[0],createdAt:'2026-02-31T10:00:20+00:00'}]));
});

test('an owner-selected literal fragment can preserve real paired context omitted by automatic prefix rules',async()=>{
 const rows=page(),before=JSON.stringify(rows),automatic=await extractContextualFanCandidates(scope,rows.map(row=>({...row,createdAt:normalizeFanMemoryTimestamp(row.createdAt)})));assert.equal(automatic.items.length,0);
 const items=await prepareManualCitedCandidates(scope,[candidate()],rows),item=items[0];assert.equal(items.length,1);assert.equal(item.value,'in mountains of Colorado');assert.equal(item.source.quote,item.value);assert.equal(item.source.author,'fan');assert.deepEqual(item.source.question,{messageId:'1',quote:'where are u from??',at:'2026-01-01T10:00:10.000Z',author:'model',kind:'where_from'});assert.equal(item.source.at,'2026-01-01T10:00:20.000Z');assert.equal(item.status,'pending');assert.equal(item.origin,'analysis');assert.equal(item.pinned,false);assert.ok(!JSON.stringify(item).includes('ordinary details'));assert.equal(JSON.stringify(rows),before);assert.deepEqual(validateMemoryQuestion(item.source,item.category),item.source.question);assert.match(item.key,/^manual_[a-f0-9]{64}$/u);assert.ok(item.key.length<=80);
});

test('context preserves origin versus based questions without reconstructing a sentence, price or payment',async()=>{
 for(const[question,kind]of [['Where are you from?','where_from'],['Where do you live?','where_based']]){const item=(await prepareManualCitedCandidates(scope,[candidate('UK')],page('UK',question)))[0];assert.equal(item.value,'UK');assert.equal(item.source.quote,'UK');assert.equal(item.source.question.kind,kind);assert.equal(Object.hasOwn(item,'nationality'),false);assert.equal(Object.hasOwn(item,'paid'),false);assert.equal(Object.hasOwn(item,'price'),false);}
 for(const[question,quote,category]of [['What should I call you?','Al','preferred_name'],['Which language do you prefer?','English','language'],['What are your hobbies?','hiking and reading','interests']]){const item=(await prepareManualCitedCandidates(scope,[candidate(quote,category)],page(quote,question)))[0];assert.equal(item.value,quote);assert.equal(item.source.quote,quote);assert.deepEqual(validateMemoryQuestion(item.source,category),item.source.question);}
});

test('a selected question must exist, target the fan, match category and precede the actual fan answer',async()=>{
 for(const rows of [page(undefined,'Where is your friend from?'),page(undefined,'Where are you from and how old are you?'),[...page().filter(row=>row.id!=='1')],page().map(row=>row.id==='1'?{...row,isFromMe:false}:row),page().map(row=>row.id==='2'?{...row,isFromMe:true}:row),page().map(row=>row.id==='1'?{...row,pending:true}:row),page().map(row=>row.id==='2'?{...row,delivery:'pending'}:row)])await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],rows));
 await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],page(undefined,'Which language do you prefer?')));await assert.rejects(prepareManualCitedCandidates(scope,[candidate('in mountains of Colorado')],page('in mountains of Oregon')));
});

test('media, empty messages and other observed messages are adjacency barriers, never filtered away',async()=>{
 for(const barrier of [message('3','Hello',true,15),message('3',null,true,15),message('3','',false,15),message('3','Pending',true,15,{pending:true})])await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],[...page(),barrier]));
 const tie=page().map(row=>row.id==='2'?{...row,createdAt:'2026-01-01T10:00:10Z'}:row);await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],tie));await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],[...page(),message('3','Other event',false,20)]));
 const reversed=page().map(row=>row.id==='2'?{...row,createdAt:'2026-01-01T10:00:05Z'}:row);await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],reversed));
});

test('explicit minor indicators reject the raw source without retaining or outputting that datum',async()=>{
 for(const text of ["I'm 17, in mountains of Colorado.",'I am 17 in mountains of Colorado.','I am 17 from Colorado, in mountains of Colorado.','I am seventeen and live in mountains of Colorado.','Tengo diecisiete, in mountains of Colorado.','Soy menor, in mountains of Colorado.'])await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],page(text)),error=>error.status===400);
 const item=(await prepareManualCitedCandidates(scope,[candidate()],page('I am 28, in mountains of Colorado.')))[0];assert.equal(item.source.quote,'in mountains of Colorado');assert.ok(!item.source.quote.includes('28'));
});

test('the full bounded transcript is checked for duplicates, malformed timestamps and cross-scope echoes',async()=>{
 const rows=page();await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],[...rows,rows[0]]));await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],rows.map(row=>row.id==='2'?{...row,createdAt:'2026-02-31T10:00:20+00:00'}:row)));
 for(const[field,value]of[['workspaceId',other],['creatorId',other],['modelId',other],['binding','acct_other'],['fanId','56']])await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],rows.map(row=>row.id==='2'?{...row,[field]:value}:row)));
 await assert.rejects(prepareManualCitedCandidates({...scope,ownerId:'invalid'},[candidate()],rows));await assert.rejects(prepareManualCitedCandidates(scope,[candidate()],rows.map(row=>row.id==='2'?{...row,id:'02'}:row)));
});

test('up to two fixed pages and twenty candidates are bounded, including the backward-compatible unpaired path',async()=>{
 const rows=Array.from({length:398},(_,index)=>message(String(index+1),'Ordinary unrelated message',false,index));rows.push(message('399','Where are you from?',true,398),message('400','Colorado',false,399));
 const selected={category:'personal_context',message_id:'400',quote:'Colorado',question_message_id:'399'};assert.equal((await prepareManualCitedCandidates(scope,Array(20).fill(selected),rows)).length,20);await assert.rejects(prepareManualCitedCandidates(scope,Array(21).fill(selected),rows));await assert.rejects(prepareManualCitedCandidates(scope,[selected],[...rows,message('401','Extra',false,400)]));
 const unpaired={category:'personal_context',message_id:'400',quote:'I live in Colorado.'},full=rows.map(row=>row.id==='400'?{...row,text:unpaired.quote}:row),plain=await prepareManualCitedCandidates(scope,[unpaired],full);assert.equal(plain[0].value,unpaired.quote);assert.equal(Object.hasOwn(plain[0].source,'question'),false);
});

test('keys are deterministic, scoped and semantic without including the auditing worker',async()=>{
 const first=(await prepareManualCitedCandidates(scope,[candidate()],page()))[0];assert.equal((await prepareManualCitedCandidates({...scope,actorId:other},[candidate()],page()))[0].key,first.key);
 for(const[field,value]of[['ownerId',other],['workspaceId',other],['creatorId',other],['binding','acct_other'],['fanId','56']])assert.notEqual((await prepareManualCitedCandidates({...scope,[field]:value},[candidate()],page()))[0].key,first.key);
 const based=(await prepareManualCitedCandidates(scope,[candidate()],page(undefined,'Where are you based?')))[0];assert.notEqual(based.key,first.key);
});
