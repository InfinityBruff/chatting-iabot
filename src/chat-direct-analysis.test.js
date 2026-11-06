import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeChatDirect} from './chat-direct-analysis.js';

const asset=(id,type='photo',extra={})=>({id:String(id),type,...extra});
const message=(id,extra={})=>({id:String(id),isFromMe:true,text:'Mensaje de prueba',createdAt:'2026-11-05T10:00:00Z',price:0,media:[asset(101)],...extra});

test('unavailable data stays unknown while an explicitly loaded empty history has observed zeros',()=>{
 for(const input of [undefined,null,{},'[]']){const value=analyzeChatDirect(input,{historyComplete:true});for(const key of ['freePhotos','freeVideos','ppvOffered','ppvUnlocked'])assert.equal(value[key],null);assert.equal(value.totalsKnown,false);assert.equal(value.lastConfirmedPrice,null);assert.equal(value.phase,'Sin verificar');assert.match(value.coverageLabel,/no disponible/)}
 const partial=analyzeChatDirect([]),complete=analyzeChatDirect([],{historyComplete:true});assert.equal(partial.ppvOffered,0);assert.equal(partial.totals.ppvOffered,null);assert.equal(complete.totals.ppvOffered,0);assert.equal(complete.totalsKnown,true);assert.equal(analyzeChatDirect([],{historyComplete:'true'}).totalsKnown,false);
});

test('counts only strict outgoing confirmed messages, never received content or pending deliveries',()=>{
 const input=[message(1),message(2,{isFromMe:false}),message(3,{isFromMe:null}),message(4,{isFromMe:'true'}),...['checking','sending','uncertain'].map((delivery,index)=>message(index+5,{delivery}))];
 const value=analyzeChatDirect(input,{historyComplete:true});assert.equal(value.freePhotos,1);assert.equal(value.ppvOffered,0);assert.equal(value.metadata.ignoredDeliveryMessages,3);assert.equal(value.metadata.unknownDirectionMessages,2);assert.equal(value.totalsKnown,false);
});

test('numeric zero proves free attachments without needing isOpened; media access and read receipts prove no sale',()=>{
 const value=analyzeChatDirect([message(1,{isOpened:false,media:[asset(101,'photo',{canView:false}),asset(102,'video')]}),message(2,{price:12,seenByFan:true,isOpened:false}),message(3,{price:15,seenByFan:false,media:[asset(103,'video',{canView:true})]})]);
 assert.equal(value.freePhotos,1);assert.equal(value.freeVideos,1);assert.equal(value.ppvOffered,2);assert.equal(value.ppvUnlocked,0);assert.equal(value.lastConfirmedPrice,null);assert.equal(value.metadata.unknownUnlockMessages,1);
});

test('one priced attachment set is one PPV offer and one explicit unlock, without per-file revenue multiplication',()=>{
 const value=analyzeChatDirect([message(1,{price:25,isOpened:true,seenByFan:false,media:[asset(101),asset(102,'video'),asset(103,'audio')]}),message(2,{price:45,isTip:true,isOpened:true})],{historyComplete:true});
 assert.equal(value.ppvOffered,1);assert.equal(value.ppvUnlocked,1);assert.equal(value.freePhotos,0);assert.equal(value.lastConfirmedPrice,25);assert.equal(value.metadata.priceUnit,'message_set');assert.equal(value.metadata.purchaseAmountVerified,false);assert.equal(value.metadata.purchaseTimeVerified,false);assert.match(value.lastConfirmedPriceLabel,/Precio del conjunto/);assert.match(value.lastConfirmedPriceLabel,/no del cobro/);assert.equal(value.phase,'Sin verificar');assert.equal(value.lastScriptLevel,'Sin verificar');
});

test('missing or coerced prices never become free or unlocked, and hide unknown whole-history totals',()=>{
 for(const missing of [undefined,null,'0','25',NaN,Infinity,-1]){const value=analyzeChatDirect([message(1,{price:missing,isOpened:true})],{historyComplete:true});assert.equal(value.freePhotos,0);assert.equal(value.ppvOffered,0);assert.equal(value.ppvUnlocked,0);assert.equal(value.lastConfirmedPrice,null);assert.equal(value.metadata.unknownPriceMessages,1);assert.equal(value.totalsKnown,false);assert.equal(value.totals.freePhotos,null)}
});

test('mediaCount can prove a PPV message while unknown free attachment types do not become photos or videos',()=>{
 const value=analyzeChatDirect([message(1,{price:15,isOpened:true,media:[],mediaCount:3}),message(2,{media:[],mediaCount:2}),message(3,{media:[asset(102,'file')]})],{historyComplete:true});
 assert.equal(value.ppvOffered,1);assert.equal(value.ppvUnlocked,1);assert.equal(value.freePhotos,0);assert.equal(value.freeVideos,0);assert.equal(value.metadata.unknownFreeMedia,2);assert.equal(value.totals.freePhotos,null);assert.equal(value.totals.ppvOffered,1);
});

test('a positive price without media evidence is not counted as a PPV offer or a confirmed unlock',()=>{
 for(const media of [undefined,null,[]]){const value=analyzeChatDirect([message(1,{media,price:15,isOpened:true})],{historyComplete:true});assert.equal(value.ppvOffered,0);assert.equal(value.ppvUnlocked,0);assert.equal(value.lastConfirmedPrice,null);assert.equal(value.metadata.missingMediaMessages,1);assert.equal(value.totals.ppvOffered,null)}
});

