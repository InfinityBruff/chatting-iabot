import test from 'node:test';
import assert from 'node:assert/strict';
import {createConversationGalleryReader} from './conversation-gallery-reader.js';

const message=(id,extra={})=>({id:String(id),text:'Mensaje',isFromMe:true,price:5,isOpened:false,media:[],...extra});
const page=(messages=[],hasMore=false,cursor=null)=>({data:{messages,hasMore,cursor}});
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return {promise,resolve,reject}};
function clock(){let at=1000,id=0;const tasks=new Map();return {now:()=>at,schedule:(fn,ms)=>{tasks.set(++id,{fn,at:at+ms});return id},cancel:id=>tasks.delete(id),nextAt:()=>tasks.size?Math.min(...[...tasks.values()].map(x=>x.at)):null,advance:ms=>at+=ms,flush:async()=>{const item=[...tasks].sort((a,b)=>a[1].at-b[1].at)[0];if(!item)return;tasks.delete(item[0]);at=Math.max(at,item[1].at);await item[1].fn()}}}
function fixture(options={}){
 const time=clock(),calls=[],denials=[];let epoch=0,shown=true;
 const reader=createConversationGalleryReader({actor:'user',workspace:'agency',account:'model',fan:'123',...time,visible:()=>shown,cacheEpoch:()=>epoch,onDenied:error=>denials.push(error),...options,request:async(cursor,readOptions)=>{const call={cursor,options:readOptions,at:time.now()};calls.push(call);assert.equal(readOptions.active(),true);if(!options.queued)readOptions.onStart();return options.request?options.request(call):page([message(1)])}});
 return {reader,calls,time,denials,setEpoch:value=>epoch=value,show:value=>shown=value};
}

test('requires all scope fields and never reads before start',async()=>{
 for(const key of ['actor','workspace','account','fan'])assert.throws(()=>createConversationGalleryReader({actor:'u',workspace:'w',account:'a',fan:'1',request:()=>{},[key]:''}),TypeError);
 const f=fixture();assert.deepEqual(f.calls,[]);assert.equal(f.time.nextAt(),null);f.reader.refresh();f.reader.loadMore();await f.time.flush();assert.equal(f.calls.length,0);f.reader.start();await f.time.flush();assert.equal(f.calls.length,1);f.reader.stop();
});

test('seed history displays immediately but completeness and cursors come only from a new head walk',async()=>{
 const initial=page([message('900')],false,'stale');initial.data._extended=true;
 const f=fixture({initial,request:({cursor})=>cursor===null?page([message(1)],true,'new'):page([message(2)])});
 assert.deepEqual(f.reader.getSnapshot().messages.map(x=>x.id),['900']);assert.equal(f.reader.getSnapshot().complete,false);assert.equal(f.reader.getSnapshot().pages,0);
 f.reader.start();await f.time.flush();assert.equal(f.calls[0].cursor,null);assert.equal(f.calls[0].options.background,false);assert.equal(f.reader.getSnapshot().complete,false);
 await f.time.flush();assert.equal(f.calls[1].cursor,'new');assert.equal(f.calls[1].options.background,true);assert.equal(f.reader.getSnapshot().complete,true);assert.equal(f.reader.getSnapshot().pages,2);assert.deepEqual(f.reader.getSnapshot().messages.map(x=>x.id),['1','2']);f.reader.stop();
});

test('preserves incoming, free, unknown and paid media rows without inventing gallery classifications',async()=>{
 const input=[message(1,{isFromMe:false,isOpened:true}),message(2,{price:0}),message(3,{isOpened:null,price:null}),message(4,{isOpened:true,media:[{id:'file',canView:false}]})];
 const f=fixture({request:()=>page(input)});f.reader.start();await f.time.flush();assert.deepEqual(f.reader.getSnapshot().messages,input);f.reader.stop();
});

