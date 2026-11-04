import test from 'node:test';
import assert from 'node:assert/strict';
import {createFanActivityReader} from './fan-activity-reader.js';
const base=Date.parse('2026-11-04T12:00:00Z'),start='2026-10-05';
const row=id=>({id:String(id),type:'tip',amount:5,createdAt:new Date(base).toISOString()});
function clock(){let at=base;const tasks=new Map();return {now:()=>at,schedule:(fn,ms)=>(tasks.set(fn,at+ms),fn),cancel:fn=>tasks.delete(fn),advance:ms=>at+=ms,nextAt:()=>Math.min(...tasks.values()),flush:async()=>{const first=[...tasks].sort((a,b)=>a[1]-b[1])[0];if(!first)return;tasks.delete(first[0]);at=Math.max(at,first[1]);await first[0]()}}}
function fixture({request,initial,visible=()=>true,epoch=()=>0,time=clock(),account='a',fan='1',periodStart=start}={}){
 const calls=[],cached=[];let denials=0;
 const page=(rows=[row(1)],hasMore=false,cursor=null)=>({data:{transactions:rows,hasMore,cursor},observedAt:new Date(time.now()).toISOString()});
 const reader=createFanActivityReader({...time,workspace:'w',account,fan,start:periodStart,initial,visible,epoch,onCache:value=>cached.push(value),onDenied:()=>denials++,request:async(w,operation,input,options)=>{assert.equal(w,'w');assert.equal(operation,'fan_activity');assert.equal(options.active(),true);const call={input,options};calls.push(call);return request?request(call,page):page()}});
 reader.start();return {reader,time,calls,cached,page,denials:()=>denials};
}
test('cold visible head is prioritized, while cursor pages and30s polls keep background priority',async()=>{
 let reads=0;const f=fixture({request:(_,page)=>++reads===1?page([row(1)],true,'next'):page([row(2)])});
 await f.time.flush();assert.equal(f.reader.getSnapshot().rows.length,1);await f.time.flush();assert.equal(f.reader.getSnapshot().complete,true);await f.time.flush();
 assert.deepEqual(f.calls.map(c=>[c.input.cursor||null,c.options.priority]),[[null,'fan-visible'],['next','background'],[null,'background']]);assert.equal(f.time.now(),base+31000);f.reader.stop();
});
test('return to partial cached fan/period displays original data immediately and resumes the accepted cursor',async()=>{
 const first=fixture({request:(_,page)=>page([row(1)],true,'next')});await first.time.flush();const saved=first.cached[0];first.reader.stop();
 const f=fixture({initial:saved,time:first.time,request:(_,page)=>page([row(2)])});
 assert.equal(f.reader.getSnapshot().updated,saved.state.updated);assert.deepEqual(f.reader.getSnapshot().rows.map(r=>r.id),['1']);assert.equal(f.reader.getSnapshot().busy,false);await f.time.flush();
 assert.equal(f.calls[0].input.cursor,'next');assert.equal(f.calls[0].options.priority,'background');assert.deepEqual(f.reader.getSnapshot().rows.map(r=>r.id).sort(),['1','2']);f.reader.stop();
});
test('completed cached data retains its30s poll deadline and cached scope cannot cross model, fan or period',async()=>{
 const first=fixture();await first.time.flush();const saved=first.cached[0];first.reader.stop();
 const f=fixture({initial:saved,time:first.time});assert.equal(f.reader.getSnapshot().updated,saved.state.updated);assert.equal(f.time.nextAt(),base+30000);await f.time.flush();assert.equal(f.calls.length,1);assert.equal(f.calls[0].options.priority,'background');f.reader.stop();
 for(const change of [{account:'b'},{fan:'2'},{periodStart:'2016-01-01'}]){const other=fixture({initial:saved,...change});assert.deepEqual(other.reader.getSnapshot().rows,[]);assert.equal(other.reader.getSnapshot().updated,undefined);other.reader.stop()}
});
test('visibility and unmount abort pending reads without dropping confirmed rows or admitting late cache writes',async()=>{
 let shown=true,release,reads=0;const f=fixture({visible:()=>shown,request:(_,page)=>++reads===1?page():new Promise(resolve=>release=resolve)});
 await f.time.flush();const old=f.reader.getSnapshot().updated,pending=f.time.flush();await Promise.resolve();shown=false;f.reader.resume();assert.equal(f.calls[1].options.signal.aborted,true);assert.equal(f.calls[1].options.active(),false);
 release(f.page([row(9)]));await pending;assert.equal(f.reader.getSnapshot().updated,old);assert.equal(f.cached.length,1);assert.equal(f.reader.getSnapshot().rows[0].id,'1');
 shown=true;f.reader.resume();const next=f.time.flush();await Promise.resolve();f.reader.stop();assert.equal(f.calls[2].options.signal.aborted,true);release(f.page([row(8)]));await next;assert.equal(f.cached.length,1);
});
test('access denial clears data and halts all polling and manual retries',async()=>{
 const f=fixture({request:async()=>{throw Object.assign(Error('Sin acceso'),{status:403})}});await f.time.flush();assert.equal(f.denials(),1);assert.deepEqual(f.reader.getSnapshot().rows,[]);
 f.reader.resume();f.reader.refresh();f.reader.restart();await f.time.flush();assert.equal(f.calls.length,1);f.reader.stop();
});
test('a cache epoch change rejects a late result and stops a stale scoped reader',async()=>{
 let generation=0,release;const f=fixture({epoch:()=>generation,request:()=>new Promise(resolve=>release=resolve)});const pending=f.time.flush();await Promise.resolve();generation++;release(f.page());await pending;
 assert.equal(f.cached.length,0);assert.deepEqual(f.reader.getSnapshot().rows,[]);assert.match(f.reader.getSnapshot().error,/acceso ha cambiado/);f.reader.resume();await f.time.flush();assert.equal(f.calls.length,1);f.reader.stop();
});
test('manual refresh and full restart preserve RetryAfter instead of bypassing quota wait',async()=>{
 let reads=0;const f=fixture({request:async(_,page)=>{if(++reads===1)throw Object.assign(Error('Límite'),{status:429,retryAfter:7});return page()}});
 await f.time.flush();assert.equal(f.reader.getSnapshot().waiting,true);f.reader.refresh();f.reader.restart();assert.equal(f.time.nextAt(),base+7000);await f.time.flush();assert.equal(f.calls.length,2);assert.equal(f.reader.getSnapshot().waiting,false);f.reader.stop();
});
test('manual and five-minute full reviews preserve visible rows until a confirmed complete replacement',async()=>{
 let reads=0;const f=fixture({request:(_,page)=>page([row(++reads)])});await f.time.flush();f.reader.restart();assert.equal(f.reader.getSnapshot().rows[0].id,'1');await f.time.flush();assert.deepEqual(f.reader.getSnapshot().rows.map(r=>r.id),['2']);
 f.time.advance(300000);await f.time.flush();assert.equal(f.reader.getSnapshot().pages,1);assert.deepEqual(f.reader.getSnapshot().rows.map(r=>r.id),['3']);assert.equal(f.calls[2].input.cursor,undefined);assert.equal(f.calls[2].options.priority,'background');f.reader.stop();
});
test('a failed completed-head poll can rebuild with the same valid provider cursor without a false repeat',async()=>{
 let reads=0;const f=fixture({request:({input},page)=>{reads++;if(reads===3)throw Error('Fallo temporal');return !input.cursor?page([row(1)],true,'next'):page([row(2)])}});
 await f.time.flush();await f.time.flush();await f.time.flush();assert.equal(f.reader.getSnapshot().rows.length,2);
 await f.time.flush();assert.equal(f.reader.getSnapshot().error,'');await f.time.flush();assert.equal(f.reader.getSnapshot().complete,true);assert.deepEqual(f.calls.map(c=>c.input.cursor||null),[null,'next',null,null,'next']);f.reader.stop();
});
test('a rejected partial cursor resets to a bounded fresh traversal, preserves rows and honors provider RetryAfter',async()=>{
 let reads=0;const f=fixture({request:({input},page)=>{reads++;if(reads===1)return page([row(1)],true,'expired');if(reads===2)throw Object.assign(Error('Cursor rechazado'),{status:502,providerStatus:422,retryAfter:90});return input.cursor?page([row(2)]):page([row(1)],true,'new-cursor')}});
 await f.time.flush();const updated=f.reader.getSnapshot().updated;await f.time.flush();
 assert.equal(f.reader.getSnapshot().rows[0].id,'1');assert.equal(f.reader.getSnapshot().updated,updated);assert.equal(f.reader.getSnapshot().complete,false);assert.equal(f.cached.at(-1).cursor,null);
 assert.equal(f.time.nextAt(),base+91000);f.reader.refresh();assert.equal(f.time.nextAt(),base+91000);await f.time.flush();await f.time.flush();
 assert.deepEqual(f.calls.map(c=>c.input.cursor||null),[null,'expired',null,'new-cursor']);assert.equal(f.reader.getSnapshot().complete,true);assert.deepEqual(f.reader.getSnapshot().rows.map(r=>r.id).sort(),['1','2']);f.reader.stop();
});
test('invalid400 head after a cursor reset backs off instead of repeatedly resetting or retrying fast',async()=>{
 let reads=0;const f=fixture({request:(_,page)=>++reads===1?page([row(1)],true,'expired'):Promise.reject(Object.assign(Error('Parámetro rechazado'),{status:400}))});
 await f.time.flush();await f.time.flush();assert.equal(f.time.nextAt(),base+61000);await f.time.flush();assert.equal(f.time.nextAt(),base+181000);
 assert.deepEqual(f.calls.map(c=>c.input.cursor||null),[null,'expired',null]);assert.equal(f.reader.getSnapshot().rows[0].id,'1');f.reader.stop();
});
