import test from 'node:test';
import assert from 'node:assert/strict';
import {createCatalogRecommendation,CATALOG_PROPOSAL_POLICY} from '../supabase/functions/bruff-memory/recommendation.js';

const actor='11111111-1111-4111-8111-111111111111',owner='22222222-2222-4222-8222-222222222222',w='33333333-3333-4333-8333-333333333333',c='44444444-4444-4444-8444-444444444444',batch='a'.repeat(64);
const scope=()=>({actorId:actor,ownerId:owner,workspaceId:w,creatorId:c,binding:'acct_fixture',fanId:'55',batchHash:batch});
const catalog=()=>({ownerId:owner,workspaceId:w,creatorId:c,batchHash:batch,sourceUsername:'fictional_model',folders:[{id:'first',name:'Fictional Script',orderConfirmed:false,items:[{id:'10',type:'video',referencePriceCents:600},{id:'11',type:'photo',label:'P1',referencePriceCents:999},{id:'12',type:'photo'},{id:'13',type:'video',referencePriceCents:null}]},{id:'second',name:'Other Script',orderConfirmed:false,items:[{id:'20',type:'video',referencePriceCents:2000},{id:'21',type:'photo'}]}]});
const row=(mediaId='11',extra={})=>({folderId:'first',mediaId,messageId:'100',createdAt:'2026-11-07T10:00:00.000Z',kind:'free_sent',priceCents:0,openedReported:false,paidConfirmed:false,...extra});
const recommend=(extra={})=>createCatalogRecommendation({catalog:catalog(),observations:[],scope:scope(),...extra});

test('first proposal prioritizes an unseen photo over earlier video without claiming order or payment',async()=>{
 const p=await recommend();assert.match(p.id,/^[a-f0-9]{64}$/);assert.equal(p.policyVersion,CATALOG_PROPOSAL_POLICY);assert.equal(p.folderId,'first');assert.equal(p.mediaId,'11');assert.equal(p.priceCents,0);assert.equal(p.currency,'USD');assert.equal(p.reviewRequired,true);assert.equal(p.orderConfirmed,false);assert.equal(p.paidConfirmed,false);assert.equal(p.observedCount,0);assert.equal(p.pendingOfferCount,0);assert.ok(p.reason.length<=500);assert.match(p.reason,/parcial/);
 assert.deepEqual(Object.keys(p).sort(),['id','policyVersion','folderId','mediaId','priceCents','currency','reviewRequired','orderConfirmed','paidConfirmed','reason','observedCount','pendingOfferCount'].sort());
});

test('unseen photos then videos retain array order; inventory does not fabricate a commercial next level',async()=>{
 const first=row(),second=row('12',{messageId:'101'});
 assert.equal((await recommend({observations:[first]})).mediaId,'12');
 const video=await recommend({observations:[first,second]});assert.equal(video.mediaId,'10');assert.equal(video.priceCents,600);assert.equal(video.orderConfirmed,false);
});

test('latest observed folder wins, equal timestamp ties use inventory order, and explicit folder wins',async()=>{
 const observations=[row(),row('21',{folderId:'second',messageId:'101',createdAt:'2026-11-07T11:00:00.000Z'})];
 assert.equal((await recommend({observations})).folderId,'second');
 assert.equal((await recommend({observations,folderId:'first'})).folderId,'first');
 observations[1].createdAt=observations[0].createdAt;assert.equal((await recommend({observations})).folderId,'first');
});

test('explicit observed media is permitted with counts and warnings, never purchase inference',async()=>{
 const a=row('10',{kind:'offered',priceCents:1800,openedReported:true}),b=row('11',{kind:'offered',priceCents:1800,openedReported:true}),c=row('10',{messageId:'101',kind:'offered',priceCents:2100,openedReported:false});
 const p=await recommend({observations:[a,b,c,a],folderId:'first',mediaId:'10'});
 assert.equal(p.observedCount,2);assert.equal(p.pendingOfferCount,2);assert.equal(p.paidConfirmed,false);assert.equal(p.priceCents,600);assert.match(p.reason,/ya aparece/);assert.match(p.reason,/sin pago confirmado/);
});

test('video uses exact reference price or unknown; no progression or price fill is performed',async()=>{
 for(const referencePriceCents of [null,undefined,0,1000,11000,13500]){
  const cat=catalog();cat.folders[0].items[0].referencePriceCents=referencePriceCents;
  const p=await recommend({catalog:cat,folderId:'first',mediaId:'10'});assert.equal(p.priceCents,referencePriceCents??null);
 }
 const cat=catalog();cat.folders[0].items[0].referencePriceCents=-1;await assert.rejects(recommend({catalog:cat}),/selección/);
});

