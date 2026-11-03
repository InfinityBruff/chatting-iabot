import test from 'node:test';import assert from 'node:assert/strict';
import {presenceModelIds,startPresenceScan,acceptPresencePage,failPresenceScan,presenceStatus} from './presence-scan.js';
import {isFanOnline,applyPresence} from './fan-presence.js';
const t=Date.parse('2026-11-01T12:00:00Z');
const page=(ids,more,cursor,now=t)=>({onlineIds:ids,hasMore:more,cursor,checkedAt:new Date(now).toISOString()});
test('scans every page independently of loaded chats and replaces previous cycle only when complete',()=>{
 let s=startPresenceScan({confirmations:{old:new Date(t-1000).toISOString()}},t);
 for(let i=0;i<8;i++)s=acceptPresencePage(s,page([String(i)],i<7,i<7?'cursor'+i:null,t+i),t+i);
 assert.equal(s.complete,true);assert.equal(s.pagesScanned,8);assert.equal(Object.keys(s.confirmations).length,8);assert.equal(s.confirmations.old,undefined);
});
test('429 retains cursor and fresh confirmations then resumes without refreshing earlier timestamps',()=>{
 let s=acceptPresencePage(startPresenceScan({},t),page(['1'],true,'page2'),t);
 s=failPresenceScan(s,{status:429,retryAfter:20},t+1000);assert.equal(s.cursor,'page2');assert.equal(s.nextAt,t+21000);assert.equal(s.confirmations['1'],new Date(t).toISOString());
 s=acceptPresencePage(s,page(['2'],false,null,t+22000),t+22000);assert.equal(s.complete,true);assert.equal(s.pagesScanned,2);assert.equal(s.confirmations['1'],new Date(t).toISOString());
});
test('refresh does not flicker unvisited recent fans; expiration never turns unknown into offline',()=>{
 const old={confirmations:{'2':new Date(t).toISOString()}};let s=startPresenceScan(old,t+45000);
 s=acceptPresencePage(s,page(['1'],true,'next',t+45000),t+45000);
 assert.equal(isFanOnline(applyPresence([{id:2}],s)[0],t+45000),true);
 assert.equal(isFanOnline(applyPresence([{id:2}],s)[0],t+60000),false);
});
test('three model states and removed permissions never share confirmations',()=>{
 const models=['a','b','c'].map((x,i)=>acceptPresencePage(startPresenceScan({},t),page([String(i)],false,null),t));
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)assert.equal(isFanOnline(applyPresence([{id:j}],models[i])[0],t),i===j);
 assert.deepEqual(failPresenceScan(models[0],{status:403},t).confirmations,{});
});
test('missing/repeated cursors and repeated pages are partial and cannot refresh stale green badges',()=>{
 let s=acceptPresencePage(startPresenceScan({},t),page(['1'],true,'same'),t);
 s=acceptPresencePage(s,page(['2'],true,'same'),t);assert.equal(s.complete,false);assert.equal(s.issue,'repeated_cursor');
 const missing=acceptPresencePage(startPresenceScan({},t),page(['1'],true,null),t);assert.equal(missing.issue,'missing_cursor');assert.match(presenceStatus(missing),/parcial/);
 let repeated=acceptPresencePage(startPresenceScan({},t),page(['1'],true,'a'),t);
 repeated=acceptPresencePage(repeated,page(['1'],true,'b',t+61000),t+61000);assert.equal(repeated.issue,'repeated_page');assert.deepEqual(repeated.confirmations,{});
});
test('invalid timestamps or non-boolean pagination never claim complete; empty completed list is valid',()=>{
 assert.equal(acceptPresencePage(startPresenceScan({},t),{onlineIds:[],hasMore:null,checkedAt:new Date(t).toISOString()},t).issue,'schema');
 assert.equal(acceptPresencePage(startPresenceScan({},t),page([],false,null,t+1000),t).issue,'schema');
 const s=acceptPresencePage(startPresenceScan({},t),page([],false,null),t);assert.equal(s.complete,true);assert.deepEqual(s.confirmations,{});
});

test('presence polls only the authorized active model in workflows that display it',()=>{const accounts=[{id:'a',chat:true},{id:'b',chat:true},{id:'denied',chat:false}];for(const view of ['chat','automations','auto-messages','mass-messages'])assert.deepEqual(presenceModelIds(accounts,view,'b'),['b']);for(const view of ['vault','accounts','analytics','team'])assert.deepEqual(presenceModelIds(accounts,view,'b'),[]);assert.deepEqual(presenceModelIds(accounts,'chat','denied'),[]);assert.deepEqual(presenceModelIds(accounts,'chat','missing'),[])});
