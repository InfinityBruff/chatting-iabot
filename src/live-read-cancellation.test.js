import test from 'node:test';import assert from 'node:assert/strict';
import {cancellableLiveRead} from './live-read-cancellation.js';
import {secondaryReads,foregroundReads} from './live-read-scheduler.js';
test('single financial pages support cancellation while retaining their background read lane',()=>{
 for(const operation of ['monthly','balances','transactions']){assert.equal(cancellableLiveRead(operation),true);assert.equal(secondaryReads.has(operation),true);assert.equal(foregroundReads.has(operation),false)}
 for(const category of ['total','messages','tips','subscriptions','posts','streams','referrals'])assert.equal(cancellableLiveRead('earnings',{category}),true);
 assert.equal(secondaryReads.has('earnings'),true);assert.equal(foregroundReads.has('earnings'),false);
 assert.equal(cancellableLiveRead('earnings'),false);assert.equal(cancellableLiveRead('earnings',{category:null}),false);
});
test('cancellation preserves chat support and never accepts a write or an unrelated background scan',()=>{
 for(const operation of ['inbox','messages','fan_profile','fan_history','fan_spend','fan_spend_batch','fan_activity','presence'])assert.equal(cancellableLiveRead(operation),true);
 for(const operation of ['send_message','prepare_send','upload','like_message','native_activate','native_cancel','collection_add','notifications'])assert.equal(cancellableLiveRead(operation,{category:'total'}),false);
});
