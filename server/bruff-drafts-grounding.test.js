import test from 'node:test';
import assert from 'node:assert/strict';
import {buildGenerationContext,buildPrompt,historySnapshot,validateGeneratedOutput,PROMPT_BYTES} from '../supabase/functions/bruff-drafts/generation.js';

const example='10000000-0000-4000-8000-000000000001';
const knowledge='10000000-0000-4000-8000-000000000002';
const pool=()=>({settings:{maxResults:3},examples:[{id:example,trigger:'How was your afternoon?',english:'hey!! thanks for asking :)',spanish:'hola!! gracias por preguntar :)'}],knowledge:[]});
const message=(id,text,isFromMe,second=Number(id))=>({id:String(id),text,isFromMe,createdAt:new Date(Date.UTC(2026,0,1,12,0,second)).toISOString()});
const promptFor=(rows,p=pool())=>buildPrompt(p,historySnapshot({data:{messages:rows}}));
const candidate=(id,english,spanish='gracias por preguntar :)')=>({id:String(id),english,spanish,exampleIds:['E1'],knowledgeIds:[]});
const validate=(drafts,p=pool(),prompt=promptFor([message(1,'How was your afternoon?',false)],p),unknowns=[])=>validateGeneratedOutput({drafts,unknowns},prompt,p);

test('every alternative targets the latest fan and distinguishes style from actor evidence',()=>{
 const rows=[message(1,'I went hiking earlier.',false),message(2,'sounds peaceful!!',true),message(3,'How was your afternoon?',false)];
 const prompt=promptFor(rows),data=JSON.parse(prompt.messages[1].content).data,policy=prompt.messages[0].content;
 assert.equal(data.replyTargetIndex,2);
 assert.deepEqual(data.conversation[data.replyTargetIndex],{speaker:'fan',text:rows[2].text});
 for(const instruction of ['FAN statements and FAN memory never describe the MODEL','Every alternative is a separate complete response','not successive turns','acknowledge it naturally','brevity, casual spelling, casing and punctuation','observable participation in this chat','avoid repeating a question already answered'])assert.ok(policy.includes(instruction),instruction);
 assert.equal(buildGenerationContext(historySnapshot({data:{messages:rows}})).protocol,'bruff-generation-context-v5');
});

test('past-day and current-activity targets keep their intent without a stock chat-activity answer',()=>{
 const p=pool();p.examples[0].english='hey!! thanks :)';
 for(const target of ['How did your afternoon go?','What are you doing right now?']){
  const prompt=promptFor([message(1,'I finished my errands.',false),message(2,'nice!!',true),message(3,target,false)],p),data=JSON.parse(prompt.messages[1].content).data;
  assert.equal(data.conversation[data.replyTargetIndex].text,target);
  assert.equal(data.approvedExamples[0].reply,'hey!! thanks :)');
  const policy=prompt.messages[0].content;
  assert.ok(policy.includes('Distinguish a question about a past day from a question about current activity'));
  assert.ok(policy.includes('do not answer the former with a description of being in this chat'));
  assert.ok(policy.includes('only when the FAN explicitly asks about current activity'));
  assert.ok(policy.includes('not as a stock phrase repeated across options'));
  assert.ok(policy.includes('a single compact clause or sentence can be enough'));
 }
});

test('distinct conversational choices are optional and short approved style stays intact',()=>{
 const p=pool();p.examples[0].english='aww thanks!!';p.examples[0].spanish='ay gracias!!';
 const prompt=promptFor([message(1,'That was a kind reply, thank you.',false)],p),data=JSON.parse(prompt.messages[1].content).data;
 assert.equal(data.approvedExamples[0].reply,p.examples[0].english);
 assert.equal(data.approvedExamples[0].translation,p.examples[0].spanish);
 assert.ok(prompt.messages[0].content.includes('Changing synonyms or wording around the same acknowledgement and follow-up is not a different choice'));
 assert.ok(prompt.messages[0].content.includes('Return fewer options when distinct appropriate choices are unavailable; never pad to three'));
 assert.ok(prompt.messages[0].content.includes('actual register and approximate length'));
 const one=candidate(1,'aww thanks!!','ay gracias!!');
 assert.equal(validate([one],p,prompt).drafts.length,1);
 assert.deepEqual(validate([],p,prompt).drafts,[]);
});

