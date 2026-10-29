import test from 'node:test';
import assert from 'node:assert/strict';
import {canAssist,defaults,validateConfig} from './policy.js';
test('pause overrides individual selection',()=>{assert.equal(canAssist({...defaults,mode:'off'},{on:true}),false)});
test('selection mode only includes selected fans',()=>{assert.equal(canAssist(defaults,{on:true}),true);assert.equal(canAssist(defaults,{on:false}),false)});
test('all mode includes fans regardless of saved selection',()=>{assert.equal(canAssist({...defaults,mode:'all'},{on:false}),true)});
test('waiting interval rejects invalid and inverted bounds',()=>{for(const [min,max] of [[30,10],[-1,30],[1,3601],[1.5,30],['',30]])assert.ok(validateConfig({...defaults,min,max}));assert.equal(validateConfig(defaults),'')});

test('global BRUFF pause and manual takeover override all mode',()=>{assert.equal(canAssist({...defaults,mode:'all',paused:true},{on:true}),false);assert.equal(canAssist({...defaults,mode:'all'},{on:true,humanPaused:true}),false)});
test('star rating respects thresholds and distinguishes unavailable spend',async()=>{const {starRating}=await import('./policy.js');assert.equal(starRating(null),null);assert.equal(starRating(0),0);assert.equal(starRating(9999),1);assert.equal(starRating(10000),2);assert.equal(starRating(250000),5);assert.ok(validateConfig({...defaults,starThresholds:[1,100,90,200,300]}))});
test('online campaigns exclude offline or unknown fans; selection does not expand',async()=>{const {campaignRecipients}=await import('./policy.js');const fans=[{id:1,online:true},{id:2,online:false},{id:3}];assert.deepEqual(campaignRecipients(fans,'online'),[1]);assert.deepEqual(campaignRecipients(fans,'selected',[2]),[2]);assert.deepEqual(campaignRecipients(fans,'selected',[]),[])});

// Account isolation and migration protect existing conversations when switching profiles.
import {scopeState,fansFor} from './creators.js';
test('profile migration preserves messages and runs only once',()=>{
 const original={fans:[{id:1,name:'Alex',messages:[{text:'Conservar',mine:true}]}],campaigns:[{id:'old'}]};
 const migrated=scopeState(original);
 assert.equal(fansFor(migrated,'luna')[0].messages[0].text,'Conservar');
 assert.deepEqual(fansFor(migrated,'valeria').map(f=>f.id),[101,102]);
 assert.equal(migrated.campaigns[0].creatorId,'luna');
 assert.deepEqual(scopeState(migrated),migrated);
 assert.equal(scopeState({...migrated,activeCreatorId:'valeria'}).activeCreatorId,'valeria');
});
