import test from 'node:test';
import assert from 'node:assert/strict';
import {extractContextualFanCandidates,validateContextualBoundary,validateContextualBoundaryShape} from '../supabase/functions/bruff-memory/contextual-candidates.js';
import {isAllowedContextualReply,isNeutralMemoryFragment,isNeutralMemoryQuote} from '../supabase/functions/bruff-memory/cited-candidates.js';
import {memoryQuestionKind,validateMemoryQuestion} from './fan-memory.js';
const owner='11111111-1111-4111-8111-111111111111',w='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444',other='22222222-2222-4222-8222-222222222222';
const scope={ownerId:owner,workspaceId:w,creatorId:c,binding:'acct_fictional',fanId:'55'};
const at=seconds=>new Date(Date.UTC(2026,0,1,10,0,seconds)).toISOString();
const row=(id,text,isFromMe,time,extra={})=>({id:String(id),text,isFromMe,createdAt:at(time),...extra});
const pair=(question='Where are you from?',answer='Colorado',kind)=>[row('2',answer,false,20),row('1',question,true,10)];

test('one shared closed question grammar supports ordinary spelling without admitting compound or third-person questions',()=>{
 for(const[question,kind]of [['where are u from??','where_from'],['Where are you based?','where_based'],['¿De dónde eres?','where_from'],['What should I call you?','preferred_name'],['Which language do you prefer?','language'],['What are your hobbies?','interests']])assert.equal(memoryQuestionKind(question),kind);
 for(const question of ['Where is she from?','Where are you from and how old are you?','My friend asked where are you from?','Where are you from????','Where are you from? Or where do you live?'])assert.equal(memoryQuestionKind(question),null);
 assert.equal(isNeutralMemoryFragment('UK'),true);assert.equal(isNeutralMemoryQuote('UK'),false);assert.equal(isAllowedContextualReply('where_from','UK'),true);
});

test('directed place questions preserve only the neutral literal fragment of a fictional mixed self-description',async()=>{
 const answer='I am cheerful, in mountains of Colorado.',result=await extractContextualFanCandidates(scope,pair('where are u from??',answer));assert.equal(result.items.length,1);const item=result.items[0];assert.equal(item.category,'personal_context');assert.equal(item.value,'in mountains of Colorado');assert.equal(item.source.quote,item.value);assert.ok(answer.includes(item.value));assert.equal(item.source.question.kind,'where_from');assert.equal(item.source.question.quote,'where are u from??');assert.equal(item.source.question.author,'model');assert.equal(item.source.author,'fan');assert.equal(item.status,'pending');assert.equal(item.origin,'analysis');assert.equal(item.pinned,false);assert.ok(!JSON.stringify(item).includes('cheerful'));assert.match(item.key,/^context_[a-f0-9]{64}$/u);assert.ok(item.key.length<=80);assert.deepEqual(validateMemoryQuestion(item.source,item.category),item.source.question);
});

test('where_from and where_based remain separate questions without inventing residency or nationality',async()=>{
 for(const question of ['Where are you from?','Where do you live?']){const result=await extractContextualFanCandidates(scope,pair(question,'UK'));assert.equal(result.items.length,1);assert.equal(result.items[0].value,'UK');assert.equal(result.items[0].source.quote,'UK');assert.equal(result.items[0].source.question.kind,question.includes('from')?'where_from':'where_based');assert.equal(Object.hasOwn(result.items[0],'nationality'),false);assert.equal(Object.hasOwn(result.items[0],'residence'),false);assert.ok(!result.items[0].value.includes('live'));}
});

test('name, language and hobby answers must be short complete neutral answers to the matching question',async()=>{
 for(const[question,answer,category]of [['What should I call you?','Alex Smith','preferred_name'],['What is your preferred name?','Al','preferred_name'],['Which language do you prefer?','English','language'],['What are your hobbies?','hiking and reading','interests']]){const result=await extractContextualFanCandidates(scope,pair(question,answer));assert.equal(result.items.length,1,answer);assert.equal(result.items[0].category,category);assert.equal(result.items[0].value,answer);assert.equal(result.items[0].source.quote,answer);assert.deepEqual(validateMemoryQuestion(result.items[0].source,category),result.items[0].source.question);}
 for(const answer of ['My name is Ana and I have lupus','My PIN is abcdef','I am twelve','Alex, my phone is 12345678','Alex and I am tired'])assert.equal((await extractContextualFanCandidates(scope,pair('What should I call you?',answer))).items.length,0,answer);
 assert.equal((await extractContextualFanCandidates(scope,pair('What are your hobbies?','English'))).items.length,0);
});

