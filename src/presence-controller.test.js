import test from 'node:test';
import assert from 'node:assert/strict';
import {createPresenceController} from './presence-controller.js';
import {applyPresence,isFanOnline} from './fan-presence.js';
import {presenceStatus} from './presence-scan.js';
const base=Date.parse('2026-11-04T12:00:00Z');
function clock(){let at=base;const tasks=new Map();return {now:()=>at,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn),advance:ms=>at+=ms,flush:async()=>{const first=[...tasks].sort((a,b)=>a[1]-b[1])[0];if(!first)return;tasks.delete(first[0]);at=Math.max(at,first[1]);await first[0]()}}}
function fixture({request,visible=()=>true,workspace='workspace'}={}){
 const time=clock(),calls=[];
 const page=(onlineIds=[],hasMore=false,cursor=null)=>({data:{onlineIds,hasMore,cursor,checkedAt:new Date(time.now()).toISOString()}});
 const reader=createPresenceController({...time,workspace,visible,request:async(w,operation,input,options)=>{assert.equal(w,workspace);assert.equal(operation,'presence');assert.equal(options.active(),true);const call={input,options};calls.push(call);return request?request(call,page):page([input.creator_id==='a'?'1':input.creator_id==='b'?'2':'3'])}});
 reader.start();reader.setInput(['a','b','c'],['a']);return {reader,time,calls,page};
}
test('A → B → A retains independent partial cursor and confirmations without querying undemanded models',async()=>{
 const f=fixture({request:({input},page)=>input.creator_id==='a'&&!input.cursor?page(['1'],true,'a-next'):page([input.creator_id==='a'?'4':'2'])});
 await f.time.flush();const original=f.reader.getSnapshot().a.confirmations['1'];
 f.reader.setInput(['a','b','c'],['b']);await f.time.flush();assert.equal(f.reader.getSnapshot().a.cursor,'a-next');
 f.reader.setInput(['a','b','c'],['a']);f.time.advance(350);await f.time.flush();
 assert.deepEqual(f.calls.map(c=>[c.input.creator_id,c.input.cursor||null,c.options.priority]),[['a',null,'fan-visible'],['b',null,'fan-visible'],['a','a-next','background']]);
 assert.equal(f.reader.getSnapshot().a.confirmations['1'],original);assert.equal(f.reader.getSnapshot().a.complete,true);assert.deepEqual(Object.keys(f.reader.getSnapshot()).sort(),['a','b']);f.reader.stop();
});
test('returning to a fresh completed model shows its confirmation without an extra request or a3s full scan',async()=>{
 const f=fixture();await f.time.flush();f.reader.setInput(['a','b','c'],['b']);await f.time.flush();
 f.reader.setInput(['a','b','c'],['a']);assert.equal(isFanOnline(applyPresence([{id:'1'}],f.reader.getSnapshot().a)[0],f.time.now()),true);
 f.time.advance(3000);await f.time.flush();assert.equal(f.calls.length,2);
 f.time.advance(42000);await f.time.flush();assert.equal(f.calls.length,3);assert.equal(f.calls[2].options.priority,'background');f.reader.stop();
});
test('switching demand aborts the old request, keeps its accepted cursor, and does not overlap pages',async()=>{
 let release;const f=fixture({request:({input},page)=>input.cursor?new Promise(resolve=>release=()=>resolve(page(['9']))):input.creator_id==='a'?page(['1'],true,'next'):page(['2'])});
 await f.time.flush();const pending=f.time.flush();await Promise.resolve();const abandoned=f.calls[1];
 f.reader.setInput(['a','b','c'],['b']);assert.equal(abandoned.options.signal.aborted,true);assert.equal(abandoned.options.active(),false);assert.equal(f.calls.length,2);
 release();await pending;assert.equal(f.reader.getSnapshot().a.cursor,'next');assert.equal(f.reader.getSnapshot().a.confirmations['9'],undefined);
 await f.time.flush();assert.equal(f.calls[2].input.creator_id,'b');f.reader.stop();
});
test('queued onStart is scoped, and permission removal cannot republish late data or cached greens',async()=>{
 let release;const f=fixture({request:()=>new Promise(resolve=>release=resolve)});const pending=f.time.flush();await Promise.resolve();const call=f.calls[0];
 assert.equal(f.reader.getSnapshot().a.queued,true);call.options.onStart();assert.equal(f.reader.getSnapshot().a.queued,false);
 f.reader.setInput(['b'],['a']);assert.deepEqual(f.reader.getSnapshot(),{});assert.equal(call.options.signal.aborted,true);
 let emissions=0;const off=f.reader.subscribe(()=>emissions++);call.options.onStart();assert.equal(emissions,0);
 release(f.page(['1']));await pending;assert.deepEqual(f.reader.getSnapshot(),{});assert.equal(f.calls.length,1);off();f.reader.stop();
});
test('hidden or closed demand aborts its read and preserves only unexpired previous evidence',async()=>{
 let shown=true,release;const f=fixture({visible:()=>shown,request:({input},page)=>input.cursor?new Promise(resolve=>release=resolve):page(['1'],true,'next')});
 await f.time.flush();const stamp=f.reader.getSnapshot().a.confirmations['1'],pending=f.time.flush();await Promise.resolve();shown=false;f.reader.resume();assert.equal(f.calls[1].options.signal.aborted,true);
 release(f.page(['8']));await pending;assert.equal(f.reader.getSnapshot().a.confirmations['1'],stamp);assert.equal(f.reader.getSnapshot().a.confirmations['8'],undefined);
 f.reader.setInput(['a','b','c'],[]);f.time.advance(60000);f.reader.setInput(['a','b','c'],[]);assert.deepEqual(f.reader.getSnapshot().a.confirmations,{});assert.equal(f.calls.length,2);f.reader.stop();
});
test('expired cursor reports a partial scan, waits, and restarts its own head without refreshing old stamps',async()=>{
 let rejectCursor=true;const f=fixture({request:({input},page)=>input.cursor&&rejectCursor?{data:{unavailable:true,providerStatus:422}}:page(['1'],true,'expired')});
 await f.time.flush();const stamp=f.reader.getSnapshot().a.confirmations['1'];await f.time.flush();
 assert.equal(f.reader.getSnapshot().a.complete,false);assert.equal(f.reader.getSnapshot().a.cursor,null);assert.equal(f.reader.getSnapshot().a.confirmations['1'],stamp);assert.match(presenceStatus(f.reader.getSnapshot().a),/parcial.*cursor/);
 await f.time.flush();assert.equal(f.calls.length,2);rejectCursor=false;f.time.advance(45000);await f.time.flush();assert.equal(f.calls[2].input.cursor,undefined);assert.equal(f.calls[2].options.priority,'background');f.reader.stop();
});
test('three demanded models use independent round-robin pages with one request at a time',async()=>{
 let running=0,maximum=0;const f=fixture({request:async({input},page)=>{running++;maximum=Math.max(maximum,running);await Promise.resolve();running--;return page([String((input.creator_id==='a'?1:input.creator_id==='b'?2:3)+(input.cursor?10:0))],!input.cursor,input.cursor?null:input.creator_id+'-next')}});
 f.reader.setInput(['a','b','c'],['a','b','c']);for(let i=0;i<6;i++)await f.time.flush();
 assert.deepEqual(f.calls.map(c=>c.input.creator_id),['a','b','c','a','b','c']);assert.equal(maximum,1);
 for(const id of ['a','b','c'])assert.equal(f.reader.getSnapshot()[id].complete,true);f.reader.stop();
});
test('provider access denial clears previous confirmation; stop and new workspace never reuse cached state',async()=>{
 let denied=false;const f=fixture({request:(_,page)=>denied?{data:{unavailable:true,providerStatus:403}}:page(['1'])});
 await f.time.flush();denied=true;f.time.advance(45000);await f.time.flush();assert.deepEqual(f.reader.getSnapshot().a.confirmations,{});assert.equal(f.reader.getSnapshot().a.issue,'access');
 f.reader.stop();assert.deepEqual(f.reader.getSnapshot(),{});const other=fixture({workspace:'other'});assert.deepEqual(other.reader.getSnapshot().a.confirmations,{});other.reader.stop();
});
test('only an explicitly demanded online editor retains3s cadence; returning to chat restores45s without losing evidence',async()=>{
 const f=fixture();f.reader.setInput(['a','b','c'],['a'],{fastModel:'a'});await f.time.flush();assert.equal(f.reader.getSnapshot().a.nextAt,base+3000);
 f.time.advance(3000);await f.time.flush();assert.equal(f.calls.length,2);const stamp=f.reader.getSnapshot().a.confirmations['1'];
 f.reader.setInput(['a','b','c'],['a']);assert.equal(f.reader.getSnapshot().a.nextAt,base+48000);assert.equal(f.reader.getSnapshot().a.confirmations['1'],stamp);
 f.time.advance(3000);await f.time.flush();assert.equal(f.calls.length,2);f.time.advance(42000);await f.time.flush();assert.equal(f.calls.length,3);assert.ok(f.calls.slice(1).every(call=>call.options.priority==='background'));f.reader.stop();
});
test('online editor cadence cannot shorten RetryAfter or request an undemanded fast model',async()=>{
 const f=fixture({request:async()=>{throw Object.assign(Error('limited'),{status:429,retryAfter:20})}});f.reader.setInput(['a','b','c'],['a'],{fastModel:'a'});await f.time.flush();
 assert.equal(f.reader.getSnapshot().a.nextAt,base+20000);f.reader.setInput(['a','b','c'],['a'],{fastModel:'b'});f.time.advance(3000);await f.time.flush();assert.equal(f.calls.length,1);assert.equal(f.reader.getSnapshot().a.nextAt,base+20000);f.reader.stop();
});
