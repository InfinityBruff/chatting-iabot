import test from 'node:test';
import assert from 'node:assert/strict';
import {fanTier,spendCents} from './fan-tier.js';
test('fan levels follow exact USD boundaries including strictly greater tiers',()=>{
 for(const [cents,count] of [[0,0],[599,0],[600,1],[1700,1],[1701,2],[3500,2],[3501,3],[6000,3],[6001,4],[9499,4],[9500,5],[20000,5],[20001,5]])assert.equal(fanTier(cents).count,count,`${cents} cents`);
 assert.equal(fanTier(20000).diamond,false);assert.equal(fanTier(20001).diamond,true);
});
test('unavailable spend never looks like a zero-spend fan',()=>{
 for(const v of [null,undefined,NaN,Infinity,-1,'600',600.5])assert.deepEqual(fanTier(v),{count:null,diamond:false});
 assert.equal(spendCents({available:false,total:300}),null);assert.equal(spendCents({available:true,total:null}),null);assert.equal(spendCents({available:true,total:0}),0);assert.equal(spendCents({available:true,total:17.01}),1701);
});