test('free GIF/audio or untyped metadata do not turn into photo/video counts or inferred script stages',()=>{
 for(const media of [[asset(101,'gif')],[asset(101,'audio')],[]]){const value=analyzeChatDirect([message(1,{media,mediaCount:1})]);assert.equal(value.freePhotos,0);assert.equal(value.freeVideos,0);assert.equal(value.metadata.freeMediaMessages,1);assert.match(value.commercialState,/Contenido gratuito/);assert.equal(value.phase,'Sin verificar');assert.equal(value.lastScriptLevel,'Sin verificar')}
});

test('message and asset IDs follow gallery strictness, with last duplicate winning before eligibility',()=>{
 const invalid=[null,'bad','0','01','-1','1.5','1'.repeat(25),0,-1,Number.MAX_SAFE_INTEGER+1];for(const id of invalid){const value=analyzeChatDirect([message(1,{id})],{historyComplete:true});assert.equal(value.freePhotos,0);assert.equal(value.metadata.invalidRecords,1);assert.equal(value.totalsKnown,false)}
 const value=analyzeChatDirect([message(1,{price:10,isOpened:false,media:[asset(101),asset(101)]}),message(1,{price:10,isOpened:true}),message(2,{price:20,isOpened:true}),message(2,{price:20,isOpened:true,delivery:'uncertain'})]);assert.equal(value.ppvOffered,1);assert.equal(value.ppvUnlocked,1);assert.equal(value.lastConfirmedPrice,10);
 const invalidAsset=analyzeChatDirect([message(1,{media:[asset('bad')]})],{historyComplete:true});assert.equal(invalidAsset.freePhotos,0);assert.equal(invalidAsset.totals.freePhotos,null);
});

test('loaded partial counts are explicit lower observations, never full conversation or account totals',()=>{
 const value=analyzeChatDirect([message(1),message(2,{price:18,isOpened:true})]);assert.equal(value.freePhotos,1);assert.equal(value.ppvOffered,1);assert.equal(value.ppvUnlocked,1);assert.deepEqual(value.totals,{freePhotos:null,freeVideos:null,ppvOffered:null,ppvUnlocked:null});assert.match(value.coverageLabel,/parcial/);for(const label of Object.values(value.countLabels))assert.match(label,/historial cargado/);assert.equal(value.metadata.scope,'loaded_messages_only');
});

test('latest offered and unlocked prices are distinct and ordered by message timestamp, not input order or numeric ID',()=>{
 const value=analyzeChatDirect([message(99,{price:8,isOpened:true,createdAt:'2026-11-05T09:00:00Z'}),message(1,{price:45,isOpened:false,createdAt:'2026-11-05T12:00:00Z'}),message(2,{price:18,isOpened:true,createdAt:'2026-11-05T11:00:00Z'})]);assert.equal(value.lastConfirmedPrice,18);assert.equal(value.lastOfferedPrice,45);assert.deepEqual(value.metadata.confirmedPrice.messageIds,['2']);assert.equal(value.metadata.confirmedPrice.basis,'message_created_at');assert.match(value.lastOfferedPriceLabel,/No acredita un pago/);
});

test('missing timestamps and ambiguous same-time prices cannot manufacture a latest price',()=>{
 for(const createdAt of [undefined,null,'invalid']){const value=analyzeChatDirect([message(1,{price:18,isOpened:true}),message(2,{price:25,isOpened:true,createdAt})]);assert.equal(value.lastConfirmedPrice,null);assert.equal(value.lastOfferedPrice,null)}
 const tied=analyzeChatDirect([message(1,{price:18,isOpened:true}),message(2,{price:25,isOpened:true})]);assert.equal(tied.lastConfirmedPrice,null);assert.match(tied.metadata.confirmedPrice.reason,/misma|comparten/);
 const same=analyzeChatDirect([message(1,{price:18,isOpened:true}),message(2,{price:18,isOpened:true})]);assert.equal(same.lastConfirmedPrice,18);assert.equal(same.metadata.confirmedPrice.messageIds.length,2);
});

test('a newer opened media message with unknown price blocks claiming an older known price as the latest',()=>{
 const value=analyzeChatDirect([message(1,{price:18,isOpened:true,createdAt:'2026-11-05T09:00:00Z'}),message(2,{price:null,isOpened:true,createdAt:'2026-11-05T11:00:00Z'})]);assert.equal(value.ppvUnlocked,1);assert.equal(value.lastConfirmedPrice,null);assert.equal(value.lastOfferedPrice,null);assert.match(value.metadata.confirmedPrice.reason,/no está informado/);
});

test('mixed malformed records remain partial and neither mutate source nor return message text/media URLs',()=>{
 const original=message(1,{text:'Original literal sin alterar',media:[asset(101,'photo',{url:'https://example.test/private'})]});Object.freeze(original.media[0]);Object.freeze(original.media);Object.freeze(original);const input=Object.freeze([original,null,{},'bad']);const before=JSON.stringify(input),value=analyzeChatDirect(input,{historyComplete:true});assert.equal(JSON.stringify(input),before);assert.equal(value.freePhotos,1);assert.equal(value.metadata.invalidRecords,3);assert.equal(value.totalsKnown,false);assert.equal(JSON.stringify(value).includes(original.text),false);assert.equal(JSON.stringify(value).includes('private'),false);assert.equal(value.phase,'Sin verificar');assert.match(value.nextAction,/Sin acción verificada/);
});