test('exhausted selected folder and empty catalog return null without jumping to another script',async()=>{
 const observations=[row(),row('12',{messageId:'101'}),row('10',{messageId:'102'}),row('13',{messageId:'103'})];
 assert.equal(await recommend({observations}),null);
 const cat=catalog();cat.folders=[];assert.equal(await recommend({catalog:cat}),null);
});

test('automatic choice and explicit verification reproduce the same proposal; poll metadata is irrelevant',async()=>{
 const first=await recommend(),explicit=await recommend({folderId:first.folderId,mediaId:first.mediaId});assert.equal(first.id,explicit.id);
 const a=row('20',{folderId:'second',kind:'offered',priceCents:2000}),b=row('21',{folderId:'second',messageId:'101'});
 const one=await recommend({observations:[a,b],folderId:'first',mediaId:'11'}),two=await recommend({observations:[b,a,a],folderId:'first',mediaId:'11',scan:{version:999,recentCheckedAt:'2099-01-01T00:00:00Z'}});assert.equal(one.id,two.id);
 const cat=catalog(),reordered=Object.fromEntries(Object.entries(cat).reverse());assert.equal((await recommend({catalog:cat})).id,(await recommend({catalog:reordered})).id);
});

test('fingerprint binds actor, owner, agency, model, binding, fan and batch',async()=>{
 const base=(await recommend()).id;
 for(const [key,value] of [['actorId','55555555-5555-4555-8555-555555555555'],['ownerId','55555555-5555-4555-8555-555555555555'],['workspaceId','55555555-5555-4555-8555-555555555555'],['creatorId','55555555-5555-4555-8555-555555555555'],['binding','acct_replaced'],['fanId','56'],['batchHash','b'.repeat(64)]]){
  const s={...scope(),[key]:value},cat=catalog();if(['ownerId','workspaceId','creatorId','batchHash'].includes(key))cat[key]=value;
  assert.notEqual((await recommend({scope:s,catalog:cat})).id,base,key);
 }
});

test('entire catalog, semantic observation and selected asset changes invalidate the fingerprint',async()=>{
 const fixed={folderId:'first',mediaId:'10'},base=(await recommend(fixed)).id;
 for(const edit of [cat=>cat.folders[1].name='Changed',cat=>cat.folders[1].items[0].referencePriceCents=2100,cat=>cat.folders[0].items.reverse()]){const cat=catalog();edit(cat);assert.notEqual((await recommend({...fixed,catalog:cat})).id,base)}
 const observations=[row('21',{folderId:'second'})],original=(await recommend({...fixed,observations})).id;
 for(const patch of [{openedReported:true},{createdAt:'2026-11-07T11:00:00.000Z'},{kind:'offered',priceCents:1500}])assert.notEqual((await recommend({...fixed,observations:[{...observations[0],...patch}]})).id,original);
 assert.notEqual((await recommend({folderId:'first',mediaId:'13'})).id,base);
});

test('invalid selection, foreign scopes, ambiguous catalog and fabricated paid evidence are rejected',async()=>{
 for(const input of [{folderId:'missing'},{folderId:'first',mediaId:'20'},{mediaId:'10'},{folderId:'first',mediaId:'01'},{folderId:''}])await assert.rejects(recommend(input),error=>error.code==='MEMORY_SELECTION');
 const foreign={...scope(),creatorId:owner};await assert.rejects(recommend({scope:foreign}),/selección/);
 const cat=catalog();cat.folders[1].items.push({id:'11',type:'photo'});await assert.rejects(recommend({catalog:cat}));
 await assert.rejects(recommend({observations:[row('11',{paidConfirmed:true})]}));
});

test('input is immutable and proposal contains only JSON-safe metadata with no raw catalog labels',async()=>{
 const cat=catalog(),observations=[row()];cat.folders[0].items[0].label='UNEXPOSED FIXTURE LABEL';
 const before=JSON.stringify({cat,observations}),p=await recommend({catalog:cat,observations});assert.equal(JSON.stringify({cat,observations}),before);assert.deepEqual(JSON.parse(JSON.stringify(p)),p);assert.equal(JSON.stringify(p).includes('UNEXPOSED'),false);
});