test('ingest merges by ID without changing fresh traversal metadata or accepting foreign-scoped seed data',async()=>{
 const f=fixture({initial:{...page([message('901')]),scope:JSON.stringify(['other','agency','model','123'])},request:()=>page([message(1)],true,'older')});
 assert.deepEqual(f.reader.getSnapshot().messages,[]);f.reader.start();await f.time.flush();
 f.reader.ingest(page([message(1,{isOpened:true}),message(8)]));assert.equal(f.reader.getSnapshot().messages.find(x=>x.id==='1').isOpened,false);assert.equal(f.reader.getSnapshot().pages,1);assert.equal(f.reader.getSnapshot().complete,false);
 f.reader.pauseScan();assert.equal(f.reader.ingest({...page([message(9)]),scope:'wrong'}),false);assert.equal(f.reader.getSnapshot().messages.length,2);f.reader.stop();
});

test('older pages are sequential, spaced at least 500ms and stop automatically at the provider end',async()=>{
 const f=fixture({spacing:1,request:({cursor})=>cursor===null?page([message(1)],true,'a'):cursor==='a'?page([message(2)],true,'b'):page([message(3)])});
 f.reader.start();await f.time.flush();assert.equal(f.time.nextAt(),1500);await f.time.flush();await f.time.flush();assert.deepEqual(f.calls.map(x=>x.at),[1000,1500,2000]);assert.equal(f.time.nextAt(),null);assert.equal(f.reader.getSnapshot().complete,true);assert.equal(f.reader.loadMore(),false);f.reader.stop();
});

test('stale thread ingestion cannot overwrite verified unlock state in either direction',async()=>{
 for(const fresh of [true,false]){const f=fixture({initial:page([message(1,{isOpened:!fresh}),message(2)]),request:()=>page([message(1,{isOpened:fresh})])});
 f.reader.ingest(page([message(2,{isOpened:true})]));assert.equal(f.reader.getSnapshot().messages.find(x=>x.id==='2').isOpened,true);f.reader.start();await f.time.flush();f.reader.ingest(page([message(1,{isOpened:!fresh})]));assert.equal(f.reader.getSnapshot().messages.find(x=>x.id==='1').isOpened,fresh);f.reader.stop()}
});

test('a complete fresh walk removes deleted seed/history rows and a later refresh can revoke an old unlock',async()=>{
 let heads=0;const f=fixture({initial:page([message('902'),message(1)]),request:({cursor})=>cursor===null?++heads===1?page([message(1,{isOpened:true})],true,'a'):page([message(1,{isOpened:false})]):page([message(2)])});
 f.reader.start();await f.time.flush();assert.equal(f.reader.getSnapshot().messages.some(x=>x.id==='902'),true);await f.time.flush();assert.deepEqual(f.reader.getSnapshot().messages.map(x=>x.id),['1','2']);assert.equal(f.reader.getSnapshot().complete,true);
 assert.equal(f.reader.ingest(page([message('902')])),false);assert.equal(f.reader.getSnapshot().messages.some(x=>x.id==='902'),false);f.reader.refresh();assert.equal(f.reader.getSnapshot().messages.length,2);await f.time.flush();assert.deepEqual(f.reader.getSnapshot().messages.map(x=>x.id),['1']);assert.equal(f.reader.getSnapshot().messages[0].isOpened,false);f.reader.ingest(page([message(1,{isOpened:true}),message(2)]));assert.equal(f.reader.getSnapshot().messages[0].isOpened,false);assert.equal(f.reader.getSnapshot().messages.length,1);f.reader.stop();
});

test('queued reads report waiting until the injected scheduler signals actual start',async()=>{
 const pending=deferred(),f=fixture({queued:true,request:()=>pending.promise});f.reader.start();const run=f.time.flush();await Promise.resolve();
 assert.equal(f.reader.getSnapshot().waiting,true);assert.equal(f.reader.getSnapshot().busy,false);f.calls[0].options.onStart();assert.equal(f.reader.getSnapshot().busy,true);assert.equal(f.reader.getSnapshot().waiting,false);
 pending.resolve(page());await run;assert.equal(f.reader.getSnapshot().busy,false);f.reader.stop();
});

