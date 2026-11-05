import test from 'node:test';
import assert from 'node:assert/strict';
import {galleryMessages,galleryPriceLabel} from './conversation-gallery.js';

const media=(id='101',type='photo',extra={})=>({id,type,canView:true,...extra});
const message=(id='1',extra={})=>({id,isFromMe:true,text:'Contenido para ti',createdAt:'2026-11-05T10:00:00Z',price:0,media:[media()],...extra});

test('gallery contains only confirmed own media messages, never incoming or uncertain sends',()=>{
 const rows=[message(),message('2',{isFromMe:false}),message('3',{isFromMe:null}),message('4',{isFromMe:'true'}),...['checking','sending','uncertain'].map((delivery,i)=>message(String(i+5),{delivery})),message('8',{media:[]}),message('9',{media:null}),message('10',{mediaCount:3,media:undefined})];
 const groups=galleryMessages(rows);
 assert.deepEqual(groups.map(group=>group.id),['1','10']);
 assert.equal(groups[0].status.key,'free');
 assert.equal(galleryPriceLabel(groups[0]),'Gratis');
});

test('unlocked tab requires an explicit opened PPV, independently of account access and read receipts',()=>{
 const rows=[message('1',{price:12,isOpened:true}),message('2',{price:12,isOpened:false,seenByFan:true}),message('3',{price:12,seenByFan:true,media:[media('103','video',{canView:true,url:'https://example.test/preview'})]}),message('4',{price:12,isOpened:true,isTip:true}),message('5',{price:0,isOpened:true}),message('6',{price:null,isOpened:true})];
 assert.deepEqual(galleryMessages(rows,{tab:'unlocked'}).map(group=>group.id),['1']);
 assert.deepEqual(galleryMessages(rows).map(group=>group.status.key),['unlocked','paid','paid','tip','free','unknown']);
 assert.match(galleryPriceLabel(rows[3]),/Propina$/);
 assert.doesNotMatch(galleryPriceLabel(rows[3]),/conjunto/);
});

test('missing, coerced and invalid prices remain unknown; only numeric zero is free',()=>{
 for(const price of [undefined,null,'0','12',NaN,Infinity,-Infinity,-1,{},[]]){
  const [group]=galleryMessages([message('1',{price,isOpened:true})]);
  assert.equal(group.price,null);assert.equal(group.status.key,'unknown');
  assert.equal(galleryPriceLabel(group),'Precio no disponible');
  assert.equal(galleryPriceLabel({price}),'Precio no disponible');
  assert.deepEqual(galleryMessages([message('1',{price,isOpened:true})],{tab:'unlocked'}),[]);
 }
 assert.equal(galleryPriceLabel({price:0}),'Gratis');
 assert.match(galleryPriceLabel({price:12.5}),/12,50.*Precio del conjunto$/);
});

test('a multi-attachment purchase is one priced message and filtering never divides or multiplies its price',()=>{
 const original=message('23',{price:18.75,isOpened:true,media:[media('101','photo'),media('102','video'),media('103','audio')]});
 for(const type of ['all','photo','video','audio']){
  const rows=galleryMessages([original],{type});assert.equal(rows.length,1);
  assert.equal(rows[0].price,18.75);assert.equal(rows[0].status.key,'unlocked');
  assert.equal(rows[0].media.length,type==='all'?3:1);
  assert.match(galleryPriceLabel(rows[0]),/18,75.*Precio del conjunto$/);
 }
 assert.deepEqual(galleryMessages([original],{type:'gif'}),[]);
});

test('duplicate pages merge by message id while another send of the same asset stays separate',()=>{
 const old=message('1',{price:10,isOpened:false,media:[media('101'),media('101')]}),updated={...old,isOpened:true},again=message('2',{price:20,isOpened:true,createdAt:'2026-11-05T11:00:00Z'});
 const groups=galleryMessages([old,updated,again]);
 assert.deepEqual(groups.map(group=>group.id),['2','1']);
 assert.equal(groups[1].status.key,'unlocked');
 assert.equal(groups[1].media.length,1);
 assert.equal(groups[0].media[0].id,groups[1].media[0].id);
 assert.deepEqual(groups.map(group=>group.price),[20,10]);
});

