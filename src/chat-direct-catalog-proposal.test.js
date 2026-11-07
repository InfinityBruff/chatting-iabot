import test from 'node:test';
import assert from 'node:assert/strict';
import {catalogSelection,validateCatalogProposal,createCatalogProposal,getCatalogProposal} from './chat-direct-catalog-proposal.js';
import {createChatDirectSource} from './chat-direct-source.js';
import {scopeKey,validateChatDirectSuggestions} from './chat-direct.js';
const actor='11111111-1111-4111-8111-111111111111',workspace='22222222-2222-4222-8222-222222222222',account='33333333-3333-4333-8333-333333333333';
const at=Date.parse('2026-11-07T10:00:00Z'),context={actor,workspace,account,fanId:'99',canRead:true,canInsert:true,canVault:true,revision:'qa-revision'};context.scope=scopeKey(context);
const proposal=()=>({id:'b'.repeat(64),policyVersion:'bruff-catalog-proposal-v1',folderId:'qa-folder',mediaId:'101',priceCents:0,currency:'USD',reviewRequired:true,orderConfirmed:false,paidConfirmed:false,reason:'Propuesta de QA; orden sin confirmar.',observedCount:0,pendingOfferCount:1});
const data=()=>({actorId:actor,workspaceId:workspace,creatorId:account,fanId:'99',sendsEnabled:false,observedAt:new Date(at).toISOString(),catalog:{batchHash:'a'.repeat(64),folders:[{id:'qa-folder',name:'Script de QA',orderConfirmed:false,items:[{id:'101',type:'photo',label:'F01',durationLabel:null,referencePriceCents:0,configuredPriceCents:null}]}]},progress:{observations:[],scan:{version:1,cursor:'qa-next',historyComplete:false,recentCheckedAt:new Date(at).toISOString(),historyCheckedAt:new Date(at).toISOString(),pages:1}},proposal:proposal()});
const candidate={id:'qa-example',english:'Good morning!',spanish:'¡Buenos días!',variables:[],source:{kind:'document',modelId:account,referenceId:'qa-guide',label:'Guía de QA',version:'1',verified:true}};
const entry=()=>{const snapshot=data();return{catalogData:snapshot,catalogProposal:createCatalogProposal(snapshot,context,candidate.id,{},at)}};

test('a catalog proposal stays separate from canonical English, Spanish and source; it carries metadata provenance without fake reference',()=>{
 const original=structuredClone(candidate),state=entry(),bound=getCatalogProposal(state,candidate,context,at);assert.ok(bound);assert.deepEqual(candidate,original);assert.equal(bound.content.reference,undefined);assert.equal(bound.content.categoryId,undefined);assert.equal(bound.content.folderName,'Script de QA');assert.equal(bound.content.provenance.kind,'catalog_proposal');assert.equal(bound.content.provenance.paidConfirmed,false);assert.deepEqual(bound.content.mediaIds,['101']);assert.equal(bound.snapshot.receivedAt,at);assert.equal(bound.proposal.pendingOfferCount,1);assert.equal(bound.proposal.observedCount,0);
 assert.equal(getCatalogProposal(state,{...candidate,id:'another-option'},context,at),null);assert.equal(getCatalogProposal(state,{...candidate,content:{}},context,at),null);
});

test('unknown proposed price remains unknown; foreign media, forged purchase/order flags and unrecognized fields are refused',()=>{
 const catalog=data().catalog;for(const patch of [{mediaId:'999'},{currency:'EUR'},{reviewRequired:false},{orderConfirmed:true},{paidConfirmed:true},{priceCents:-1},{priceCents:'0'},{url:'https://invalid'}])assert.throws(()=>validateCatalogProposal({...proposal(),...patch},catalog));
 const video=structuredClone(catalog);video.folders[0].items[0].type='video';video.folders[0].items[0].referencePriceCents=null;assert.equal(validateCatalogProposal({...proposal(),priceCents:null},video).priceCents,null);assert.throws(()=>validateCatalogProposal({...proposal(),priceCents:null},catalog));
 video.folders[0].items[0].referencePriceCents=600;assert.equal(validateCatalogProposal({...proposal(),priceCents:600},video).priceCents,600);assert.throws(()=>validateCatalogProposal({...proposal(),priceCents:1000},video));
 video.folders[0].items[0].type='audio';assert.throws(()=>validateCatalogProposal({...proposal(),priceCents:600},video));assert.equal(validateCatalogProposal(null,catalog),null);
});

