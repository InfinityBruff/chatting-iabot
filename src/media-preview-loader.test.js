import test from 'node:test';import assert from 'node:assert/strict';
import {createMediaPreviewLoader,previewSources,previewsExpired} from './media-preview-loader.js';
function setup(options={}){
 let time=0,id=0;const timers=new Map(),images=[],starts=[];
 const loader=createMediaPreviewLoader({now:()=>time,schedule:(fn,delay)=>{timers.set(++id,{fn,at:time+delay});return id},cancel:id=>timers.delete(id),createImage:()=>{const image={set src(value){this.value=value;if(value)starts.push(value)},get src(){return this.value}};images.push(image);return image},...options});
 return {loader,images,starts,advance(ms){time+=ms;for(const [id,t]of [...timers])if(t.at<=time){timers.delete(id);t.fn()}},ok(i){images[i].onload?.()},fail(i){images[i].onerror?.()}};
}
test('visible consumers share one image request and a ready result; source URLs isolate models',()=>{
 const f=setup(),a=[],b=[];f.loader.subscribe(['account-a/thumb'],x=>a.push(x));f.loader.subscribe(['account-a/thumb'],x=>b.push(x));assert.equal(f.images.length,1);f.ok(0);assert.equal(a.at(-1).state,'ready');assert.equal(b.at(-1).src,'account-a/thumb');f.loader.subscribe(['account-a/thumb'],()=>{});assert.equal(f.images.length,1);f.loader.subscribe(['account-b/thumb'],()=>{});assert.equal(f.images.length,2);
});
test('image starts respect concurrency, eager priority and a rolling request budget',()=>{
 const f=setup({concurrency:1,budget:2,windowMs:1000});f.loader.subscribe(['first'],()=>{});f.loader.subscribe(['background'],()=>{});f.loader.subscribe(['selected'],()=>{},{priority:2});assert.deepEqual(f.starts,['first']);f.ok(0);assert.deepEqual(f.starts,['first','selected']);f.ok(1);assert.equal(f.images.length,2);f.advance(999);assert.equal(f.images.length,2);f.advance(1);assert.deepEqual(f.starts,['first','selected','background']);
});
test('broken thumbnails do not pause healthy files or try every variant',()=>{
 const f=setup({concurrency:1});for(let i=0;i<4;i++)f.loader.subscribe(['thumb'+i,'preview'+i,'full'+i],()=>{});f.loader.subscribe(['healthy'],()=>{});for(let i=0;i<4;i++)f.fail(i);assert.deepEqual(f.starts,['thumb0','thumb1','thumb2','thumb3','healthy']);f.ok(4);
});
test('opening a failed thumbnail tries one light alternative and shares recovery with the grid',()=>{
 const f=setup(),grid=[],viewer=[];f.loader.subscribe(['thumb','square','full'],x=>grid.push(x));f.fail(0);f.loader.subscribe(['thumb','square','full'],x=>viewer.push(x),{priority:4,allowFallback:true});assert.deepEqual(f.starts,['thumb','square']);f.ok(1);assert.equal(grid.at(-1).src,'square');assert.equal(viewer.at(-1).src,'square');
});
test('an explicit preview gets a reserved connection and request budget before background images',()=>{
 const f=setup({concurrency:1,budget:8,windowMs:1000});for(let i=0;i<7;i++){f.loader.subscribe(['normal'+i],()=>{});f.ok(i)}f.loader.subscribe(['background'],()=>{});assert.equal(f.images.length,7);f.loader.subscribe(['viewer'],()=>{},{priority:4});assert.equal(f.images.length,8);f.ok(7);f.advance(1000);assert.equal(f.starts.at(-1),'background');
 const g=setup({concurrency:1});g.loader.subscribe(['normal'],()=>{});g.loader.subscribe(['viewer'],()=>{},{priority:4});g.loader.subscribe(['other viewer'],()=>{},{priority:4});assert.equal(g.images.length,2);g.ok(1);assert.equal(g.images.length,3);
});
test('leaving a folder cancels unfinished requests and never starts its queued thumbnails',()=>{
 const f=setup({concurrency:1});const stopA=f.loader.subscribe(['a'],()=>{}),stopB=f.loader.subscribe(['b'],()=>{});stopB();stopA();assert.equal(f.images[0].src,'');assert.equal(f.images.length,1);f.loader.subscribe(['c'],()=>{});assert.deepEqual(f.starts,['a','c']);
});
test('clearing access cancels images and late callbacks, clears cache, and retains rate budget',()=>{
 const f=setup({concurrency:1,budget:1,windowMs:1000}),events=[];f.loader.subscribe(['a'],x=>events.push(x));let reset=0;f.loader.onReset(()=>reset++);const old=f.images[0].onload;f.loader.clear();old();assert.equal(reset,1);assert.equal(events.at(-1).state,'loading');f.loader.subscribe(['b'],()=>{});assert.equal(f.images.length,1);f.advance(1000);assert.equal(f.images.length,2);
});
test('a valid image completing after twelve seconds stays in flight and becomes ready before the thirty-second deadline',()=>{
 const f=setup(),states=[];f.loader.subscribe(['slow-but-valid'],x=>states.push(x));
 f.advance(12001);assert.equal(states.at(-1).state,'loading');assert.equal(f.images[0].src,'slow-but-valid');
 f.advance(7999);f.ok(0);assert.equal(states.at(-1).state,'ready');assert.equal(states.at(-1).src,'slow-but-valid');
 f.advance(10000);assert.equal(states.at(-1).state,'ready');assert.deepEqual(f.starts,['slow-but-valid']);
});
test('a genuinely hung image is canceled at thirty seconds and releases its slot exactly once',()=>{
 const f=setup({concurrency:1}),states=[];f.loader.subscribe(['hung'],x=>states.push(x));const late=f.images[0].onload;
 f.loader.subscribe(['healthy'],()=>{});f.advance(29999);assert.equal(states.at(-1).state,'loading');assert.deepEqual(f.starts,['hung']);
 f.advance(1);assert.equal(states.at(-1).state,'error');assert.equal(f.images[0].src,'');assert.deepEqual(f.starts,['hung','healthy']);
 late();assert.equal(states.at(-1).state,'error');f.loader.subscribe(['third'],()=>{});assert.deepEqual(f.starts,['hung','healthy']);
 f.ok(1);assert.deepEqual(f.starts,['hung','healthy','third']);
});
test('the image deadline is configurable without changing concurrency or retries',()=>{
 const f=setup({concurrency:1,timeoutMs:5000}),states=[];f.loader.subscribe(['hung'],x=>states.push(x));f.loader.subscribe(['next'],()=>{});
 f.advance(4999);assert.equal(states.at(-1).state,'loading');assert.equal(f.starts.length,1);
 f.advance(1);assert.equal(states.at(-1).state,'error');assert.deepEqual(f.starts,['hung','next']);
});
test('an immediate image error such as HTTP 410 still fails immediately without automatic grid fanout',()=>{
 const f=setup({concurrency:1}),states=[];f.loader.subscribe(['refused-thumb','other-variant','original'],x=>states.push(x));f.loader.subscribe(['healthy'],()=>{});
 f.images[0].onerror({type:'error',status:410});assert.equal(states.at(-1).state,'error');assert.deepEqual(f.starts,['refused-thumb','healthy']);
 f.ok(1);f.advance(30000);assert.deepEqual(f.starts,['refused-thumb','healthy']);assert.equal(states.at(-1).state,'error');
});
test('a ready cache expires without persistent media storage',()=>{
 const f=setup({ttl:1000});const off=f.loader.subscribe(['a'],()=>{});f.ok(0);off();f.advance(1001);f.loader.subscribe(['a'],()=>{});assert.equal(f.images.length,2);
});
test('locked media has no source and a viewer reuses the lightweight thumbnail before larger files',()=>{
 const item={type:'photo',preview:'thumb',previewSources:['thumb','square','preview','full'],url:'original'};assert.deepEqual(previewSources({...item,canView:false}),[]);assert.equal(previewSources(item)[0],'thumb');assert.equal(previewSources(item,true)[0],'thumb');assert.deepEqual(previewSources({type:'video',url:'video-file'}),[]);
});
test('a mounted image element is used directly, avoiding a second preload/download',()=>{
 const f=setup(),element={};f.loader.subscribe(['thumb'],()=>{},{element});assert.equal(f.images.length,0);assert.equal(element.src,'thumb');element.onload();assert.equal(element.onload,null);
});

