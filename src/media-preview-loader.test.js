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
test('stalled images time out and a ready cache expires without persistent media storage',()=>{
 const f=setup({concurrency:1,ttl:1000}),states=[];const stop=f.loader.subscribe(['a'],x=>states.push(x));f.advance(20000);assert.equal(states.at(-1).state,'error');stop();const off=f.loader.subscribe(['b'],()=>{});f.ok(1);off();f.advance(1001);f.loader.subscribe(['b'],()=>{});assert.equal(f.images.length,3);
});
test('locked media has no source and a viewer reuses the lightweight thumbnail before larger files',()=>{
 const item={type:'photo',preview:'thumb',previewSources:['thumb','square','preview','full'],url:'original'};assert.deepEqual(previewSources({...item,canView:false}),[]);assert.equal(previewSources(item)[0],'thumb');assert.equal(previewSources(item,true)[0],'thumb');assert.deepEqual(previewSources({type:'video',url:'video-file'}),[]);
});
test('a mounted image element is used directly, avoiding a second preload/download',()=>{
 const f=setup(),element={};f.loader.subscribe(['thumb'],()=>{},{element});assert.equal(f.images.length,0);assert.equal(element.src,'thumb');element.onload();assert.equal(element.onload,null);
});

test('only known expired signed URLs request a listing renewal',()=>{assert.equal(previewsExpired(['https://api.ofmapi.com/image?exp=1'],2000),true);assert.equal(previewsExpired(['https://api.ofmapi.com/image?exp=3'],2000),false);assert.equal(previewsExpired(['blob:local'],2000),false);assert.equal(previewsExpired([],2000),false)});
