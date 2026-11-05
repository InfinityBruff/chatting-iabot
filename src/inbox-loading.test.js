import test from 'node:test';import assert from 'node:assert/strict';import {inboxNextPage} from './inbox-loading.js';
const opts=(count=10)=>({page:{conversations:Array(count).fill({}),hasMore:true,cursor:'next'},seen:new Set(),busy:false,error:''});
test('saved profile placeholders do not prevent refreshing the first40 real conversations',()=>{const state=opts(200);state.page.conversations=state.page.conversations.map((f,i)=>({...f,profileSnapshot:i>=10}));assert.equal(inboxNextPage(state),'next');state.page.conversations=state.page.conversations.map((f,i)=>({...f,profileSnapshot:i>=40}));assert.equal(inboxNextPage(state),null)});
test('preloads40 chats then continues only when approaching list end',()=>{assert.equal(inboxNextPage(opts()),'next');assert.equal(inboxNextPage(opts(39)),'next');assert.equal(inboxNextPage(opts(40)),null);assert.equal(inboxNextPage({...opts(40),nearEnd:true}),'next')});
test('pagination does not loop on repeated cursors or errors and bounds empty initial pages',()=>{for(const extra of [{busy:true},{error:'failed'},{seen:new Set(['next'])},{initialPages:8},{page:{hasMore:false,cursor:'next'}},{page:{hasMore:true,cursor:null}}])assert.equal(inboxNextPage({...opts(),...extra}),null)});
test('scroll demand may promote only its own queued cursor, never a running read or another busy operation',()=>{
 const queued={...opts(150),busy:true,pageQueued:true,requestCursor:'next',nearEnd:true};assert.equal(inboxNextPage(queued),'next');
 for(const extra of [{nearEnd:false},{pageQueued:false},{requestCursor:'other'},{requestCursor:undefined},{error:'limited'},{seen:new Set(['next'])}])assert.equal(inboxNextPage({...queued,...extra}),null);
});
