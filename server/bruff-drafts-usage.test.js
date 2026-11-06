import test from 'node:test';
import assert from 'node:assert/strict';
import {calculatedNeurons,providerUsage,reservedUsage,validUsage,validQuota} from '../supabase/functions/bruff-drafts/usage.js';

test('observed tokens produce an exact conservative tariff calculation, not a fixed reservation',()=>{
 assert.deepEqual(providerUsage({result:{usage:{prompt_tokens:1000,completion_tokens:500,total_tokens:1500}}}),{status:'observed',promptTokens:1000,completionTokens:500,calculatedNeurons:58,chargedNeurons:58});
 assert.equal(calculatedNeurons(1,0),1);
 assert.equal(calculatedNeurons(1_000_000,1_000_000),82364);
 assert.equal(calculatedNeurons(1_000_000,0),31876);
 assert.equal(calculatedNeurons(500000,500000),41182);
});

test('missing, string, fractional, inconsistent and out-of-bounds usage never fabricate zero consumption',()=>{
 const invalid=[null,{},[],{prompt_tokens:0,completion_tokens:0},{prompt_tokens:'1',completion_tokens:0},{prompt_tokens:1.5,completion_tokens:0},{prompt_tokens:1,completion_tokens:-1},{prompt_tokens:1,completion_tokens:1_000_001},{prompt_tokens:1_000_001,completion_tokens:0},{prompt_tokens:1,completion_tokens:2,total_tokens:4},{prompt_tokens:1,completion_tokens:2,total_tokens:'3'}];
 for(const usage of invalid)assert.deepEqual(providerUsage({result:{usage}}),reservedUsage());
 assert.deepEqual(providerUsage({usage:{prompt_tokens:1000,completion_tokens:500}}),reservedUsage(),'only the fixed provider result envelope is accepted');
 assert.equal(validUsage({status:'observed',promptTokens:1000,completionTokens:500,calculatedNeurons:57,chargedNeurons:57}),false);
 assert.equal(validUsage({...reservedUsage(),chargedNeurons:0}),false);
 assert.equal(validUsage({...reservedUsage(),promptTokens:0}),false);
 assert.equal(validUsage(reservedUsage()),true);
});

const quota=()=>({usageDay:'2026-11-06',resetsAt:'2026-11-07T00:00:00.000Z',modelQueries:3,modelDailyLimit:100,sharedBudgetNeurons:7500,calculatedNeurons:58,reservedNeurons:1200,chargedNeurons:1258,remainingNeurons:6242,observedRequests:1,reservedRequests:2});
test('quota preserves observed plus reserved units and the UTC reset without claiming account-wide free usage',()=>{
 assert.equal(validQuota(quota()),true);
 assert.equal(validQuota({...quota(),modelQueries:105,modelDailyLimit:100}),true,'lowering the limit does not erase existing queries');
 assert.equal(validQuota({...quota(),calculatedNeurons:9000,chargedNeurons:10200,remainingNeurons:0}),true,'observed overshoot must remain visible');
 for(const patch of [{usageDay:'2026-02-30'},{resetsAt:'2026-11-07T01:00:00Z'},{sharedBudgetNeurons:10000},{calculatedNeurons:'58'},{reservedNeurons:0},{chargedNeurons:58},{remainingNeurons:6243},{reservedRequests:-1},{modelDailyLimit:1001},{modelDailyLimit:0}])assert.equal(validQuota({...quota(),...patch}),false,JSON.stringify(patch));
});
