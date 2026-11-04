import test from 'node:test';import assert from 'node:assert/strict';
import {observeNearViewportOnce} from './near-viewport-once.js';
function fixture(){let callback,settings,observed,disconnected=false;const root={},element={closest:selector=>{assert.equal(selector,'.workspace-content');return root}};class Observer{constructor(fn,options){callback=fn;settings=options}observe(value){observed=value}disconnect(){disconnected=true}}return {root,element,Observer,emit:entries=>callback(entries),settings:()=>settings,observed:()=>observed,disconnected:()=>disconnected}}
test('offscreen transaction demand waits for its own near-viewport entry and keeps the admitted page across scroll reentry',()=>{
 const f=fixture();let mounts=0,page=null;const cleanup=observeNearViewportOnce(f.element,()=>{mounts++;page={rows:['confirmed'],cursor:'next-page'}},{Observer:f.Observer});
 assert.equal(f.observed(),f.element);assert.deepEqual(f.settings(),{root:f.root,rootMargin:'200px 0px'});assert.equal(mounts,0);
 f.emit([{target:f.element,isIntersecting:false},{target:{},isIntersecting:true}]);assert.equal(mounts,0);
 f.emit([{target:f.element,isIntersecting:true}]);assert.equal(mounts,1);assert.equal(f.disconnected(),true);const admitted=page;
 f.emit([{target:f.element,isIntersecting:false}]);f.emit([{target:f.element,isIntersecting:true}]);assert.equal(mounts,1);assert.equal(page,admitted);assert.equal(page.cursor,'next-page');cleanup();
});
test('disposing an unvisited period disconnects observation and cannot admit a late callback',()=>{
 const f=fixture();let calls=0;const cleanup=observeNearViewportOnce(f.element,()=>calls++,{Observer:f.Observer});cleanup();f.emit([{target:f.element,isIntersecting:true}]);assert.equal(f.disconnected(),true);assert.equal(calls,0);
});
test('a real section remains available without IntersectionObserver and a missing element cannot request data',()=>{
 let calls=0;const cleanup=observeNearViewportOnce({closest:()=>null},()=>calls++,{Observer:null});assert.equal(calls,1);cleanup();observeNearViewportOnce(null,()=>calls++,{Observer:null})();assert.equal(calls,1);
});
