import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeKey,contextRevision,validateSuggestions,materializeSuggestion,applyDraftInsertion} from './chat-direct.js';

const target={actor:'worker',workspace:'agency',account:'model-A',fanId:'123'},scope=scopeKey(target),revision='fixture-context';
const candidate=(patch={})=>({id:'example-1',english:'Hello! How is your day? 🙂',spanish:'¡Hola! ¿Cómo va tu día? 🙂',source:{verified:true,modelId:'model-A',conversationId:'conversation-1',messageId:'message-1',version:1},variables:[],...patch});
const envelope=(candidates=[],patch={})=>({scope,revision,candidates,...patch});
const validate=(payload,options={})=>validateSuggestions(payload,{scope,revision,...options});
function biography(){const english="I'm Nora, 29, from Lima. Nice to meet you 🙂";return candidate({english,spanish:'Soy {{NAME}}, tengo {{AGE}} y soy de {{CITY}}. Encantada 🙂',variables:[{key:'NAME',label:'NOMBRE',type:'text',start:english.indexOf('Nora'),end:english.indexOf('Nora')+4},{key:'AGE',label:'EDAD',type:'bioAge',start:english.indexOf('29'),end:english.indexOf('29')+2},{key:'CITY',label:'CIUDAD',type:'text',start:english.indexOf('Lima'),end:english.indexOf('Lima')+4}]})}
const insertion=patch=>applyDraftInsertion({scope,currentScope:scope,token:'choice-1',consumed:new Set(),text:'Hello 🙂  ',currentText:'',expectedText:'',mode:'replace',enabled:true,...patch});

test('scope identity includes actor, agency, model and fan, with no ID coercion or ambiguous delimiters',()=>{
 assert.equal(scope,JSON.stringify(['worker','agency','model-A','123']));for(const field of Object.keys(target)){assert.equal(scopeKey({...target,[field]:''}),null);assert.notEqual(scopeKey({...target,[field]:'different'}),scope)}assert.equal(scopeKey({...target,fanId:123}),null);assert.equal(scopeKey({...target,account:' model-A '}),null);assert.notEqual(scopeKey({...target,account:'a,b',fanId:'c'}),scopeKey({...target,account:'a',fanId:'b,c'}));
});

test('context revision ignores polling timestamps, array/key order and rotating media URLs',()=>{
 const message={id:'1',text:'Good morning 🙂',isFromMe:false,price:0,isOpened:false,createdAt:'2026-11-06T10:00:00Z',media:[{id:'10',type:'photo',canView:true,url:'signed-first',preview:'thumb-first'}]};const second={id:'2',text:'Hello!',isFromMe:true,price:0,media:[]};
 const first=contextRevision([message,second]);assert.equal(first,contextRevision([second,{...message,checkedAt:99,observedAt:'later',media:[{...message.media[0],url:'signed-new',preview:'thumb-new'}]}]));assert.equal(first,contextRevision([message,second,message]));assert.equal(contextRevision(null),contextRevision([]));assert.ok(!first.includes(message.text));
});

test('actual conversation, payment, direction and media changes invalidate prior suggestions',()=>{
 const base={id:'1',text:'Hello',isFromMe:false,price:0,isOpened:false,isTip:false,createdAt:'2026-11-06T10:00:00Z',mediaCount:1,media:[{id:'10',type:'video',duration:12}]},before=contextRevision([base]);
 for(const change of [{id:'2'},{text:'hello'},{text:'Hello '},{isFromMe:true},{price:5},{price:null},{isOpened:true},{isTip:true},{createdAt:'2026-11-06T10:00:01Z'},{mediaCount:2},{media:[{id:'11',type:'video',duration:12}]},{media:[{id:'10',type:'photo',duration:12}]},{media:[{id:'10',type:'video',duration:15}]}])assert.notEqual(contextRevision([{...base,...change}]),before,JSON.stringify(change));
 assert.notEqual(contextRevision([base,{id:'2',text:'New',isFromMe:false}]),before);
});