test('only known expired signed URLs request a listing renewal',()=>{assert.equal(previewsExpired(['https://api.ofmapi.com/image?exp=1'],2000),true);assert.equal(previewsExpired(['https://api.ofmapi.com/image?exp=3'],2000),false);assert.equal(previewsExpired(['blob:local'],2000),false);assert.equal(previewsExpired([],2000),false)});

test('an explicit refresh recovers a persistent error with unchanged URLs for all live consumers',()=>{
 const f=setup(),grid=[],selected=[];
 f.loader.subscribe(['account-a/thumb'],v=>grid.push(v));f.fail(0);
 f.advance(300000);f.loader.subscribe(['account-a/thumb'],v=>selected.push(v));
 assert.deepEqual(f.starts,['account-a/thumb']);assert.equal(selected.at(-1).state,'error');
 f.loader.retryFailed(['account-a/thumb'],'refresh-1');
 f.loader.retryFailed(['account-a/thumb'],'refresh-1');
 assert.deepEqual(f.starts,['account-a/thumb','account-a/thumb']);f.ok(1);
 assert.equal(grid.at(-1).state,'ready');assert.equal(selected.at(-1).state,'ready');
});

test('refresh leaves ready files, in-flight requests and errors from other accounts intact',()=>{
 const f=setup(),other=[];
 f.loader.subscribe(['ready'],()=>{});f.ok(0);
 f.loader.subscribe(['loading'],()=>{});const liveImage=f.images[1];
 f.loader.subscribe(['account-b/error'],v=>other.push(v));f.fail(2);
 f.loader.retryFailed(['ready'],'refresh-1');f.loader.retryFailed(['loading'],'refresh-1');
 assert.equal(liveImage.src,'loading');assert.equal(f.images.length,3);
 f.fail(1);f.loader.retryFailed(['loading'],'refresh-1');
 assert.equal(f.images.length,3);assert.equal(other.at(-1).state,'error');
 f.loader.retryFailed(['loading'],'refresh-2');assert.equal(f.images.length,4);
 assert.equal(other.at(-1).state,'error');
});