test('hiding aborts an in-flight page, drops late results and retries the same page only after resume',async()=>{
 const pending=deferred();let reads=0;const f=fixture({request:({cursor})=>++reads===1?page([message(1)],true,'older'):reads===2?pending.promise:page([message(2)])});
 f.reader.start();await f.time.flush();const run=f.time.flush();await Promise.resolve();f.show(false);f.reader.resume();assert.equal(f.calls[1].options.signal.aborted,true);assert.equal(f.calls[1].options.active(),false);
 pending.resolve(page([message(99)]));await run;assert.deepEqual(f.reader.getSnapshot().messages.map(x=>x.id),['1']);assert.equal(f.time.nextAt(),null);f.show(true);f.reader.resume();await f.time.flush();assert.deepEqual(f.calls.map(x=>x.cursor),[null,'older','older']);assert.equal(f.reader.getSnapshot().complete,true);f.reader.stop();
});

test('a reader initially hidden does not queue a request until it becomes visible',async()=>{
 const f=fixture();f.show(false);f.reader.start();await f.time.flush();assert.equal(f.calls.length,0);f.show(true);f.reader.resume();await f.time.flush();assert.equal(f.calls.length,1);f.reader.stop();
});

test('stop aborts a late response and cannot mutate or schedule after dialog close',async()=>{
 const pending=deferred(),f=fixture({request:()=>pending.promise});f.reader.start();const run=f.time.flush();await Promise.resolve();f.reader.stop();assert.equal(f.calls[0].options.signal.aborted,true);pending.resolve(page([message(9)],true,'older'));await run;assert.deepEqual(f.reader.getSnapshot().messages,[]);assert.equal(f.time.nextAt(),null);assert.equal(f.reader.getSnapshot().busy,false);
});

test('restart before an aborted request settles does not overlap requests',async()=>{
 const pending=deferred();let reads=0;const f=fixture({request:()=>++reads===1?pending.promise:page([message(2)])});f.reader.start();const run=f.time.flush();await Promise.resolve();f.reader.stop();f.reader.start();await f.time.flush();assert.equal(f.calls.length,1);
 pending.resolve(page([message(99)]));await run;await f.time.flush();assert.equal(f.calls.length,2);assert.deepEqual(f.reader.getSnapshot().messages.map(x=>x.id),['2']);f.reader.stop();
});

test('pause stops automatic history but permits one manual page without restarting the scan',async()=>{
 const f=fixture({request:({cursor})=>cursor===null?page([message(1)],true,'a'):page([message(2)],true,'b')});f.reader.start();f.reader.pauseScan();await f.time.flush();assert.equal(f.calls.length,1);assert.equal(f.time.nextAt(),null);
 assert.equal(f.reader.loadMore(),true);await f.time.flush();assert.equal(f.calls.length,2);assert.equal(f.reader.getSnapshot().scanning,false);assert.equal(f.time.nextAt(),null);f.reader.toggleScan();assert.equal(f.reader.getSnapshot().scanning,true);assert.notEqual(f.time.nextAt(),null);f.reader.stop();
});

test('refresh aborts old history, keeps visible rows and follows only the new head cursor',async()=>{
 const pending=deferred();let heads=0;const f=fixture({request:({cursor})=>cursor===null?++heads===1?page([message(1)],true,'old'):page([message(1,{isOpened:true})],true,'new'):cursor==='old'?pending.promise:page([message(3)])});
 f.reader.start();await f.time.flush();const run=f.time.flush();await Promise.resolve();f.reader.refresh();assert.equal(f.calls[1].options.signal.aborted,true);assert.equal(f.reader.getSnapshot().messages.length,1);assert.equal(f.reader.getSnapshot().complete,false);assert.equal(f.reader.getSnapshot().pages,0);await f.time.flush();assert.equal(f.calls.length,2);
 pending.resolve(page([message(99)]));await run;await f.time.flush();await f.time.flush();assert.deepEqual(f.calls.map(x=>x.cursor),[null,'old',null,'new']);assert.equal(f.reader.getSnapshot().messages.find(x=>x.id==='1').isOpened,true);assert.equal(f.reader.getSnapshot().messages.some(x=>x.id==='99'),false);assert.equal(f.reader.getSnapshot().complete,true);f.reader.stop();
});