test('confirmation of the same message invalidates suggestions without polling or signed-URL noise',()=>{
 const pending={id:'1',text:'Hello',isFromMe:true,delivery:'sending',media:[{id:'10',type:'photo',url:'first'}]},before=contextRevision([pending]);
 assert.equal(contextRevision([{...pending,checkedAt:123,media:[{...pending.media[0],url:'rotated'}]}]),before);
 assert.notEqual(contextRevision([{...pending,delivery:undefined}]),before);
 assert.notEqual(contextRevision([{...pending,delivery:'uncertain'}]),before);
});

test('zero, one or two documented answers remain zero, one or two; the helper never fills a quota',()=>{
 assert.deepEqual(validate(envelope()),[]);for(const length of [1,2,3])assert.equal(validate(envelope(Array.from({length},(_,index)=>candidate({id:'example-'+index,english:'Documented text '+index,spanish:'Texto documentado '+index})))).length,length);assert.throws(()=>validate(envelope(Array.from({length:4},(_,index)=>candidate({id:'example-'+index})))));
});

test('scope or context mismatch rejects an otherwise valid response before exposing its candidates',()=>{
 for(const field of Object.keys(target))assert.throws(()=>validate(envelope([candidate()],{scope:scopeKey({...target,[field]:'other'})})));assert.throws(()=>validate(envelope([candidate()],{revision:'old'})));assert.throws(()=>validate(envelope([candidate()]),{scope:'invalid'}));
});

test('every candidate needs explicit verified model, conversation, message and immutable source version',()=>{
 const base=candidate();for(const field of ['modelId','conversationId','messageId','version']){const source={...base.source};delete source[field];assert.throws(()=>validate(envelope([candidate({source})])),field)}for(const patch of [{verified:false},{verified:'true'},{version:0},{version:''},{status:'pending'}])assert.throws(()=>validate(envelope([candidate({source:{...base.source,...patch}})])));
 assert.throws(()=>validate(envelope([candidate({verified:true,source:{label:'Unverified note',ref:'somewhere'}})])));assert.equal(validate(envelope([candidate({source:{...base.source,version:'v2'}})]))[0].source.version,'v2');
});

test('source-model permission defaults to the current model; cross-model evidence requires an explicit allowlist',()=>{
 const foreign=candidate({source:{...candidate().source,modelId:'model-B'}});assert.throws(()=>validate(envelope([foreign])));assert.throws(()=>validate(envelope([foreign]),{allowedSourceModels:['model-A']}));assert.equal(validate(envelope([foreign]),{allowedSourceModels:new Set(['model-B'])}).length,1);assert.throws(()=>validate(envelope([candidate()]),{allowedSourceModels:[]}));
});

test('exact duplicate answers collapse while conflicting identity, translation or annotations are rejected',()=>{
 const original=candidate(),sameText=candidate({id:'another-source',source:{...original.source,messageId:'message-2'}});assert.equal(validate(envelope([original,original,sameText])).length,1);assert.throws(()=>validate(envelope([original,candidate({english:'Different'})])));assert.throws(()=>validate(envelope([original,candidate({id:'other',spanish:'Different translation'})])));
 assert.equal(validate(envelope([original,candidate({id:'case-sensitive',english:'hello! How is your day? 🙂'})])).length,2);
});

test('validated candidates are immutable snapshots detached from mutable adapter objects',()=>{
 const input=biography(),result=validate(envelope([input]));input.english='Changed';input.source.messageId='different';input.variables[0].start=0;assert.equal(result[0].english,biography().english);assert.equal(result[0].source.messageId,'message-1');assert.notEqual(result[0].variables[0].start,0);assert.ok(Object.isFrozen(result)&&Object.isFrozen(result[0])&&Object.isFrozen(result[0].source)&&Object.isFrozen(result[0].variables));
});

