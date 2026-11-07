import test from 'node:test';
import assert from 'node:assert/strict';
import {extractScriptProgress,summarizeScriptProgress,ProgressError} from '../supabase/functions/bruff-memory/progress.js';

const catalog=()=>({batchHash:'fixture-batch',status:'draft',folders:[{id:'folder-a',name:'Script A',items:[{id:'101',type:'photo',label:'Fictional photo'},{id:'102',type:'video'}]},{id:'folder-b',name:'Script B',items:[{id:'103',type:'video'}]}]});
const media=(id,type='photo',extra={})=>({id:String(id),type,...extra});
const message=(id,extra={})=>({id:String(id),isFromMe:true,createdAt:'2026-11-07T10:00:00Z',price:0,isOpened:false,media:[media('101')],...extra});
const extract=(messages,cat=catalog())=>extractScriptProgress({catalog:cat,messages});
const summary=(observations,cat=catalog())=>summarizeScriptProgress({catalog:cat,observations});

test('extracts only catalog assets, no message text, URLs, labels, capabilities or inferred purchases',()=>{
 const rows=extract([message('1',{text:'Private fixture text',price:18.5,isOpened:true,seenByFan:true,media:[media('101','photo',{canView:true,url:'https://example.test/private',attachment:'fixture-secret'}),media('999','video')]})]);
 assert.deepEqual(rows,[{folderId:'folder-a',mediaId:'101',messageId:'1',createdAt:'2026-11-07T10:00:00.000Z',kind:'offered',priceCents:1850,openedReported:true,paidConfirmed:false}]);
 for(const value of ['Private fixture','private','fixture-secret','label','canView','seenByFan'])assert.equal(JSON.stringify(rows).includes(value),false);
});

test('received, unknown direction, pending deliveries and tips never enter progress',()=>{
 const rows=[message('1',{isFromMe:false}),message('2',{isFromMe:'true'}),message('3',{isTip:true,price:20}),...['checking','sending','uncertain','failed'].map((delivery,i)=>message(String(i+4),{delivery})),message('8',{pending:true}),message('9',{status:'queued'})];
 assert.deepEqual(extract(rows),[]);
 assert.deepEqual(extract([message('10',{media:[],mediaCount:3,price:12,isOpened:true})]),[]);
});

test('known free, offered and unknown prices stay distinct; receipts/access do not establish paidConfirmed',()=>{
 for(const price of [undefined,null,'0','18',NaN,Infinity,-1,1.001,Number.MAX_SAFE_INTEGER]){
  const [row]=extract([message('1',{price,isOpened:true})]);assert.equal(row.kind,'sent_price_unknown');assert.equal(row.priceCents,null);assert.equal(row.paidConfirmed,false);
 }
 for(const isOpened of [true,false,null,undefined,'true']){
  const [row]=extract([message('1',{price:0,isOpened,seenByFan:true,media:[media('101','photo',{canView:true})]})]);assert.equal(row.kind,'free_sent');assert.equal(row.priceCents,0);assert.equal(row.openedReported,typeof isOpened==='boolean'?isOpened:null);assert.equal(row.paidConfirmed,false);
 }
 assert.equal(extract([message('1',{price:0.1+0.2})])[0].priceCents,30);
});

test('bundle observations retain one carrying price while summary counts each unique message once',()=>{
 const rows=extract([message('1',{price:18.5,media:[media('101'),media('102','video'),media('103','video')]}),message('2'),message('3',{price:null})]);
 assert.equal(rows.filter(row=>row.messageId==='1').length,3);assert.deepEqual(rows.slice(0,3).map(row=>row.priceCents),[1850,1850,1850]);
 const result=summary(rows);assert.equal(result.messageCount,3);assert.equal(result.offeredMessages,1);assert.equal(result.freeMessages,1);assert.equal(result.sentPriceUnknownMessages,1);assert.equal(result.offeredPriceCents,1850);assert.equal(result.observationCount,5);assert.equal(result.priceUnit,'message_bundle');assert.equal(result.coverage,'loaded_messages_only');assert.equal(result.confirmedPurchases,null);assert.equal(result.orderConfirmed,false);
 assert.deepEqual(result.folders.map(row=>[row.folderId,row.offeredMessages,row.offeredPriceCents]),[['folder-a',1,1850],['folder-b',1,1850]]);
});

test('identical message/media duplicates coalesce, including refreshed preview and seen fields',()=>{
 const original=message('1',{price:9.99,media:[media('102','video'),media('101'),media('101')]}),copy={...original,seenByFan:true,media:[media('101','photo',{url:'https://example.test/new'}),media('102','video')]};
 assert.equal(extract([original,copy]).length,2);
 const rows=extract([original]);assert.equal(summary([...rows,...rows]).observationCount,2);assert.equal(summary([...rows,...rows]).offeredPriceCents,999);
});