test('manual selection requires its real folder and forbids arbitrary request inputs',()=>{
 assert.deepEqual(catalogSelection({folderId:'qa-folder',mediaId:'101'}),{folderId:'qa-folder',mediaId:'101'});
 for(const args of [{mediaId:'101'},{folderId:'qa-folder',mediaId:101},{folderId:'qa-folder',operation:'send'},{url:'https://invalid'}])assert.throws(()=>catalogSelection(args));
});

test('snapshot expiry, future stamps, changed chat/model/batch/scan and changed content all block a bound proposal',()=>{
 assert.equal(getCatalogProposal(entry(),candidate,context,at+120001),null);assert.equal(getCatalogProposal(entry(),candidate,context,at-30001),null);
 for(const patch of [{revision:'changed'},{scope:'other-chat'},{account:actor},{canRead:false}])assert.equal(getCatalogProposal(entry(),candidate,{...context,...patch},at),null);
 const mutations=[state=>state.catalogData.catalog.batchHash='c'.repeat(64),state=>state.catalogData.progress.scan.version++,state=>state.catalogProposal.content.mediaIds=['999'],state=>state.catalogProposal.content.priceCents=600,state=>state.catalogProposal.content.folderName='Other folder',state=>state.catalogProposal.content.provenance.paidConfirmed=true,state=>state.catalogProposal.snapshot.selection={folderId:'other-folder'},state=>state.catalogData.fanId='100',state=>state.catalogProposal.content.provenance.url='https://invalid',state=>state.catalogProposal.content.attachment='not a capability',state=>state.catalogProposal.snapshot.actor='forged'];
 for(const mutate of mutations){const state=entry();mutate(state);assert.equal(getCatalogProposal(state,candidate,context,at),null)}
});

test('new source methods call only bruff-memory and bind exact chosen metadata; no history, text, URLs or generation calls',async()=>{
 const calls=[],client={functions:{invoke:async(name,options)=>{calls.push([name,options]);return{data:data()}}}},source=createChatDirectSource(client,{actor,workspace}),request={scope:context.scope,revision:context.revision,context};
 const result=await source.suggestContent({...request,folderId:'qa-folder',mediaId:'101'});assert.equal(result.proposal.id,proposal().id);
 await source.verifyContent({...request,proposalId:proposal().id,folderId:'qa-folder',mediaId:'101'});
 assert.deepEqual(calls.map(([name,{body}])=>[name,body]),[['bruff-memory',{operation:'recommend',workspace_id:workspace,creator_id:account,conversation_id:'99',folder_id:'qa-folder',media_id:'101'}],['bruff-memory',{operation:'verify_recommendation',workspace_id:workspace,creator_id:account,conversation_id:'99',folder_id:'qa-folder',media_id:'101',proposal_id:proposal().id}]]);
 await assert.rejects(source.suggestContent({...request,context:{...context,canInsert:false}}));assert.equal(calls.length,2);
});

test('source verification rejects changed proposal, foreign response and late cancellation rather than reusing old metadata',async()=>{
 const request={scope:context.scope,revision:context.revision,context,proposalId:proposal().id};let payload=data();const source=createChatDirectSource({functions:{invoke:async()=>({data:payload})}},{actor,workspace});payload.proposal.id='c'.repeat(64);await assert.rejects(source.verifyContent(request),error=>error.status===409);payload=data();payload.fanId='100';await assert.rejects(source.suggestContent(request),error=>error.status===403);
 let release;const pending=new Promise(resolve=>{release=resolve}),controller=new AbortController(),late=createChatDirectSource({functions:{invoke:()=>pending}},{actor,workspace});const call=late.suggestContent({...request,signal:controller.signal});controller.abort();release({data:data()});await assert.rejects(call,error=>error.name==='AbortError');
});

test('canonical generated validation continues to reject content injection; separate catalog metadata does not relax it',()=>{
 const generation='44444444-4444-4444-8444-444444444444',example='55555555-5555-4555-8555-555555555555',draft={id:'gen.'+generation+'.1',english:'Good morning!',spanish:'¡Buenos días!',variables:[],aiGenerated:true,aiVerified:false,generationId:generation,expiresAt:new Date(at+600000).toISOString(),exampleIds:[example],knowledgeIds:[],source:{kind:'generated',modelId:account,verified:false,label:'Borrador IA · Revisión humana',version:'d'.repeat(32)}};
 const validate=item=>validateChatDirectSuggestions({scope:context.scope,revision:context.revision,candidates:[item]},{scope:context.scope,revision:context.revision,allowedSourceModels:[account]});assert.equal(validate(draft).length,1);assert.throws(()=>validate({...draft,content:entry().catalogProposal.content}));assert.equal(getCatalogProposal({...entry(),catalogProposal:{...entry().catalogProposal,candidateId:draft.id}},draft,context,at)?.proposal.id,proposal().id);
});