test('variable annotations need valid ordered nonoverlapping spans and an exact Spanish placeholder key set',()=>{
 const source=biography();for(const variables of [[{...source.variables[0],start:-1}],[{...source.variables[0],end:10000}],[source.variables[1],source.variables[0]],[source.variables[0],{...source.variables[1],start:source.variables[0].start}],[{...source.variables[0],key:'bad key'}],[{...source.variables[0],type:'auto-guess'}]])assert.throws(()=>validate(envelope([candidate({...source,variables})])));
 for(const spanish of ['No variables','{{NAME}} {{AGE}} {{WRONG}}','{{NAME}} {{AGE}} {{CITY}} {{EXTRA}}','{{NAME}} {{AGE}} {{city}}'])assert.throws(()=>validate(envelope([candidate({...source,spanish})])));
});

test('shared biography keys have one label and type across all candidate cards',()=>{
 const first=candidate({english:'I am 29.',spanish:'Tengo {{AGE}}.',variables:[{key:'AGE',label:'EDAD',type:'bioAge',start:5,end:7}]}),second=candidate({id:'example-2',english:'My age is 29.',spanish:'Mi edad es {{AGE}}.',variables:[{key:'AGE',label:'EDAD',type:'bioAge',start:10,end:12}]});
 assert.equal(validate(envelope([first,second])).length,2);
 for(const patch of [{label:'AÑOS'},{type:'text'}])assert.throws(()=>validate(envelope([first,{...second,variables:[{...second.variables[0],...patch}]}])));
});

test('manual spans use UTF-16 boundaries without splitting an emoji or changing neighboring text',()=>{
 const english='Hi Nora🙂!',base={key:'NAME',label:'NOMBRE',type:'text',start:3,end:7},original=candidate({english,spanish:'Hola {{NAME}}🙂!',variables:[base]});
 const [validated]=validate(envelope([original]));assert.equal(materializeSuggestion(validated,{NAME:'Eva'}).english,'Hi Eva🙂!');
 for(const span of [{...base,end:8},{...base,start:8,end:10}])assert.throws(()=>validate(envelope([candidate({...original,variables:[span]})])));
});

test('a canonical scope alone cannot authorize an absent or unknown source-model allowlist entry',()=>{
 const payload=envelope([candidate()]);assert.throws(()=>validate(payload,{allowedSourceModels:[null]}));assert.throws(()=>validate(payload,{allowedSourceModels:['model-B']}));assert.throws(()=>validate(payload,{allowedSourceModels:{'model-A':true}}));
 assert.equal(validate(payload,{allowedSourceModels:['model-A']}).length,1);
});

test('age annotations and completed values require adult integer ages from 18 through 100',()=>{
 const original=biography();for(const value of ['17','101','twenty','18.5','029','-20']){const result=materializeSuggestion(original,{NAME:'Nora',AGE:value,CITY:'Lima'});if(value==='029'){assert.equal(result.complete,true);continue}assert.equal(result.complete,false,value);assert.ok(result.errors.AGE)}for(const value of ['18','100',29])assert.equal(materializeSuggestion(original,{NAME:'Nora',AGE:value,CITY:'Lima'}).complete,true);
 const bad=biography();bad.english=bad.english.replace('29','17');assert.throws(()=>validate(envelope([bad])));
});

test('missing biography values remain explicit placeholders and cannot be marked complete',()=>{
 const original=biography(),result=materializeSuggestion(original,{NAME:'Eva'});assert.equal(result.english,"I'm Eva, [EDAD], from [CIUDAD]. Nice to meet you 🙂");assert.equal(result.spanish,'Soy Eva, tengo [EDAD] y soy de [CIUDAD]. Encantada 🙂');assert.deepEqual(result.missing,['AGE','CITY']);assert.equal(result.complete,false);assert.equal(original.english,biography().english);
});

