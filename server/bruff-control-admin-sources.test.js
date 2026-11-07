import test from 'node:test';
import assert from 'node:assert/strict';
import {OwnerSourceError,prepareSourceApproval,approveSource} from '../supabase/functions/bruff-control/admin-sources.js';

const actor='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',w='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',c='cccccccc-cccc-4ccc-8ccc-cccccccccccc',sourceId='dddddddd-dddd-4ddd-8ddd-dddddddddddd',other='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const example=patch=>({id:sourceId,version:3,state:'draft',trigger:'How is your day?',english:'  hello! 🙂\nHow is your day?  ',spanish:'  ¡Hola! 🙂\n¿Cómo va tu día?  ',reference_id:'document.greeting',label:'Reviewed neutral greeting',source_version:'v2',...patch});
const knowledge=patch=>({id:sourceId,version:3,state:'draft',kind:'style_rule',key:null,text:'  Keep replies concise.\nAsk a neutral question.  ',reference_id:'document.style',label:'Owner style notes',source_version:'v2',...patch});
const snapshot=entry=>({actorId:actor,workspaceId:w,modelId:c,items:[entry],total:1,limit:200,complete:true,savedId:null});
const errorCode=(code,status)=>error=>error instanceof OwnerSourceError&&error.code===code&&(status===undefined||error.status===status);
function fixture(kind='example',options={}){
 const calls=[],state={entry:kind==='example'?example():knowledge()};
 const list=async selectedKind=>{calls.push({op:'list',kind:selectedKind});return options.list?options.list(state):snapshot(state.entry)};
 const save=async(selectedKind,id,expected,value)=>{
  calls.push({op:'save',kind:selectedKind,id,expected,value});
  if(options.save)return options.save(state,{kind:selectedKind,id,expected,value});
  state.entry={...state.entry,state:'verified',version:expected+1};
  return {...snapshot(state.entry),savedId:id};
 };
 const args={kind,sourceId,expected:3,actor,w,c,list};
 return {args,save,calls,state};
}

test('preparing a review is a scoped read that preserves exact stored text without approving anything',async()=>{
 const f=fixture(),prepared=await prepareSourceApproval(f.args);
 assert.deepEqual({...prepared,reviewHash:undefined},{actorId:actor,workspaceId:w,modelId:c,kind:'example',entry:example(),reviewHash:undefined,requiresApproval:true});
 assert.match(prepared.reviewHash,/^[a-f0-9]{64}$/u);assert.equal(Object.isFrozen(prepared),true);assert.equal(Object.isFrozen(prepared.entry),true);
 assert.deepEqual(f.calls,[{op:'list',kind:'example'}]);assert.equal(f.state.entry.state,'draft');
 assert.equal((await prepareSourceApproval(f.args)).reviewHash,prepared.reviewHash);
});

test('review hashes bind every stored example field, source identity, scope and revision',async()=>{
 const f=fixture(),original=await prepareSourceApproval(f.args);
 for(const patch of [{trigger:'Another question?'},{english:'Another original.'},{spanish:'Otra traducción.'},{reference_id:'another.reference'},{label:'Another source'},{source_version:'v3'},{state:'verified'}]){
  const changed=fixture('example');changed.state.entry=example(patch);assert.notEqual((await prepareSourceApproval(changed.args)).reviewHash,original.reviewHash,JSON.stringify(patch));
 }
 for(const [key,value]of [['actor',other],['w',other],['c',other]]){
  const args={...f.args,[key]:value,list:async()=>({...snapshot(example()),actorId:key==='actor'?value:actor,workspaceId:key==='w'?value:w,modelId:key==='c'?value:c})};
  assert.notEqual((await prepareSourceApproval(args)).reviewHash,original.reviewHash,key);
 }
 const revised=fixture();revised.args.expected=4;revised.state.entry=example({version:4});assert.notEqual((await prepareSourceApproval(revised.args)).reviewHash,original.reviewHash);
 const otherId=fixture();otherId.args.sourceId=other;otherId.state.entry=example({id:other});assert.notEqual((await prepareSourceApproval(otherId.args)).reviewHash,original.reviewHash);
 const normalized=await prepareSourceApproval({...f.args,actor:actor.toUpperCase(),w:w.toUpperCase(),c:c.toUpperCase(),sourceId:sourceId.toUpperCase()});assert.equal(normalized.reviewHash,original.reviewHash);
});

