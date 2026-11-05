import test from 'node:test';import assert from 'node:assert/strict';
import {toggleVaultSelection,sortVaultMedia,collectVaultFolders,initialVaultAttachments,toggleVaultAttachments,vaultSelectionIndex,vaultDuration} from './vault-library.js';
test('vault selection persists across folders, prevents duplicate existing items and respects total limit',()=>{
 const a={id:1,attachment:'a'},b={id:2,attachment:'b'};
 let selected=toggleVaultSelection([],a);selected=toggleVaultSelection(selected,b);
 assert.deepEqual(selected,[a,b]);assert.deepEqual(toggleVaultSelection(selected,{id:'1'}),[b]);
 assert.deepEqual(toggleVaultSelection([],a,[{id:'1'}]),[]);
 assert.deepEqual(toggleVaultSelection([],a,Array.from({length:10},(_,i)=>({id:i+5}))),[]);
 assert.deepEqual(toggleVaultSelection([],{id:3}),[]);
});
test('all folder pages are read, deduplicated and cursor loops stop explicitly',async()=>{
 const cursors=[],updates=[];
 await collectVaultFolders(async cursor=>{cursors.push(cursor);return {data:cursor?{categories:[{id:1},{id:2}],hasMore:false}:{categories:[{id:1}],hasMore:true,cursor:'next'}}},(rows,complete)=>updates.push({rows,complete}));
 assert.deepEqual(cursors,[undefined,'next']);assert.equal(updates.at(-1).rows.length,2);assert.equal(updates.at(-1).complete,true);
 await assert.rejects(collectVaultFolders(async()=>({data:{categories:[],hasMore:true,cursor:'same'}}),()=>{}),/incompleta/);
});
test('late folder responses are discarded when model scope is abandoned',async()=>{
 let active=true,updates=0;
 await collectVaultFolders(async()=>{active=false;return {data:{categories:[{id:1}],hasMore:false}}},()=>updates++,()=>active);
 assert.equal(updates,0);
});
test('sorting applies to loaded content without mutating its source',()=>{
 const rows=[{id:1,createdAt:'2026-01-01'},{id:2,createdAt:'2026-02-01'}];
 assert.deepEqual(sortVaultMedia(rows,'newest').map(x=>x.id),[2,1]);assert.equal(rows[0].id,1);
});
test('editing a reopened picker preserves original upload tokens and previews without changing the composer until apply',()=>{
 const uploaded={id:'upload-fixture',token:'opaque-upload-token',name:'archivo propio',media:{type:'video',url:'blob:fixture'}},withoutPreview={id:2,token:'vault-token'},existing=[uploaded,withoutPreview];
 let draft=initialVaultAttachments(existing,true);
 assert.notEqual(draft,existing);assert.equal(draft[0],uploaded);assert.equal(draft[1],withoutPreview);
 draft=toggleVaultAttachments(draft,{id:'2'},existing,true);
 const photo={id:3,type:'photo',attachment:'photo-token',preview:'photo-fixture'};
 draft=toggleVaultAttachments(draft,photo,existing,true);
 assert.deepEqual(existing,[uploaded,withoutPreview]);assert.equal(draft[0],uploaded);
 assert.deepEqual(draft[1],{id:3,token:'photo-token',name:'Foto · 3',media:photo});
 assert.deepEqual(initialVaultAttachments(existing,true),existing);
 assert.deepEqual(initialVaultAttachments(existing),[]);
});
test('replacement selection toggles across folder results, permits empty and counts all ten attachments exactly once',()=>{
 const existing=Array.from({length:10},(_,id)=>({id,token:'token-'+id}));let draft=initialVaultAttachments(existing,true);
 const extra={id:10,type:'video',attachment:'extra'};
 assert.equal(toggleVaultAttachments(draft,extra,existing,true),draft);
 draft=toggleVaultAttachments(draft,{id:'0'},existing,true);assert.equal(draft.length,9);
 draft=toggleVaultAttachments(draft,extra,existing,true);assert.equal(draft.length,10);assert.equal(draft.at(-1).media,extra);
 assert.equal(vaultSelectionIndex(draft,{id:'10'}),9);
 for(const attachment of [...draft])draft=toggleVaultAttachments(draft,attachment,existing,true);
 assert.deepEqual(draft,[]);assert.equal(existing.length,10);
 assert.deepEqual(toggleVaultAttachments(draft,{id:99},existing,true),[]);
});
test('attachment identity normalizes IDs and only falls back to opaque token when an ID is missing',()=>{
 const selected=[{id:1,token:'a'},{token:'b',name:'Sin vista previa'}];
 assert.equal(vaultSelectionIndex(selected,{id:'1',attachment:'renewed'}),0);
 assert.equal(vaultSelectionIndex(selected,{id:2,attachment:'a'}),-1);
 assert.equal(vaultSelectionIndex(selected,{id:2,attachment:'b'}),1);
 assert.equal(vaultSelectionIndex(selected,{name:'Sin vista previa'}),-1);
 assert.deepEqual(toggleVaultAttachments(selected,{id:2,attachment:'b'},[],true),[selected[0]]);
});
test('an anonymous attachment can be removed by its original reference without matching other anonymous objects',()=>{
 const first={name:'Primero'},second={name:'Segundo'},selected=[first,second];
 assert.equal(vaultSelectionIndex(selected,second),1);
 assert.equal(vaultSelectionIndex(selected,{name:'Segundo'}),-1);
 assert.deepEqual(toggleVaultAttachments(selected,second,[],true),[first]);
 assert.equal(vaultSelectionIndex([null],null),-1);
});
test('default picker still appends only new content and reserves space for existing message attachments',()=>{
 const existing=[{id:1,token:'a'}],item={id:2,type:'audio',attachment:'b'};
 assert.deepEqual(toggleVaultAttachments([],{id:'1',attachment:'a'},existing),[]);
 const selected=toggleVaultAttachments([],item,existing);
 assert.deepEqual(selected,[{id:2,token:'b',name:'Audio · 2',media:item}]);
 assert.equal(toggleVaultAttachments(selected,{id:3,attachment:'c'},existing,false,2),selected);
 assert.deepEqual(toggleVaultAttachments(selected,{id:'2'}),[]);
});
test('duration badges show only real finite positive numeric seconds without guessing strings or unavailable durations',()=>{
 assert.equal(vaultDuration(65.9),'1:05');assert.equal(vaultDuration(3600),'60:00');assert.equal(vaultDuration(1),'0:01');
 for(const duration of [undefined,null,'65',0,.9,-1,Infinity,NaN,Number.MAX_VALUE])assert.equal(vaultDuration(duration),null);
});
