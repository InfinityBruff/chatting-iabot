import test from 'node:test';import assert from 'node:assert/strict';
import {mergePage,newestPreview,sessionKey,readSession,writeSession,clearUserSession} from './chat-sync.js';
const page=(rows,cursor='next',hasMore=true)=>({data:{messages:rows,cursor,hasMore}});
test('refresh keeps old history, replaces same ID and uses fresh head pagination',()=>{
 const old=page([{id:'1',text:'old'},{id:'2',seenByFan:false}]);
 const next=mergePage(old,page([{id:'2',seenByFan:true},{id:'3',text:'new'}],'new-cursor'),'messages',{retain:true});
 assert.deepEqual(next.data.messages.map(x=>x.id),['1','2','3']);assert.equal(next.data.messages[1].seenByFan,true);assert.equal(next.data.cursor,'new-cursor');
});
test('refresh after older pages retains oldest cursor without duplicate IDs',()=>{
 const older=mergePage(page([{id:'2'}]),page([{id:'1'}],'oldest'),'messages',{append:true});
 const refreshed=mergePage(older,page([{id:'3'},{id:'2'}],'head'),'messages',{retain:true});
 assert.equal(refreshed.data.cursor,'oldest');assert.equal(refreshed.data.messages.length,3);
});
test('last preview accepts either sender and cannot regress behind confirmed send',()=>{
 const fan={userId:'1',lastMessageTime:'2026-11-01T12:00:00Z',lastMessage:'before'};
 for(const isFromMe of [true,false])assert.equal(newestPreview(fan,{text:'new',createdAt:'2026-11-01T12:01:00Z',isFromMe}).lastMessage,'new');
 assert.equal(newestPreview(fan,{text:'old',createdAt:'2026-11-01T11:00:00Z'}),fan);
 const r=mergePage({data:{conversations:[fan]}},{data:{conversations:[{...fan,lastMessage:'old',lastMessageTime:'2026-11-01T11:00:00Z',unreadCount:2}]}},'conversations',{retain:true});assert.equal(r.data.conversations[0].lastMessage,'before');assert.equal(r.data.conversations[0].unreadCount,2);
});
test('stored navigation and drafts isolate users agencies models and fans; logout clears only actor',()=>{
 const store={};globalThis.sessionStorage={getItem:k=>store[k],setItem:(k,v)=>{store[k]=v;globalThis.sessionStorage[k]=v},removeItem:k=>{delete store[k];delete globalThis.sessionStorage[k]}};
 const keys=[sessionKey('u','w','m','f','draft'),sessionKey('u','w','m2','f','draft'),sessionKey('u','w2','m','f','draft'),sessionKey('v','w','m','f','draft'),sessionKey('u','w','m','f2','draft')];assert.equal(new Set(keys).size,5);
 keys.forEach((k,i)=>writeSession(k,{text:String(i)}));assert.equal(readSession(keys[1]).text,'1');clearUserSession('u');assert.equal(readSession(keys[0]),null);assert.equal(readSession(keys[3]).text,'3');delete globalThis.sessionStorage;
});
test('disabled storage does not crash editing; normal non-chat pages replace data',()=>{assert.equal(writeSession('x',{}),false);assert.equal(readSession('x','fallback'),'fallback');const next=page([{id:'2'}]);assert.equal(mergePage(page([{id:'1'}]),next,'messages'),next)});
test('unchanged messages keep their object identity during head refreshes',()=>{const message={id:'1',text:'Hello',media:[]},old={data:{messages:[message],hasMore:true,cursor:'older'}};const next=mergePage(old,{data:{messages:[{...message,media:[]}],hasMore:true,cursor:'next'}},'messages',{retain:true});assert.equal(next.data.messages[0],message)});
test('an unchanged newest preview keeps its identity while a changed delivery preview still updates',()=>{const fan={lastMessage:'Same',lastMessageTime:'2026-11-03T08:00:00Z',lastMessageIsFromMe:false};assert.equal(newestPreview(fan,{text:'Same',createdAt:fan.lastMessageTime,isFromMe:false}),fan);assert.notEqual(newestPreview(fan,{text:'Changed',createdAt:fan.lastMessageTime,isFromMe:false}),fan)});