test('example approval rereads its source and saves only its exact stored fields plus the review state',async()=>{
 const f=fixture(),prepared=await prepareSourceApproval(f.args),result=await approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save});
 assert.deepEqual(f.calls.map(call=>call.op),['list','list','save']);
 assert.deepEqual(f.calls[2],{op:'save',kind:'example',id:sourceId,expected:3,value:{trigger:example().trigger,english:example().english,spanish:example().spanish,referenceId:'document.greeting',label:'Reviewed neutral greeting',sourceVersion:'v2',state:'verified',reviewed:true}});
 assert.equal(result.items[0].version,4);assert.equal(result.items[0].state,'verified');assert.equal(result.savedId,sourceId);
 assert.equal(result.items[0].english,example().english);assert.equal(result.items[0].spanish,example().spanish);
});

test('knowledge approval preserves rule, boundary and fact structure without the example-only reviewed RPC field',async()=>{
 for(const entry of [knowledge(),knowledge({kind:'boundary',text:'Do not promise anything without evidence.'}),knowledge({kind:'model_fact',key:'language',text:'English and Spanish.'})]){
  const f=fixture('knowledge');f.state.entry=entry;const prepared=await prepareSourceApproval(f.args),result=await approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save});
  assert.equal(result.items[0].state,'verified');assert.deepEqual(f.calls[2].value,{kind:entry.kind,key:entry.key,text:entry.text,referenceId:entry.reference_id,label:entry.label,sourceVersion:entry.source_version,state:'verified'});
  assert.equal(Object.hasOwn(f.calls[2].value,'reviewed'),false);assert.equal(f.calls[2].kind,'knowledge');
 }
 const f=fixture('knowledge'),initial=await prepareSourceApproval(f.args);f.state.entry=knowledge({kind:'model_fact',key:'language',text:knowledge().text});assert.notEqual((await prepareSourceApproval(f.args)).reviewHash,initial.reviewHash);
 f.state.entry=knowledge({text:'A changed rule.'});assert.notEqual((await prepareSourceApproval(f.args)).reviewHash,initial.reviewHash);
});

test('missing explicit review, malformed hashes and invalid request structure stop before reading or writing',async()=>{
 const f=fixture();
 for(const patch of [{kind:'all'},{sourceId:'bad'},{actor:'bad'},{w:null},{c:'bad'},{expected:0},{expected:-1},{expected:3.5},{expected:'3'},{expected:Number.MAX_SAFE_INTEGER},{list:null}])await assert.rejects(()=>prepareSourceApproval({...f.args,...patch}),errorCode('SOURCE_INPUT',400));
 for(const patch of [{reviewed:false,reviewHash:'a'.repeat(64)},{reviewed:'true',reviewHash:'a'.repeat(64)},{reviewed:true,reviewHash:'bad'},{reviewed:true,reviewHash:'A'.repeat(64)},{reviewed:true,reviewHash:'a'.repeat(64),save:null}])await assert.rejects(()=>approveSource({...f.args,save:f.save,...patch}),errorCode('SOURCE_REVIEW',400));
 assert.equal(f.calls.length,0);
});

test('scope changes, absent sources, stale versions and ambiguous rows cannot produce a review',async()=>{
 for(const patch of [{actorId:other},{workspaceId:other},{modelId:other}]){const f=fixture('example',{list:()=>({...snapshot(example()),...patch})});await assert.rejects(()=>prepareSourceApproval(f.args),errorCode('SOURCE_SCOPE',403));assert.equal(f.calls.length,1)}
 for(const items of [[],[example({id:other})],[example({version:4})]]){const f=fixture('example',{list:()=>({...snapshot(example()),items})});await assert.rejects(()=>prepareSourceApproval(f.args),errorCode('SOURCE_CHANGED',409));assert.equal(f.calls.length,1)}
 for(const items of [[example(),example()],[example(),example({id:sourceId.toUpperCase()})],Array(201).fill(example()),[example({id:'bad'})]]){const f=fixture('example',{list:()=>({...snapshot(example()),items})});await assert.rejects(()=>prepareSourceApproval(f.args),errorCode('SOURCE_UNAVAILABLE',503));assert.equal(f.calls.length,1)}
});

test('archived entries require restoration and verified entries never cause a second approval write',async()=>{
 const archived=fixture();archived.state.entry=example({state:'archived'});await assert.rejects(()=>prepareSourceApproval(archived.args),errorCode('SOURCE_REVIEW',409));
 const f=fixture();f.state.entry=example({state:'verified'});const prepared=await prepareSourceApproval(f.args);assert.equal(prepared.requiresApproval,false);
 await assert.rejects(()=>approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save}),errorCode('SOURCE_REVIEW',409));assert.equal(f.calls.filter(call=>call.op==='save').length,0);
});

