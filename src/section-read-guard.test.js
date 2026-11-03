import test from 'node:test';
import assert from 'node:assert/strict';
import {createSectionReadGuard} from './section-read-guard.js';
import {createReadScheduler} from './live-read-scheduler.js';

test('a fan section scrolled away while queued does not contact the provider or replace its cached data',async()=>{
 const scheduler=createReadScheduler({minimumGap:0,settleMs:0}),cached={rows:[{id:'existing'}],complete:true,pages:4};
 let visible=true,calls=0,release;const occupied=scheduler.primary(()=>new Promise(resolve=>release=resolve));
 const guard=createSectionReadGuard({current:()=>true,visible:()=>visible});
 const read=scheduler.secondary(async()=>{calls++;cached.rows=[]},guard.active),rejected=assert.rejects(read,{name:'AbortError'});
 visible=false;release();await occupied;await rejected;
 assert.equal(calls,0);assert.equal(guard.deferred(),true);assert.equal(guard.resume(),false);
 assert.deepEqual(cached,{rows:[{id:'existing'}],complete:true,pages:4});
});

test('returning during queue cleanup permits one immediate resume with no overlapping or repeated reads',async()=>{
 let visible=false,calls=0;const guard=createSectionReadGuard({current:()=>true,visible:()=>visible});
 assert.equal(guard.active(),false);visible=true;assert.equal(guard.resume(),true);assert.equal(guard.resume(),false);
 const scheduler=createReadScheduler({minimumGap:0,settleMs:0});
 const resumed=createSectionReadGuard({current:()=>true,visible:()=>visible});
 assert.equal(await scheduler.secondary(async()=>++calls,resumed.active),1);assert.equal(resumed.resume(),false);assert.equal(calls,1);
});

test('a different fan or model invalidates a deferred read and cannot resume it',()=>{
 let version=1,visible=false;const guard=createSectionReadGuard({current:()=>version===1,visible:()=>visible});
 assert.equal(guard.active(),false);version++;visible=true;assert.equal(guard.active(),false);assert.equal(guard.resume(),false);
});

test('a hidden document defers a queued section even if its viewport intersection remains true',()=>{
 let documentVisible=false;const guard=createSectionReadGuard({current:()=>true,visible:()=>documentVisible});
 assert.equal(guard.active(),false);assert.equal(guard.deferred(),true);assert.equal(guard.resume(),false);
 documentVisible=true;assert.equal(guard.resume(),true);assert.equal(guard.resume(),false);
});

test('a read already started can finish and retain its data after scrolling away without triggering another poll',async()=>{
 let visible=true,finish,calls=0;const guard=createSectionReadGuard({current:()=>true,visible:()=>visible}),scheduler=createReadScheduler({minimumGap:0,settleMs:0});
 const read=scheduler.secondary(()=>new Promise(resolve=>{calls++;finish=resolve}),guard.active);
 visible=false;finish({rows:[{id:'new'}],complete:true});
 assert.deepEqual(await read,{rows:[{id:'new'}],complete:true});assert.equal(calls,1);assert.equal(guard.deferred(),false);assert.equal(guard.resume(),false);
});