test('third-person locations, indirect narration, relocation, denial and uncertain answers are not attributed to the fan',async()=>{
 for(const answer of ['My cousin works in Madrid.','The film was shot in Madrid.','I moved from Madrid to Paris.','I am sure Alex lives in Madrid.','I am talking to Alex in Madrid.','She lives in Colorado.','My dad lives in Colorado.','I do not live in Colorado.','If I lived in Colorado.','Maybe Colorado.','I am visiting Colorado.','I used to live in Colorado.','I live in Colorado and Montana.','I live in Colorado or Montana.','I live in Colorado, Montana.','I live in Colorado Street 12.','I read "in mountains of Colorado".'])assert.equal((await extractContextualFanCandidates(scope,pair('Where are you based?',answer))).items.length,0,answer);
 for(const answer of ['I live in Colorado.','I am based in Colorado.','I am cheerful, in mountains of Colorado.'])assert.equal((await extractContextualFanCandidates(scope,pair('Where are you based?',answer))).items.length,1,answer);
 for(const answer of ['I am 17, a person in Colorado.','I am seventeen and I live in Colorado.','I am 121 and I live in Colorado.','I am sure Alex lives in Madrid.','I am talking to Alex in Madrid.','I am 28, sure Alex lives in Madrid.','I am in Colorado and now in Madrid.','I am from Colorado and now in Madrid.','I am in Colorado, near Madrid.'])assert.equal((await extractContextualFanCandidates(scope,pair('Where are you based?',answer))).items.length,0,answer);
 const compact=await extractContextualFanCandidates(scope,pair('Where are you from?','I am 28, a person in mountains of Colorado.'));assert.equal(compact.items.length,1);assert.equal(compact.items[0].value,'in mountains of Colorado');assert.ok(!compact.items[0].source.quote.includes('28'));
});

test('pairs require strict timestamps and actual immediate observed adjacency, including nontext and pending barriers',async()=>{
 const q=row('1','Where are you from?',true,10),a=row('3','Colorado',false,20);
 for(const barrier of [row('2','Hello',true,15),row('2',null,true,15),row('2','',false,15),row('2','Waiting',true,15,{pending:true}),row('2','Waiting',true,15,{delivery:'pending'})])assert.equal((await extractContextualFanCandidates(scope,[a,barrier,q])).items.length,0);
 for(const rows of [[{...a,createdAt:q.createdAt},q],[{...a,createdAt:at(5)},q],[a,q,row('4','Another event',false,20)],[a,{...q,isFromMe:false}]])assert.equal((await extractContextualFanCandidates(scope,rows)).items.length,0);
 const normal=await extractContextualFanCandidates(scope,[a,q]);assert.equal(normal.items.length,1);assert.ok(Date.parse(normal.items[0].source.question.at)<Date.parse(normal.items[0].source.at));
});

test('page ordering is chronological, source IDs are exact and optional scope echoes cannot cross an account or fan',async()=>{
 const q=row('900719925474099300000001','Where are you from?',true,10),a=row('900719925474099300000002','Colorado',false,20),before=JSON.stringify([a,q]);const result=await extractContextualFanCandidates(scope,[a,q]);assert.equal(result.items[0].source.messageId,a.id);assert.equal(result.items[0].source.question.messageId,q.id);assert.equal(JSON.stringify([a,q]),before);
 for(const[field,value]of[['workspaceId',other],['creatorId',other],['modelId',other],['binding','acct_other'],['fanId','56']])await assert.rejects(extractContextualFanCandidates(scope,[{...a,[field]:value},q]));
 await assert.rejects(extractContextualFanCandidates(scope,[a,a,q]));await assert.rejects(extractContextualFanCandidates(scope,[{...a,id:'02'},q]));await assert.rejects(extractContextualFanCandidates(scope,[{...a,createdAt:'2026-02-31T09:00:00Z'},q]));
});