test('conflicting duplicate message ID fails before eligibility rather than preserving a false old offer',()=>{
 const original=message('1',{price:10});
 for(const patch of [{price:20},{isFromMe:false},{isTip:true},{delivery:'uncertain'},{isOpened:true},{createdAt:'2026-11-07T11:00:00Z'},{media:[media('102','video')]}])assert.throws(()=>extract([original,{...original,...patch}]),error=>error instanceof ProgressError&&error.code==='duplicate_message_conflict');
});

test('ambiguous media IDs across folders, duplicate folders and conflicting media types fail closed',()=>{
 const duplicate=catalog();duplicate.folders[1].items.push({id:'101',type:'photo'});assert.throws(()=>extract([],duplicate),/catalog_media/);
 const within=catalog();within.folders[0].items.push({id:101,type:'photo'});assert.throws(()=>extract([],within),/catalog_media/);
 const folder=catalog();folder.folders[1].id='folder-a';assert.throws(()=>extract([],folder),/catalog_folder/);
 assert.throws(()=>extract([message('1',{media:[media('101','video')]})]),/catalog_media_type_conflict/);
 assert.throws(()=>extract([message('1',{media:[media('101'),media('101','video')]})]),/message_media_conflict/);
});

test('separate model catalogs only match their exact IDs and never borrow folder names or price policy',()=>{
 const other={batchHash:'other-model',folders:[{id:'folder-a',name:'Script A',items:[{id:'201',type:'photo'}]}]};
 assert.equal(extract([message('1')],catalog()).length,1);assert.deepEqual(extract([message('1')],other),[]);
 const [row]=extract([message('1',{price:20})]);assert.equal(row.kind,'offered');assert.equal(row.priceCents,2000);assert.equal(summary([row]).orderConfirmed,false);
});

test('numeric identities are strict and retain 24 digit strings without unsafe Number conversion',()=>{
 for(const id of ['0','01','-1','1.5','bad','1'.repeat(25),0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  assert.throws(()=>extract([message('1',{id})]),/message_id/);
  const cat=catalog();cat.folders[0].items[0].id=id;assert.throws(()=>extract([],cat),/catalog_media/);
 }
 const id='123456789012345678901234',cat=catalog();cat.folders[0].items[0].id=id;
 const [row]=extract([message(id,{media:[media(id)]})],cat);assert.equal(row.messageId,id);assert.equal(row.mediaId,id);
 assert.equal(extract([message('1',{id:42,media:[media('101')]})])[0].messageId,'42');
});

test('invalid or normalized-overflow calendar dates cannot certify a sent observation',()=>{
 for(const createdAt of [undefined,null,'today','2026-11-07','2026-02-30T10:00:00Z','2025-02-29T10:00:00Z','2026-13-01T10:00:00Z','2026-11-07T24:00:00Z','2026-11-07T10:00:00'])assert.throws(()=>extract([message('1',{createdAt})]),/message_date/);
 assert.equal(extract([message('1',{createdAt:'2024-02-29T11:00:00+01:00'})])[0].createdAt,'2024-02-29T10:00:00.000Z');
});

test('summary validates catalog mapping, price consistency and rejects manufactured paid evidence',()=>{
 const [row]=extract([message('1',{price:10})]);
 for(const patch of [{folderId:'folder-b'},{mediaId:'999'},{paidConfirmed:true},{kind:'free_sent'},{priceCents:10.5},{openedReported:'true'},{createdAt:'invalid'}])assert.throws(()=>summary([{...row,...patch}]),ProgressError);
 assert.throws(()=>summary([row,{...row,priceCents:2000}]),/duplicate_observation_conflict/);
 assert.throws(()=>summary([row,{...row,mediaId:'102',priceCents:2000}]),/observation_message_conflict/);
});

test('empty loaded evidence remains zero observed messages, unknown purchases and unconfirmed order',()=>{
 const result=summary(extract([]));assert.equal(result.messageCount,0);assert.equal(result.offeredPriceCents,0);assert.equal(result.confirmedPurchases,null);assert.equal(result.orderConfirmed,false);assert.equal(result.folders.length,2);
});

test('functions do not mutate frozen input and return ordinary JSON-safe projected data',()=>{
 const cat=catalog(),input=[message('1',{price:12.34})];
 const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value)}return value};freeze(cat);freeze(input);
 const before=JSON.stringify([cat,input]),rows=extract(input,cat),result=summary(rows,cat);assert.equal(JSON.stringify([cat,input]),before);assert.deepEqual(JSON.parse(JSON.stringify(rows)),rows);assert.deepEqual(JSON.parse(JSON.stringify(result)),result);
});

test('bounded input rejects oversized walks before processing and never guesses assets from mediaCount',()=>{
 assert.throws(()=>extract(Array(20001)),/messages/);assert.throws(()=>extractScriptProgress({catalog:catalog()}),/messages/);
 assert.throws(()=>summary(Array(200001)),/observations/);
 assert.deepEqual(extract([message('1',{media:[],mediaCount:100,price:15})]),[]);
});