test('429 retries automatically and refresh/loadMore/toggles preserve RetryAfter',async()=>{
 let reads=0;const f=fixture({request:()=>++reads===1?Promise.reject(Object.assign(Error('Límite'),{status:429,retryAfter:7})):page([message(1)])});
 f.reader.start();await f.time.flush();assert.equal(f.reader.getSnapshot().waiting,true);assert.equal(f.reader.getSnapshot().error,'');assert.equal(f.time.nextAt(),8000);
 f.reader.refresh();f.reader.loadMore();f.reader.pauseScan();f.reader.toggleScan();assert.equal(f.time.nextAt(),8000);await f.time.flush();assert.equal(f.calls[1].at,8000);assert.equal(f.reader.getSnapshot().waiting,false);f.reader.stop();
});

test('a manually requested paused cursor retries 429 once without scanning following pages',async()=>{
 let reads=0;const f=fixture({request:()=>++reads===1?page([message(1)],true,'a'):reads===2?Promise.reject(Object.assign(Error('Límite'),{status:429,retryAfter:2})):page([message(2)],true,'b')});
 f.reader.start();f.reader.pauseScan();await f.time.flush();f.reader.loadMore();await f.time.flush();assert.equal(f.time.nextAt(),3500);await f.time.flush();assert.deepEqual(f.calls.map(x=>x.cursor),[null,'a','a']);assert.equal(f.time.nextAt(),null);f.reader.stop();
});

test('ordinary errors preserve rows, pause scanning and require an explicit retry',async()=>{
 let reads=0;const f=fixture({request:()=>++reads===1?page([message(1)],true,'a'):reads===2?Promise.reject(Error('Fallo simulado')):page([message(2)])});
 f.reader.start();await f.time.flush();await f.time.flush();assert.equal(f.reader.getSnapshot().scanning,false);assert.equal(f.reader.getSnapshot().error,'Fallo simulado');assert.equal(f.time.nextAt(),null);assert.equal(f.reader.getSnapshot().messages.length,1);f.reader.loadMore();await f.time.flush();assert.equal(f.reader.getSnapshot().complete,true);f.reader.stop();
});

test('401/403 revoke all seeded and fetched data, call onDenied once and prevent every retry path',async()=>{
 for(const status of [401,403]){const f=fixture({initial:page([message('900')]),request:()=>Promise.reject(Object.assign(Error('Sin permiso'),{status}))});f.reader.start();await f.time.flush();assert.equal(f.denials.length,1);assert.deepEqual(f.reader.getSnapshot().messages,[]);assert.equal(f.reader.getSnapshot().updated,null);assert.equal(f.reader.getSnapshot().complete,false);
 f.reader.refresh();f.reader.loadMore();f.reader.toggleScan();f.reader.resume();f.reader.stop();f.reader.start();f.reader.ingest(page([message(9)]));await f.time.flush();assert.equal(f.calls.length,1);assert.equal(f.denials.length,1)}
});

test('cache epoch revocation clears data and rejects an in-flight response and subsequent ingestion',async()=>{
 const pending=deferred(),f=fixture({initial:page([message(1)]),request:()=>pending.promise});f.reader.start();const run=f.time.flush();await Promise.resolve();f.setEpoch(1);assert.equal(f.calls[0].options.active(),false);f.reader.resume();assert.equal(f.calls[0].options.signal.aborted,true);assert.deepEqual(f.reader.getSnapshot().messages,[]);pending.resolve(page([message(2)]));await run;f.reader.ingest(page([message(3)]));assert.deepEqual(f.reader.getSnapshot().messages,[]);assert.equal(f.denials.length,1);assert.equal(f.time.nextAt(),null);f.reader.stop();
});

