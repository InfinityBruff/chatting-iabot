import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeKey,validateSuggestions,materializeSuggestion} from './chat-direct.js';

const scope=scopeKey({actor:'worker',workspace:'agency',account:'model-A',fanId:'123'}),revision='context';
const content=(patch={})=>({accountId:'model-A',currency:'USD',priceCents:1250,mediaIds:['501','502'],reason:'Conjunto de prueba configurado por el operador.',reference:{id:'catalog-example',version:'v1',verified:true},...patch});
const candidate=(patch={})=>({id:'one',english:'Here is the collection you asked about.',spanish:'Aquí está la colección por la que preguntaste.',source:{verified:true,modelId:'model-A',conversationId:'origin',messageId:'message',version:'1'},...patch});
const validate=candidates=>validateSuggestions({scope,revision,candidates},{scope,revision});

test('one optional content proposal shares the same three options with independent text alternatives',()=>{
 const rows=validate([candidate({id:'text'}),candidate({id:'bundle',content:content()}),candidate({id:'other',english:'How has your day been?',spanish:'¿Qué tal ha ido tu día?'})]);
 assert.equal(rows.length,3);assert.equal(rows[0].content,undefined);assert.deepEqual(rows[1].content.mediaIds,['501','502']);assert.equal(rows[1].content.priceCents,1250);assert.equal(rows[2].content,undefined);
 assert.deepEqual(materializeSuggestion(rows[1]),{english:rows[1].english,spanish:rows[1].spanish,complete:true,missing:[],errors:{}});
 assert.ok(Object.isFrozen(rows[1].content));assert.ok(Object.isFrozen(rows[1].content.mediaIds));
});

test('a zero price is explicitly free while absent or null price stays unknown',()=>{
 for(const priceCents of [undefined,null,0,1999])assert.equal(validate([candidate({content:content({priceCents})})])[0].content.priceCents,priceCents??null);
 for(const priceCents of [-1,'0',NaN,Infinity,12.2,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>validate([candidate({content:content({priceCents})})]));
});

test('content references are bound to the current model even when text provenance allows another model',()=>{
 assert.throws(()=>validate([candidate({content:content({accountId:'model-B'})})]));
 assert.throws(()=>validate([candidate({content:content({currency:'EUR'})})]));
 for(const reference of [null,{}, {id:'catalog',version:'v1',verified:false},{id:'catalog',version:0,verified:true}])assert.throws(()=>validate([candidate({content:content({reference})})]));
});

test('vault references preserve order, require unique IDs and enforce the existing ten-file limit',()=>{
 for(const mediaIds of [[],['501','501'],[501],['0'],['-1'],['0501'],['https://example.test/a'],Array.from({length:11},(_,i)=>String(i+1))])assert.throws(()=>validate([candidate({content:content({mediaIds})})]));
 const ids=Array.from({length:10},(_,i)=>String(10-i));assert.deepEqual(validate([candidate({content:content({mediaIds:ids})})])[0].content.mediaIds,ids);
});

test('corpus payload cannot inject attachment capabilities, arbitrary URLs, resolved rows or upload objects',()=>{
 const raw=content({items:[{token:'untrusted'}],token:'untrusted',preview:'https://example.test/tracker',resolvedContent:{status:'resolved'},uploads:['untrusted']});
 const row=validate([candidate({content:raw,resolvedContent:{status:'resolved',items:[{token:'untrusted'}]}})])[0];
 for(const key of ['items','token','preview','resolvedContent','uploads'])assert.equal(row.content[key],undefined);
 assert.equal(row.resolvedContent,undefined);assert.deepEqual(row.content.mediaIds,['501','502']);
});

test('content rationale and optional existing category are bounded and never used as raw search commands',()=>{
 for(const patch of [{reason:''},{reason:'x'.repeat(501)},{reason:'bad\nline'},{categoryId:'anything'},{categoryId:123},{categoryId:'1&cursor=other'}])assert.throws(()=>validate([candidate({content:content(patch)})]));
 assert.equal(validate([candidate({content:content({categoryId:'42'})})])[0].content.categoryId,'42');
});

test('same message with content is a different alternative; duplicate content records never add a fourth option',()=>{
 const bundle=candidate({id:'bundle',content:content()}),rows=validate([candidate({id:'text'}),bundle,{...bundle}]);
 assert.equal(rows.length,2);assert.equal(rows[0].content,undefined);assert.ok(rows[1].content);
 assert.throws(()=>validate([bundle,candidate({id:'bundle2',english:'Another example.',spanish:'Otro ejemplo.',content:content({priceCents:0})})]));
 assert.throws(()=>validate([bundle,{...bundle,content:content({mediaIds:['503']})}]));
});
