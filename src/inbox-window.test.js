import test from 'node:test';import assert from 'node:assert/strict';
import {createInboxWindow,restoredInboxWindowLimit,validInboxWindowLimit} from './inbox-window.js';
const rows=(count,start=1)=>Array.from({length:count},(_,i)=>({userId:String(start+i),lastMessage:'Real'}));
const result=(fans,hasMore=true,cursor='next',extra={})=>({data:{conversations:fans,hasMore,cursor},...extra});
const settled=()=>new Promise(resolve=>setImmediate(resolve));
function fixture({count=0,pageSize=20,hasMore=true,filter=x=>x,provider,savedLimit=null}={}){
 let raw=rows(count),revision=0,call=0;const calls=[],commits=[];
 let value=result(raw,hasMore,hasMore?'next':null),input={rows:filter(raw),result:value,busy:false,pageRevision:revision};
 const reader=createInboxWindow({initial:input,savedLimit,onCommit:limit=>commits.push(limit),load:async(cursor,options)=>{
  calls.push({cursor,options});const next=provider?provider(++call,raw):{rows:rows(pageSize,raw.length+1),hasMore:true,cursor:'page'+(++call)};
  const map=new Map(raw.map(fan=>[fan.userId,fan]));for(const fan of next.rows)map.set(fan.userId,{...map.get(fan.userId),...fan});raw=[...map.values()];value=result(raw,next.hasMore,next.cursor);input={rows:filter(raw),result:value,busy:false,pageRevision:++revision};reader.setInput(input);reader.commit();return true;
 }});reader.commit();reader.start();return {reader,calls,commits,get raw(){return raw},get input(){return input},set(next){input={...input,...next};reader.setInput(input);reader.commit()}};
}
test('39 real rows fill the initial40, while40 rows stop without another provider read',async()=>{
 const partial=fixture({count:39,pageSize:20});await settled();assert.equal(partial.reader.getSnapshot().visibleLimit,40);assert.equal(partial.raw.length,59);assert.equal(partial.calls.length,1);assert.equal(partial.reader.getSnapshot().pending,false);partial.reader.stop();
 const full=fixture({count:40});await settled();assert.equal(full.calls.length,0);full.reader.stop();
});
test('a cached122-row page reveals40 then55 then70 with zero GETs and preserves full raw data/cursor',async()=>{
 const f=fixture({count:122,hasMore:false});await settled();assert.equal(f.reader.getSnapshot().visibleLimit,40);assert.equal(f.reader.getSnapshot().hasMore,true);
 assert.equal(f.reader.loadMore(),true);assert.equal(f.reader.loadMore(),false);assert.equal(f.reader.getSnapshot().visibleLimit,55);f.reader.commit();assert.equal(f.reader.getSnapshot().pending,false);
 assert.equal(f.reader.loadMore(),true);f.reader.commit();assert.equal(f.reader.getSnapshot().visibleLimit,70);assert.equal(f.calls.length,0);assert.equal(f.raw.length,122);assert.equal(f.input.result.data.hasMore,false);assert.equal(f.input.result.data.cursor,null);f.reader.stop();
});
test('native20 fills40 in two total pages, then the next15 reveals55 while preserving all60 fetched rows',async()=>{
 const f=fixture({count:20,pageSize:20});await settled();assert.equal(f.calls.length,1);assert.equal(f.raw.length,40);assert.equal(f.reader.getSnapshot().visibleLimit,40);
 f.reader.loadMore();f.reader.commit();await settled();assert.equal(f.calls.length,2);assert.equal(f.raw.length,60);assert.equal(f.reader.getSnapshot().visibleLimit,55);assert.equal(f.input.result.data.cursor,'page2');assert.ok(f.calls.every(call=>call.options.priority==='pagination'));f.reader.stop();
});
test('unknown native37 and10 page sizes preserve extras and stop at the real initial target',async()=>{
 for(const size of [37,10]){const f=fixture({count:size,pageSize:size});await settled();assert.equal(f.reader.getSnapshot().visibleLimit,40);assert.equal(f.reader.getSnapshot().pending,false);assert.equal(f.calls.length,size===37?1:3);assert.equal(f.raw.length,size===37?74:40);const before=f.calls.length;f.reader.loadMore();f.reader.commit();await settled();assert.equal(f.reader.getSnapshot().visibleLimit,55);assert.equal(f.calls.length-before,size===37?0:2);assert.equal(f.raw.length,size===37?74:60);f.reader.stop()}
});
test('a head poll or spend/cache update never expands the visible window',async()=>{
 const f=fixture({count:122});await settled();const changed=f.raw.map(fan=>({...fan,spend:{available:true,total:10}}));f.set({rows:changed,result:result([...rows(1,999),...changed],true,'unchanged')});assert.equal(f.reader.getSnapshot().visibleLimit,40);assert.equal(f.calls.length,0);assert.equal(f.reader.getSnapshot().pending,false);f.reader.stop();
});
test('profile snapshots are not40 real chats and a profile-only cache cannot declare provider exhaustion',async()=>{
 const profiles=rows(100).map(fan=>({...fan,profileSnapshot:true}));let calls=0;const reader=createInboxWindow({initial:{rows:profiles,result:result(profiles,false,null,{cachedProfiles:true})},load:async()=>{calls++;return false}});reader.commit();reader.start();await settled();assert.equal(calls,0);assert.equal(reader.getSnapshot().pending,true);
 reader.setInput({rows:profiles,result:result(rows(40),false,null),pageRevision:0});reader.commit();assert.equal(reader.getSnapshot().pending,false);assert.equal(reader.getSnapshot().visibleLimit,40);reader.stop();
});
test('sparse filters fill40 raw chats only, then each accepted block scans at most15 new raw IDs',async()=>{
 const f=fixture({count:20,pageSize:20,filter:fans=>fans.filter(fan=>Number(fan.userId)%20===0)});await settled();assert.equal(f.raw.length,40);assert.equal(f.input.rows.length,2);assert.equal(f.calls.length,1);
 f.reader.loadMore();f.reader.commit();await settled();assert.equal(f.raw.length,60);assert.equal(f.input.rows.length,3);assert.equal(f.calls.length,2);assert.equal(f.reader.getSnapshot().visibleLimit,55);assert.equal(f.reader.getSnapshot().pending,false);f.reader.stop();
});
test('empty and fully overlapping pages stop after8 cursor turns instead of walking the entire account',async()=>{
 for(const empty of [true,false]){const f=fixture({count:20,provider:(turn,raw)=>({rows:empty?[]:raw,hasMore:true,cursor:'page'+turn})});await settled();assert.equal(f.calls.length,8);assert.equal(f.reader.getSnapshot().pending,false);assert.equal(f.reader.getSnapshot().hasMore,true);assert.equal(f.reader.getSnapshot().canLoadMore,false);assert.equal(f.raw.length,20);f.reader.stop()}
});
test('a repeated or missing real cursor stops partial work without discarding the original page',async()=>{
 for(const cursor of ['next',null]){const f=fixture({count:20,provider:()=>({rows:[],hasMore:true,cursor})});await settled();assert.equal(f.calls.length,1);assert.equal(f.reader.getSnapshot().pending,false);assert.equal(f.reader.getSnapshot().hasMore,true);assert.equal(f.reader.getSnapshot().canLoadMore,false);assert.equal(f.raw.length,20);f.reader.stop()}
});
test('a pending accepted block rejects repeated demands and a disposed scope cannot start more reads',async()=>{
 let release;const full=rows(40),reader=createInboxWindow({initial:{rows:full,result:result(full),pageRevision:0},load:()=>new Promise(resolve=>release=resolve)});reader.commit();reader.start();assert.equal(reader.loadMore(),true);reader.commit();await Promise.resolve();assert.equal(reader.loadMore(),false);assert.equal(reader.loadMore(),false);assert.equal(reader.getSnapshot().visibleLimit,55);reader.stop();release(true);await settled();assert.equal(reader.loadMore(),false);
});
test('a failed or already-busy native load is not retried in a synchronous loop',async()=>{
 let calls=0;const fans=rows(20),reader=createInboxWindow({initial:{rows:fans,result:result(fans),pageRevision:0},load:async()=>{calls++;return false}});reader.commit();reader.start();await settled();assert.equal(calls,1);reader.stop();
});
test('deep windows restore only when sufficient confirmed filtered cache exists',()=>{
 const cache=rows(122);assert.equal(restoredInboxWindowLimit(70,cache,cache),70);assert.equal(restoredInboxWindowLimit(70,cache.slice(0,40),cache),null);assert.equal(restoredInboxWindowLimit(70,cache,cache.slice(0,20)),null);assert.equal(restoredInboxWindowLimit(70,cache.map(fan=>({...fan,profileSnapshot:true})),cache),null);
 const restored=fixture({count:122,savedLimit:70});assert.equal(restored.reader.getSnapshot().visibleLimit,70);assert.equal(restored.reader.getSnapshot().restored,true);restored.reader.stop();
 for(const value of [null,39,NaN,'70',10001])assert.equal(validInboxWindowLimit(value),null);
});
test('cached profile ghosts can stay visible but cannot satisfy a15-real-chat block without reading',async()=>{
 const f=fixture({count:40,pageSize:20,filter:fans=>[...fans,...rows(200,fans.length+1).map(fan=>({...fan,profileSnapshot:true}))]});await settled();assert.equal(f.calls.length,0);f.reader.loadMore();f.reader.commit();await settled();assert.equal(f.calls.length,1);assert.equal(f.raw.length,60);assert.equal(f.reader.getSnapshot().pending,false);f.reader.stop();
});
test('a blocked provider cursor cannot be retried just because a later head update adds a small local buffer',async()=>{
 const f=fixture({count:20,provider:()=>({rows:[],hasMore:true,cursor:'next'})});await settled();assert.equal(f.calls.length,1);const head=rows(48);f.set({rows:head,result:result(head,true,'next')});assert.equal(f.reader.getSnapshot().canLoadMore,true);f.reader.loadMore();f.reader.commit();await settled();assert.equal(f.calls.length,1);assert.equal(f.reader.getSnapshot().visibleLimit,55);assert.equal(f.reader.getSnapshot().pending,false);f.reader.stop();
});
test('effect cleanup/setup before dispatch cannot strand a pending initial window or let an old completion clear it',async()=>{
 const fans=rows(20);let calls=0;const reader=createInboxWindow({initial:{rows:fans,result:result(fans),pageRevision:0},load:async()=>{calls++;reader.setInput({rows:rows(40),result:result(rows(40)),pageRevision:1});reader.commit();return true}});reader.commit();reader.start();reader.stop();reader.setInput({rows:fans,result:result(fans),pageRevision:0});reader.commit();reader.start();await settled();assert.equal(calls,1);assert.equal(reader.getSnapshot().pending,false);assert.equal(reader.getSnapshot().visibleLimit,40);reader.stop();
});