test('materializing only replaces annotated spans and preserves all outside punctuation, whitespace and emojis',()=>{
 const original=biography(),before=JSON.stringify(original),result=materializeSuggestion(original,{NAME:'Éva',AGE:'31',CITY:'Porto'});assert.equal(result.english,"I'm Éva, 31, from Porto. Nice to meet you 🙂");assert.equal(result.spanish,'Soy Éva, tengo 31 y soy de Porto. Encantada 🙂');assert.equal(result.complete,true);assert.deepEqual(result.errors,{});assert.equal(JSON.stringify(original),before);
 const untouched=candidate({english:'  hello 🙂\nSee you!  ',spanish:'  hola 🙂\n¡Hasta luego!  '});assert.deepEqual(materializeSuggestion(untouched),{english:untouched.english,spanish:untouched.spanish,complete:true,missing:[],errors:{}});
});

test('unknown manual fields, oversized values and control/template injection cannot produce a copy-ready result',()=>{
 for(const values of [{NAME:'Eva',AGE:'31',CITY:'Porto',EXTRA:'hidden'},{NAME:'x'.repeat(121),AGE:'31',CITY:'Porto'},{NAME:'Eva\nOther',AGE:'31',CITY:'Porto'},{NAME:'{{CITY}}',AGE:'31',CITY:'Porto'},[],null])assert.equal(materializeSuggestion(biography(),values).complete,false);
});

test('a shared biography key can replace repeated declared spans without automatic editing elsewhere',()=>{
 const english='Nora says hi. Nora is my name.',variables=[{key:'NAME',label:'NOMBRE',type:'text',start:0,end:4},{key:'NAME',label:'NOMBRE',type:'text',start:14,end:18}],original=candidate({english,spanish:'{{NAME}} saluda. Mi nombre es {{NAME}}.',variables});const [validated]=validate(envelope([original]));assert.equal(materializeSuggestion(validated,{NAME:'Eva'}).english,'Eva says hi. Eva is my name.');
});

test('check only reports the guarded current draft and never consumes the choice or sends anything',()=>{
 const consumed=new Set(),result=insertion({mode:'check',currentText:'Existing draft',consumed,text:undefined});assert.deepEqual(result,{status:'checked',currentText:'Existing draft'});assert.equal(consumed.size,0);assert.equal(insertion({mode:'check',enabled:false}).status,'blocked');assert.equal(insertion({mode:'check',locked:true}).status,'blocked');
});

test('typing or changing fan/model/worker between check and confirmation prevents stale insertion',()=>{
 const checked=insertion({mode:'check',currentText:'Original'});assert.equal(insertion({mode:'append',currentText:'Original edited',expectedText:checked.currentText}).status,'conflict');for(const field of Object.keys(target))assert.equal(insertion({currentScope:scopeKey({...target,[field]:'other'})}).status,'stale');assert.equal(insertion({scope:null}).status,'stale');
});

test('append and replace preserve exact whitespace/emojis, and repeated consumed tokens cannot insert twice',()=>{
 const consumed=new Set(),append=insertion({mode:'append',currentText:'Draft  \n',expectedText:'Draft  \n',consumed});assert.deepEqual(append,{status:'ready',text:'Draft  \n\nHello 🙂  '});assert.equal(consumed.size,0);consumed.add('choice-1');assert.equal(insertion({consumed}).status,'duplicate');assert.equal(insertion({consumed:['choice-1']}).status,'duplicate');assert.equal(insertion({consumed:'choice-1'}).status,'duplicate');assert.deepEqual(insertion({currentText:'Old',expectedText:'Old'}),{status:'ready',text:'Hello 🙂  '});
});

test('insertion enforces send availability/edit locks and the full draft length without silently trimming',()=>{
 for(const patch of [{enabled:false},{enabled:'true'},{locked:true},{token:''},{text:''},{text:'x'.repeat(10001)},{mode:'send'},{currentText:null}])assert.equal(insertion(patch).status,'blocked');assert.equal(insertion({mode:'append',currentText:'x'.repeat(9990),expectedText:'x'.repeat(9990)}).reason,'limit');assert.equal(insertion({text:'x'.repeat(10000)}).text.length,10000);
});