test('manual thumbnail retries keep the rolling budget and concurrency limits',()=>{
 const f=setup({concurrency:1,budget:2,windowMs:1000});
 f.loader.subscribe(['thumb'],()=>{});f.fail(0);f.loader.subscribe(['busy'],()=>{});
 f.loader.retryFailed(['thumb'],'refresh-1');assert.deepEqual(f.starts,['thumb','busy']);
 f.ok(1);assert.deepEqual(f.starts,['thumb','busy']);f.advance(999);assert.equal(f.starts.length,2);
 f.advance(1);assert.deepEqual(f.starts,['thumb','busy','thumb']);
});

test('an explicit thumbnail refresh never cascades through alternatives or the original',()=>{
 const f=setup(),states=[];
 f.loader.subscribe(['thumb','square','original'],v=>states.push(v),{allowFallback:true});
 f.fail(0);f.fail(1);assert.deepEqual(f.starts,['thumb','square']);
 f.loader.retryFailed(['thumb','square','original'],'refresh-1');f.fail(2);
 f.loader.retryFailed(['thumb','square','original'],'refresh-1');
 assert.deepEqual(f.starts,['thumb','square','thumb']);assert.equal(states.at(-1).state,'error');
});

test('refresh skips expired or unobserved errors and cancelled retries release their slot',()=>{
 const f=setup({concurrency:1}),expired='https://example.test/thumb?exp=1';
 f.loader.subscribe([expired],()=>{});f.fail(0);f.advance(2000);
 f.loader.retryFailed([expired],'refresh-1');assert.equal(f.starts.length,1);
 const stopHidden=f.loader.subscribe(['hidden'],()=>{});f.fail(1);stopHidden();
 f.loader.retryFailed(['hidden'],'refresh-1');assert.equal(f.starts.length,2);
 const stop=f.loader.subscribe(['visible'],()=>{});f.fail(2);
 f.loader.retryFailed(['visible'],'refresh-1');const late=f.images[3].onload;
 stop();assert.equal(f.images[3].src,'');late();
 f.loader.subscribe(['next'],()=>{});assert.equal(f.starts.at(-1),'next');
 f.loader.clear();f.loader.retryFailed(['visible'],'refresh-2');assert.equal(f.starts.length,5);
});