test('twenty-message history retains the last fan after more than twenty later model messages',()=>{
 const rows=[message(1,'Could we chat tomorrow?',false),...Array.from({length:30},(_,i)=>message(i+2,'A previous model reply.',true))];
 rows.push({...message(99,'A pending fan message.',false,59),delivery:'pending'});
 const before=JSON.stringify(rows),history=historySnapshot({data:{messages:[...rows].reverse()}});
 assert.equal(history.length,20);
 assert.equal(history[0].id,'1');
 assert.deepEqual(history.slice(1).map(x=>x.id),Array.from({length:19},(_,i)=>String(i+13)));
 const data=JSON.parse(buildPrompt(pool(),history).messages[1].content).data;
 assert.equal(data.conversation[data.replyTargetIndex].text,'Could we chat tomorrow?');
 assert.equal(JSON.stringify(rows),before);
 assert.ok(!history.some(x=>x.id==='99'));
});

test('history without any confirmed fan still fails rather than inventing a target',()=>{
 assert.throws(()=>historySnapshot({data:{messages:[message(1,'hello',true),{...message(2,'hi',false),delivery:'pending'}]}}),{code:'AI_HISTORY_EMPTY'});
 assert.throws(()=>buildPrompt(pool(),[message(1,'hello',true)]),{code:'AI_HISTORY_EMPTY'});
});

test('long fan message retains beginning and final question with explicit omission inside 1200 characters',()=>{
 const beginning='A neutral introduction. ',question='Could we talk about hiking tomorrow?';
 const text=beginning+'neutral context '.repeat(140)+question;
 const prompt=promptFor([message(1,text,false)]),data=JSON.parse(prompt.messages[1].content).data,target=data.conversation[data.replyTargetIndex];
 assert.ok(target.text.startsWith(beginning));assert.ok(target.text.endsWith(question));
 assert.ok(target.text.includes('[... text omitted ...]'));
 assert.equal(target.truncated,true);assert.ok(target.omittedCharacters>0);
 assert.equal(target.text.length- ' [... text omitted ...] '.length+target.omittedCharacters,text.length);
 assert.ok(target.text.length<=1200);
 assert.ok(prompt.messages[0].content.includes('never infer omitted details'));
 assert.ok(new TextEncoder().encode(JSON.stringify(prompt.messages)).length<=PROMPT_BYTES);
});

test('truncation never creates half an emoji and short targets remain verbatim',()=>{
 const text='🙂'.repeat(900)+' final question?';
 const data=JSON.parse(promptFor([message(1,text,false)]).messages[1].content).data;
 const target=data.conversation[data.replyTargetIndex];
 assert.ok(target.text.endsWith(' final question?'));assert.ok(target.text.length<=1200);
 assert.equal(target.text.isWellFormed(),true);
 const short='  hey!! 🙂\nthanks  ';
 const exact=JSON.parse(promptFor([message(1,short,false)]).messages[1].content).data.conversation[0];
 assert.deepEqual(exact,{speaker:'fan',text:short});
});

test('byte compaction recomputes the target index and preserves its truncated ending',()=>{
 const p=pool();p.examples=Array.from({length:6},(_,i)=>({...p.examples[0],id:String(i),trigger:'neutral '.repeat(100),english:'short casual reply '.repeat(100),spanish:'respuesta breve '.repeat(100)}));
 const text='Context '.repeat(250)+'What would you like to discuss?';
 const rows=[message(1,text,false),...Array.from({length:19},(_,i)=>message(i+2,'Previous model turn. '.repeat(90),true))];
 const prompt=promptFor(rows,p),data=JSON.parse(prompt.messages[1].content).data;
 assert.ok(data.conversation.length<20);assert.ok(data.conversation[data.replyTargetIndex].text.endsWith('What would you like to discuss?'));
 assert.equal(data.conversation[data.replyTargetIndex].speaker,'fan');assert.equal(data.conversation[data.replyTargetIndex].truncated,true);
 assert.ok(new TextEncoder().encode(JSON.stringify(prompt.messages)).length<=PROMPT_BYTES);
});

const unsafe=[
 ['I slept well last night.','Dormí bien anoche.'],
 ['I went for a walk earlier.','Fui a dar un paseo antes.'],
 ["I've just finished working.",'Acabo de terminar de trabajar.'],
 ['My afternoon was quiet.','Mi tarde fue tranquila.'],
 ["I'm relaxing in bed.",'Estoy descansando en la cama.'],
 ['We had a busy morning.','Tuvimos una mañana ocupada.'],
 ["I didn't sleep much.",'No dormí mucho.'],
 ['hey!!','He estado trabajando esta mañana.'],
 ['thanks for asking :)','Comí en casa.'],
 ['I have been watching a film.','gracias por preguntar :)'],
 ['I worked earlier, thanks!','gracias por preguntar :)'],
 ['i was hiking this morning too','gracias por preguntar :)'],
 ['i hiked today','gracias por preguntar :)'],
 ['ive been watching a film','gracias por preguntar :)'],
 ['im working today','gracias por preguntar :)'],
 ['just relaxing','gracias por preguntar :)'],
 ['hey!!','descansando en casa'],
 ['hey!!','Viajé ayer.'],
 ['hey!!','yo viaje ayer.'],
];
for(const [english,spanish] of unsafe)test('unsupported personal activity is discarded: '+english+' / '+spanish,()=>{
 const result=validate([candidate(1,english,spanish)]);
 assert.deepEqual(result.drafts,[]);assert.equal(result.unknowns.length,1);
 assert.match(result.unknowns[0],/descartado.*actividad personal sin acreditar/u);
});