test('missing or repeated cursors stop with explicit partial data instead of claiming completion',async()=>{
 for(const invalid of [null,'a']){let reads=0;const f=fixture({request:()=>++reads===1?page([message(1)],true,'a'):page([message(2)],true,invalid)});f.reader.start();await f.time.flush();await f.time.flush();assert.equal(f.reader.getSnapshot().messages.length,2);assert.equal(f.reader.getSnapshot().complete,false);assert.equal(f.reader.getSnapshot().scanning,false);assert.match(f.reader.getSnapshot().error,/parcial/);assert.equal(f.time.nextAt(),null);f.reader.stop()}
});

test('invalid message IDs and malformed pages cannot certify a complete traversal',async()=>{
 for(const result of [page([message(1),{text:'missing ID'}]),{data:{messages:[message(1)]}}]){const f=fixture({request:()=>result});f.reader.start();await f.time.flush();assert.equal(f.reader.getSnapshot().complete,false);assert.equal(f.reader.getSnapshot().scanning,false);assert.ok(f.reader.getSnapshot().error);assert.equal(f.time.nextAt(),null);f.reader.stop()}
});

test('authoritative message IDs must be positive numeric strings or safe positive integers',async()=>{
 for(const id of ['garbage','0','1.5','01','1e3','-1','1'.repeat(25),0,-1,1.5,Number.MAX_SAFE_INTEGER+1]){
  const f=fixture({request:()=>page([message(7),message(8,{id})])});f.reader.start();await f.time.flush();assert.deepEqual(f.reader.getSnapshot().messages.map(x=>x.id),['7']);assert.equal(f.reader.getSnapshot().complete,false);assert.equal(f.reader.getSnapshot().scanning,false);assert.match(f.reader.getSnapshot().error,/identificador válido/);assert.equal(f.time.nextAt(),null);f.reader.stop();
 }
 const valid=fixture({request:()=>page([message(1,{id:Number.MAX_SAFE_INTEGER}),message('1'.repeat(24))])});valid.reader.start();await valid.time.flush();assert.equal(valid.reader.getSnapshot().complete,true);assert.equal(valid.reader.getSnapshot().messages.length,2);valid.reader.stop();
});

test('provider cursors accept the backend 2048-character boundary and stop partial above it',async()=>{
 for(const length of [2048,2049]){
  const cursor='a'.repeat(length),f=fixture({request:({cursor:requested})=>requested===null?page([message(1)],true,cursor):page([message(2)])});f.reader.start();await f.time.flush();
  if(length===2048){assert.equal(f.time.nextAt(),1500);await f.time.flush();assert.equal(f.calls[1].cursor,cursor);assert.equal(f.reader.getSnapshot().complete,true)}
  else{assert.equal(f.calls.length,1);assert.equal(f.reader.getSnapshot().complete,false);assert.equal(f.reader.getSnapshot().scanning,false);assert.match(f.reader.getSnapshot().error,/continuar este historial/);assert.equal(f.time.nextAt(),null)}f.reader.stop();
 }
});

test('message and byte caps pause explicitly, retain bounded rows and cannot be bypassed by manual reads',async()=>{
 for(const limits of [{maxMessages:2},{maxBytes:300}]){const f=fixture({...limits,request:()=>page([message(1),message(2),message(3)])});f.reader.start();await f.time.flush();assert.equal(f.reader.getSnapshot().complete,false);assert.equal(f.reader.getSnapshot().scanning,false);assert.match(f.reader.getSnapshot().error,/límite de memoria/);assert.ok(f.reader.getSnapshot().messages.length<=2);f.reader.refresh();f.reader.loadMore();f.reader.toggleScan();await f.time.flush();assert.equal(f.calls.length,1);f.reader.stop()}
});
