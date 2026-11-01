import test from 'node:test';import assert from 'node:assert/strict';
import {toggleVaultSelection,sortVaultMedia,collectVaultFolders} from './vault-library.js';
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