test('fan experience and matching approved style cannot accredit the model activity',()=>{
 const p=pool();p.examples[0].english='I cooked dinner earlier.';
 p.knowledge=[{id:knowledge,kind:'style_rule',text:'Use casual first-person messages.'}];
 const prompt=promptFor([message(1,'I cooked dinner earlier.',false),message(2,'How was your evening?',false)],p);
 const result=validate([candidate(1,'I cooked dinner earlier.','Cociné antes.')],p,prompt);
 assert.equal(result.drafts.length,0);assert.equal(result.unknowns.length,1);
});

test('only autobiographical draft is removed while safe alternatives retain identity and no replacements are invented',()=>{
 const drafts=[candidate(1,'hey!! thanks for asking :)'),candidate(2,'I watched a film earlier.'),candidate(3,'what would you like to chat about?')];
 const result=validate(drafts);
 assert.deepEqual(result.drafts.map(x=>x.id),['1','3']);assert.equal(result.unknowns.length,1);
 assert.equal(result.drafts[0].english,drafts[0].english);
 assert.deepEqual(result.drafts[0].exampleIds,[example]);
 assert.deepEqual(validate([]),{drafts:[],unknowns:[]});
 assert.equal(validate([drafts[0]]).drafts.length,1);assert.equal(validate([drafts[0],drafts[2]]).drafts.length,2);
});

test('discard warning stays explicit and bounded when provider already returned five unknowns',()=>{
 const unknowns=Array.from({length:5},(_,i)=>'Un dato no está disponible '+String.fromCharCode(65+i)+'.');
 const result=validate([candidate(1,'I slept earlier.')],pool(),undefined,unknowns);
 assert.equal(result.unknowns.length,5);assert.deepEqual(result.unknowns.slice(0,4),unknowns.slice(0,4));assert.match(result.unknowns[4],/descartado/u);
 assert.deepEqual(unknowns,Array.from({length:5},(_,i)=>'Un dato no está disponible '+String.fromCharCode(65+i)+'.'));
});

test('other invalid fields still reject the entire result even when one draft would be discarded',()=>{
 const bad=[{exampleIds:['E99']},{knowledgeIds:['K99']},{english:'I slept for 8 hours.'},{spanish:'Visita https://invalid.test'},{extra:true}];
 for(const patch of bad)assert.throws(()=>validate([candidate(1,'thanks!!'),{...candidate(2,'I slept earlier.'),...patch}]),{code:'AI_DRAFT_RESPONSE'});
 assert.throws(()=>validate([candidate(1,'I slept earlier.'),candidate(1,'thanks!!')]),{code:'AI_DRAFT_RESPONSE'});
 assert.throws(()=>validate([candidate(1,'I slept earlier.'),candidate(2,'I slept earlier.')]),{code:'AI_DRAFT_RESPONSE'});
});

test('courtesies, style and observable chat actions remain usable without off-chat inventions',()=>{
 const safe=[
  ["I'm sorry to hear that.",'Siento oír eso.'],
  ["I'm glad you told me.",'Me alegra que me lo cuentes.'],
  ["I'm here chatting with you!!",'estoy aquí charlando contigo!!'],
  ['I wanted to ask about your day.','Quería preguntarte por tu día.'],
  ['I got your message, thanks!!','Recibí tu mensaje, gracias!!'],
  ['I read your message.','Leí tu mensaje.'],
  ['I got your message.','Vi tu mensaje.'],
  ['I read your message.','He visto tu mensaje.'],
  ["I've been here chatting with you.",'He estado aquí charlando contigo.'],
  ['im good too!! how is your day?','¡Yo también estoy bien! ¿Cómo va tu día?'],
  ['how was your trip?','¿Cómo fue tu viaje?'],
 ];
 for(const [english,spanish] of safe){const result=validate([candidate(1,english,spanish)]);assert.equal(result.drafts.length,1,english+' / '+spanish);assert.deepEqual(result.unknowns,[])}
});