test('fresh rereads catch same-version text mutations, changed references and hashes from another scope',async()=>{
 for(const patch of [{english:'An unexpected changed reply.'},{reference_id:'other.source'},{source_version:'v9'},{state:'verified'}]){
  const f=fixture(),prepared=await prepareSourceApproval(f.args);f.state.entry=example(patch);
  await assert.rejects(()=>approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save}),errorCode('SOURCE_CHANGED',409));assert.equal(f.calls.filter(call=>call.op==='save').length,0);
 }
 const f=fixture(),prepared=await prepareSourceApproval(f.args);f.state.entry=example({version:4});await assert.rejects(()=>approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save}),errorCode('SOURCE_CHANGED',409));
 const foreign=fixture('example',{list:()=>({...snapshot(example()),workspaceId:other})});await assert.rejects(()=>approveSource({...foreign.args,reviewHash:prepared.reviewHash,reviewed:true,save:foreign.save}),errorCode('SOURCE_SCOPE',403));
});

test('malformed source fields, template variables and invalid fact keys never reach approval',async()=>{
 for(const patch of [{trigger:''},{english:'x'.repeat(10001)},{spanish:'bad\u0000text'},{reference_id:'https://example.test'},{source_version:'0'},{label:'x'.repeat(201)},{english:'Hello {{NAME}}'},{state:'approved'}]){const f=fixture();f.state.entry=example(patch);await assert.rejects(()=>prepareSourceApproval(f.args),errorCode('SOURCE_UNAVAILABLE',503))}
 for(const patch of [{kind:'system_prompt'},{kind:'model_fact',key:null},{key:'age'},{text:'{{NAME}}'},{kind:'model_fact',key:'salary'},{label:'x'.repeat(161)}]){const f=fixture('knowledge');f.state.entry=knowledge(patch);await assert.rejects(()=>prepareSourceApproval(f.args),errorCode('SOURCE_UNAVAILABLE',503))}
});

test('revocation, CAS conflicts and duplicate facts propagate once without a retry or fabricated success',async()=>{
 for(const code of ['42501','40001','23505']){
  const failure=Object.assign(new Error('Fictional database failure'),{code});
  const f=fixture('knowledge',{save:()=>{throw failure}}),prepared=await prepareSourceApproval(f.args);
  await assert.rejects(()=>approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save}),error=>error===failure);assert.equal(f.calls.filter(call=>call.op==='save').length,1);assert.equal(f.calls.filter(call=>call.op==='list').length,2);
 }
 let revoked=false;const failure=Object.assign(new Error('Fictional revoked read'),{code:'42501'}),f=fixture('example',{list:()=>{if(revoked)throw failure;return snapshot(example())}}),prepared=await prepareSourceApproval(f.args);revoked=true;
 await assert.rejects(()=>approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save}),error=>error===failure);assert.equal(f.calls.filter(call=>call.op==='save').length,0);
});

test('save responses must confirm exact source, version, state, text and references before success',async()=>{
 for(const patch of [{savedId:other},{actorId:other},{workspaceId:other},{modelId:other},{items:[example({id:other,state:'verified',version:4})]},{items:[example({version:3,state:'verified'})]},{items:[example({version:4,state:'draft'})]},{items:[example({version:4,state:'verified',english:'Unexpected replacement'})]},{items:[example({version:4,state:'verified',source_version:'v3'})]}]){
  const f=fixture('example',{save:()=>({...snapshot(example({state:'verified',version:4})),savedId:sourceId,...patch})}),prepared=await prepareSourceApproval(f.args);
  await assert.rejects(()=>approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save}),error=>error instanceof OwnerSourceError);assert.equal(f.calls.filter(call=>call.op==='save').length,1);
 }
});

test('an approval result cannot be replayed with its old version, even with an identical review receipt',async()=>{
 const f=fixture(),prepared=await prepareSourceApproval(f.args);
 await approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save});
 await assert.rejects(()=>approveSource({...f.args,reviewHash:prepared.reviewHash,reviewed:true,save:f.save}),errorCode('SOURCE_CHANGED',409));assert.equal(f.calls.filter(call=>call.op==='save').length,1);
});