test('a boundary carries at most two closed neutral fragments of only the globally oldest fan message',async()=>{
 const raw='I am cheerful, in mountains of Colorado.',result=await extractContextualFanCandidates(scope,[row('2',raw,false,20)]),buffer=result.boundary;assert.equal(result.items.length,0);assert.equal(buffer.messageId,'2');assert.equal(buffer.at,at(20));assert.equal(buffer.candidates.length,2);assert.ok(buffer.candidates.every(candidate=>candidate.quote==='in mountains of Colorado'));assert.ok(!JSON.stringify(buffer).includes('cheerful'));assert.ok(!JSON.stringify(buffer).includes(raw));assert.ok(JSON.stringify(buffer).length<1000);assert.deepEqual(await validateContextualBoundary(scope,buffer),buffer);
 assert.equal((await extractContextualFanCandidates(scope,[row('2','Colorado',false,20),row('1','Hello',true,15)])).boundary,null);
 assert.equal((await extractContextualFanCandidates(scope,[row('3','Colorado',false,20),row('1',null,true,15)])).boundary,null);
 assert.equal((await extractContextualFanCandidates(scope,[row('2','Colorado',false,20),row('1','Unrelated',false,15)])).boundary,null);
});

test('no names, sensitive terms or mixed free text are retained without an observed matching question',async()=>{
 for(const text of ['Alex Smith','eczema','My password is abcdef','Tengo asma','My name is Ana and I am twelve','I enjoy hiking and my PIN is abcdef'])assert.equal((await extractContextualFanCandidates(scope,[row('2',text,false,20)])).boundary,null,text);
 for(const[text,kind]of [['English','language'],['hiking','interests']]){const result=await extractContextualFanCandidates(scope,[row('2',text,false,20)]);assert.equal(result.boundary.candidates.length,1);assert.equal(result.boundary.candidates[0].kind,kind);assert.equal(result.boundary.candidates[0].quote,text);}
});

test('a later older page can join only its newest neutral model question to the scoped boundary answer',async()=>{
 const initial=await extractContextualFanCandidates(scope,[row('2','I am cheerful, in mountains of Colorado.',false,20)]),result=await extractContextualFanCandidates(scope,[row('1','Where are you from?',true,10)],{boundary:initial.boundary});assert.equal(result.items.length,1);assert.equal(result.items[0].source.question.messageId,'1');assert.equal(result.items[0].source.messageId,'2');assert.equal(result.boundary,null);
 for(const rows of [[row('1','Where are you from?',true,10),row('3','Hello',true,15)],[row('1','Where are you from?',true,20)],[row('1','Where are you from?',true,25)],[row('1','Where are you from?',true,10),row('3',null,false,15)]])assert.equal((await extractContextualFanCandidates(scope,rows,{boundary:initial.boundary})).items.length,0);
});

test('boundary scope, schema, closed vocabularies and buffer limits fail closed on tampering',async()=>{
 const buffer=(await extractContextualFanCandidates(scope,[row('2','Colorado',false,20)])).boundary;
 for(const[key,value]of[['ownerId',other],['workspaceId',other],['creatorId',other],['binding','acct_other'],['fanId','56']])await assert.rejects(validateContextualBoundary({...scope,[key]:value},buffer));
 for(const patch of [{scopeHash:'bad'},{messageId:'0'},{at:'invalid'},{raw:'do not persist me'},{candidates:Array(3).fill(buffer.candidates[0])},{candidates:[{kind:'preferred_name',category:'preferred_name',quote:'Unknown Name'}]},{candidates:[{kind:'where_from',category:'personal_context',quote:'My password is abcdef'}]},{candidates:[{...buffer.candidates[0],value:'invented'}]},{candidates:[buffer.candidates[0],buffer.candidates[0]]}])assert.throws(()=>validateContextualBoundaryShape({...buffer,...patch}));
 assert.equal(validateContextualBoundaryShape(null),null);assert.equal(await validateContextualBoundary(scope,null),null);
});

test('twenty pairs fit the cap and overflow rejects instead of silently claiming exhaustive processing',async()=>{
 const rows=[];for(let index=0;index<21;index++){rows.push(row(String(index*2+1),'Where are you from?',true,index*2),row(String(index*2+2),'Colorado',false,index*2+1));}
 assert.equal((await extractContextualFanCandidates(scope,rows.slice(0,40))).items.length,20);await assert.rejects(extractContextualFanCandidates(scope,rows),error=>error.status===409&&error.code==='MEMORY_CONTEXT_LIMIT');await assert.rejects(extractContextualFanCandidates(scope,Array(201).fill(rows[0])));
});
