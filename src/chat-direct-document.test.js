import test from 'node:test';
import assert from 'node:assert/strict';
import {scopeKey,validateSuggestions,materializeSuggestion} from './chat-direct.js';

const scope=scopeKey({actor:'worker',workspace:'agency',account:'model-A',fanId:'123'}),revision='context';
const documentSource=(patch={})=>({kind:'document',verified:true,modelId:'model-A',referenceId:'guide-section-2',label:'Guía revisada · Saludos',version:2,...patch});
const candidate=source=>({id:'document-example',english:'Good morning! How is your day?',spanish:'¡Buenos días! ¿Cómo va tu día?',source});
const validate=(source,options={})=>validateSuggestions({scope,revision,candidates:[candidate(source)]},{scope,revision,...options});

test('documentary provenance preserves its actual reference without fabricating conversation or message IDs',()=>{
 const source=documentSource(),before=structuredClone(source),[row]=validate(source);
 assert.deepEqual(row.source,{kind:'document',verified:true,modelId:'model-A',referenceId:'guide-section-2',label:'Guía revisada · Saludos',version:'2'});
 assert.equal(Object.hasOwn(row.source,'conversationId'),false);assert.equal(Object.hasOwn(row.source,'messageId'),false);
 assert.deepEqual(materializeSuggestion(row),{english:row.english,spanish:row.spanish,complete:true,missing:[],errors:{}});
 source.referenceId='changed';source.label='Changed';assert.equal(row.source.referenceId,before.referenceId);assert.equal(row.source.label,before.label);assert.ok(Object.isFrozen(row.source));
});

test('document references need explicit model, reference, label and immutable version',()=>{
 for(const field of ['modelId','referenceId','label','version']){const source=documentSource();delete source[field];assert.throws(()=>validate(source),field)}
 for(const patch of [{referenceId:''},{referenceId:'https://example.test/reference'},{referenceId:'../guide'},{label:''},{label:'   '},{label:'line\nbreak'},{label:'x'.repeat(201)},{version:0},{version:''},{verified:false},{verified:'true'},{status:'draft'}])assert.throws(()=>validate(documentSource(patch)),JSON.stringify(patch));
 assert.equal(validate(documentSource({version:'edition-3'}))[0].source.version,'edition-3');
});

test('documentary source uses the same explicit source-model allowlist as conversation evidence',()=>{
 const foreign=documentSource({modelId:'model-B'});assert.throws(()=>validate(foreign));assert.throws(()=>validate(foreign,{allowedSourceModels:['model-A']}));
 assert.equal(validate(foreign,{allowedSourceModels:new Set(['model-B'])})[0].source.modelId,'model-B');
});

test('mixed or conflicting provenance is rejected instead of silently inventing one source kind',()=>{
 for(const patch of [{conversationId:'conversation-1'},{messageId:'message-1'},{conversationId:undefined},{messageId:null},{kind:'conversation'},{kind:'unknown'},{kind:null}])assert.throws(()=>validate(documentSource(patch)),JSON.stringify(patch));
 const conversation={verified:true,modelId:'model-A',conversationId:'conversation-1',messageId:'message-1',version:1};
 for(const kind of [undefined,'conversation'])for(const referenceId of ['document-1',undefined,null])assert.throws(()=>validate({...conversation,kind,referenceId}));
});

test('legacy conversation source snapshots remain unchanged and explicit conversation kind is retained',()=>{
 const conversation={verified:true,modelId:'model-A',conversationId:'conversation-1',messageId:'message-1',version:1,label:''};
 assert.deepEqual(validate(conversation)[0].source,{...conversation,version:'1'});
 assert.deepEqual(validate({...conversation,kind:'conversation'})[0].source,{kind:'conversation',...conversation,version:'1'});
});

test('only safe document reference fields survive; approval-looking metadata cannot replace required provenance',()=>{
 const row=validate(documentSource({token:'untrusted',url:'https://example.test/track',localPath:'/private/source',approval:{signed:true},reviewedBy:'owner'}))[0];
 assert.deepEqual(Object.keys(row.source).sort(),['kind','verified','modelId','referenceId','label','version'].sort());
 const source=documentSource({approved:true,signed:true,reviewedBy:'owner'});delete source.referenceId;assert.throws(()=>validate(source));
 // Structural acceptance does not authenticate a document, its contents or its
 // reviewer; the server must approve the stored reference before returning it.
 assert.equal(validate(documentSource())[0].source.verified,true);
});