test('valid numeric identities only, with unsafe numeric values rejected rather than silently rounded',()=>{
 const invalid=[null,undefined,'','0','01','-1','1.5','pending:1','<img>',{},[],0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1,'1'.repeat(25)];
 for(const id of invalid){assert.deepEqual(galleryMessages([message('1',{id})]),[]);assert.deepEqual(galleryMessages([message('1',{media:[media('101','photo',{id})]})]),[])}
 const [group]=galleryMessages([message(7,{media:[media(9)]})]);
 assert.equal(group.id,'7');assert.equal(group.media[0].id,'9');
 assert.equal(galleryMessages([message('9'.repeat(24))]).length,1);
});

test('text and type search use copies and keep hostile strings as plain data without mutating source',()=>{
 const original=message('1',{text:'<img src=x onerror=alert(1)> ÁLBUM especial',media:[media('101','photo',{previewSources:['one','two']}),media('102','video')]});
 const before=JSON.stringify(original);
 Object.freeze(original.media[0].previewSources);Object.freeze(original.media[0]);Object.freeze(original.media[1]);Object.freeze(original.media);Object.freeze(original);
 const groups=galleryMessages([original],{type:'photo',query:'álbum'});
 assert.equal(groups.length,1);assert.equal(groups[0].text,original.text);assert.equal(groups[0].media.length,1);
 assert.notEqual(groups[0],original);assert.notEqual(groups[0].media[0],original.media[0]);assert.notEqual(groups[0].media[0].previewSources,original.media[0].previewSources);
 assert.equal(JSON.stringify(original),before);
 assert.equal(galleryMessages([original],{query:'102'}).length,1);
 assert.equal(galleryMessages([original],{query:'102',type:'photo'}).length,0);
 assert.equal(galleryMessages([original],{query:'sin coincidencia'}).length,0);
 assert.deepEqual(galleryMessages(null),[]);
});

test('confirmed metadata-only media messages remain visible in All without invented assets or unlock evidence',()=>{
 const rows=[message('1',{price:15,isOpened:true,media:[],mediaCount:3}),message('2',{price:null,isOpened:true,media:null,mediaCount:2}),message('3',{price:15,isOpened:false,media:undefined,mediaCount:1})];
 const groups=galleryMessages(rows);
 assert.deepEqual(groups.map(group=>[group.id,group.missingMediaCount,group.media]),[['1',3,[]],['2',2,[]],['3',1,[]]]);
 assert.deepEqual(groups.map(group=>group.status.key),['unlocked','unknown','paid']);
 assert.deepEqual(galleryMessages(rows,{tab:'unlocked'}).map(group=>group.id),['1']);
 assert.deepEqual(galleryMessages(rows,{type:'photo'}),[]);
 assert.deepEqual(galleryMessages(rows,{query:'2'}).map(group=>group.id),['2']);
 for(const mediaCount of [undefined,null,'3',0,-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.deepEqual(galleryMessages([message('4',{media:[],mediaCount})]),[]);
});

test('partial media counts are computed before filters and page dedup preserves the latest priced message',()=>{
 const original=message('7',{price:25,isOpened:true,mediaCount:4,media:[media('101','photo'),media('102','video'),media('102','video')]}),updated={...original,price:30};
 const [all]=galleryMessages([original,updated]),[photos]=galleryMessages([original,updated],{type:'photo'});
 assert.equal(all.missingMediaCount,2);assert.equal(all.media.length,2);assert.equal(all.price,30);
 assert.equal(photos.missingMediaCount,2);assert.equal(photos.media.length,1);assert.equal(photos.price,30);
 assert.equal(galleryMessages([updated],{type:'audio'}).length,0);
 assert.equal(galleryMessages([updated],{query:'102',type:'photo'}).length,0);
 assert.equal(galleryMessages([{...updated,mediaCount:1}])[0].missingMediaCount,0);
 assert.deepEqual(original.media.map(item=>item.id),['101','102','102']);
});
